import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { PageHeader } from '../components/ui';

type Stats = { code: string; signedUp: number; paying: number; monthsEarned: number; credits: number };

/** Remembers a referral code from a link (app.spannr.au/?ref=CODE) until the business is created. */
export function rememberReferral() {
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[A-Z0-9-]{4,16}$/i.test(ref)) localStorage.setItem('spannr-ref', ref.toUpperCase());
  } catch { /* private mode */ }
}
export const pendingReferral = () => { try { return localStorage.getItem('spannr-ref') ?? ''; } catch { return ''; } };
export const clearReferral = () => { try { localStorage.removeItem('spannr-ref'); } catch { /* ignore */ } };

/** "Referred by LNC Automotive Services – your first month is free" on the sign-up screens. */
export function ReferralBanner() {
  const [name, setName] = useState('');
  useEffect(() => {
    const code = pendingReferral();
    if (code) void supabase.rpc('referral_name', { p_code: code }).then(({ data }) => setName((data as string) ?? ''));
  }, []);
  if (!name) return null;
  return <p className="banner" style={{ marginBottom: 12 }}>🎁 Referred by <strong>{name}</strong> – your first paid month is free.</p>;
}

/** Settings → Refer a mechanic: give a month, get a month. */
export default function Refer() {
  const { businessId, businessName } = useCloud();
  const [s, setS] = useState<Stats | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void supabase.rpc('my_referrals', { bid: businessId }).then(({ data }) => setS((data as Stats) ?? null));
  }, [businessId]);
  const link = s ? `https://spannr.au/?ref=${s.code}` : '';
  const msg = `I run ${businessName} on Spannr – jobs, quotes, texts and payments in one app built for mechanics. Use my link for your first month free: ${link}`;

  return (
    <>
      <PageHeader back title="Refer a mechanic" />
      <section className="card refer-hero">
        <h2 style={{ marginTop: 0 }}>🎁 Give a month, get a month</h2>
        <p style={{ marginTop: 0 }}>Know another mechanic who'd like Spannr? Send them your link.</p>
        <ul className="small refer-points">
          <li><strong>They get their first paid month free</strong> after the 30-day trial.</li>
          <li><strong>You get a month free</strong> once they start paying – it comes off your next bill.</li>
          <li>No limit – refer five mechanics, get five months.</li>
        </ul>
        {s ? (
          <>
            <div className="refer-link">{link}</div>
            <div className="row wrap">
              <button className="btn primary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? '✓ Copied' : '📋 Copy link'}</button>
              <a className="btn" href={`sms:?&body=${encodeURIComponent(msg)}`}>💬 Text it</a>
              {typeof navigator.share === 'function' && <button className="btn" onClick={() => void navigator.share({ title: 'Spannr', text: msg }).catch(() => undefined)}>Share…</button>}
            </div>
          </>
        ) : <p className="muted">Loading…</p>}
      </section>
      {s && (
        <div className="stats">
          <div className="stat"><span className="stat-value">{s.signedUp}</span><span className="stat-label">Signed up</span></div>
          <div className="stat"><span className="stat-value">{s.paying}</span><span className="stat-label">Paying</span></div>
          <div className="stat"><span className="stat-value">{s.monthsEarned}</span><span className="stat-label">Free months earned{s.credits ? ` · ${s.credits} to use` : ''}</span></div>
        </div>
      )}
      <p className="small muted">A month is worth one month of your plan. Months you earn before you subscribe are used at checkout.</p>
    </>
  );
}
