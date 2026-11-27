import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { PageHeader } from '../components/ui';
import { db } from '../db';
import { uid } from '../utils';
import { useSettings } from '../hooks';
import { mapCustomers, parseCsv, type ImportResult, type Sheet } from './parseCustomers';
import { isSm8JobList, mapSm8Jobs, type JobImport } from './parseJobs';

async function readFile(file: File): Promise<Sheet> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as Sheet;
  }
  if (/\.xls$/i.test(file.name)) throw new Error('That is an old Excel file (.xls). Open it and save it as .xlsx or .csv first.');
  return parseCsv(await file.text());
}

/** Settings → Import customers: bring customers over from ServiceM8 (client list) or any spreadsheet. */
export default function ImportCustomers() {
  const { isAdmin } = useCloud();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [jobs, setJobs] = useState<JobImport | null>(null);
  const [doneJobs, setDoneJobs] = useState('');
  const settings = useSettings();

  if (!isAdmin) return <><PageHeader back title="Import customers" /><p className="muted">Importing is for the owner and admins.</p></>;

  async function pick(file?: File) {
    if (!file) return;
    setErr(''); setResult(null); setJobs(null); setDone(0); setDoneJobs(''); setFileName(file.name);
    try {
      const sheet = await readFile(file);
      if (isSm8JobList(sheet)) {
        setJobs(mapSm8Jobs(sheet, {
          customers: await db.customers.toArray(), vehicles: await db.vehicles.toArray(), jobs: await db.jobs.toArray(),
          gst: settings.gstRegistered, labourRate: settings.labourRate,
          serviceMonths: settings.serviceIntervalMonths, serviceKm: settings.serviceIntervalKm,
        }));
        return;
      }
      setResult(mapCustomers(sheet, await db.customers.toArray()));
    } catch (e) {
      setErr((e as Error).message || "Couldn't read that file.");
    }
  }

  async function run() {
    if (!result) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const add = result.rows.filter((r) => r.status === 'new').map(({ status: _s, reason: _r, ...c }) => ({ ...c, id: uid(), createdAt: now }));
      await db.customers.bulkAdd(add);
      setDone(add.length);
      setResult(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runJobs() {
    if (!jobs) return;
    setBusy(true);
    try {
      await db.transaction('rw', db.customers, db.vehicles, db.jobs, async () => {
        if (jobs.newCustomers.length) await db.customers.bulkAdd(jobs.newCustomers);
        if (jobs.newVehicles.length) await db.vehicles.bulkPut(jobs.newVehicles);
        await db.jobs.bulkAdd(jobs.jobs);
      });
      setDoneJobs(`${jobs.jobs.length} jobs and ${jobs.newVehicles.length} vehicles`);
      setJobs(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fresh = result?.rows.filter((r) => r.status === 'new') ?? [];
  const other = result?.rows.filter((r) => r.status !== 'new') ?? [];
  const shown = showAll ? fresh : fresh.slice(0, 8);

  return (
    <>
      <PageHeader back title="Import from ServiceM8" />
      {doneJobs && (
        <section className="card banner-ok">
          <strong>✓ Imported {doneJobs}.</strong>
          <p className="small" style={{ margin: '4px 0 0' }}>They're marked as imported, so no texts or reminders go out for old jobs. <Link to="/jobs">See jobs</Link></p>
        </section>
      )}
      {done > 0 && (
        <section className="card banner-ok">
          <strong>✓ Imported {done} customers.</strong>
          <p className="small" style={{ margin: '4px 0 0' }}>They'll sync to your other devices in a moment. <Link to="/customers">See customers</Link></p>
        </section>
      )}

      <section className="card">
        <h2>From ServiceM8</h2>
        <ol className="small steps">
          <li>On a computer, open the ServiceM8 online dashboard (owner login).</li>
          <li>Settings → ServiceM8 Add-ons → turn on <strong>Advanced Reporting Pack</strong>.</li>
          <li>Reports → <strong>Client List</strong> → download it, and choose it below first.</li>
          <li>Then Reports → <strong>Job List</strong> → download it and choose it below – this brings in past jobs and the cars (from lines like "Mazda CX5 - ABC123").</li>
        </ol>
        <p className="small muted">.csv or .xlsx both work, even if the phone numbers look odd in Excel.</p>
        <p className="small muted">Any other spreadsheet works too, as long as the first row has headings like Name, Mobile, Email and Address.</p>
        <label className="btn primary block file-btn">
          📄 Choose file
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
            onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {err && <p className="error">{err}</p>}
      </section>

      {jobs && (
        <section className="card">
          <h2>{fileName}</h2>
          <p style={{ marginTop: 0 }}>
            <strong>{jobs.summary.total} jobs</strong> ({jobs.summary.paid} paid) · <strong>{jobs.summary.vehicles} vehicles</strong>
            {jobs.newCustomers.length > 0 && <> · {jobs.newCustomers.length} new customer{jobs.newCustomers.length > 1 ? 's' : ''}</>}
          </p>
          <p className="small muted" style={{ marginTop: 0 }}>
            {jobs.summary.matchedCustomers} jobs matched to customers already in Spannr. Import the Client List first so jobs land on the right customers.
          </p>
          <div className="import-list">
            {jobs.jobs.slice(0, showAll ? undefined : 8).map((j) => (
              <div key={j.id} className="import-row">
                <strong>#{j.number} {j.title}</strong>
                <span className="small muted">{new Date(j.createdAt).toLocaleDateString('en-AU')} · {j.status}{j.odometer ? ` · ${Number(j.odometer).toLocaleString('en-AU')} km` : ''}</span>
              </div>
            ))}
          </div>
          {jobs.jobs.length > 8 && !showAll && <button className="link small" onClick={() => setShowAll(true)}>Show all {jobs.jobs.length}</button>}
          {jobs.skipped.length > 0 && (
            <details className="small" style={{ marginTop: 8 }}>
              <summary>Skipped ({jobs.skipped.length})</summary>
              {jobs.skipped.map((x, i) => <div key={i} className="muted">{x.label} – {x.reason}</div>)}
            </details>
          )}
          <p className="small muted">Imported jobs keep their ServiceM8 numbers and totals, and never send texts, reminders or review requests.</p>
          <button className="btn primary block" disabled={busy || !jobs.jobs.length} onClick={() => void runJobs()}>
            {busy ? 'Importing…' : `Import ${jobs.jobs.length} jobs`}
          </button>
        </section>
      )}

      {result && (
        <section className="card">
          <h2>{fileName}</h2>
          <p style={{ marginTop: 0 }}>
            <strong>{fresh.length} new customers</strong> from {result.source}
            {other.length > 0 && <span className="muted"> · {other.length} skipped</span>}
          </p>
          {result.damagedPhones > 0 && (
            <p className="notice small">
              {result.damagedPhones} phone number{result.damagedPhones > 1 ? 's were' : ' was'} saved by Excel as something like "4.12E+08", so the digits are lost – those customers will import without a phone.
              For all the numbers, download the file from ServiceM8 again and choose it here without opening it in Excel first (or save it as .xlsx).
            </p>
          )}
          <div className="import-list">
            {shown.map((r, i) => (
              <div key={i} className="import-row">
                <strong>{r.name}</strong>
                <span className="small muted">{[r.phone, r.email, r.address].filter(Boolean).join(' · ') || 'No contact details'}</span>
              </div>
            ))}
          </div>
          {fresh.length > shown.length && <button className="link small" onClick={() => setShowAll(true)}>Show all {fresh.length}</button>}
          {other.length > 0 && (
            <details className="small" style={{ marginTop: 8 }}>
              <summary>Skipped ({other.length})</summary>
              {other.map((r, i) => <div key={i} className="muted">{r.name || '(no name)'} – {r.reason}</div>)}
            </details>
          )}
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy || !fresh.length} onClick={() => void run()}>
            {busy ? 'Importing…' : `Import ${fresh.length} customers`}
          </button>
        </section>
      )}
    </>
  );
}
