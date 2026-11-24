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
  const [repairChoices, setRepairChoices] = useState<Record<string, 'approved' | 'declined'>>({});

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
  const isQuote = kind === 'quote';
  const outcome = quoteOutcome(w.decisions);
  // Quotes with 2+ repairs: the customer chooses per repair.
  const repairs = isQuote && (c.repairs?.length ?? 0) >= 2 ? c.repairs! : null;
  const repairShown: Record<string, string> = done ? outcome?.items ?? {} : repairChoices;
  const repairsDecided = !repairs || repairs.every((r) => repairShown[r.id]);
  const nYes = repairs ? repairs.filter((r) => repairShown[r.id] === 'approved').length : 0;
  const quoteChoice = repairs
    ? repairsDecided ? (nYes === repairs.length ? 'approved' : nYes === 0 ? 'declined' : 'partial') : null
    : choice;
  const approvedTotal = isWalk
    ? c.items.filter((i) => shown[i.id] === 'approved').reduce((s, i) => s + i.total, 0)
    : repairs
      ? repairs.filter((r) => repairShown[r.id] === 'approved').reduce((s, r) => s + r.total, 0)
      : c.total ?? 0;
  const allDecided = (!isWalk || c.items.every((i) => shown[i.id])) && repairsDecided;
  const declined = isQuote && (done ? outcome?.outcome === 'declined' : quoteChoice === 'declined');
  const partial = isQuote && (done ? outcome?.outcome === 'partial' : quoteChoice === 'partial');
  const hasTerms = !!c.terms?.trim() && !declined;
  const statement = signStatement(
    kind,
    c.business.name,
    `${money(declined ? 0 : approvedTotal)}${c.gst ? ' (inc GST)' : ''}`,
    c.dueDate ? fmtDay(c.dueDate) : undefined,
    declined,
    partial,
  );
  const setAll = (d: 'approved' | 'declined') => {
    setRepairChoices(Object.fromEntries(repairs!.map((r) => [r.id, d])));
    setErr('');
  };

  async function submit() {
    setErr('');
    if (!allDecided) return setErr(repairs ? 'Please choose Yes or No for every repair.' : 'Please choose Yes or No for every item.');
    if (isQuote && !quoteChoice) return setErr('Please choose Approve or Decline.');
    if (!name.trim()) return setErr('Please type your name.');
    if (!signature) return setErr('Please sign in the box.');
    if (hasTerms && !agree) return setErr('Please tick the box to agree to the terms and conditions.');
    setBusy(true);
    const { error } = await supabase.rpc('respond_walkaround', {
      p_token: token,
      p_decisions: isQuote
        ? repairs
          ? { items: repairChoices, reason: [reason, reasonNote.trim()].filter(Boolean).join(' – ') }
          : { outcome: choice, reason: [reason, reasonNote.trim()].filter(Boolean).join(' – ') }
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
                  : partial
                    ? ` You approved ${nYes} of ${repairs?.length} repairs: ${money(approvedTotal)}${c.gst ? ' inc GST' : ''}.`
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
          {repairs ? (
            <>
              <p className="small">
                There are {repairs.length} repairs. Choose the ones you'd like done now – you can leave the others for later.
              </p>
              {!done && !w.expired && (
                <div className="row wrap all-btns">
                  <button className="btn small" onClick={() => setAll('approved')}>✓ Approve all</button>
                  <button className="btn small" onClick={() => setAll('declined')}>✕ Decline all</button>
                </div>
              )}
              {repairs.map((r) => {
                const d = repairShown[r.id];
                return (
                  <div key={r.id} className={`cust-item ${d ?? ''}`}>
                    <div className="row between">
                      <strong>{r.title}</strong>
                      <span className="cust-price">{money(r.total)}</span>
                    </div>
                    <ul className="repair-lines">
                      {r.lines.map((l, n) => (
                        <li key={n}>{l.description}{l.qty !== 1 && ` × ${l.qty}`}</li>
                      ))}
                    </ul>
                    {done ? (
                      <div className={`decision ${d}`}>{d === 'approved' ? '✓ Yes – go ahead' : '✕ No – not now'}</div>
                    ) : (
                      !w.expired && (
                        <div className="yn">
                          <button className={d === 'approved' ? 'yes on' : 'yes'} onClick={() => { setRepairChoices({ ...repairChoices, [r.id]: 'approved' }); setErr(''); }}>✓ Yes, do it</button>
                          <button className={d === 'declined' ? 'no on' : 'no'} onClick={() => { setRepairChoices({ ...repairChoices, [r.id]: 'declined' }); setErr(''); }}>✕ Not now</button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
              <div className="cust-sums">
                <div><span>All repairs{c.gst ? ' (inc GST)' : ''}</span><span>{money(c.total ?? 0)}</span></div>
              </div>
              <div className="cust-total">
                <span>Approved{done ? '' : ' so far'}{c.gst ? ' (inc GST)' : ''}</span>
                <strong>{money(approvedTotal)}</strong>
              </div>
              {!done && !w.expired && (quoteChoice === 'partial' || quoteChoice === 'declined') && (
                <div className="decline-reason">
                  <span className="small">Why are you leaving some work for now? (optional)</span>
                  <div className="chips wrap">
                    {DECLINE_REASONS.map((x) => (
                      <button key={x} className={`chip${reason === x ? ' active' : ''}`} onClick={() => setReason(reason === x ? '' : x)}>{x}</button>
                    ))}
                  </div>
                  <input placeholder="Anything else you'd like to tell us?" value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
                </div>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
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

      {isQuote && !repairs && !done && !w.expired && (
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
      {isQuote && done && outcome?.outcome === 'partial' && outcome.reason && (
        <p className="declined-note">Reason for leaving some work: {outcome.reason}</p>
      )}

      {!done && !w.expired && (!isQuote || quoteChoice) && (
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
            {busy
              ? 'Sending…'
              : isQuote
                ? declined
                  ? 'Submit – decline quote'
                  : partial
                    ? `Submit – approve ${nYes} of ${repairs?.length} repairs`
                    : 'Submit – approve quote'
                : 'Submit my response'}
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
