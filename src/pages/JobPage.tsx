import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LineItems from '../components/LineItems';
import Photos from '../components/Photos';
import { Field, PageHeader, StatusBadge } from '../components/ui';
import { db, deleteJob, newCustomer, newVehicle } from '../db';
import { useSettings } from '../hooks';
import type { Job, JobStatus } from '../types';
import { fromLocalInput, mapsUrl, smsUrl, STATUS, STATUS_ORDER, telUrl, toLocalInput, vehicleLabel } from '../utils';

const NEXT_STEP: Partial<Record<JobStatus, { label: string; to: JobStatus }>> = {
  quote: { label: 'Quote accepted → Schedule', to: 'scheduled' },
  scheduled: { label: 'Start job', to: 'in_progress' },
  in_progress: { label: 'Mark job complete', to: 'completed' },
  completed: { label: 'Create invoice', to: 'invoiced' },
  invoiced: { label: 'Mark as paid', to: 'paid' },
};

export default function JobPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [saved, setSaved] = useState(true);
  const loaded = useRef(false);

  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  const vehicles = useLiveQuery(
    () => (job?.customerId ? db.vehicles.where('customerId').equals(job.customerId).toArray() : []),
    [job?.customerId],
  ) ?? [];
  const customer = customers.find((c) => c.id === job?.customerId);
  const vehicle = vehicles.find((v) => v.id === job?.vehicleId);

  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCust, setNewCust] = useState(newCustomer());
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [newVeh, setNewVeh] = useState(newVehicle(''));

  useEffect(() => {
    loaded.current = false;
    db.jobs.get(id).then((j) => setJob(j ?? null));
  }, [id]);

  // Auto-save shortly after every change.
  useEffect(() => {
    if (!job) return;
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    setSaved(false);
    const t = setTimeout(() => db.jobs.put(job).then(() => setSaved(true)), 400);
    return () => clearTimeout(t);
  }, [job]);

  if (job === undefined) return null;
  if (job === null)
    return (
      <>
        <PageHeader title="Job not found" back />
        <Link to="/jobs" className="btn">Back to jobs</Link>
      </>
    );

  const update = (patch: Partial<Job>) => setJob((j) => (j ? { ...j, ...patch } : j));

  function setStatus(to: JobStatus) {
    const patch: Partial<Job> = { status: to };
    const now = new Date().toISOString();
    if (to === 'invoiced' && !job!.invoicedAt) patch.invoicedAt = now;
    if (to === 'paid' && !job!.paidAt) patch.paidAt = now;
    update(patch);
  }

  async function saveNewCustomer() {
    if (!newCust.name.trim()) return alert('Customer name is required.');
    await db.customers.add(newCust);
    update({ customerId: newCust.id, vehicleId: '', siteAddress: job!.siteAddress || newCust.address });
    setNewCust(newCustomer());
    setAddingCustomer(false);
  }

  async function saveNewVehicle() {
    const v = { ...newVeh, customerId: job!.customerId, rego: newVeh.rego.toUpperCase() };
    await db.vehicles.add(v);
    update({ vehicleId: v.id });
    setNewVeh(newVehicle(''));
    setAddingVehicle(false);
  }

  async function remove() {
    if (!confirm(`Delete job #${job!.number}? This cannot be undone.`)) return;
    loaded.current = false;
    await deleteJob(job!.id);
    navigate('/jobs', { replace: true });
  }

  const next = NEXT_STEP[job.status];
  const address = job.siteAddress || customer?.address || '';

  return (
    <>
      <PageHeader
        back
        title={<>Job #{job.number} <StatusBadge status={job.status} /></>}
        actions={<span className="muted small">{saved ? 'Saved' : 'Saving…'}</span>}
      />

      {next && (
        <button className="btn primary block" onClick={() => setStatus(next.to)}>
          {next.label}
        </button>
      )}

      <div className="row wrap quick-actions">
        {customer?.phone && <a className="btn" href={telUrl(customer.phone)}>📞 Call</a>}
        {customer?.phone && (
          <a className="btn" href={smsUrl(customer.phone, `Hi ${customer.name.split(' ')[0]}, it's ${settings.businessName}. I'm on my way and should be with you shortly.`)}>
            💬 On my way
          </a>
        )}
        {address && <a className="btn" href={mapsUrl(address)} target="_blank" rel="noreferrer">🧭 Navigate</a>}
        <Link className="btn" to={`/jobs/${job.id}/quote`}>📄 Quote</Link>
        <Link className="btn" to={`/jobs/${job.id}/invoice`}>🧾 Invoice</Link>
      </div>

      <section className="card">
        <h2>Customer</h2>
        {!addingCustomer ? (
          <div className="row">
            <select className="grow" value={job.customerId}
              onChange={(e) => {
                const c = customers.find((x) => x.id === e.target.value);
                update({ customerId: e.target.value, vehicleId: '', siteAddress: job.siteAddress || c?.address || '' });
              }}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
            </select>
            <button className="btn" onClick={() => setAddingCustomer(true)}>+ New</button>
          </div>
        ) : (
          <div className="grid">
            <Field label="Name"><input autoFocus value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></Field>
            <Field label="Mobile"><input type="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></Field>
            <Field label="Address" wide><input value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} /></Field>
            <div className="row wide">
              <button className="btn primary" onClick={saveNewCustomer}>Add customer</button>
              <button className="btn ghost" onClick={() => setAddingCustomer(false)}>Cancel</button>
            </div>
          </div>
        )}
        {customer && !addingCustomer && (
          <p className="muted small">
            <Link to={`/customers/${customer.id}`}>View customer</Link>
            {customer.email && ` · ${customer.email}`}
          </p>
        )}
      </section>

      {job.customerId && (
        <section className="card">
          <h2>Vehicle</h2>
          {!addingVehicle ? (
            <div className="row">
              <select className="grow" value={job.vehicleId} onChange={(e) => update({ vehicleId: e.target.value })}>
                <option value="">— Select vehicle —</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
              </select>
              <button className="btn" onClick={() => setAddingVehicle(true)}>+ New</button>
            </div>
          ) : (
            <div className="grid">
              <Field label="Rego"><input autoFocus value={newVeh.rego} onChange={(e) => setNewVeh({ ...newVeh, rego: e.target.value })} /></Field>
              <Field label="Year"><input inputMode="numeric" value={newVeh.year} onChange={(e) => setNewVeh({ ...newVeh, year: e.target.value })} /></Field>
              <Field label="Make"><input value={newVeh.make} onChange={(e) => setNewVeh({ ...newVeh, make: e.target.value })} /></Field>
              <Field label="Model"><input value={newVeh.model} onChange={(e) => setNewVeh({ ...newVeh, model: e.target.value })} /></Field>
              <Field label="VIN" wide><input value={newVeh.vin} onChange={(e) => setNewVeh({ ...newVeh, vin: e.target.value })} /></Field>
              <div className="row wide">
                <button className="btn primary" onClick={saveNewVehicle}>Add vehicle</button>
                <button className="btn ghost" onClick={() => setAddingVehicle(false)}>Cancel</button>
              </div>
            </div>
          )}
          {vehicle && !addingVehicle && (
            <Field label="Odometer at this job (km)">
              <input inputMode="numeric" value={job.odometer}
                onChange={(e) => {
                  update({ odometer: e.target.value });
                  db.vehicles.update(vehicle.id, { odometer: e.target.value });
                }} placeholder={vehicle.odometer ? `Last: ${vehicle.odometer}` : ''} />
            </Field>
          )}
        </section>
      )}

      <section className="card grid">
        <h2 className="wide">Job details</h2>
        <Field label="Job title" wide>
          <input value={job.title} placeholder="e.g. Logbook service, brake pads" onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <Field label="Booking time">
          <input type="datetime-local" value={toLocalInput(job.scheduledStart)}
            onChange={(e) => update({
              scheduledStart: fromLocalInput(e.target.value),
              status: job.status === 'quote' && e.target.value ? 'scheduled' : job.status,
            })} />
        </Field>
        <Field label="Duration">
          <select value={job.durationMins} onChange={(e) => update({ durationMins: Number(e.target.value) })}>
            {[30, 60, 90, 120, 180, 240, 360, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
          </select>
        </Field>
        <Field label="Job address" wide>
          <input value={job.siteAddress} placeholder={customer?.address} onChange={(e) => update({ siteAddress: e.target.value })} />
        </Field>
        <Field label="Customer's description of the problem" wide>
          <textarea rows={3} value={job.description} onChange={(e) => update({ description: e.target.value })} />
        </Field>
        <Field label="Work notes (shown on invoice)" wide>
          <textarea rows={4} value={job.workNotes} placeholder="Work carried out, recommendations…" onChange={(e) => update({ workNotes: e.target.value })} />
        </Field>
        <Field label="Status">
          <select value={job.status} onChange={(e) => setStatus(e.target.value as JobStatus)}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </Field>
      </section>

      <section className="card">
        <h2>Labour &amp; parts</h2>
        <LineItems items={job.lineItems} onChange={(lineItems) => update({ lineItems })}
          labourRate={settings.labourRate} gst={settings.gstRegistered} />
      </section>

      <section className="card">
        <h2>Photos</h2>
        <Photos jobId={job.id} />
      </section>

      <button className="btn danger block" onClick={remove}>Delete job</button>
    </>
  );
}
