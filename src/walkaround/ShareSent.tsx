import type { Customer } from '../types';
import { smsUrl } from '../utils';
import { shareLink } from './model';

/** After creating a request: text / email / copy the customer's link. */
export default function ShareSent({
  token,
  customer,
  message,
  subject,
  onDone,
  doneLabel = 'Done',
}: {
  token: string;
  customer?: Customer;
  message: string;
  subject: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const link = shareLink(token);
  const text = `${message.trim()}\n\n${link}`;
  return (
    <div className="card share-sent">
      <p style={{ marginTop: 0 }}>✓ Ready. Send this link to {customer?.name || 'the customer'}:</p>
      <p className="link-box">{link}</p>
      <div className="row wrap">
        {customer?.phone && <a className="btn primary grow" href={smsUrl(customer.phone, text)}>💬 Text it</a>}
        {customer?.email && (
          <a className="btn grow" href={`mailto:${customer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>✉ Email it</a>
        )}
        <button className="btn grow" onClick={() => navigator.clipboard?.writeText(link).then(() => alert('Link copied'))}>📋 Copy link</button>
      </div>
      <p className="muted small">You'll see when they open it and when they sign.</p>
      <button className="btn ghost block" onClick={onDone}>{doneLabel}</button>
    </div>
  );
}
