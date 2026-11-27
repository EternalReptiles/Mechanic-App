import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import NumberInput from '../components/NumberInput';
import { Field, PageHeader } from '../components/ui';
import { db, getSettings } from '../db';
import { useAutosave } from '../hooks';
import type { BookingService, BookingSettings, Settings } from '../types';
import { uid } from '../utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DEFAULT_BOOKING: BookingSettings = {
  enabled: false,
  intro: '',
  services: [
    { id: 'svc-service', name: 'Logbook service', durationMins: 120 },
    { id: 'svc-brakes', name: 'Brake inspection / repair', durationMins: 90 },
    { id: 'svc-diag', name: 'Diagnosis – warning light or noise', durationMins: 60 },
  ],
  days: [1, 2, 3, 4, 5],
  startTime: '08:00',
  endTime: '17:00',
  slotMins: 30,
  leadHours: 12,
  maxDaysAhead: 30,
  capacity: 1,
};

const suggestSlug = (name: string) =>
  name.toLowerCase().replace(/(pty|ltd|services|automotive|mechanical|mechanics)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'my-business';

/** Settings → Online booking: turn on the public booking page, choose services and hours, share the link. */
export default function OnlineBookingSettings() {
  const { businessId, isAdmin } = useCloud();
  const [s, setS] = useState<Settings | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [slugDraft, setSlugDraft] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const catalog = useLiveQuery(() => db.catalog.orderBy('name').toArray(), []) ?? [];

  useEffect(() => {
    void getSettings().then((x) => setS({
      ...x,
      // Booking times follow the business's time zone – default it to this device's if it was never set.
      timezone: x.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney',
      booking: { ...DEFAULT_BOOKING, ...x.booking },
    }));
    void supabase.from('businesses').select('booking_slug').eq('id', businessId).maybeSingle()
      .then(({ data }) => { setSlug(data?.booking_slug ?? ''); setSlugDraft(data?.booking_slug ?? ''); });
  }, [businessId]);
  useAutosave(s, (x) => db.settings.put(x), 'settings');
  useEffect(() => {
    if (s && slug === '' && !slugDraft) setSlugDraft(suggestSlug(s.businessName));
  }, [s, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s?.booking || slug === null) return <PageHeader back title="Online booking" />;
  const b = s.booking;
  const set = (patch: Partial<BookingSettings>) => setS({ ...s, booking: { ...b, ...patch } });
  const setSvc = (id: string, patch: Partial<BookingService>) => set({ services: b.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const link = slug ? `https://app.spannr.au/book/${slug}` : '';

  async function saveSlug() {
    setErr('');
    setMsg('');
    const { data, error } = await supabase.rpc('set_booking_slug', { bid: businessId, p_slug: slugDraft });
    if (error) return setErr(error.message);
    setSlug(data as string);
    setSlugDraft(data as string);
    setMsg('Booking link saved.');
  }

  return (
    <>
      <PageHeader back title="Online booking" />
      <p className="muted small" style={{ marginTop: 0 }}>
        Customers book themselves from your own booking page – put the link on your Google profile, website, Facebook and Instagram.
        Bookings land straight in your schedule, and they get your automatic confirmation.
      </p>
      {!isAdmin && <p className="notice small">Only the owner or an admin can change online booking.</p>}

      <section className="card">
        <label className="row" style={{ gap: 10, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 22, height: 22, minHeight: 0 }} checked={b.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <strong>Take bookings online</strong>
        </label>
        <Field label="Your booking link">
          <div className="row" style={{ gap: 6 }}>
            <span className="muted small" style={{ whiteSpace: 'nowrap' }}>app.spannr.au/book/</span>
            <input value={slugDraft} onChange={(e) => setSlugDraft(e.target.value.toLowerCase())} placeholder="your-business" />
            <button className="btn" disabled={!slugDraft || slugDraft === slug} onClick={() => void saveSlug()}>Save</button>
          </div>
        </Field>
        {link && (
          <div className="row wrap">
            <a className="btn" href={`/book/${slug}`} target="_blank" rel="noreferrer">👀 Preview</a>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg('Link copied.'))}>📋 Copy link</button>
            {'share' in navigator && <button className="btn" onClick={() => void navigator.share({ title: `Book with ${s.businessName}`, url: link })}>Share</button>}
          </div>
        )}
        {!b.enabled && slug && <p className="small muted">The page is off – tick "Take bookings online" to switch it on.</p>}
        {msg && <p className="small">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </section>

      <section className="card">
        <h2>Services customers can book</h2>
        {b.services.map((v) => (
          <div key={v.id} className="booking-svc">
            <div className="row" style={{ gap: 8 }}>
              <input className="grow" value={v.name} placeholder="Service name" onChange={(e) => setSvc(v.id, { name: e.target.value })} />
              <button className="icon-btn danger" aria-label="Remove service" onClick={() => set({ services: b.services.filter((x) => x.id !== v.id) })}>✕</button>
            </div>
            <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
              <label className="mini">Takes (minutes)
                <NumberInput inputMode="numeric" value={v.durationMins} onChange={(n) => setSvc(v.id, { durationMins: Math.max(15, Math.round(n)) })} />
              </label>
              <label className="mini" style={{ flex: 2 }}>Add price-list item to the job
                <select value={v.catalogId ?? ''} onChange={(e) => setSvc(v.id, { catalogId: e.target.value || undefined })}>
                  <option value="">— none —</option>
                  {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
            {v.catalogId && (
              <label className="small row" style={{ gap: 6, marginTop: 6 }}>
                <input type="checkbox" style={{ width: 18, height: 18, minHeight: 0 }} checked={!!v.showPrice} onChange={(e) => setSvc(v.id, { showPrice: e.target.checked })} />
                Show the price on the booking page
              </label>
            )}
            <input style={{ marginTop: 6 }} placeholder="Short description (optional)" value={v.description ?? ''} onChange={(e) => setSvc(v.id, { description: e.target.value })} />
          </div>
        ))}
        <button className="btn" onClick={() => set({ services: [...b.services, { id: uid(), name: '', durationMins: 60 }] })}>+ Add service</button>
      </section>

      <section className="card grid">
        <h2 className="wide">When customers can book</h2>
        <div className="wide chips wrap">
          {DAYS.map((d, i) => (
            <button key={d} className={`chip ${b.days.includes(i) ? 'active' : ''}`}
              onClick={() => set({ days: b.days.includes(i) ? b.days.filter((x) => x !== i) : [...b.days, i].sort() })}>{d}</button>
          ))}
        </div>
        <Field label="From"><input type="time" value={b.startTime} onChange={(e) => set({ startTime: e.target.value })} /></Field>
        <Field label="Until"><input type="time" value={b.endTime} onChange={(e) => set({ endTime: e.target.value })} /></Field>
        <Field label="Start times every">
          <select value={b.slotMins} onChange={(e) => set({ slotMins: Number(e.target.value) })}>
            {[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}
          </select>
        </Field>
        <Field label="Earliest booking">
          <select value={b.leadHours} onChange={(e) => set({ leadHours: Number(e.target.value) })}>
            {[2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hours ahead` : `${h / 24} day${h > 24 ? 's' : ''} ahead`}</option>)}
          </select>
        </Field>
        <Field label="Book up to">
          <select value={b.maxDaysAhead} onChange={(e) => set({ maxDaysAhead: Number(e.target.value) })}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
          </select>
        </Field>
        <Field label="Jobs at the same time">
          <NumberInput inputMode="numeric" value={b.capacity} onChange={(n) => set({ capacity: Math.max(1, Math.round(n)) })} />
        </Field>
        <p className="wide small muted" style={{ margin: 0 }}>
          Times already taken by jobs in your schedule aren't offered. Set "jobs at the same time" above 1 if you have more than one mechanic or bay.
        </p>
        <Field label="Message on your booking page (optional)" wide>
          <textarea rows={2} value={b.intro ?? ''} placeholder="e.g. Mobile mechanic servicing the Sunshine Coast. We come to your home or work." onChange={(e) => set({ intro: e.target.value })} />
        </Field>
      </section>
    </>
  );
}
