import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../cloud/supabase';

type Vehicle = {
  id: string; rego: string | null; make: string | null; model: string | null; year: string | null; odometer: string | null;
  nextServiceDate: string | null; nextServiceKm: string | null; regoExpiry: string | null;
};
type PortalJob = {
  number: number; date: string; title: string | null; status: string; vehicleId: string | null; odometer: string | null;
  notes: string | null; total: number; payUrl: string | null;
};
type Portal = {
  business: { name: string; phone: string | null; email: string | null; logo: string | null; brandColor: string | null; address: string | null; abn: string | null; website: string | null; bookingUrl: string | null };
  customer: { firstName: string };
  vehicles: Vehicle[];
  jobs: PortalJob[];
};

const money = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const carName = (v: Vehicle) => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Your car';
const STATUS: Record<string, string> = {
  scheduled: 'Booked', in_progress: 'In progress', waiting: 'In progress', completed: 'Done', invoiced: 'To pay', paid: 'Paid',
};
const daysUntil = (iso: string) => Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);

/** A customer's own page: app.spannr.au/my/<token> – their cars, service history and invoices, in the business's branding. */
export default function CustomerPortal() {
  const { token = '' } = useParams();
  const [p, setP] = useState<Portal | null | undefined>(undefined);
  useEffect(() => {
    void supabase.rpc('public_customer_portal', { p_token: token }).then(({ data }) => setP((data as Portal) ?? null));
  }, [token]);
  useEffect(() => { if (p) document.title = `${p.business.name} – your car`; }, [p]);

  if (p === undefined) return <div className="portal"><p className="muted" style={{ textAlign: 'center', marginTop: 80 }}>Loading…</p></div>;
  if (p === null) return <div className="portal"><div className="portal-card"><h2>Link not found</h2><p className="muted">This link has expired. Ask your mechanic for a new one.</p></div></div>;

  const b = p.business;
  const color = b.brandColor && /^#[0-9a-f]{6}$/i.test(b.brandColor) ? b.brandColor : '#f59e0b';
  const owing = p.jobs.filter((j) => j.status === 'invoiced');
  const upcoming = p.jobs.filter((j) => ['scheduled', 'in_progress', 'waiting'].includes(j.status));
  const history = p.jobs.filter((j) => ['completed', 'invoiced', 'paid'].includes(j.status));
  const car = (id: string | null) => p.vehicles.find((v) => v.id === id);

  return (
    <div className="portal" style={{ ['--brand' as string]: color }}>
      <header className="portal-head">
        {b.logo ? <img src={b.logo} alt={b.name} className="portal-logo" /> : <strong className="portal-name">{b.name}</strong>}
        <div className="portal-contact">
          {b.phone && <a href={`tel:${b.phone.replace(/\s/g, '')}`}>📞 {b.phone}</a>}
        </div>
      </header>

      <h1 className="portal-hi">Hi {p.customer.firstName || 'there'} 👋</h1>
      <p className="muted" style={{ marginTop: 0 }}>Your cars, service history and invoices with {b.name}.</p>

      <div className="portal-actions">
        {b.bookingUrl && <a className="portal-btn primary" href={b.bookingUrl}>📅 Book a service</a>}
        {b.phone && <a className={`portal-btn${b.bookingUrl ? '' : ' primary'}`} href={`tel:${b.phone.replace(/\s/g, '')}`}>📞 Call to book</a>}
        {b.phone && <a className="portal-btn" href={`sms:${b.phone.replace(/\s/g, '')}`}>💬 Text us</a>}
      </div>

      {owing.length > 0 && (
        <section className="portal-card owing">
          <h2>To pay</h2>
          {owing.map((j) => (
            <div key={j.number} className="portal-row">
              <span><strong>{j.title || `Job #${j.number}`}</strong><br /><small className="muted">#{j.number} · {day(j.date)}</small></span>
              <span className="portal-right">
                <strong>{money(j.total)}</strong>
                {j.payUrl && <a className="portal-btn primary small" href={j.payUrl}>Pay now</a>}
              </span>
            </div>
          ))}
        </section>
      )}

      {p.vehicles.map((v) => {
        const due = v.nextServiceDate ? daysUntil(v.nextServiceDate) : null;
        return (
          <section key={v.id} className="portal-card">
            <div className="portal-row" style={{ borderTop: 0, paddingTop: 0 }}>
              <span><strong className="portal-car">{carName(v)}</strong><br /><span className="portal-rego">{v.rego}</span></span>
              {v.odometer && <small className="muted">{Number(v.odometer).toLocaleString('en-AU')} km</small>}
            </div>
            {v.nextServiceDate && (
              <p className={`portal-due${due !== null && due < 30 ? ' soon' : ''}`}>
                🔧 Next service {due !== null && due < 0 ? 'was due' : 'due'} <strong>{day(v.nextServiceDate)}</strong>
                {v.nextServiceKm && <> or {Number(v.nextServiceKm).toLocaleString('en-AU')} km</>}
              </p>
            )}
            {v.regoExpiry && <p className="portal-due">🪪 Rego due <strong>{day(v.regoExpiry)}</strong></p>}
          </section>
        );
      })}

      {upcoming.length > 0 && (
        <section className="portal-card">
          <h2>Booked in</h2>
          {upcoming.map((j) => (
            <div key={j.number} className="portal-row">
              <span><strong>{j.title || `Job #${j.number}`}</strong><br /><small className="muted">{car(j.vehicleId)?.rego ?? ''} {STATUS[j.status]}</small></span>
            </div>
          ))}
        </section>
      )}

      <section className="portal-card">
        <h2>Service history</h2>
        {!history.length ? <p className="muted">No completed jobs yet.</p> : history.map((j) => (
          <details key={j.number} className="portal-job">
            <summary className="portal-row">
              <span><strong>{day(j.date)}</strong> · {j.title || `Job #${j.number}`}<br />
                <small className="muted">#{j.number}{car(j.vehicleId)?.rego ? ` · ${car(j.vehicleId)!.rego}` : ''}{j.odometer ? ` · ${Number(j.odometer).toLocaleString('en-AU')} km` : ''}</small></span>
              <span className="portal-right"><span>{j.total ? money(j.total) : ''}</span><small className={`portal-pill ${j.status}`}>{STATUS[j.status]}</small></span>
            </summary>
            {j.notes && <p className="portal-notes">{j.notes}</p>}
          </details>
        ))}
      </section>

      <footer className="portal-foot">
        <div>{b.name}{b.abn ? ` · ABN ${b.abn}` : ''}</div>
        {b.address && <div>{b.address}</div>}
        {b.email && <div><a href={`mailto:${b.email}`}>{b.email}</a></div>}
        <div className="portal-powered">Powered by <a href="https://spannr.au">Spannr</a></div>
      </footer>
    </div>
  );
}
