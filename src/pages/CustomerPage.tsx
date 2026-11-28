import PortalShare from '../portal/PortalShare';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import JobCard from '../components/JobCard';
import { Empty, Field, PageHeader } from '../components/ui';
import { createJob, db, deleteCustomer, newVehicle, removeRecords } from '../db';
import { useAutosave } from '../hooks';
import { useSettings } from '../hooks';
import type { Customer, Vehicle } from '../types';
import { fmtDay, mapsUrl, telUrl, vehicleLabel } from '../utils';
import TextThread from '../messages/TextThread';

function VehicleEditor({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const [v, setV] = useState(vehicle);
  const set = (k: keyof Vehicle) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <div className="card grid">
      <Field label="Rego"><input value={v.rego} onChange={set('rego')} /></Field>
      <Field label="Year"><input inputMode="numeric" value={v.year} onChange={set('year')} /></Field>
      <Field label="Make"><input value={v.make} onChange={set('make')} /></Field>
      <Field label="Model"><input value={v.model} onChange={set('model')} /></Field>
      <Field label="VIN"><input value={v.vin} onChange={set('vin')} /></Field>
      <Field label="Odometer (km)"><input inputMode="numeric" value={v.odometer} onChange={set('odometer')} /></Field>
      <Field label="Next service due"><input type="date" value={v.nextServiceDate ?? ''} onChange={set('nextServiceDate')} /></Field>
      <Field label="Next service (km)"><input inputMode="numeric" value={v.nextServiceKm ?? ''} onChange={set('nextServiceKm')} /></Field>
      <Field label="Rego expiry"><input type="date" value={v.regoExpiry ?? ''} onChange={set('regoExpiry')} /></Field>
      <Field label="Notes" wide><textarea rows={2} value={v.notes} onChange={set('notes')} /></Field>
      <div className="row wide">
        <button className="btn primary" onClick={async () => { await db.vehicles.put({ ...v, rego: v.rego.toUpperCase() }); onDone(); }}>Save vehicle</button>
        <button className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn danger" onClick={async () => { if (confirm('Delete this vehicle?')) { await removeRecords('vehicles', [v.id]); onDone(); } }}>Delete</button>
      </div>
    </div>
  );
}

export default function CustomerPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const [c, setC] = useState<Customer | null | undefined>(undefined);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const deletedRef = useRef(false);

  const vehicles = useLiveQuery(() => db.vehicles.where('customerId').equals(id).toArray(), [id]) ?? [];
  const jobs = useLiveQuery(() => db.jobs.where('customerId').equals(id).reverse().sortBy('number'), [id]) ?? [];
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

  useEffect(() => {
    db.customers.get(id).then((x) => setC(x ?? null));
  }, [id]);

  useAutosave(c, (x) => !deletedRef.current && db.customers.put(x), id);

  if (c === undefined) return null;
  if (c === null) return <PageHeader title="Customer not found" back />;

  const set = (k: keyof Customer) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setC({ ...c, [k]: e.target.value });

  async function newJob() {
    const job = await createJob({ customerId: c!.id, siteAddress: c!.address, vehicleId: vehicles.length === 1 ? vehicles[0].id : '' });
    navigate(`/jobs/${job.id}`);
  }

  async function remove() {
    if (!confirm(`Delete ${c!.name} and all their vehicles, jobs and photos?`)) return;
    deletedRef.current = true;
    await deleteCustomer(c!.id);
    navigate('/customers', { replace: true });
  }

  return (
    <>
      <PageHeader back title={c.name || 'Customer'} actions={<button className="btn primary" onClick={newJob}>+ Job</button>} />
      <div className="row wrap quick-actions">
        {c.phone && <a className="btn" href={telUrl(c.phone)}>📞 Call</a>}
        {c.email && <a className="btn" href={`mailto:${c.email}`}>✉ Email</a>}
        {c.address && <a className="btn" href={mapsUrl(c.address)} target="_blank" rel="noreferrer">🧭 Navigate</a>}
        <PortalShare customer={c} onChange={setC} />
      </div>

      <TextThread customer={c} />

      <section className="card grid">
        <Field label="Name" wide><input value={c.name} onChange={set('name')} /></Field>
        <Field label="Mobile"><input type="tel" value={c.phone} onChange={set('phone')} /></Field>
        <Field label="Email"><input type="email" value={c.email} onChange={set('email')} /></Field>
        <Field label="Address" wide><input value={c.address} onChange={set('address')} /></Field>
        <Field label="Notes" wide><textarea rows={2} value={c.notes} onChange={set('notes')} /></Field>
        <label className="field checkbox wide">
          <input type="checkbox" checked={!!c.noAutoMessages} onChange={(e) => setC({ ...c, noAutoMessages: e.target.checked })} />
          <span>Don't send automatic booking messages to this customer</span>
        </label>
      </section>

      <h2>Vehicles</h2>
      {vehicles.map((v) =>
        editingVehicle?.id === v.id ? (
          <VehicleEditor key={v.id} vehicle={v} onDone={() => setEditingVehicle(null)} />
        ) : (
          <button key={v.id} className="card as-button" onClick={() => setEditingVehicle(v)}>
            <strong>{vehicleLabel(v)}</strong>
            <div className="muted small">{[v.vin && `VIN ${v.vin}`, v.odometer && `${v.odometer} km`, v.nextServiceDate && `Service due ${fmtDay(v.nextServiceDate)}`].filter(Boolean).join(' · ')}</div>
          </button>
        ),
      )}
      {editingVehicle && !vehicles.some((v) => v.id === editingVehicle.id) && (
        <VehicleEditor vehicle={editingVehicle} onDone={() => setEditingVehicle(null)} />
      )}
      {!editingVehicle && <button className="btn" onClick={() => setEditingVehicle(newVehicle(c.id))}>+ Add vehicle</button>}

      <h2>Job history</h2>
      {jobs.length ? (
        jobs.map((j) => <JobCard key={j.id} job={j} customer={c} vehicle={vehicleMap.get(j.vehicleId)} gst={settings.gstRegistered} />)
      ) : (
        <Empty>No jobs yet.</Empty>
      )}

      <p><Link to="/customers">← All customers</Link></p>
      <button className="btn danger block" onClick={remove}>Delete customer</button>
    </>
  );
}
