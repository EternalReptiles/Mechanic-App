import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { useSettings } from '../hooks';
import type { Customer, Job, Vehicle } from '../types';
import { dayKey, firstName, fmtDay, groupRepairs, money, totals, vehicleLabel } from '../utils';
import { fillTerms, KIND_LABEL, type RequestKind, type WalkContent } from './model';
import ShareSent from './ShareSent';

/** Billing tab: send the quote (before work) or the finished job (after work) to the customer to sign remotely. */
export default function SendSignoff({ job, customer, vehicle, onSent }: { job: Job; customer?: Customer; vehicle?: Vehicle; onSent: () => void }) {
  const settings = useSettings();
  const { businessId, userId, email, memberName } = useCloud();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ token: string; message: string; subject: string } | null>(null);

  async function send(kind: Exclude<RequestKind, 'walkaround'>) {
    setErr('');
    if (!customer) return setErr('Add the customer to the job first.');
    if (!job.lineItems.length) return setErr('Add labour and parts first, so the customer can see what they are agreeing to pay.');
    if (!navigator.onLine) return setErr("You're offline. Sending needs signal.");
    setBusy(true);
    const t = totals(job.lineItems, settings.gstRegistered);
    const issued = job.invoicedAt ? new Date(job.invoicedAt) : new Date();
    const due = new Date(issued.getTime() + settings.paymentTermsDays * 86400000);
    const v = vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.rego : 'vehicle';
    const repairs = kind === 'quote' ? groupRepairs(job.lineItems, settings.gstRegistered) : [];
    const message =
      kind === 'quote'
        ? repairs.length >= 2
          ? `Hi ${firstName(customer.name)}, here's the quote for your ${v}: ${repairs.length} repairs, ${money(t.total)} for everything. Choose which ones you'd like done now, then sign.`
          : `Hi ${firstName(customer.name)}, here's the quote for your ${v} (${money(t.total)}). Please check it, then approve or decline and sign.`
        : `Hi ${firstName(customer.name)}, the work on your ${v} is done. Please check the details and sign off (${money(t.total)}, due ${fmtDay(dayKey(due))}).`;
    const content: WalkContent = {
      business: { name: settings.businessName, phone: settings.phone, email: settings.email, logo: settings.logo, abn: settings.abn },
      customerName: customer.name,
      vehicle: vehicleLabel(vehicle),
      message,
      gst: settings.gstRegistered,
      sentBy: memberName(userId) || email,
      items: [],
      terms: fillTerms(settings.terms, settings.businessName, settings.paymentTermsDays),
      jobNumber: job.number,
      title: job.title,
      description: kind === 'quote' ? job.description : '',
      workNotes: kind === 'completion' ? job.workNotes : '',
      lines: job.lineItems.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, amount: Math.round(l.qty * l.unitPrice * 100) / 100 })),
      subtotal: t.subtotal,
      gstAmount: t.gst,
      total: t.total,
      dueDate: kind === 'completion' ? dayKey(due) : undefined,
      repairs:
        repairs.length >= 2
          ? repairs.map((r) => ({
              id: r.id,
              title: r.title,
              lines: r.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, amount: Math.round(l.qty * l.unitPrice * 100) / 100 })),
              lineIds: r.lines.map((l) => l.id),
              subtotal: r.subtotal,
              total: r.total,
            }))
          : undefined,
    };
    const { data, error } = await supabase
      .from('walkarounds')
      .insert({ business_id: businessId, job_id: job.id, kind, content })
      .select('token')
      .single();
    setBusy(false);
    if (error) return setErr(`Couldn't send: ${error.message}`);
    setSent({ token: data.token as string, message, subject: `${KIND_LABEL[kind]} – ${settings.businessName}` });
    onSent();
  }

  if (sent) return <ShareSent token={sent.token} customer={customer} message={sent.message} subject={sent.subject} onDone={() => setSent(null)} />;

  const before = ['quote', 'scheduled'].includes(job.status);
  return (
    <section className="card">
      <h2>✍ Remote sign-off</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Send a link so the customer can sign on their own phone. They agree to the amount and your terms &amp; conditions, and you get a
        signed record.
      </p>
      <div className="row wrap">
        <button className={`btn grow wrap-text ${before ? 'primary' : ''}`} disabled={busy} onClick={() => send('quote')}>📄 Send quote to approve</button>
        <button className={`btn grow wrap-text ${!before ? 'primary' : ''}`} disabled={busy} onClick={() => send('completion')}>✅ Send job sign-off</button>
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
