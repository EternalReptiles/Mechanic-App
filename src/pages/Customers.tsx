import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, PageHeader } from '../components/ui';
import { db, newCustomer } from '../db';
import { vehicleLabel } from '../utils';

export default function Customers() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];

  const needle = q.trim().toLowerCase();
  const list = customers.filter((c) => {
    if (!needle) return true;
    const vs = vehicles.filter((v) => v.customerId === c.id).map(vehicleLabel).join(' ');
    return [c.name, c.phone, c.email, c.address, vs].some((s) => s.toLowerCase().includes(needle));
  });

  async function add() {
    const c = newCustomer({ name: 'New customer' });
    await db.customers.add(c);
    navigate(`/customers/${c.id}`);
  }

  return (
    <>
      <PageHeader title="Customers" actions={<button className="btn primary" onClick={add}>+ Customer</button>} />
      <input className="search" type="search" placeholder="Search name, phone, rego…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length ? (
        list.map((c) => {
          const vs = vehicles.filter((v) => v.customerId === c.id);
          return (
            <Link key={c.id} to={`/customers/${c.id}`} className="card">
              <strong>{c.name}</strong>
              <div className="muted small">{[c.phone, c.address].filter(Boolean).join(' · ')}</div>
              {vs.length > 0 && <div className="small">{vs.map(vehicleLabel).join(', ')}</div>}
            </Link>
          );
        })
      ) : (
        <Empty>{customers.length ? 'No matches.' : 'No customers yet. Add one, or create a job and add the customer there.'}</Empty>
      )}
    </>
  );
}
