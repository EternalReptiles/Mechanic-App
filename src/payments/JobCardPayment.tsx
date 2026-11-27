import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import type { Customer, Job } from '../types';
import { firstName, fmtDateTime, money } from '../utils';
import ShareSent from '../walkaround/ShareSent';
import { STRIPE_PUBLISHABLE_KEY, stripeApi, type PaymentsStatus, type StripeInvoiceRow } from './api';
import TapToPay from './TapToPay';

const LABEL: Record<string, string> = { open: 'Waiting for payment', paid: '✓ Paid by card', void: 'Cancelled', uncollectible: 'Marked uncollectible', draft: 'Draft' };

/** Billing tab: send a Stripe invoice the customer can pay by card, and show its status. */
export default function JobCardPayment({ job, customer, businessName, onInvoiced, onPaid }: {
  job: Job; customer?: Customer; businessName: string; onInvoiced: () => void;
  /** Tap to Pay succeeded: the job screen updates its copy so it doesn't save over "Paid". */
  onPaid?: (paidAt: string) => void;
}) {
  const { businessId } = useCloud();
  const [status, setStatus] = useState<PaymentsStatus | null>(null);
  const [invoices, setInvoices] = useState<StripeInvoiceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ url: string; total: number; receipt?: boolean; number?: string | null } | null>(null);

  const load = useCallback(async () => {
    if (!navigator.onLine || !STRIPE_PUBLISHABLE_KEY) return;
    const [{ data }, st] = await Promise.all([
      supabase.from('stripe_invoices').select('id, number, status, total, hosted_invoice_url, created_at, paid_at')
        .eq('business_id', businessId).eq('job_id', job.id).order('created_at', { ascending: false }),
      supabase.from('stripe_accounts').select('card_payments_status').eq('business_id', businessId).maybeSingle(),
    ]);
    setInvoices((data ?? []) as StripeInvoiceRow[]);
    setStatus(st.data ? { connected: true, cardPayments: st.data.card_payments_status } : { connected: false });
  }, [businessId, job.id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!STRIPE_PUBLISHABLE_KEY || !status) return null;

  async function send() {
    setErr('');
    if (!navigator.onLine) return setErr("You're offline. Sending needs signal.");
    setBusy(true);
    try {
      const r = await stripeApi<{ url: string; total: number }>('create_invoice', businessId, { jobId: job.id });
      setSent(r);
      onInvoiced();
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <ShareSent
        token=""
        jobId={job.id}
        link={sent.url}
        customer={customer}
        message={
          sent.receipt
            ? `Hi ${firstName(customer?.name ?? '')}, thanks for your payment of ${money(sent.total / 100)} to ${businessName} for ${sent.number ?? 'your invoice'}. Your paid invoice:`
            : `Hi ${firstName(customer?.name ?? '')}, here's your invoice from ${businessName} for ${money(sent.total / 100)}. You can pay by card, Apple Pay or Google Pay:`
        }
        subject={sent.receipt ? `Receipt from ${businessName}` : `Invoice from ${businessName}`}
        onDone={() => setSent(null)}
      />
    );

  const active = status.cardPayments === 'active';
  return (
    <section className="card">
      <h2>💳 Card payment</h2>
      {job.status === 'paid' && !invoices.some((i) => i.status === 'open') ? (
        <p className="small muted" style={{ margin: 0 }}>This job is marked as paid, so there's nothing to send.</p>
      ) : !active ? (
        <p className="small muted" style={{ margin: 0 }}>
          Let customers pay this invoice by card. <Link to="/settings/payments">Set up card payments</Link>
        </p>
      ) : (
        <>
          {onPaid && <TapToPay job={job} businessName={businessName} onPaid={onPaid} />}
          <p className="muted small" style={{ marginTop: 0 }}>
            Sends a Stripe invoice with a pay link (card, Apple Pay, Google Pay). The job is marked paid automatically when they pay.
          </p>
          <button className="btn primary block" disabled={busy || !job.lineItems.length} onClick={send}>
            {busy ? 'Creating invoice…' : invoices.some((i) => i.status === 'open') ? 'Re-send pay link' : 'Send invoice – pay by card'}
          </button>
        </>
      )}
      {err && <p className="error">{err}</p>}
      {invoices.map((i) => (
        <div key={i.id} className={`msg-row ${i.status === 'paid' ? 'sent' : ''}`}>
          <span>{i.number} · {money(i.total / 100)}</span>
          <span className="small">
            {LABEL[i.status] ?? i.status} {fmtDateTime(i.paid_at || i.created_at)}
            {i.status === 'open' && i.hosted_invoice_url && <> · <a href={i.hosted_invoice_url} target="_blank" rel="noreferrer">View</a></>}
            {i.status === 'paid' && i.hosted_invoice_url && (
              <> · <button className="link" onClick={() => setSent({ url: i.hosted_invoice_url!, total: i.total, receipt: true, number: i.number })}>Send receipt</button></>
            )}
          </span>
        </div>
      ))}
    </section>
  );
}
