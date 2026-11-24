import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../cloud/supabase';
import SignaturePad from '../components/SignaturePad';
import { fmtDay, money, telUrl } from '../utils';
import { DECLINE_REASONS, PRIORITY, quoteOutcome, signStatement, termLines, videoUrl, type RequestKind, type WalkContent } from './model';

interface Loaded {
  kind: RequestKind;
  terms_agreed: boolean | null;
  content: WalkContent;
  video_path: string | null;
  expired: boolean;
  responded_at: string | null;
  decisions: Record<string, string> | null;
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
  const [agree, setAgree] = useState(false);
  const [choice, setChoice] = useState<'approved' | 'declined' | null>(null);
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');

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
  const kind = w.kind ?? 'walkaround';
  const isWalk = kind === 'walkaround';
  const done = !!w.responded_at;
  const shown = done ? w.decisions ?? {} : decisions;
  const approvedTotal = isWalk ? c.items.filter((i) => shown[i.id] === 'approved').reduce((s, i) => s + i.total, 0) : c.total ?? 0;
  const allDecided = !isWalk || c.items.every((i) => shown[i.id]);
  const isQuote = kind === 'quote';
  const outcome = quoteOutcome(w.decisions);
  const declined = isQuote && (done ? outcome?.outcome === 'declined' : choice === 'declined');
  const hasTerms = !!c.terms?.trim() && !declined;
  const statement = signStatement(kind, c.business.name, `${money(declined ? 0 : approvedTotal)}${c.gst ? ' (inc GST)' : ''}`, c.dueDate ? fmtDay(c.dueDate) : undefined, declined);

  async function submit() {
    setErr('');
    if (!allDecided) return setErr('Please choose Yes or No for every item.');
    if (isQuote && !choice) return setErr('Please choose Approve or Decline.');
    if (!name.trim()) return setErr('Please type your name.');
    if (!signature) return setErr('Please sign in the box.');
    if (hasTerms && !agree) return setErr('Please tick the box to agree to the terms and conditions.');
    setBusy(true);
    const { error } = await supabase.rpc('respond_walkaround', {
      p_token: token,
      p_decisions: isQuote
        ? { outcome: choice, reason: [reason, reasonNote.trim()].filter(Boolean).join(' – ') }
        : decisions,
      p_name: name.trim(),
      p_signature: signature,
      p_agree_terms: agree,
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
            {isWalk
              ? approvedTotal > 0 ? ` Approved work: ${money(approvedTotal)}${c.gst ? ' inc GST' : ''}.` : ' No work was approved.'
              : kind === 'quote'
                ? declined
                  ? ' You declined this quote.'
                  : ` You approved the quote for ${money(approvedTotal)}${c.gst ? ' inc GST' : ''}.`
                : ` You signed off the work: ${money(approvedTotal)}${c.gst ? ' inc GST' : ''}${c.dueDate ? `, due ${fmtDay(c.dueDate)}` : ''}.`}
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

      {!isWalk && (
        <section>
          <h2>{kind === 'quote' ? 'Quote' : 'Work completed'}{c.jobNumber ? ` · #${c.jobNumber}` : ''}</h2>
          {c.title && <p><strong>{c.title}</strong></p>}
          {c.description && <p className="small pre">{c.description}</p>}
          <table className="cust-lines">
            <tbody>
              {(c.lines ?? []).map((l, n) => (
                <tr key={n}>
                  <td>{l.description}{l.qty !== 1 && <span className="muted"> × {l.qty}</span>}</td>
                  <td>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="cust-sums">
            {c.gst && <div><span>Subtotal (ex GST)</span><span>{money(c.subtotal ?? 0)}</span></div>}
            {c.gst && <div><span>GST</span><span>{money(c.gstAmount ?? 0)}</span></div>}
          </div>
          <div className="cust-total">
            <span>Total{c.gst ? ' (inc GST)' : ''}</span>
            <strong>{money(c.total ?? 0)}</strong>
          </div>
          {c.dueDate && <p className="due">Payment due by <strong>{fmtDay(c.dueDate)}</strong></p>}
          {c.workNotes && (<><h3>Work carried out</h3><p className="small pre">{c.workNotes}</p></>)}
        </section>
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

      {isQuote && !done && !w.expired && (
        <section className="cust-choice">
          <h2>Your decision</h2>
          <div className="yn big">
            <button className={choice === 'approved' ? 'yes on' : 'yes'} onClick={() => { setChoice('approved'); setErr(''); }}>✓ Approve quote</button>
            <button className={choice === 'declined' ? 'no on' : 'no'} onClick={() => { setChoice('declined'); setErr(''); }}>✕ Decline quote</button>
          </div>
          {choice === 'declined' && (
            <div className="decline-reason">
              <span className="small">Reason (optional)</span>
              <div className="chips wrap">
                {DECLINE_REASONS.map((r) => (
                  <button key={r} className={`chip${reason === r ? ' active' : ''}`} onClick={() => setReason(reason === r ? '' : r)}>{r}</button>
                ))}
              </div>
              <input placeholder="Anything else you'd like to tell us?" value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
            </div>
          )}
        </section>
      )}

      {isQuote && done && outcome?.outcome === 'declined' && (
        <p className="declined-note">✕ Quote declined{outcome.reason ? ` – ${outcome.reason}` : ''}</p>
      )}

      {!done && !w.expired && (!isQuote || choice) && (
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
          <p className="consent"><strong>{statement}</strong></p>
          {hasTerms && <Terms text={c.terms!} />}
          {hasTerms && (
            <label className="agree">
              <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErr(''); }} />
              <span>I have read and agree to the terms and conditions</span>
            </label>
          )}
          {err && <p className="error">{err}</p>}
          <button className="btn primary block big" disabled={busy} onClick={submit}>
            {busy ? 'Sending…' : isQuote ? (declined ? 'Submit – decline quote' : 'Submit – approve quote') : 'Submit my response'}
          </button>
        </section>
      )}

      {done && w.signature && (
        <section className="cust-sign">
          <h2>Signed</h2>
          <img className="sig-img" src={w.signature} alt="Signature" />
          <p className="small">{w.signed_name}</p>
          <p className="consent"><strong>{statement}</strong></p>
          {hasTerms && <Terms text={c.terms!} />}
          {w.terms_agreed && <p className="small">✓ Agreed to the terms and conditions</p>}
        </section>
      )}
      <footer className="cust-foot">{c.business.abn && `ABN ${c.business.abn} · `}{c.business.email}</footer>
    </div>
  );
}

function Terms({ text }: { text: string }) {
  return (
    <details className="terms" open>
      <summary>Terms &amp; conditions</summary>
      <ol>
        {termLines(text).map((t, i) => (
          <li key={i}>{t.heading && <strong>{t.heading}: </strong>}{t.text}</li>
        ))}
      </ol>
    </details>
  );
}
