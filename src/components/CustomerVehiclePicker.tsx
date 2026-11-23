import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db, newCustomer, newVehicle } from '../db';
import type { Customer, Vehicle } from '../types';
import { vehicleLabel } from '../utils';
import { Field } from './ui';

/**
 * One search box for the whole "who and what car" question:
 * type a name, phone number or rego and tap the match.
 */
export default function CustomerVehiclePicker({
  customerId,
  vehicleId,
  onChange,
}: {
  customerId: string;
  vehicleId: string;
  onChange: (customer: Customer | undefined, vehicle: Vehicle | undefined) => void;
}) {
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];
  const customer = customers.find((c) => c.id === customerId);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const theirVehicles = vehicles.filter((v) => v.customerId === customerId);

  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'view' | 'search' | 'newCustomer' | 'newVehicle'>(customerId ? 'view' : 'search');
  const [nc, setNc] = useState(newCustomer());
  const [nv, setNv] = useState(newVehicle(''));

  const needle = q.trim().toLowerCase().replace(/\s+/g, ' ');
  const regoNeedle = needle.replace(/\s/g, '');
  const digits = needle.replace(/\D/g, '');
  const vehicleHits = needle
    ? vehicles.filter(
        (v) =>
          v.rego.toLowerCase().replace(/\s/g, '').includes(regoNeedle) ||
          `${v.year} ${v.make} ${v.model}`.toLowerCase().includes(needle) ||
          (v.vin && v.vin.toLowerCase().includes(needle)),
      )
    : [];
  const customerHits = needle
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.email.toLowerCase().includes(needle) ||
          (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits)),
      )
    : customers.slice(0, 8);

  function startNewCustomer() {
    const looksLikePhone = /^[\d+ ]{6,}$/.test(q.trim());
    setNc(newCustomer(looksLikePhone ? { phone: q.trim() } : { name: q.trim() }));
    setNv(newVehicle(''));
    setMode('newCustomer');
  }

  async function saveNewCustomer() {
    if (!nc.name.trim()) return alert('Please enter the customer name.');
    await db.customers.add(nc);
    let v: Vehicle | undefined;
    if (nv.rego.trim() || nv.make.trim() || nv.model.trim()) {
      v = { ...nv, customerId: nc.id, rego: nv.rego.toUpperCase().trim() };
      await db.vehicles.add(v);
    }
    onChange(nc, v);
    setQ('');
    setMode('view');
  }

  async function saveNewVehicle() {
    if (!customer) return;
    const v = { ...nv, customerId: customer.id, rego: nv.rego.toUpperCase().trim() };
    await db.vehicles.add(v);
    onChange(customer, v);
    setMode('view');
  }

  const vehicleFields = (
    <>
      <Field label="Rego"><input value={nv.rego} onChange={(e) => setNv({ ...nv, rego: e.target.value })} autoCapitalize="characters" /></Field>
      <Field label="Year"><input inputMode="numeric" value={nv.year} onChange={(e) => setNv({ ...nv, year: e.target.value })} /></Field>
      <Field label="Make"><input value={nv.make} onChange={(e) => setNv({ ...nv, make: e.target.value })} /></Field>
      <Field label="Model"><input value={nv.model} onChange={(e) => setNv({ ...nv, model: e.target.value })} /></Field>
    </>
  );

  if (mode === 'newCustomer')
    return (
      <div className="grid">
        <h3 className="wide">New customer</h3>
        <Field label="Customer name"><input autoFocus value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></Field>
        <Field label="Mobile"><input type="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></Field>
        <Field label="Email"><input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Field>
        <Field label="Customer address"><input value={nc.address} onChange={(e) => setNc({ ...nc, address: e.target.value })} /></Field>
        <h3 className="wide">Their vehicle (optional)</h3>
        {vehicleFields}
        <div className="row wide">
          <button className="btn primary" onClick={saveNewCustomer}>Save customer</button>
          <button className="btn ghost" onClick={() => setMode(customerId ? 'view' : 'search')}>Cancel</button>
        </div>
      </div>
    );

  if (mode === 'newVehicle')
    return (
      <div className="grid">
        <h3 className="wide">New vehicle for {customer?.name}</h3>
        {vehicleFields}
        <Field label="VIN" wide><input value={nv.vin} onChange={(e) => setNv({ ...nv, vin: e.target.value })} /></Field>
        <div className="row wide">
          <button className="btn primary" onClick={saveNewVehicle}>Save vehicle</button>
          <button className="btn ghost" onClick={() => setMode('view')}>Cancel</button>
        </div>
      </div>
    );

  if (mode === 'search' || !customer)
    return (
      <div className="picker">
        <input
          autoFocus={!customerId}
          type="search"
          placeholder="Search name, phone or rego…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="picker-results">
          {vehicleHits.map((v) => {
            const c = customers.find((x) => x.id === v.customerId);
            return (
              <button key={v.id} className="picker-hit" onClick={() => { onChange(c, v); setMode('view'); setQ(''); }}>
                <strong>🚗 {vehicleLabel(v)}</strong>
                <span className="muted small">{c?.name}</span>
              </button>
            );
          })}
          {customerHits.map((c) => (
            <button key={c.id} className="picker-hit" onClick={() => {
              const vs = vehicles.filter((v) => v.customerId === c.id);
              onChange(c, vs.length === 1 ? vs[0] : undefined);
              setMode('view'); setQ('');
            }}>
              <strong>👤 {c.name}</strong>
              <span className="muted small">{[c.phone, c.address].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          <button className="picker-hit new" onClick={startNewCustomer}>
            <strong>+ New customer{q.trim() ? ` "${q.trim()}"` : ''}</strong>
          </button>
          {customerId && <button className="btn ghost" onClick={() => setMode('view')}>Cancel</button>}
        </div>
      </div>
    );

  return (
    <div className="picked">
      <div className="row between">
        <div>
          <Link to={`/customers/${customer.id}`}><strong>{customer.name}</strong></Link>
          <div className="muted small">{[customer.phone, customer.email].filter(Boolean).join(' · ')}</div>
        </div>
        <button className="btn ghost" onClick={() => setMode('search')}>Change</button>
      </div>
      <div className="row">
        <select className="grow" value={vehicle?.id ?? ''} onChange={(e) => onChange(customer, theirVehicles.find((v) => v.id === e.target.value))}>
          <option value="">— Select vehicle —</option>
          {theirVehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
        </select>
        <button className="btn" onClick={() => { setNv(newVehicle(customer.id)); setMode('newVehicle'); }}>+ Vehicle</button>
      </div>
    </div>
  );
}
