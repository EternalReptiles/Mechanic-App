import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import Upgrade from '../components/Upgrade';
import { sendFromSpannr } from '../components/SendMessage';
import { useSettings } from '../hooks';
import type { Customer, Job } from '../types';
import { money, totals } from '../utils';
import { cancelTap, onTapToPayProgress, TAP_TO_PAY_NAME, tapToPayAvailable, tapToPayForJob, type TapPhase } from './terminal';

type Outcome = { kind: 'approved' | 'declined' | 'cancelled'; text: string; amount: number };

/** Apple's configuration progress while Tap to Pay on iPhone gets ready (required by Apple's review). */
export function TapToPayProgress() {
  const [p, setP] = useState<number | null>(null);
  useEffect(() => onTapToPayProgress(setP), []);
  if (p === null) return null;
  return (
    <div className="ttp-progress" role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="small">Configuring {TAP_TO_PAY_NAME}… {Math.round(p * 100)}%</div>
      <div className="bar"><span style={{ width: `${Math.max(4, p * 100)}%` }} /></div>
      <div className="small muted">{TAP_TO_PAY_NAME} isn't ready yet – this only takes a moment.</div>
    </div>
  );
}

/**
 * The checkout button: always shown (Apple 5.3) at the top of the job's Billing tab (5.2). The first press on a
 * phone runs setup (Apple's terms + How to Tap), then the payment.
 */
export default function TapToPay({ job, customer, businessName, onPaid }: {
  job: Job; customer?: Customer; businessName: string; onPaid: (paidAt: string) => void;
}) {
  const { businessId, can, isAdmin } = useCloud();
  const settings = useSettings();
  const [phase, setPhase] = useState<TapPhase | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [receipt, setReceipt] = useState('');
  if (!tapToPayAvailable) return null;
  if (!can('tapToPay')) return <Upgrade feature="tapToPay" what={TAP_TO_PAY_NAME} />;
  const total = totals(job.lineItems, settings.gstRegistered).total;
  const cents = Math.round(total * 100);

  async function tap() {
    setOutcome(null);
    setReceipt('');
    if (!isAdmin) return setOutcome({ kind: 'cancelled', amount: cents, text: `Ask the business owner or an admin to turn on ${TAP_TO_PAY_NAME} first.` });
    if (!navigator.onLine) return setOutcome({ kind: 'cancelled', amount: cents, text: "You're offline. Tap to Pay needs signal." });
    try {
      const r = await tapToPayForJob(businessId, businessName, job.id, setPhase);
      if (r.status !== 'succeeded') throw new Error('The card was declined – no money was taken.');
      setOutcome({ kind: 'approved', amount: r.amount ?? cents, text: `Approved – ${money((r.amount ?? cents) / 100)} paid by card. The receipt has been sent to the customer.` });
      onPaid(r.paidAt ?? new Date().toISOString());
    } catch (e) {
      const text = (e as Error).message;
      setOutcome({ kind: /cancel/i.test(text) ? 'cancelled' : 'declined', amount: cents, text });
    } finally {
      setPhase(null);
    }
  }

  // Apple 5.10: a digital receipt is available whether the payment was approved or declined.
  async function sendDeclinedReceipt(channel: 'sms' | 'email') {
    if (!customer) return;
    try {
      const body = `Your card payment of ${money(cents / 100)} to ${businessName || 'us'} for job #${job.number} was declined. No money was taken.`;
      await sendFromSpannr(businessId, customer.id, job.id, channel, `Payment declined – ${businessName}`, body);
      setReceipt(`✓ Declined receipt sent by ${channel === 'sms' ? 'text' : 'email'}.`);
    } catch (e) {
      setReceipt((e as Error).message);
    }
  }

  if (outcome?.kind === 'approved') return <p className="paid-note ttp-result">✓ {outcome.text}</p>;

  return (
    <section className="card tap-to-pay">
      {phase === 'preparing' ? (
        <div className="ttp-status">
          <div className="spinner" aria-hidden="true" />
          <strong>Preparing {TAP_TO_PAY_NAME}…</strong>
          <TapToPayProgress />
        </div>
      ) : phase === 'processing' ? (
        <div className="ttp-status">
          <div className="spinner" aria-hidden="true" />
          <strong>Processing payment…</strong>
          <span className="small muted">Don't close Spannr until this finishes.</span>
        </div>
      ) : phase === 'tapping' ? (
        <div className="ttp-status">
          <strong>Ready – ask the customer to tap their card, phone or watch</strong>
          <button className="btn ghost block" onClick={() => void cancelTap()}>Cancel</button>
        </div>
      ) : (
        <button className="btn primary block big ttp-button" disabled={!job.lineItems.length || total <= 0} onClick={tap}>
          {TAP_TO_PAY_NAME} · {money(total)}
        </button>
      )}

      {outcome && (
        <div className={`ttp-result ${outcome.kind}`}>
          <p className="error" style={{ margin: '10px 0 6px' }}>{outcome.kind === 'declined' ? '✕ Declined' : 'Not charged'} – {outcome.text}</p>
          {outcome.kind === 'declined' && customer && (customer.phone || customer.email) && (
            <div className="row wrap">
              {customer.phone && <button className="btn small" onClick={() => void sendDeclinedReceipt('sms')}>Text declined receipt</button>}
              {customer.email && <button className="btn small" onClick={() => void sendDeclinedReceipt('email')}>Email declined receipt</button>}
            </div>
          )}
          {outcome.kind === 'declined' && (
            <p className="small muted" style={{ marginBottom: 0 }}>If the card can't be read, send the customer a pay link instead (below).</p>
          )}
          {receipt && <p className="small">{receipt}</p>}
        </div>
      )}
      {!phase && !outcome && <p className="muted small" style={{ margin: '8px 0 0' }}>Customers tap their contactless card, iPhone, Apple Watch or other digital wallet on this iPhone.</p>}
    </section>
  );
}
