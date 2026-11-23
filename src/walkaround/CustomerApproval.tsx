import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../cloud/supabase';
import SignaturePad from '../components/SignaturePad';
import { money, telUrl } from '../utils';
import { consentText, PRIORITY, videoUrl, type WalkContent } from './model';

interface Loaded {
  content: WalkContent;
  video_path: string | null;
  expired: boolean;
  responded_at: string | null;
  decisions: Record<string, 'approved' | 'declined'> | null;
  approved_total: number | null;
  signed_name: string | null;
  signature: string | null;
}

/** Public page the customer opens from the link: watch, choose Yes/No per item, sign. */
export default function CustomerApproval() {
  const { token = '' } = useParams();
  const [w, setW] = useState<Loaded | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState('');
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'declined'>>({});
  const [name, setName] = useState('');
  const [signature, setSignature] = useState('');
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const { data, error } = await supabase.rpc('get_walkaround', { p_token: token });
    if (error) return setLoadErr("We couldn't load this page. Check your internet connection and try again.");
    setW((data as Loaded | null) ?? null);
    if (data) setName((data as Loaded).content.customerName);
  }
  useEffect(() => {
    void load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadErr) return <div className="cust"><p className="error">{loadErr}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div>;
  if (w === undefined) return <div className="cust"><p className="muted">Loading…</p></div>;
  if (w === null) return <div className="cust"><h1>Link not found</h1><p>This link isn't valid. Please check the message you were sent.</p></div>;

  const c = w.content;
  const done = !!w.responded_at;
  const shown = done ? w.decisions ?? {} : decisions;
  const approvedTotal = c.items.filter((i) => shown[i.id] === 'approved').reduce((s, i) => s + i.total, 0);
  const allDecided = c.items.every((i) => shown[i.id]);

  async function submit() {
    setErr('');
    if (!allDecided) return setErr('Please choose Yes or No for every item.');
    if (!name.trim()) return setErr('Please type your name.');
    if (!signature) return setErr('Please sign in the box.');
    setBusy(true);
    const { error } = await supabase.rpc('respond_walkaround', {
      p_token: token,
      p_decisions: decisions,
      p_name: name.trim(),
      p_signature: signature,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    window.scrollTo({ top: 0 });
    await load();
  }

  return (
    <div className="cust">
      <header className="cust-head">
        {c.business.logo && <img src={c.business.logo} alt="" />}
        <div>
          <strong>{c.business.name}</strong>
          {c.business.phone && <div><a href={telUrl(c.business.phone)}>📞 {c.business.phone}</a></div>}
        </div>
      </header>

      {done && (
        <div className="cust-done">
          <h1>✓ Thanks, {w.signed_name?.split(' ')[0]}!</h1>
          <p>
            Your response was sent to {c.business.name} on{' '}
            {new Date(w.responded_at!).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}.
            {approvedTotal > 0 ? ` Approved work: ${money(approvedTotal)}${c.gst ? ' inc GST' : ''}.` : ' No work was approved.'}
          </p>
          <button className="btn" onClick={() => window.print()}>Save a copy (PDF)</button>
        </div>
      )}
      {!done && w.expired && (
        <div className="cust-done">
          <h1>This quote has expired</h1>
          <p>Please contact {c.business.name}{c.business.phone ? ` on ${c.business.phone}` : ''} for an updated quote.</p>
        </div>
      )}

      {c.vehicle && <h2 className="cust-vehicle">🚗 {c.vehicle}</h2>}
      {c.message && <p className="cust-msg">{c.message}</p>}

      {w.video_path && (
        <video className="wa-video" src={videoUrl(w.video_path)} controls playsInline preload="metadata" />
      )}

      {c.items.length > 0 && (
        <section>
          <h2>Recommended work</h2>
          {c.items.map((i) => {
            const d = shown[i.id];
            return (
              <div key={i.id} className={`cust-item ${d ?? ''}`}>
                <div className="row between">
                  <strong>{i.title}</strong>
                  <span className="cust-price">{i.total ? money(i.total) : 'Price on request'}</span>
                </div>
                <span className="prio" style={{ background: PRIORITY[i.priority].color }}>{PRIORITY[i.priority].label}</span>
                {i.note && <p className="small">{i.note}</p>}
                {done ? (
                  <div className={`decision ${d}`}>{d === 'approved' ? '✓ Yes – go ahead' : '✕ No – not now'}</div>
                ) : (
                  !w.expired && (
                    <div className="yn">
                      <button className={d === 'approved' ? 'yes on' : 'yes'} onClick={() => setDecisions({ ...decisions, [i.id]: 'approved' })}>✓ Yes, do it</button>
                      <button className={d === 'declined' ? 'no on' : 'no'} onClick={() => setDecisions({ ...decisions, [i.id]: 'declined' })}>✕ Not now</button>
                    </div>
                  )
                )}
              </div>
            );
          })}
          <div className="cust-total">
            <span>Approved total{c.gst ? ' (inc GST)' : ''}</span>
            <strong>{money(approvedTotal)}</strong>
          </div>
        </section>
      )}

      {!done && !w.expired && (
        <section className="cust-sign">
          <h2>Confirm &amp; sign</h2>
          <label className="field">
            <span>Your full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          {signature ? (
            <div>
              <img className="sig-img" src={signature} alt="Your signature" />
              <button className="btn ghost" onClick={() => setSignature('')}>Sign again</button>
            </div>
          ) : signing ? (
            <SignaturePad autoScroll={false} onCancel={() => setSigning(false)} onSave={(s) => { setSignature(s); setSigning(false); }} />
          ) : (
            <button className="btn block" onClick={() => setSigning(true)}>✍ Tap to sign</button>
          )}
          <p className="consent">{consentText(c.business.name)}</p>
          {err && <p className="error">{err}</p>}
          <button className="btn primary block big" disabled={busy} onClick={submit}>
            {busy ? 'Sending…' : 'Submit my response'}
          </button>
        </section>
      )}

      {done && w.signature && (
        <section className="cust-sign">
          <h2>Signed</h2>
          <img className="sig-img" src={w.signature} alt="Signature" />
          <p className="small">{w.signed_name}</p>
          <p className="consent">{consentText(c.business.name)}</p>
        </section>
      )}
      <footer className="cust-foot">{c.business.abn && `ABN ${c.business.abn} · `}{c.business.email}</footer>
    </div>
  );
}
