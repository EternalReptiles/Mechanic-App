import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../cloud/supabase';

type Service = { id: string; name: string; durationMins: number; description?: string; price?: number | null };
type Page = {
  businessName: string; logo: string | null; brandColor: string | null; phone: string; email: string;
  businessType: 'mobile' | 'workshop' | 'both'; workshopAddress: string | null; timezone: string; intro: string | null;
  services: Service[]; days: number[]; startTime: string; endTime: string; slotMins: number; leadHours: number;
  maxDaysAhead: number; capacity: number; busy: [string, string][];
};

// ---- time-zone helpers: build instants from the business's local date + time ----
function tzOffsetMs(utcMs: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}
function localParts(utcMs: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const hm = (t: string) => t.split(':').map(Number) as [number, number];

/** Public booking page: app.spannr.au/book/<slug> */
export default function BookingPage() {
  const { slug = '' } = useParams();
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [svcId, setSvcId] = useState('');
  const [day, setDay] = useState<number | null>(null); // UTC ms of local midnight
  const [slot, setSlot] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', rego: '', make: '', model: '', address: '', notes: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ when: string; service: string } | null>(null);

  async function load() {
    const { data } = await supabase.rpc('public_booking_page', { p_slug: slug });
    setPage((data as Page) ?? null);
  }
  useEffect(() => { void load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (page) document.title = `Book with ${page.businessName}`;
  }, [page]);

  const svc = page?.services.find((s) => s.id === svcId);
  const color = page?.brandColor && /^#[0-9a-f]{6}$/i.test(page.brandColor) ? page.brandColor : '#f59e0b';

  // Open slots for each day, honouring hours, lead time, existing jobs and capacity.
  const days = useMemo(() => {
    if (!page || !svc) return [];
    const tz = page.timezone;
    const out: { midnight: number; label: string; slots: number[] }[] = [];
    const busy = page.busy.map(([a, b]) => [Date.parse(a), Date.parse(b)] as const);
    const earliest = Date.now() + page.leadHours * 3600_000;
    const [sh, sm] = hm(page.startTime);
    const [eh, em] = hm(page.endTime);
    const today = localParts(Date.now(), tz);
    for (let i = 0; i <= page.maxDaysAhead; i++) {
      const base = Date.UTC(today.y, today.m - 1, today.d + i, 12);
      const lp = localParts(base, tz);
      if (!page.days.includes(lp.wd)) continue;
      const open = zonedToUtc(lp.y, lp.m, lp.d, sh, sm, tz);
      const close = zonedToUtc(lp.y, lp.m, lp.d, eh, em, tz);
      const slots: number[] = [];
      for (let t = open; t + svc.durationMins * 60_000 <= close; t += page.slotMins * 60_000) {
        if (t < earliest) continue;
        const end = t + svc.durationMins * 60_000;
        const overlapping = busy.filter(([a, b]) => a < end && b > t).length;
        if (overlapping < page.capacity) slots.push(t);
      }
      if (slots.length)
        out.push({
          midnight: zonedToUtc(lp.y, lp.m, lp.d, 0, 0, tz),
          label: new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(open)),
          slots,
        });
    }
    return out;
  }, [page, svc]);

  const fmtTime = (t: number) => new Intl.DateTimeFormat('en-AU', { timeZone: page!.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  const chosenDay = days.find((d) => d.midnight === day) ?? null;
  const mobile = page?.businessType === 'mobile';
  const askAddress = page?.businessType !== 'workshop';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!svc || slot === null) return;
    setErr('');
    setBusy(true);
    const { data, error } = await supabase.rpc('public_create_booking', {
      p_slug: slug,
      p: { ...form, serviceId: svc.id, start: new Date(slot).toISOString() },
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      if (/taken/i.test(error.message)) { setSlot(null); void load(); }
      return;
    }
    setDone(data as { when: string; service: string });
  }

  if (page === undefined) return <div className="book-page"><p className="muted">Loading…</p></div>;
  if (page === null)
    return (
      <div className="book-page">
        <div className="book-card"><h1>Online booking isn't available</h1><p className="muted">This booking page doesn't exist or isn't taking bookings right now.</p></div>
      </div>
    );

  return (
    <div className="book-page" style={{ ['--brand' as string]: color }}>
      <header className="book-head">
        {page.logo && <img src={page.logo} alt="" className="book-logo" />}
        <div>
          <h1>{page.businessName}</h1>
          <div className="small muted">Book online{page.phone ? ` · ${page.phone}` : ''}</div>
        </div>
      </header>

      {done ? (
        <div className="book-card">
          <h2>✓ You're booked in</h2>
          <p><strong>{done.service}</strong> on <strong>{done.when}</strong>.</p>
          <p className="muted">You'll get a confirmation by text. {page.businessName} will be in touch if anything needs to change.</p>
        </div>
      ) : (
        <form onSubmit={submit}>
          {page.intro && <p className="book-intro">{page.intro}</p>}

          <section className="book-card">
            <h2>1. What do you need?</h2>
            <div className="book-options">
              {page.services.map((s) => (
                <button type="button" key={s.id} className={`book-opt ${svcId === s.id ? 'on' : ''}`} onClick={() => { setSvcId(s.id); setDay(null); setSlot(null); }}>
                  <strong>{s.name}</strong>
                  <span className="small muted">
                    {s.durationMins >= 60 ? `${Math.round((s.durationMins / 60) * 10) / 10} hr` : `${s.durationMins} min`}
                    {s.price ? ` · from $${s.price.toFixed(2)}` : ''}
                  </span>
                  {s.description && <span className="small">{s.description}</span>}
                </button>
              ))}
            </div>
          </section>

          {svc && (
            <section className="book-card">
              <h2>2. Pick a time</h2>
              {!days.length ? (
                <p className="muted">No times available – please call{page.phone ? ` ${page.phone}` : ''} to book.</p>
              ) : (
                <>
                  <div className="book-days">
                    {days.map((d) => (
                      <button type="button" key={d.midnight} className={`book-day ${day === d.midnight ? 'on' : ''}`} onClick={() => { setDay(d.midnight); setSlot(null); }}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {chosenDay && (
                    <div className="book-slots">
                      {chosenDay.slots.map((t) => (
                        <button type="button" key={t} className={`book-slot ${slot === t ? 'on' : ''}`} onClick={() => setSlot(t)}>{fmtTime(t)}</button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {svc && slot !== null && (
            <section className="book-card">
              <h2>3. Your details</h2>
              <label className="field"><span>Name *</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
              <label className="field"><span>Mobile *</span><input required type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" placeholder="04…" /></label>
              <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></label>
              {askAddress && (
                <label className="field">
                  <span>{mobile ? 'Where will the car be? *' : 'Your address (if you\'d like us to come to you)'}</span>
                  <input required={mobile} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} autoComplete="street-address" />
                </label>
              )}
              {!mobile && page.workshopAddress && <p className="small muted">Workshop: {page.workshopAddress}</p>}
              <div className="row wrap" style={{ gap: 8 }}>
                <label className="field" style={{ flex: 1, minWidth: 110 }}><span>Rego</span><input value={form.rego} onChange={(e) => setForm({ ...form, rego: e.target.value.toUpperCase() })} /></label>
                <label className="field" style={{ flex: 1, minWidth: 110 }}><span>Make</span><input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder="e.g. Toyota" /></label>
                <label className="field" style={{ flex: 1, minWidth: 110 }}><span>Model</span><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g. HiLux" /></label>
              </div>
              <label className="field"><span>Anything we should know?</span><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Squeaking when braking, service light on" /></label>
              <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              {err && <p className="error">{err}</p>}
              <button className="btn primary block big book-submit" disabled={busy}>
                {busy ? 'Booking…' : `Book ${svc.name} – ${chosenDay?.label}, ${fmtTime(slot)}`}
              </button>
            </section>
          )}
        </form>
      )}
      <p className="book-foot small muted">Bookings by <a href="https://spannr.au" target="_blank" rel="noreferrer">Spannr</a></p>
    </div>
  );
}
