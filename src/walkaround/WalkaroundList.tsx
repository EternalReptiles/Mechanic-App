import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import type { Job } from '../types';
import { fmtDateTime, money, uid } from '../utils';
import { KIND_LABEL, quoteOutcome, shareLink, type RequestKind, type WalkRecord } from './model';

/** Requests sent to the customer for a job (walk-arounds, quote approvals, sign-offs) and their answers. */
export default function ApprovalList({
  job,
  kinds,
  refreshKey,
  onAddLines,
  onApplyQuote,
}: {
  job: Job;
  kinds: RequestKind[];
  refreshKey?: unknown;
  onAddLines?: (lines: Job['lineItems'], walkId: string) => void;
  /** Quote with per-repair choices: drop declined repairs from the job */
  onApplyQuote?: (w: WalkRecord) => void;
}) {
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
      .in('kind', kinds)
      .order('created_at', { ascending: false });
    if (error) return setErr(error.message);
    setErr('');
    const rows = (data ?? []) as WalkRecord[];
    setList(rows);
    const unseen = rows.filter((r) => r.responded_at && !r.seen_by_business_at).map((r) => r.id);
    if (unseen.length) await supabase.from('walkarounds').update({ seen_by_business_at: new Date().toISOString() }).in('id', unseen);
  }, [businessId, job.id, kinds.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (err) return <p className="muted small">{err}</p>;
  if (!list?.length) return null;

  return (
    <div className="approval-list">
      <div className="row between">
        <h3 className="sub">Sent to customer</h3>
        <button className="btn ghost small" onClick={() => void load()} aria-label="Refresh">↻</button>
      </div>
      {list.map((w) => {
        const items = w.content.items;
        const approved = items.filter((i) => w.decisions?.[i.id] === 'approved');
        const applied = job.appliedWalkarounds?.includes(w.id);
        const qo = w.kind === 'quote' ? quoteOutcome(w.decisions) : null;
        return (
          <div key={w.id} className={`wa-row${w.responded_at ? (qo?.outcome === 'declined' ? ' declined' : ' responded') : ''}`}>
            <div className="small muted">
              {KIND_LABEL[w.kind]} · {w.delivered_at || w.viewed_at ? `sent ${fmtDateTime(w.delivered_at || w.created_at)}` : `made ${fmtDateTime(w.created_at)}`}
              {w.kind !== 'walkaround' && w.content.total != null && ` · ${money(w.content.total)}`}
            </div>
            {w.responded_at ? (
              w.kind === 'walkaround' ? (
                <div>
                  <strong>✍ Signed by {w.signed_name}</strong> – approved {approved.length} of {items.length} ({money(Number(w.approved_total ?? 0))})
                  <ul className="wa-decisions">
                    {items.map((i) => (
                      <li key={i.id} className={w.decisions?.[i.id]}>{w.decisions?.[i.id] === 'approved' ? '✓' : '✕'} {i.title}</li>
                    ))}
                  </ul>
                </div>
              ) : qo && w.content.repairs && w.content.repairs.length >= 2 ? (
                <div>
                  <strong>
                    {qo.outcome === 'declined' ? '✕ Declined' : '✍ Signed'} by {w.signed_name}
                  </strong>{' '}
                  – approved {w.content.repairs.filter((r) => qo.items[r.id] === 'approved').length} of {w.content.repairs.length} repairs (
                  {money(Number(w.approved_total ?? 0))})
                  <ul className="wa-decisions">
                    {w.content.repairs.map((r) => (
                      <li key={r.id} className={qo.items[r.id]}>{qo.items[r.id] === 'approved' ? '✓' : '✕'} {r.title} ({money(r.total)})</li>
                    ))}
                  </ul>
                  {qo.reason && <div className="small muted">Reason: {qo.reason}</div>}
                </div>
              ) : qo?.outcome === 'declined' ? (
                <div>
                  <strong>✕ Declined by {w.signed_name}</strong>{qo.reason && ` – ${qo.reason}`}
                  <div className="small muted">Signed to confirm they declined the work</div>
                </div>
              ) : (
                <div>
                  <strong>✍ Signed by {w.signed_name}</strong> – {w.kind === 'quote' ? 'quote approved' : 'job signed off'} ({money(Number(w.approved_total ?? 0))})
                  {w.terms_agreed && <div className="small muted">Agreed to terms &amp; conditions</div>}
                </div>
              )
            ) : (
              <div>{w.viewed_at ? `👀 Opened ${fmtDateTime(w.viewed_at)} – waiting for signature` : w.delivered_at ? '📨 Sent – not opened yet' : '📝 Link made – not sent to the customer yet'}</div>
            )}
            <div className="row wrap">
              <Link className="btn small" to={`/walkaround/${w.id}`}>📄 Record</Link>
              {!w.responded_at && (
                <button className="btn small" onClick={() => navigator.clipboard?.writeText(shareLink(w.token)).then(async () => {
                  if (!w.delivered_at) { await supabase.from('walkarounds').update({ delivered_at: new Date().toISOString() }).eq('id', w.id); void load(); }
                  alert('Link copied');
                })}>📋 Copy link</button>
              )}
              {onAddLines && w.responded_at && approved.length > 0 && !applied && (
                <button className="btn primary small" onClick={() => onAddLines(approved.flatMap((i) => i.lines.map((l) => ({ ...l, id: uid() }))), w.id)}>
                  + Add approved work to job
                </button>
              )}
              {onApplyQuote && w.kind === 'quote' && w.responded_at && !applied &&
                (w.content.repairs?.length ?? 0) >= 2 && quoteOutcome(w.decisions)?.outcome !== 'approved' && (
                  <button className="btn primary small" onClick={() => onApplyQuote(w)}>Update job to approved repairs</button>
                )}
              {applied && <span className="small pill-ok">✓ {w.kind === 'quote' ? 'Job updated' : 'Added to job'}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Inspection tab: start a new video walk-around and see earlier ones. */
export function WalkaroundSection({ job, onAddLines }: { job: Job; onAddLines: (lines: Job['lineItems'], walkId: string) => void }) {
  return (
    <section className="card">
      <h2>📹 Video walk-around</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Film the car, list what it needs with prices, and send it. The customer approves or declines each item and signs.
      </p>
      <Link className="btn primary block" to={`/jobs/${job.id}/video`}>🎥 New video walk-around</Link>
      <ApprovalList job={job} kinds={['walkaround']} onAddLines={onAddLines} />
    </section>
  );
}
