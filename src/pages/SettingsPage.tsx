import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import SyncBadge from '../cloud/SyncBadge';
import AutoMessages from '../components/AutoMessages';
import { Field, PageHeader } from '../components/ui';
import { useAutosave } from '../hooks';
import { db, DEFAULT_TERMS, exportBackup, getSettings, importBackup, WORKSHOP_TERMS_EXTRA } from '../db';
import type { Settings } from '../types';

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const cloud = useCloud();

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  useAutosave(s, (x) => db.settings.put(x));

  if (!s) return null;

  const text = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setS({ ...s, [k]: e.target.value });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS({ ...s, [k]: e.target.valueAsNumber || 0 });

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

  return (
    <>
      <PageHeader title="Settings" />

      <section className="card">
        <h2>Account</h2>
        <p className="small" style={{ marginTop: 0 }}>
          <strong>{cloud.businessName}</strong><br />
          {cloud.email} · {cloud.role === 'tech' ? 'Technician' : cloud.role === 'admin' ? 'Admin' : 'Owner'}
        </p>
        <SyncBadge detailed />
        <div className="row wrap" style={{ marginTop: 10 }}>
          <Link to="/settings/team" className="btn">👥 Team</Link>
          <Link to="/settings/payments" className="btn">💳 Card payments</Link>
          <button className="btn ghost" onClick={() => void cloud.signOut()}>Sign out</button>
        </div>
      </section>

      {!cloud.isAdmin && (
        <>
          <Link to="/settings/price-list" className="card row between">
            <span><strong>📋 Price list</strong></span>
            <span>›</span>
          </Link>
          <p className="muted small">Business settings can be changed by the owner or an admin.</p>
        </>
      )}
      {cloud.isAdmin && (<>
      <section className="card grid">
        <h2 className="wide">Business details</h2>
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
      </section>

      <section className="card grid">
        <h2 className="wide">Pricing &amp; invoicing</h2>
        <Field label="Default labour rate per hour (ex GST)"><input type="number" inputMode="decimal" value={s.labourRate} onChange={num('labourRate')} /></Field>
        <Field label="Payment terms (days)"><input type="number" inputMode="numeric" value={s.paymentTermsDays} onChange={num('paymentTermsDays')} /></Field>
        <Field label="Job / invoice numbers start from"><input type="number" inputMode="numeric" value={s.nextJobNumber} onChange={num('nextJobNumber')} /></Field>
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
      </section>

      <Link to="/settings/price-list" className="card row between">
        <span><strong>📋 Price list</strong><br /><span className="muted small">Your services, packages and parts with prices</span></span>
        <span>›</span>
      </Link>

      <AutoMessages s={s} onChange={setS} />

      <section className="card grid">
        <h2 className="wide">Inspections &amp; reminders</h2>
        <Field label="Service interval (months)"><input type="number" inputMode="numeric" value={s.serviceIntervalMonths} onChange={num('serviceIntervalMonths')} /></Field>
        <Field label="Service interval (km)"><input type="number" inputMode="numeric" value={s.serviceIntervalKm} onChange={num('serviceIntervalKm')} /></Field>
        <Field label="Service reminder text message" wide>
          <textarea rows={3} value={s.reminderMessage} onChange={text('reminderMessage')} />
        </Field>
        <p className="wide muted small" style={{ margin: 0 }}>Placeholders: {'{name} {business} {vehicle} {rego} {date}'}</p>
        {s.businessType !== 'mobile' && (
          <Field label={"\"Car's ready\" text message"} wide>
            <textarea rows={2} value={s.readyMessage} onChange={text('readyMessage')} />
          </Field>
        )}
        <Field label="Inspection checklist (one item per line)" wide>
          <textarea rows={8} value={s.checklistTemplate.join('\n')}
            onChange={(e) => setS({ ...s, checklistTemplate: e.target.value.split('\n').map((x) => x.trimStart()).filter((x, i, a) => x || i === a.length - 1) })} />
        </Field>
      </section>

      <section className="card grid">
        <h2 className="wide">Bank details (for direct deposit)</h2>
        <Field label="Bank"><input value={s.bankName} onChange={text('bankName')} /></Field>
        <Field label="Account name"><input value={s.accountName} onChange={text('accountName')} /></Field>
        <Field label="BSB"><input inputMode="numeric" value={s.bsb} onChange={text('bsb')} /></Field>
        <Field label="Account number"><input inputMode="numeric" value={s.accountNumber} onChange={text('accountNumber')} /></Field>
      </section>

      </>)}

      <section className="card">
        <h2>Backup</h2>
        <p className="muted small">
          Your data is stored on this device. Download a backup regularly, and use it to move your data to a new phone.
        </p>
        <div className="row wrap">
          <button className="btn primary" onClick={backup}>Download backup</button>
          <label className="btn">
            Restore from backup
            <input type="file" accept="application/json,.json" hidden onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        {msg && <p className="small">{msg}</p>}
      </section>
    </>
  );
}
