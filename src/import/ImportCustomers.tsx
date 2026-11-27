import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { PageHeader } from '../components/ui';
import { db } from '../db';
import { uid } from '../utils';
import { mapCustomers, parseCsv, type ImportResult, type Sheet } from './parseCustomers';

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

  if (!isAdmin) return <><PageHeader back title="Import customers" /><p className="muted">Importing is for the owner and admins.</p></>;

  async function pick(file?: File) {
    if (!file) return;
    setErr(''); setResult(null); setDone(0); setFileName(file.name);
    try {
      setResult(mapCustomers(await readFile(file), await db.customers.toArray()));
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

  const fresh = result?.rows.filter((r) => r.status === 'new') ?? [];
  const other = result?.rows.filter((r) => r.status !== 'new') ?? [];
  const shown = showAll ? fresh : fresh.slice(0, 8);

  return (
    <>
      <PageHeader back title="Import customers" />
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
          <li>Reports → <strong>Client List</strong> → download it.</li>
          <li>Choose that file below – .csv or .xlsx both work, even if the phone numbers look odd in Excel.</li>
        </ol>
        <p className="small muted">Any other spreadsheet works too, as long as the first row has headings like Name, Mobile, Email and Address.</p>
        <label className="btn primary block file-btn">
          📄 Choose file
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
            onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {err && <p className="error">{err}</p>}
      </section>

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
