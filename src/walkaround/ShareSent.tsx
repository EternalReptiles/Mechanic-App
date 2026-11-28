import type { Customer } from '../types';
import SendMessage from '../components/SendMessage';
import { shareLink } from './model';
import { supabase } from '../cloud/supabase';

/** After creating a request: text / email / copy the customer's link. */
export default function ShareSent({
  token,
  jobId = '',
  link: fullLink,
  customer,
  message,
  subject,
  onDone,
  onDelivered,
  doneLabel = 'Done',
}: {
  /** Called when the link is sent or copied (Spannr links get marked as sent). */
  onDelivered?: () => void;
  token: string;
  /** Job the message is about (for the message log) */
  jobId?: string;
  /** Use this URL instead of a Spannr link built from the token */
  link?: string;
  customer?: Customer;
  message: string;
  subject: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const link = fullLink || shareLink(token);
  const text = `${message.trim()}\n\n${link}`;
  const delivered = () => {
    if (fullLink) return onDelivered?.();
    void supabase.from('walkarounds').update({ delivered_at: new Date().toISOString() }).eq('token', token).is('delivered_at', null)
      .then(() => onDelivered?.());
  };
  return (
    <div className="card share-sent">
      <p style={{ marginTop: 0 }}>✓ Ready. Send this link to {customer?.name || 'the customer'}:</p>
      <p className="link-box">{link}</p>
      <SendMessage customer={customer} jobId={jobId} text={text} subject={subject} onSent={delivered} />
      <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(link).then(() => { delivered(); alert('Link copied'); })}>📋 Copy link</button>
      <p className="muted small">You'll see when they open it and when they sign.</p>
      <button className="btn ghost block" onClick={onDone}>{doneLabel}</button>
    </div>
  );
}
