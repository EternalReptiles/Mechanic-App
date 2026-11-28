import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db';
import { useSettings } from '../hooks';

type Step = { key: string; label: string; hint: string; to: string; done: boolean; markOnClick?: boolean };

/** Dashboard checklist for a new business: everything needed to look professional and get paid, ticking itself off. */
export default function GettingStarted() {
  const s = useSettings();
  const customers = useLiveQuery(() => db.customers.count(), []) ?? 0;
  const jobs = useLiveQuery(() => db.jobs.count(), []) ?? 0;
  const ob = s.onboarding ?? {};
  const [all, setAll] = useState(false);
  if (ob.hidden) return null;
  const n = s.notify;

  const steps: Step[] = [
    { key: 'business', label: 'Business details', hint: 'Name, ABN and phone – on every quote and invoice', to: '/settings?s=business',
      done: !!s.abn && !!s.phone && s.businessName !== 'My Mobile Mechanics' },
    { key: 'logo', label: 'Logo & colour', hint: 'Your branding on invoices, texts and your customer pages', to: '/settings?s=business', done: !!s.logo },
    { key: 'prices', label: 'Labour rate & price list', hint: 'So quotes are one tap', to: '/settings?s=pricing', done: s.labourRate !== 120 || !!ob.done?.prices, markOnClick: true },
    { key: 'bank', label: 'Bank details', hint: 'For customers who pay by transfer', to: '/settings?s=bank', done: !!s.bsb && !!s.accountNumber },
    { key: 'customers', label: 'Add your customers', hint: 'Import from ServiceM8 or a spreadsheet, or add as you go', to: '/settings/import', done: customers > 0 },
    { key: 'texts', label: 'Turn on automatic texts', hint: 'Booking confirmations, reminders and service reminders', to: '/settings?s=messages',
      done: !!(n?.confirmEnabled || n?.reminderEnabled || n?.serviceReminders?.enabled) },
    { key: 'cards', label: 'Take card payments', hint: 'Pay-by-card invoices and Tap to Pay on iPhone', to: '/settings/payments', done: !!ob.done?.cards, markOnClick: true },
    { key: 'job', label: 'Create your first job', hint: 'Tap + New job at the top', to: '/', done: jobs > 0 },
  ];
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return null;

  const save = (patch: { hidden?: boolean; done?: Record<string, boolean> }) =>
    db.settings.update('settings', { onboarding: { ...ob, ...patch, done: { ...ob.done, ...patch.done } } });

  return (
    <section className="card getting-started">
      <div className="row between">
        <h2 style={{ margin: 0 }}>🚀 Getting started</h2>
        <span className="small muted">{done} of {steps.length} done</span>
      </div>
      <div className="gs-bar"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="gs-steps">
        {(all ? steps : steps.filter((x) => !x.done).slice(0, 3)).map((x) => (
          <li key={x.key} className={x.done ? 'done' : ''}>
            <Link to={x.to} onClick={() => x.markOnClick && !x.done && void save({ done: { [x.key]: true } })}>
              <span className="gs-tick">{x.done ? '✓' : ''}</span>
              <span><strong>{x.label}</strong><br /><small className="muted">{x.hint}</small></span>
              {!x.done && <span className="set-chev">›</span>}
            </Link>
          </li>
        ))}
      </ol>
      <div className="row between small">
        {!all ? <button className="link small" onClick={() => setAll(true)}>Show all {steps.length}</button> : <span />}
        <Link to="/settings/help">Help</Link>
        <button className="link small" onClick={() => void save({ hidden: true })}>Hide</button>
      </div>
    </section>
  );
}
