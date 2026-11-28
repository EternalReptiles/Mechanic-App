import { textsFor } from '../smsParts';
import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import type { Customer } from '../types';
import { smsUrl } from '../utils';

type Channel = 'sms' | 'email';

/** Sends a text or email to one of the business's customers from Spannr (not from the mechanic's own phone). */
export async function sendFromSpannr(businessId: string, customerId: string, jobId: string, channel: Channel, subject: string, body: string) {
  if (!navigator.onLine) throw new Error("You're offline. Sending needs signal.");
  const { data, error } = await supabase.rpc('send_customer_message', {
    p_business: businessId, p_customer: customerId, p_job: jobId, p_channel: channel, p_subject: subject, p_body: body,
  });
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, '') || "Couldn't send the message.");
  return data as { id: string; to: string };
}

type Allowance = { sms_allowance: number; sms_used: number; sms_ready: boolean; email_ready: boolean };

/**
 * "Send by text / Send by email" buttons. Messages go out from Spannr (texts via the business's plan allowance,
 * emails from bookings@spannr.au in the business's branding). Sending from the mechanic's own phone stays available.
 */
export default function SendMessage({ customer, jobId, text, subject, intro }: {
  customer?: Customer;
  jobId: string;
  text: string;
  subject: string;
  intro?: string;
}) {
  const { businessId, businessName } = useCloud();
  const parts = textsFor(businessName, 'message', text);
  const [busy, setBusy] = useState<Channel | ''>('');
  const [sent, setSent] = useState<Partial<Record<Channel, string>>>({});
  const [err, setErr] = useState('');
  const [own, setOwn] = useState(false);
  const [allow, setAllow] = useState<Allowance | null>(null);

  useEffect(() => {
    if (!navigator.onLine) return;
    void supabase.rpc('message_allowance', { bid: businessId }).then(({ data }) => setAllow((data as Allowance) ?? null));
  }, [businessId, sent.sms]);

  if (!customer) return <p className="muted small">Add a customer to the job to send this.</p>;
  const textsLeft = allow ? Math.max(0, allow.sms_allowance - allow.sms_used) : null;
  const canText = !!customer.phone && allow?.sms_ready !== false && (textsLeft === null || textsLeft >= parts);
  const canEmail = !!customer.email && allow?.email_ready !== false;

  async function send(channel: Channel) {
    setErr('');
    setBusy(channel);
    try {
      const r = await sendFromSpannr(businessId, customer!.id, jobId, channel, subject, text);
      setSent((s) => ({ ...s, [channel]: r.to }));
    } catch (e) {
      setErr((e as Error).message);
      setOwn(true);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="send-message">
      {intro && <p style={{ marginTop: 0 }}>{intro}</p>}
      <div className="row wrap">
        {customer.phone && (
          sent.sms ? <span className="sent-pill">✓ Texted {sent.sms.replace(/^\+61/, '0')}</span> : (
            <button className="btn primary grow" disabled={!!busy || !canText} onClick={() => send('sms')}>
              {busy === 'sms' ? 'Sending…' : `💬 Send by text${parts > 1 ? ` (uses ${parts})` : ''}`}
            </button>
          )
        )}
        {customer.email && (
          sent.email ? <span className="sent-pill">✓ Emailed {sent.email}</span> : (
            <button className={`btn grow${customer.phone ? '' : ' primary'}`} disabled={!!busy || !canEmail} onClick={() => send('email')}>
              {busy === 'email' ? 'Sending…' : '✉ Send by email'}
            </button>
          )
        )}
      </div>
      {!customer.phone && !customer.email && <p className="small muted">Add a mobile number or email to the customer to send this.</p>}
      {customer.phone && textsLeft !== null && textsLeft < parts && (
        <p className="small muted">{allow?.sms_allowance ? "You've used this month's texts for your plan." : 'Texts from Spannr are on the Pro plan and up.'} You can still send it from your own phone.</p>
      )}
      {customer.phone && textsLeft !== null && textsLeft > 0 && textsLeft <= 20 && <p className="small muted">{textsLeft} texts left this month.</p>}
      {err && <p className="error">{err}</p>}
      <button type="button" className="link small" onClick={() => setOwn((o) => !o)}>
        {own ? 'Hide' : 'Or send from my own phone'}
      </button>
      {own && (
        <div className="row wrap" style={{ marginTop: 6 }}>
          {customer.phone && <a className="btn small" href={smsUrl(customer.phone, text)}>💬 My Messages app</a>}
          {customer.email && <a className="btn small" href={`mailto:${customer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>✉ My email app</a>}
        </div>
      )}
    </div>
  );
}

/** One-tap text from Spannr (e.g. "On my way", "Car's ready"). Falls back to the phone's Messages app if it can't send. */
export function QuickText({ customer, jobId, text, label, className = 'btn', onSent }: {
  customer: Customer; jobId: string; text: string; label: string; className?: string; onSent?: () => void;
}) {
  const { businessId } = useCloud();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  async function go() {
    setState('busy');
    try {
      await sendFromSpannr(businessId, customer.id, jobId, 'sms', '', text);
      setState('sent');
      onSent?.();
    } catch (e) {
      setState('idle');
      if (confirm(`${(e as Error).message}\n\nSend it from your own phone instead?`)) location.href = smsUrl(customer.phone, text);
    }
  }
  return (
    <button className={className} disabled={state !== 'idle'} onClick={go}>
      {state === 'busy' ? 'Sending…' : state === 'sent' ? `✓ ${label.replace(/^\S+\s/, '')} sent` : label}
    </button>
  );
}
