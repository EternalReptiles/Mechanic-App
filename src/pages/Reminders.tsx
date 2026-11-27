import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, PageHeader } from '../components/ui';
import { createJob, db } from '../db';
import { useSettings } from '../hooks';
import type { Customer, Vehicle } from '../types';
import { daysUntil, fillTemplate, firstName, fmtDay, smsUrl, telUrl, vehicleLabel } from '../utils';
import { QuickText } from '../components/SendMessage';

type Due = { vehicle: Vehicle; customer?: Customer; kind: 'Service' | 'Rego'; date: string; days: number };

export default function Reminders() {
  const navigate = useNavigate();
  const settings = useSettings();
  const [windowDays, setWindowDays] = useState(30);
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? [];
  const cmap = new Map(customers.map((c) => [c.id, c]));

  const due: Due[] = [];
  for (const v of vehicles) {
    const customer = cmap.get(v.customerId);
    if (v.nextServiceDate) due.push({ vehicle: v, customer, kind: 'Service', date: v.nextServiceDate, days: daysUntil(v.nextServiceDate) });
    if (v.regoExpiry) due.push({ vehicle: v, customer, kind: 'Rego', date: v.regoExpiry, days: daysUntil(v.regoExpiry) });
  }
  const list = due.filter((d) => d.days <= windowDays).sort((a, b) => a.days - b.days);

  function message(d: Due) {
    const base = fillTemplate(settings.reminderMessage, {
      name: firstName(d.customer?.name ?? ''),
      business: settings.businessName,
      vehicle: [d.vehicle.make, d.vehicle.model].filter(Boolean).join(' ') || d.vehicle.rego,
      rego: d.vehicle.rego,
      date: fmtDay(d.date),
    });
    return d.kind === 'Rego'
      ? `Hi ${firstName(d.customer?.name ?? '')}, it's ${settings.businessName}. Just a heads-up that the rego on ${d.vehicle.rego} is due ${fmtDay(d.date)}. Need a safety/pink slip inspection? Reply and we'll come to you.`
      : base;
  }

  async function book(d: Due) {
    const job = await createJob({
      customerId: d.vehicle.customerId,
      vehicleId: d.vehicle.id,
      siteAddress: d.customer?.address ?? '',
      title: d.kind === 'Service' ? 'Scheduled service' : 'Rego inspection',
    });
    navigate(`/jobs/${job.id}`);
  }

  return (
    <>
      <PageHeader back title="Reminders" />
      <div className="chips">
        {[7, 30, 60, 90].map((n) => (
          <button key={n} className={`chip${windowDays === n ? ' active' : ''}`} onClick={() => setWindowDays(n)}>
            Due within {n} days
          </button>
        ))}
      </div>
      {list.length ? (
        list.map((d) => (
          <div key={d.vehicle.id + d.kind} className={`card reminder${d.days < 0 ? ' overdue' : ''}`}>
            <div className="row between">
              <strong>{d.kind} due · {vehicleLabel(d.vehicle)}</strong>
              <span className={`small ${d.days < 0 ? 'danger-text' : 'muted'}`}>
                {d.days < 0 ? `${-d.days} days overdue` : d.days === 0 ? 'Today' : `in ${d.days} days`}
              </span>
            </div>
            <div className="small">
              {d.customer ? <Link to={`/customers/${d.customer.id}`}>{d.customer.name}</Link> : 'No customer'} · {fmtDay(d.date)}
              {d.kind === 'Service' && d.vehicle.nextServiceKm && ` or ${d.vehicle.nextServiceKm} km`}
            </div>
            <div className="row wrap">
              {d.customer?.phone && <QuickText customer={d.customer} jobId={`vehicle:${d.vehicle.id}`} label="💬 Text reminder" text={message(d)} />}
              {d.customer?.phone && <a className="btn" href={telUrl(d.customer.phone)}>📞 Call</a>}
              <button className="btn primary" onClick={() => book(d)}>Book job</button>
            </div>
          </div>
        ))
      ) : (
        <Empty>
          Nothing due in the next {windowDays} days. Set "Next service due" on a vehicle (or tap "Remind in {settings.serviceIntervalMonths} months" when
          you finish a job) and it will show up here.
        </Empty>
      )}
    </>
  );
}
