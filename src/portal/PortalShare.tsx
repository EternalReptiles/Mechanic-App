import { useState } from 'react';
import { QuickText } from '../components/SendMessage';
import { useSettings } from '../hooks';
import { APP_URL } from '../native';
import type { Customer } from '../types';
import { firstName } from '../utils';

const newToken = () => {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Customer page: share their own portal (cars, history, invoices). Creates the private link the first time. */
export default function PortalShare({ customer, onChange }: { customer: Customer; onChange: (c: Customer) => void }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = customer.portalToken;
  const url = token ? `${APP_URL || 'https://app.spannr.au'}/my/${token}` : '';

  function start() {
    if (!token) onChange({ ...customer, portalToken: newToken() });
    setOpen(!open);
  }

  return (
    <>
      <button className="btn" onClick={start}>🔗 Customer page</button>
      {open && url && (
        <div className="card portal-share">
          <p className="small" style={{ marginTop: 0 }}>
            {firstName(customer.name) || 'Your customer'}'s own page – their cars, next service, history and invoices (with Pay now), in your branding.
          </p>
          <div className="row wrap">
            {customer.phone && (
              <QuickText customer={customer} jobId={`customer:${customer.id}`} label="💬 Text it"
                text={`Hi ${firstName(customer.name)}, here's your page with ${settings.businessName} – your car's service history, invoices and next service: ${url}`} />
            )}
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>{copied ? '✓ Copied' : '📋 Copy link'}</button>
            <a className="btn" href={url} target="_blank" rel="noreferrer">Open</a>
            <button className="btn ghost small" onClick={() => {
              if (confirm('Turn off the old link? Anyone with it will no longer see the page. A new link is made next time you share.')) {
                onChange({ ...customer, portalToken: undefined });
                setOpen(false);
              }
            }}>Reset link</button>
          </div>
        </div>
      )}
    </>
  );
}
