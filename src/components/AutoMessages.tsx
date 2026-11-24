import { useEffect, useState } from 'react';
import { supabase } from '../cloud/supabase';
import type { NotifySettings, Settings } from '../types';
import { Field } from './ui';

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

  return (
    <section className="card grid">
      <h2 className="wide">Automatic customer messages</h2>
      <p className="wide muted small" style={{ margin: 0 }}>
        Spannr texts and emails your customers for you – even when your phone is off. Nothing is sent between 9pm and 7:30am.
      </p>
      <label className="field checkbox wide">
        <input type="checkbox" checked={n.receiptEnabled !== false} onChange={(e) => set({ receiptEnabled: e.target.checked })} />
        <span>Send a receipt with the paid invoice when a customer pays by card</span>
      </label>
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
          <p className="wide small preview">Preview: {preview(n.confirmTemplate, s)}</p>
          <Field label="Reminder message" wide>
            <textarea rows={3} value={n.reminderTemplate} onChange={(e) => set({ reminderTemplate: e.target.value })} />
          </Field>
          <p className="wide small preview">Preview: {preview(n.reminderTemplate, s)}</p>
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
