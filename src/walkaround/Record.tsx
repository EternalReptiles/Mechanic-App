import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../cloud/supabase';
import { money } from '../utils';
import { consentText, PRIORITY, videoUrl, type WalkRecord } from './model';

const dt = (s: string | null) => (s ? new Date(s).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'long' }) : '—');

/** Printable proof of what the customer was shown and what they approved/declined. */
export default function Record() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [w, setW] = useState<WalkRecord | null | undefined>(undefined);
  useEffect(() => {
    supabase.from('walkarounds').select('*').eq('id', id).maybeSingle().then(({ data }) => setW((data as WalkRecord) ?? null));
  }, [id]);
  if (w === undefined) return <p className="empty">Loading…</p>;
  if (w === null) return <p className="empty">Record not found (are you online?).</p>;
  const c = w.content;

  return (
    <div className="doc-page">
      <div className="doc-toolbar no-print">
        <button className="btn" onClick={() => navigate(-1)}>← Back</button>
        <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      <article className="doc">
        <header className="doc-head">
          <div>
            {c.business.logo && <img src={c.business.logo} alt="" className="doc-logo" />}
            <h2>{c.business.name}</h2>
            {c.business.abn && <div className="small">ABN {c.business.abn}</div>}
          </div>
          <div className="doc-meta">
            <h1>Customer approval record</h1>
            <div>{w.responded_at ? 'SIGNED' : 'NOT YET SIGNED'}</div>
          </div>
        </header>

        <section className="doc-parties">
          <div>
            <h3>Customer</h3>
            <strong>{c.customerName || '—'}</strong>
            <div>Vehicle: {c.vehicle || '—'}</div>
          </div>
          <div>
            <h3>Timeline</h3>
            <div>Sent: {dt(w.created_at)} by {c.sentBy}</div>
            <div>Opened: {dt(w.viewed_at)}</div>
            <div>Signed: {dt(w.responded_at)}</div>
          </div>
        </section>

        {c.message && <p className="pre">{c.message}</p>}
        {w.video_path && <p className="small break">Video shown: <a href={videoUrl(w.video_path)}>{videoUrl(w.video_path)}</a></p>}

        <div className="table-wrap">
        <table className="doc-table">
          <thead><tr><th>Item</th><th>Priority</th><th>Price{c.gst ? ' (inc GST)' : ''}</th><th>Customer decision</th></tr></thead>
          <tbody>
            {c.items.map((i) => {
              const d = w.decisions?.[i.id];
              return (
                <tr key={i.id}>
                  <td>{i.title}{i.note && <div className="small muted">{i.note}</div>}</td>
                  <td>{PRIORITY[i.priority].label}</td>
                  <td>{money(i.total)}</td>
                  <td><strong className={d === 'approved' ? 'ok-text' : d === 'declined' ? 'danger-text' : ''}>{d === 'approved' ? 'APPROVED' : d === 'declined' ? 'DECLINED' : '—'}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="totals doc-totals">
          <div className="grand"><span>Approved total</span><span>{money(Number(w.approved_total ?? 0))}</span></div>
        </div>

        <section>
          <h3>Customer statement</h3>
          <p className="small">{consentText(c.business.name)}</p>
          {w.signature && <img src={w.signature} alt="Customer signature" className="record-sig" />}
          <div>{w.signed_name}</div>
        </section>

        <section className="audit">
          <h3>Audit details</h3>
          <div>Signed from IP address: {w.signer_ip || '—'}</div>
          <div>Device: {w.signer_user_agent || '—'}</div>
          <div>Record ID: {w.id}</div>
          <div>Content fingerprint (SHA-256 of the quote and video as sent): <code>{w.content_hash}</code></div>
          <div className="muted">The quote and video cannot be changed after sending, and the response cannot be changed after signing.</div>
        </section>
      </article>
    </div>
  );
}
