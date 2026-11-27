import { useEffect, useState } from 'react';
import { supabase } from '../cloud/supabase';
import type { NotifySettings, Settings } from '../types';
import { Field } from './ui';
import TextUsage from './TextUsage';
import { textsFor } from '../smsParts';

export const DEFAULT_CONFIRM =
  "Hi {name}, you're booked in with {business} {day} at {time}{where}. Reply or call {phone} if you need to change it.";
export const DEFAULT_REMINDER =
  'Hi {name}, a reminder from {business}: your booking is {day} at {time}{where}. Reply or call {phone} if you need to change it.';

export function notifyDefaults(n?: NotifySettings): NotifySettings {
  return {
    confirmEnabled: false,
    reminderEnabled: false,
    reminderHours: 24,
    sms: true,
    email: true,
    enabledAt: 0,
    confirmTemplate: DEFAULT_CONFIRM,
    reminderTemplate: DEFAULT_REMINDER,
    ...n,
  };
}

/** Same placeholders the server fills in. */
function preview(tpl: string, s: Settings) {
  const vars: Record<string, string> = {
    name: 'Sam',
    business: s.businessName || 'Your business',
    day: 'tomorrow',
    date: 'Tue 25 Nov',
    time: '9:00am',
    where: s.businessType === 'workshop' ? ` at our workshop${s.address ? `, ${s.address}` : ''}` : ' at 12 Smith St, Newcastle',
    vehicle: 'Ford Ranger',
    phone: s.phone || 'us',
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Settings section: automatic booking confirmations and reminders. */
export default function AutoMessages({ s, onChange }: { s: Settings; onChange: (s: Settings) => void }) {
  const n = notifyDefaults(s.notify);
  const [status, setStatus] = useState<{ sms: boolean; email: boolean } | null>(null);
  useEffect(() => {
    supabase.rpc('notify_status').then(({ data }) => data && setStatus(data as { sms: boolean; email: boolean }));
  }, []);

  const set = (patch: Partial<NotifySettings>) => {
    const next = { ...n, ...patch };
    const turningOn = (patch.confirmEnabled || patch.reminderEnabled) && !n.confirmEnabled && !n.reminderEnabled;
    onChange({
      ...s,
      // Only bookings made from now on get a confirmation – no surprise texts for old bookings.
      notify: turningOn ? { ...next, enabledAt: Date.now() } : next,
      timezone: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney',
    });
  };
  const on = n.confirmEnabled || n.reminderEnabled;
  const pr = { enabled: false, firstDays: 3, secondDays: 7, ...n.payReminders };
  const rv = { enabled: false, url: '', delayHours: 2, ...n.reviews };

  return (
    <section className="card grid">
      <h2 className="wide">Automatic customer messages</h2>
      <TextUsage />
      <p className="wide muted small" style={{ margin: 0 }}>
        Spannr texts and emails your customers for you – even when your phone is off. Nothing is sent between 9pm and 7:30am.
      </p>
      <label className="field checkbox wide">
        <input type="checkbox" checked={n.receiptEnabled !== false} onChange={(e) => set({ receiptEnabled: e.target.checked })} />
        <span>Send a receipt with the paid invoice when a customer pays by card</span>
      </label>
      <label className="field checkbox wide">
        <input type="checkbox" checked={!!rv.enabled} onChange={(e) => set({ reviews: { ...rv, enabled: e.target.checked, enabledAt: e.target.checked ? Date.now() : rv.enabledAt } })} />
        <span>Ask for a Google review after a job is paid</span>
      </label>
      {rv.enabled && (
        <>
          <Field label="Your Google review link" wide>
            <input type="url" inputMode="url" placeholder="https://g.page/r/…/review" value={rv.url} onChange={(e) => set({ reviews: { ...rv, url: e.target.value.trim() } })} />
          </Field>
          <Field label="Send it">
            <select value={rv.delayHours} onChange={(e) => set({ reviews: { ...rv, delayHours: Number(e.target.value) } })}>
              {[1, 2, 4, 24].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hour${h > 1 ? 's' : ''}` : 'Next day'} after payment</option>)}
            </select>
          </Field>
          <p className="wide small muted" style={{ margin: 0 }}>
            Get your link from Google: search your business on Google → <strong>Ask for reviews</strong> (or in your Google Business Profile → Read reviews →
            Get more reviews) and copy it here. Sent once per job, never more than once every 4 months to the same customer, 9am–7pm.
          </p>
          {rv.url && !/^https?:\/\//.test(rv.url) && <p className="wide error" style={{ margin: 0 }}>The link should start with https://</p>}
        </>
      )}
      <label className="field checkbox wide">
        <input type="checkbox" checked={!!pr.enabled} onChange={(e) => set({ payReminders: { ...pr, enabled: e.target.checked, enabledAt: e.target.checked ? Date.now() : pr.enabledAt } })} />
        <span>Remind customers about unpaid invoices</span>
      </label>
      {pr.enabled && (
        <>
          <Field label="First reminder">
            <select value={pr.firstDays} onChange={(e) => set({ payReminders: { ...pr, firstDays: Number(e.target.value) } })}>
              {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''} after the invoice</option>)}
            </select>
          </Field>
          <Field label="Second reminder">
            <select value={pr.secondDays} onChange={(e) => set({ payReminders: { ...pr, secondDays: Number(e.target.value) } })}>
              <option value={0}>Don't send</option>
              {[5, 7, 10, 14, 21, 30].map((d) => <option key={d} value={d}>{d} days after the invoice</option>)}
            </select>
          </Field>
          <p className="wide small muted" style={{ margin: 0 }}>
            Counts from the invoice date (or when a technician finished the job). Sent Monday–Saturday, 9am–6pm, until the job is marked paid –
            with your card pay link if you've sent one, otherwise your bank details. Only invoices from now on are chased.
          </p>
          <p className="wide small preview" style={{ margin: 0 }}>
            Preview: Hi Sam, a friendly reminder from {s.businessName || 'your business'} that invoice #1042 for $385.00 is now due. Pay by card here: https://… Thanks!
          </p>
        </>
      )}
      <label className="field checkbox wide">
        <input type="checkbox" checked={n.confirmEnabled} onChange={(e) => set({ confirmEnabled: e.target.checked })} />
        <span>Send a booking confirmation when a job is booked in</span>
      </label>
      <label className="field checkbox wide">
        <input type="checkbox" checked={n.reminderEnabled} onChange={(e) => set({ reminderEnabled: e.target.checked })} />
        <span>Send a reminder before the booking</span>
      </label>
      {n.reminderEnabled && (
        <Field label="Reminder timing">
          <select value={n.reminderHours} onChange={(e) => set({ reminderHours: Number(e.target.value) })}>
            <option value={2}>2 hours before</option>
            <option value={24}>The day before (24 hours)</option>
            <option value={48}>2 days before</option>
          </select>
        </Field>
      )}
      {on && (
        <>
          <div className="field wide">
            <span>Send by</span>
            <div className="row wrap">
              <label className="field checkbox"><input type="checkbox" checked={n.sms} onChange={(e) => set({ sms: e.target.checked })} /><span>Text message</span></label>
              <label className="field checkbox"><input type="checkbox" checked={n.email} onChange={(e) => set({ email: e.target.checked })} /><span>Email</span></label>
            </div>
          </div>
          {status && (!status.sms || !status.email) && (
            <p className="wide notice small" style={{ margin: 0 }}>
              {!status.sms && !status.email
                ? 'Text and email sending are not connected yet, so messages will be prepared but not sent.'
                : !status.sms
                  ? 'Text messages are not connected yet – only emails will be sent for now.'
                  : 'Email is not connected yet – only text messages will be sent for now.'}
            </p>
          )}
          <Field label="Booking confirmation message" wide>
            <textarea rows={3} value={n.confirmTemplate} onChange={(e) => set({ confirmTemplate: e.target.value })} />
          </Field>
          <p className="wide small preview">Preview: {preview(n.confirmTemplate, s)}{n.sms && <span className="muted"> · ≈ {textsFor(s.businessName, 'confirmation', preview(n.confirmTemplate, s))} text{textsFor(s.businessName, 'confirmation', preview(n.confirmTemplate, s)) > 1 ? 's' : ''} each</span>}</p>
          <Field label="Reminder message" wide>
            <textarea rows={3} value={n.reminderTemplate} onChange={(e) => set({ reminderTemplate: e.target.value })} />
          </Field>
          <p className="wide small preview">Preview: {preview(n.reminderTemplate, s)}{n.sms && <span className="muted"> · ≈ {textsFor(s.businessName, 'reminder', preview(n.reminderTemplate, s))} text{textsFor(s.businessName, 'reminder', preview(n.reminderTemplate, s)) > 1 ? 's' : ''} each</span>}</p>
          <p className="wide small muted" style={{ margin: 0 }}>
            Texts automatically end with <em>"Reply Y to confirm or C to cancel."</em> and <em>"Powered by Spannr"</em>. When a customer replies Y,
            the job shows ✓ Customer confirmed and they get a thank-you text; if they reply C, you'll get an alert to rebook them.
          </p>
          <p className="wide muted small" style={{ margin: 0 }}>
            Placeholders: {'{name} {business} {day} {date} {time} {where} {vehicle} {phone}'} ·{' '}
            <button className="link" onClick={() => set({ confirmTemplate: DEFAULT_CONFIRM, reminderTemplate: DEFAULT_REMINDER })}>Reset wording</button>
          </p>
          <Field label="Time zone">
            <select value={s.timezone || 'Australia/Sydney'} onChange={(e) => onChange({ ...s, timezone: e.target.value })}>
              {['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Hobart'].map((z) => (
                <option key={z} value={z}>{z.replace('Australia/', '')}</option>
              ))}
            </select>
          </Field>
        </>
      )}
    </section>
  );
}
