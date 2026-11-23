import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import type { Job } from '../types';
import { fmtDateTime, money, uid } from '../utils';
import { shareLink, type WalkRecord } from './model';

/** Sent walk-arounds for a job, with their status and the customer's answers. */
export default function WalkaroundList({ job, onAddLines }: { job: Job; onAddLines: (lines: Job['lineItems'], walkId: string) => void }) {
  const { businessId } = useCloud();
  const [list, setList] = useState<WalkRecord[] | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!navigator.onLine) return setErr('Offline – connect to see customer responses.');
    const { data, error } = await supabase
      .from('walkarounds')
      .select('*')
      .eq('business_id', businessId)
      .eq('job_id', job.id)
      .order('created_at', { ascending: false });
    if (error) return setErr(error.message);
    setErr('');
    const rows = (data ?? []) as WalkRecord[];
    setList(rows);
    const unseen = rows.filter((r) => r.responded_at && !r.seen_by_business_at).map((r) => r.id);
    if (unseen.length) await supabase.from('walkarounds').update({ seen_by_business_at: new Date().toISOString() }).in('id', unseen);
  }, [businessId, job.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card">
      <div className="row between">
        <h2>📹 Video walk-around</h2>
        <button className="btn ghost small" onClick={() => void load()}>↻</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Film the car, list what it needs with prices, and send it. The customer approves or declines each item and signs.
      </p>
      <Link className="btn primary block" to={`/jobs/${job.id}/video`}>🎥 New video walk-around</Link>
      {err && <p className="muted small">{err}</p>}
      {list?.map((w) => {
        const items = w.content.items;
        const approved = items.filter((i) => w.decisions?.[i.id] === 'approved');
        const applied = job.appliedWalkarounds?.includes(w.id);
        return (
          <div key={w.id} className={`wa-row${w.responded_at ? ' responded' : ''}`}>
            <div className="small muted">Sent {fmtDateTime(w.created_at)} · {items.length} item{items.length === 1 ? '' : 's'}</div>
            {w.responded_at ? (
              <div>
                <strong>✍ Signed by {w.signed_name}</strong> – approved {approved.length} of {items.length} ({money(Number(w.approved_total ?? 0))})
                <ul className="wa-decisions">
                  {items.map((i) => (
                    <li key={i.id} className={w.decisions?.[i.id]}>{w.decisions?.[i.id] === 'approved' ? '✓' : '✕'} {i.title}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>{w.viewed_at ? `👀 Opened ${fmtDateTime(w.viewed_at)} – waiting for answer` : '📨 Sent – not opened yet'}</div>
            )}
            <div className="row wrap">
              <Link className="btn small" to={`/walkaround/${w.id}`}>📄 Record</Link>
              {!w.responded_at && (
                <button className="btn small" onClick={() => navigator.clipboard?.writeText(shareLink(w.token)).then(() => alert('Link copied'))}>📋 Copy link</button>
              )}
              {w.responded_at && approved.length > 0 && !applied && (
                <button className="btn primary small" onClick={() =>
                  onAddLines(approved.flatMap((i) => i.lines.map((l) => ({ ...l, id: uid() }))), w.id)
                }>+ Add approved work to job</button>
              )}
              {applied && <span className="small pill-ok">✓ Added to job</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
