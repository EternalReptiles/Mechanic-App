import type { Customer, Job, JobStatus, PaymentMethod, Vehicle } from '../types';
import { uid } from '../utils';
import { auPhone, type Cell, type Sheet } from './parseCustomers';

const clean = (v: Cell) => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n').trim();
const digits = (s: string) => s.replace(/\D/g, '');

/** Fixes text that was saved as UTF-8 but read back as Windows-1252 ("â€˜Start Jobâ€™"). */
export function fixMojibake(s: string) {
  if (!/[âÃ]/.test(s)) return s;
  return s
    .replace(/â€˜|â€™/g, "'").replace(/â€œ|â€\u009d|â€/g, '"').replace(/â€“|â€”/g, '-').replace(/â€¦/g, '...')
    .replace(/Â°/g, '°').replace(/Â /g, ' ').replace(/Â/g, '');
}

/** ServiceM8 writes "0000-00-00 00:00:00" for "never". */
function isoDate(v: Cell): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  const s = clean(v);
  if (!s || s.startsWith('0000')) return '';
  const d = new Date(s.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** First line like "Mazda CX5 - FIN011" (or "Commodore Running Rough - 739SRR") → vehicle. */
export function parseVehicleLine(text: string): { make: string; model: string; rego: string } | null {
  for (const line of text.split('\n').slice(0, 2)) {
    const m = line.trim().match(/^(.{2,40}?)\s*[-–]\s*([A-Za-z0-9]{2,7})\s*$/);
    if (!m || !/\d/.test(m[2])) continue;
    // "Puegeot - Service - 452DQ2": the car is the part before any other dash.
    const words = m[1].split(/\s+[-–]\s+/)[0].trim().split(/\s+/);
    if (NOT_A_MAKE.test(words[0] ?? '')) return { make: '', model: '', rego: m[2].toUpperCase() };
    return { make: cap(words[0]), model: words.slice(1).join(' '), rego: m[2].toUpperCase() };
  }
  return null;
}
const NOT_A_MAKE = /^(service|quote|replace|repair|install|attend|check|customer|logbook|brakes?|tyres?|battery|rego|inspection|pre-?purchase)$/i;
const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

function odometerFrom(text: string) {
  const m = text.match(/^\s*([\d][\d,. ]{2,9})\s*k(?:m|ms)?\b/im);
  return m ? m[1].replace(/\D/g, '') : '';
}

export type JobImport = {
  jobs: Job[];
  newCustomers: Customer[];
  newVehicles: Vehicle[];
  skipped: { label: string; reason: string }[];
  summary: { total: number; paid: number; vehicles: number; matchedCustomers: number };
};

export const isSm8JobList = (sheet: Sheet) => {
  const h = (sheet[0] ?? []).map((x) => clean(x).toLowerCase());
  return h.includes('job number') && h.includes('work completed');
};

/** ServiceM8 Job List → Spannr jobs (with customers and vehicles matched or created). */
export function mapSm8Jobs(sheet: Sheet, opts: { customers: Customer[]; vehicles: Vehicle[]; jobs: Job[]; gst: boolean; labourRate: number }): JobImport {
  const head = sheet[0].map((h) => clean(h).toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const get = (r: Cell[], n: string) => r[col(n)];

  const customers = [...opts.customers];
  const vehicles = [...opts.vehicles];
  const newCustomers: Customer[] = [];
  const newVehicles: Vehicle[] = [];
  const jobs: Job[] = [];
  const skipped: JobImport['skipped'] = [];
  const done = new Set(opts.jobs.map((j) => j.importKey).filter(Boolean));
  let matchedCustomers = 0;

  for (const r of sheet.slice(1)) {
    const num = clean(get(r, 'job number'));
    if (!/^\d+$/.test(num)) { skipped.push({ label: `Job ${num || '?'}`, reason: 'Sample or blank job' }); continue; }
    const key = `servicem8:${num}`;
    if (done.has(key)) { skipped.push({ label: `Job ${num}`, reason: 'Already imported' }); continue; }

    // ---- customer ----
    const first = clean(get(r, 'contact first')) || clean(get(r, 'billing contact first'));
    const last = clean(get(r, 'contact last')) || clean(get(r, 'billing contact last'));
    const company = clean(get(r, 'company'));
    const companyName = /^[^,]+,\s*[^,]+$/.test(company) ? company.split(',').map((s) => s.trim()).reverse().join(' ') : company;
    const name = `${first} ${last}`.trim() || companyName;
    const phone = auPhone(get(r, 'job contact mobile number') ?? null) || auPhone(get(r, 'billing contact mobile number') ?? null)
      || auPhone(get(r, 'job telephone number') ?? null) || auPhone(get(r, 'billing telephone number') ?? null);
    const email = (clean(get(r, 'job email address')) || clean(get(r, 'billing email address'))).toLowerCase();
    const pd = digits(phone);
    let cust = customers.find((c) => pd.length >= 8 && digits(c.phone) === pd)
      ?? customers.find((c) => email && c.email.toLowerCase() === email)
      ?? customers.find((c) => name && c.name.toLowerCase() === name.toLowerCase());
    if (cust) matchedCustomers++;
    else if (name || phone || email) {
      cust = {
        id: uid(), name: name || 'Customer', phone, email, address: clean(get(r, 'billing address')) || clean(get(r, 'job address')),
        notes: 'Imported from ServiceM8', createdAt: isoDate(get(r, 'date')) || new Date().toISOString(),
      };
      customers.push(cust);
      newCustomers.push(cust);
    }

    // ---- vehicle ----
    const desc = fixMojibake(clean(get(r, 'description of work')));
    const work = fixMojibake(clean(get(r, 'work completed')));
    const v = parseVehicleLine(work) ?? parseVehicleLine(desc);
    const odo = odometerFrom(work);
    let veh: Vehicle | undefined;
    if (v) {
      veh = vehicles.find((x) => x.rego.replace(/\s/g, '').toUpperCase() === v.rego);
      if (!veh && cust) {
        veh = { id: uid(), customerId: cust.id, rego: v.rego, make: v.make, model: v.model, year: '', vin: '', odometer: odo, notes: 'Imported from ServiceM8' };
        vehicles.push(veh);
        newVehicles.push(veh);
      } else if (veh && odo && Number(odo) > Number(veh.odometer || 0)) {
        veh.odometer = odo;
        if (!newVehicles.includes(veh)) newVehicles.push(veh); // save the newer reading
      }
    }

    // ---- job ----
    const sm8Status = clean(get(r, 'job status')).toLowerCase();
    const paid = Number(get(r, 'payment received')) === 1;
    const invoiceSent = Number(get(r, 'invoice sent')) === 1;
    const total = Number(get(r, 'total invoice amount')) || 0;
    const status: JobStatus = sm8Status === 'unsuccessful' ? 'cancelled'
      : sm8Status === 'quote' ? 'quote'
      : sm8Status === 'work order' ? 'scheduled'
      : paid ? 'paid' : invoiceSent ? 'invoiced' : 'completed';
    const pm = clean(get(r, 'payment method')).toLowerCase();
    const paymentMethod: PaymentMethod | undefined = !paid ? undefined
      : pm === 'cash' ? 'cash' : pm === 'card' || pm.includes('servicem8 pay') ? 'card' : pm === 'eft' ? 'transfer' : 'other';
    const created = isoDate(get(r, 'date')) || new Date().toISOString();
    const descLines = desc.split('\n').map((l) => l.trim()).filter((l) => l && !/^-?\s*(remember to|take ')/i.test(l));
    const workLines = work.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstWork = workLines.find((l) => !parseVehicleLine(l) && !/^\s*[\d][\d,. ]{2,9}\s*k/i.test(l)) ?? '';
    const titleSrc = descLines.find((l) => !/^customer booked/i.test(l)) ?? firstWork;
    const title = titleSrc.split(/\.\s/)[0].replace(/\s*[-–]\s*[A-Za-z0-9]{2,7}$/, '').replace(/[.]\s*$/, '').slice(0, 70) || 'ServiceM8 job';

    jobs.push({
      id: uid(),
      number: Number(num),
      customerId: cust?.id ?? '',
      vehicleId: veh?.id ?? '',
      status,
      title,
      description: descLines.join('\n'),
      siteAddress: clean(get(r, 'job address')),
      scheduledStart: '',
      durationMins: 60,
      odometer: odo,
      lineItems: total > 0 ? [{
        id: uid(), type: 'other', description: `ServiceM8 job #${num}${clean(get(r, 'payment method')) ? ` (paid by ${clean(get(r, 'payment method'))})` : ''}`,
        qty: 1, unitPrice: Math.round((opts.gst ? total / 1.1 : total) * 10000) / 10000,
      }] : [],
      workNotes: work,
      createdAt: created,
      invoicedAt: isoDate(get(r, 'invoice date')) || (paid ? isoDate(get(r, 'payment received date')) : ''),
      paidAt: paid ? (isoDate(get(r, 'payment received date')) || isoDate(get(r, 'invoice date')) || created) : '',
      paymentMethod,
      finishedAt: isoDate(get(r, 'completion date')) || undefined,
      imported: 'ServiceM8',
      importKey: key,
    });
    done.add(key);
  }

  return {
    jobs, newCustomers, newVehicles, skipped,
    summary: { total: jobs.length, paid: jobs.filter((j) => j.status === 'paid').length, vehicles: newVehicles.length, matchedCustomers },
  };
}
