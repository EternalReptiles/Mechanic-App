import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { money } from '../utils';
import { stripeApi } from './api';

type Payment = { kind: string; amount: number; stripe_fee: number | null; application_fee: number | null; net: number | null; paid_at: string | null };

/** Paid jobs: what the customer paid by card, the fees, and what lands in the bank. */
export default function PaymentFees({ jobId }: { jobId: string }) {
  const { businessId, isAdmin } = useCloud();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  useEffect(() => {
    if (!isAdmin || !navigator.onLine) return;
    stripeApi<{ payments: Payment[] }>('payment_fees', businessId, { jobId })
      .then((r) => setPayments(r.payments))
      .catch(() => setPayments([]));
  }, [businessId, jobId, isAdmin]);
  if (!payments?.length) return null;
  const c = (n: number | null) => (n == null ? '…' : money(n / 100));
  return (
    <div className="fee-breakdown">
      {payments.map((p, i) => (
        <table key={i}>
          <tbody>
            <tr><th colSpan={2}>{p.kind}{p.paid_at ? ` · ${new Date(p.paid_at).toLocaleDateString('en-AU')}` : ''}</th></tr>
            <tr><td>Customer paid</td><td>{money(p.amount / 100)}</td></tr>
            <tr><td>Stripe fee</td><td>−{c(p.stripe_fee)}</td></tr>
            <tr><td>Spannr fee (0.5%)</td><td>−{c(p.application_fee)}</td></tr>
            <tr className="net"><td>You receive</td><td>{c(p.net)}</td></tr>
          </tbody>
        </table>
      ))}
      {payments.some((p) => p.net == null) && <p className="muted small">Some fees aren't available from Stripe yet – check again shortly.</p>}
    </div>
  );
}
