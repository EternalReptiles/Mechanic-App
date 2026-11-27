import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { QuickText } from '../components/SendMessage';
import type { Customer, Job, Vehicle } from '../types';
import { firstName } from '../utils';
import { aiAssist } from './ai';

type Result = { workNotes: string; customerSummary: string };

/** ✨ Tidy up: turns rough or dictated notes into tidy job notes and a plain-English summary for the customer. */
export default function AiNotes({ job, vehicle, customer, update }: { job: Job; vehicle?: Vehicle; customer?: Customer; update: (p: Partial<Job>) => void }) {
  const { businessId } = useCloud();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [r, setR] = useState<Result | null>(null);
  const text = job.workNotes.trim();

  async function run() {
    setErr(''); setBusy(true);
    try {
      setR(await aiAssist<Result>('notes', businessId, {
        text, title: job.title, vehicle: [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.rego].filter(Boolean).join(' '),
      }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="ai-box">
      {!r && (
        <div className="row between wrap">
          <span className="small muted">🎤 Tip: tap the mic on your keyboard and just talk – then tidy it up.</span>
          <button className="btn small ai-btn" disabled={busy || text.length < 8} onClick={() => void run()}>{busy ? 'Tidying…' : '✨ Tidy up'}</button>
        </div>
      )}
      {err && <p className="error small">{err}</p>}
      {r && (
        <div className="ai-result">
          <h3>Job notes</h3>
          <p className="pre small">{r.workNotes}</p>
          <h3>For the customer</h3>
          <p className="pre small">{r.customerSummary}</p>
          <div className="row wrap">
            <button className="btn small primary" onClick={() => { update({ workNotes: r.workNotes }); setR(null); }}>Use job notes</button>
            <button className="btn small" onClick={() => { update({ workNotes: r.customerSummary }); setR(null); }}>Use customer version</button>
            {customer?.phone && (
              <QuickText className="btn small" customer={customer} jobId={job.id} label="💬 Text it"
                text={`Hi ${firstName(customer.name)},\n${r.customerSummary}`} />
            )}
            <button className="btn small ghost" onClick={() => setR(null)}>Discard</button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Written by AI – check it before you use it.</p>
        </div>
      )}
    </div>
  );
}
