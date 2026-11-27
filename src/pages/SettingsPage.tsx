import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import SyncBadge from '../cloud/SyncBadge';
import AutoMessages from '../components/AutoMessages';
import Upgrade from '../components/Upgrade';
import { planLabel } from '../plans';
import { startTechPreview } from '../tech/preview';
import { brandColor, onBrand } from '../brand';
import { Field, PageHeader } from '../components/ui';
import { useAutosave } from '../hooks';
import { db, DEFAULT_TERMS, exportBackup, getSettings, importBackup, WORKSHOP_TERMS_EXTRA } from '../db';
import type { Settings } from '../types';
import NumberInput from '../components/NumberInput';
import CloseAccount from './CloseAccount';
import { supabase } from '../cloud/supabase';
import { TAP_TO_PAY_NAME, tapToPayAvailable } from '../payments/terminal';

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const cloud = useCloud();
  const [params] = useSearchParams();
  const [isAdminOfSpannr, setIsAdminOfSpannr] = useState(false);
  useEffect(() => {
    if (navigator.onLine) void supabase.rpc('is_spannr_admin').then(({ data }) => setIsAdminOfSpannr(data === true));
  }, []);

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  useAutosave(s, (x) => db.settings.put(x));

  if (!s) return null;

  const text = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setS({ ...s, [k]: e.target.value });
  const num = (k: keyof Settings) => (n: number) => setS({ ...s, [k]: n });

  function onLogo(file?: File) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setS({ ...s!, logo: r.result as string });
    r.readAsDataURL(file);
  }

  async function backup() {
    const blob = await exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spannr-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Backup downloaded.');
  }

  async function restore(file?: File) {
    if (!file) return;
    if (!confirm('Restoring replaces ALL data on this device with the backup. Continue?')) return;
    try {
      await importBackup(file);
      setMsg('Backup restored. Reopen Settings to see restored settings.');
    } catch (e) {
      setMsg(`Restore failed: ${(e as Error).message}`);
    }
  }

  const sec = params.get('s');
  const show = (k: string) => sec === k;
  const TITLES: Record<string, string> = {
    business: 'Business details', pricing: 'Pricing & invoicing', messages: 'Automatic messages',
    inspections: 'Inspections & reminders', bank: 'Bank details', backup: 'Backup', account: 'Account',
  };
  const Row = ({ to, icon, label, hint }: { to: string; icon: string; label: string; hint?: string }) => (
    <Link to={to} className="set-row"><span className="set-ico">{icon}</span><span className="set-text"><span>{label}</span>{hint && <small>{hint}</small>}</span><span className="set-chev">›</span></Link>
  );

  if (!sec)
    return (
      <>
        <PageHeader title="Settings" />
        <div className="set-account">
          <div>
            <strong>{cloud.businessName}</strong>
            <div className="small muted">{cloud.email} · {cloud.role === 'tech' ? 'Technician' : cloud.role === 'admin' ? 'Admin' : 'Owner'}</div>
          </div>
          <SyncBadge />
        </div>

        {cloud.isAdmin && (
          <div className="set-group">
            <h3>Business</h3>
            <Row to="?s=business" icon="🏢" label="Business details" hint="Name, ABN, logo, colours" />
            <Row to="?s=pricing" icon="🧾" label="Pricing & invoicing" hint="Labour rate, GST, terms" />
            <Row to="/settings/price-list" icon="📋" label="Price list" />
            <Row to="?s=bank" icon="🏦" label="Bank details" />
            <Row to="/stock" icon="📦" label="Stock & orders" hint="Parts on hand, purchase orders" />
            <Row to="/reports" icon="📊" label="Reports" hint="Takings, money owed, top customers" />
            <Row to="/timesheets" icon="⏱" label="Timesheets" hint="Hours clocked on jobs" />
          </div>
        )}
        {!cloud.isAdmin && (
          <div className="set-group"><Row to="/settings/price-list" icon="📋" label="Price list" /><Row to="/timesheets" icon="⏱" label="My hours" /></div>
        )}

        {cloud.isAdmin && (
          <div className="set-group">
            <h3>Customers</h3>
            <Row to="?s=messages" icon="💬" label="Automatic messages" hint="Confirmations, reminders, unpaid invoices" />
            <Row to="/settings/booking" icon="📅" label="Online booking" />
            <Row to="?s=inspections" icon="🔧" label="Inspections & service reminders" />
            <Row to="/settings/checklists" icon="☑" label="Job checklists" />
          </div>
        )}

        <div className="set-group">
          <h3>Payments</h3>
          <Row to="/settings/payments" icon="💳" label="Card payments" />
          {tapToPayAvailable && <Row to="/settings/tap-to-pay" icon="📲" label={TAP_TO_PAY_NAME} />}
          <Row to="/settings/billing" icon="⭐" label="Plan & billing" hint={planLabel(cloud.plan)} />
        </div>

        <div className="set-group">
          <h3>Team & app</h3>
          <Row to="/settings/team" icon="👥" label="Team" />
          {cloud.isAdmin && <button className="set-row" onClick={startTechPreview}><span className="set-ico">👁</span><span className="set-text"><span>Preview technician app</span></span><span className="set-chev">›</span></button>}
          <Row to="?s=backup" icon="💾" label="Backup" />
          {isAdminOfSpannr && <Row to="/admin" icon="🛠" label="Spannr admin" />}
          <Row to="?s=account" icon="⚙️" label="Account" hint="Sign out, close account" />
        </div>
      </>
    );

  return (
    <>
      <PageHeader back title={TITLES[sec] ?? 'Settings'} />
      {!cloud.isAdmin && ['business', 'pricing', 'messages', 'inspections', 'bank'].includes(sec) && (
        <p className="muted small">Business settings can be changed by the owner or an admin.</p>
      )}
      {show('account') && (
        <section className="card">
          <p className="small" style={{ marginTop: 0 }}>
            <strong>{cloud.businessName}</strong><br />
            {cloud.email} · {cloud.role === 'tech' ? 'Technician' : cloud.role === 'admin' ? 'Admin' : 'Owner'}
          </p>
          <SyncBadge detailed />
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => void cloud.signOut()}>Sign out</button>
        </section>
      )}
      {cloud.isAdmin && (<>
      {show('business') && <section className="card grid">
        <Field label="Business name" wide><input value={s.businessName} onChange={text('businessName')} /></Field>
        <Field label="ABN"><input inputMode="numeric" value={s.abn} onChange={text('abn')} /></Field>
        <Field label="Phone"><input type="tel" value={s.phone} onChange={text('phone')} /></Field>
        <Field label="Email"><input type="email" value={s.email} onChange={text('email')} /></Field>
        <Field label="Website"><input value={s.website} onChange={text('website')} /></Field>
        <Field label="Address" wide><input value={s.address} onChange={text('address')} /></Field>
        <Field label="How you work" wide>
          <select value={s.businessType} onChange={(e) => setS({ ...s, businessType: e.target.value as Settings['businessType'] })}>
            <option value="mobile">🚐 Mobile – I go to the customer</option>
            <option value="workshop">🔧 Workshop – customers bring the car in</option>
            <option value="both">🚐🔧 Both</option>
          </select>
        </Field>
        <div className="field wide">
          <span>Logo (shown on quotes &amp; invoices)</span>
          <div className="row">
            {s.logo && <img src={s.logo} alt="Logo" className="logo-preview" />}
            <label className="btn">
              {s.logo ? 'Change logo' : 'Upload logo'}
              <input type="file" accept="image/*" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
            </label>
            {s.logo && <button className="btn ghost" onClick={() => setS({ ...s, logo: '' })}>Remove</button>}
          </div>
        </div>
        <div className="field wide">
          <span>Brand colour (quotes, invoices, customer pages and Stripe invoices)</span>
          <div className="row">
            <input type="color" className="color-input" value={brandColor(s.brandColor)} onChange={(e) => setS({ ...s, brandColor: e.target.value })} />
            <span className="brand-swatch" style={{ background: brandColor(s.brandColor), color: onBrand(brandColor(s.brandColor)) }}>Sample button</span>
            {s.brandColor && <button className="btn ghost" onClick={() => setS({ ...s, brandColor: undefined })}>Reset</button>}
          </div>
        </div>
      </section>}

      {show('pricing') && <section className="card grid">
        <Field label="Default labour rate per hour (ex GST)"><NumberInput inputMode="decimal" value={s.labourRate} onChange={num('labourRate')} /></Field>
        <Field label="Payment terms (days)"><NumberInput inputMode="numeric" value={s.paymentTermsDays} onChange={num('paymentTermsDays')} /></Field>
        <Field label="Job / invoice numbers start from"><NumberInput inputMode="numeric" value={s.nextJobNumber} onChange={num('nextJobNumber')} /></Field>
        <label className="field checkbox">
          <input type="checkbox" checked={s.gstRegistered} onChange={(e) => setS({ ...s, gstRegistered: e.target.checked })} />
          <span>Registered for GST (add 10%)</span>
        </label>
        <Field label="Terms & conditions (customers agree to these when they sign)" wide>
          <textarea rows={10} value={s.terms} onChange={text('terms')} />
        </Field>
        <p className="wide muted small" style={{ margin: 0 }}>
          One term per line; start a line with a heading and a colon, e.g. "Payment: …". Placeholders: {'{business} {days}'} (payment terms).
          Have a lawyer check these before relying on them.{' '}
          <button className="link" onClick={() => setS({ ...s, terms: DEFAULT_TERMS + (s.businessType === 'mobile' ? '' : WORKSHOP_TERMS_EXTRA) })}>Reset to default</button>
        </p>
        <Field label="Invoice footer" wide><textarea rows={2} value={s.invoiceFooter} onChange={text('invoiceFooter')} /></Field>
        <Field label="Quote footer" wide><textarea rows={2} value={s.quoteFooter} onChange={text('quoteFooter')} /></Field>
      </section>}


      {show('messages') && (cloud.can('autoMessages') ? <AutoMessages s={s} onChange={setS} /> : <Upgrade feature="autoMessages" what="Automatic booking messages" />)}

      {show('inspections') && <section className="card grid">
        <Field label="Service interval (months)"><NumberInput inputMode="numeric" value={s.serviceIntervalMonths} onChange={num('serviceIntervalMonths')} /></Field>
        <Field label="Service interval (km)"><NumberInput inputMode="numeric" value={s.serviceIntervalKm} onChange={num('serviceIntervalKm')} /></Field>
        <Field label="Service reminder text message" wide>
          <textarea rows={3} value={s.reminderMessage} onChange={text('reminderMessage')} />
        </Field>
        <p className="wide muted small" style={{ margin: 0 }}>Placeholders: {'{name} {business} {vehicle} {rego} {date}'}</p>
        {s.businessType !== 'mobile' && (
          <Field label={"\"Car's ready\" text message"} wide>
            <textarea rows={2} value={s.readyMessage} onChange={text('readyMessage')} />
          </Field>
        )}
        <p className="wide small" style={{ margin: 0 }}>
          The vehicle inspection list (battery test, pad / rotor / tyre measurements…) is edited in{' '}
          <Link to="/settings/checklists">Job checklists</Link>.
        </p>
      </section>}

      {show('bank') && <section className="card grid">
        <Field label="Bank"><input value={s.bankName} onChange={text('bankName')} /></Field>
        <Field label="Account name"><input value={s.accountName} onChange={text('accountName')} /></Field>
        <Field label="BSB"><input inputMode="numeric" value={s.bsb} onChange={text('bsb')} /></Field>
        <Field label="Account number"><input inputMode="numeric" value={s.accountNumber} onChange={text('accountNumber')} /></Field>
      </section>}

      </>)}

      {show('backup') && <section className="card">
        <p className="muted small">
          Your data is saved to the cloud automatically and syncs to every device you sign in on. You can also download a copy at any time.
        </p>
        <div className="row wrap">
          <button className="btn primary" onClick={backup}>Download backup</button>
          <label className="btn">
            Restore from backup
            <input type="file" accept="application/json,.json" hidden onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        {msg && <p className="small">{msg}</p>}
      </section>}

      {show('account') && <CloseAccount />}
    </>
  );
}
