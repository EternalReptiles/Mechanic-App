import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import NumberInput from '../components/NumberInput';
import { Empty, Field, PageHeader } from '../components/ui';
import { db } from '../db';
import { nextOrderNumber } from '../stock';
import type { StockItem } from '../types';
import { money, uid } from '../utils';

const blank = (): StockItem => ({ id: uid(), name: '', partNumber: '', supplier: '', cost: 0, price: 0, onHand: 0, reorderAt: 0 });
export const isLow = (s: StockItem) => s.reorderAt > 0 && s.onHand <= s.reorderAt;

/** Stock: parts on the shelf, low-stock warnings, and ordering more. */
export default function StockPage() {
  const navigate = useNavigate();
  const items = useLiveQuery(() => db.stock.orderBy('name').toArray(), []) ?? [];
  const orders = useLiveQuery(() => db.orders.orderBy('number').reverse().toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [edit, setEdit] = useState<StockItem | null>(null);

  const list = useMemo(() => items.filter((s) => (!lowOnly || isLow(s))
    && (!q || `${s.name} ${s.partNumber} ${s.supplier}`.toLowerCase().includes(q.toLowerCase()))), [items, q, lowOnly]);
  const low = items.filter(isLow);
  const value = items.reduce((t, s) => t + Math.max(0, s.onHand) * s.cost, 0);
  const openOrders = orders.filter((o) => o.status === 'ordered' || o.status === 'draft');

  async function orderLow() {
    // One draft order per supplier for everything that's low.
    const bySupplier = new Map<string, StockItem[]>();
    low.forEach((s) => bySupplier.set(s.supplier || 'Supplier', [...(bySupplier.get(s.supplier || 'Supplier') ?? []), s]));
    let n = await nextOrderNumber();
    let first = '';
    for (const [supplier, parts] of bySupplier) {
      const id = uid();
      first ||= id;
      await db.orders.add({
        id, number: n++, supplier, status: 'draft', notes: '', createdAt: new Date().toISOString(),
        lines: parts.map((s) => ({ stockId: s.id, description: s.name, partNumber: s.partNumber, qty: Math.max(1, s.reorderAt * 2 - s.onHand), cost: s.cost })),
      });
    }
    navigate(bySupplier.size === 1 ? `/orders/${first}` : '/orders');
  }

  return (
    <>
      <PageHeader back title="Stock" actions={<button className="btn primary" onClick={() => setEdit(blank())}>+ Part</button>} />

      <div className="stats">
        <div className="stat"><span className="stat-value">{items.length}</span><span className="stat-label">Parts</span></div>
        <button className={`stat${low.length ? ' warn' : ''}`} onClick={() => setLowOnly(!lowOnly)}>
          <span className="stat-value">{low.length}</span><span className="stat-label">Low stock{lowOnly ? ' (showing)' : ''}</span>
        </button>
        <div className="stat"><span className="stat-value">{money(value)}</span><span className="stat-label">Stock value (cost)</span></div>
      </div>

      <div className="row wrap" style={{ margin: '10px 0' }}>
        <Link className="btn" to="/orders">🧾 Orders{openOrders.length ? ` (${openOrders.length} open)` : ''}</Link>
        {low.length > 0 && <button className="btn" onClick={() => void orderLow()}>Order low stock</button>}
      </div>
      <input placeholder="Search parts, part numbers, suppliers" value={q} onChange={(e) => setQ(e.target.value)} />

      {edit && (
        <section className="card grid two-up" style={{ marginTop: 12 }}>
          <h2 className="wide">{items.some((s) => s.id === edit.id) ? 'Edit part' : 'New part'}</h2>
          <Field label="Name" wide><input autoFocus value={edit.name} placeholder="e.g. Oil filter Z418" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Part number"><input value={edit.partNumber} onChange={(e) => setEdit({ ...edit, partNumber: e.target.value })} /></Field>
          <Field label="Supplier"><input value={edit.supplier} placeholder="e.g. Repco" onChange={(e) => setEdit({ ...edit, supplier: e.target.value })} /></Field>
          <Field label="Cost (ex GST)"><NumberInput value={edit.cost} onChange={(n) => setEdit({ ...edit, cost: n })} /></Field>
          <Field label="Sell price (ex GST)"><NumberInput value={edit.price} onChange={(n) => setEdit({ ...edit, price: n })} /></Field>
          <Field label="On hand"><NumberInput value={edit.onHand} onChange={(n) => setEdit({ ...edit, onHand: n })} /></Field>
          <Field label="Reorder at"><NumberInput value={edit.reorderAt} onChange={(n) => setEdit({ ...edit, reorderAt: n })} /></Field>
          <Field label="Shelf / bin (optional)" wide><input value={edit.location ?? ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })} /></Field>
          <div className="wide row wrap">
            <button className="btn primary grow" disabled={!edit.name.trim()} onClick={() => { void db.stock.put({ ...edit, name: edit.name.trim() }); setEdit(null); }}>Save</button>
            <button className="btn grow" onClick={() => setEdit(null)}>Cancel</button>
            {items.some((s) => s.id === edit.id) && (
              <button className="btn ghost danger" onClick={async () => {
                if (!confirm(`Delete ${edit.name}?`)) return;
                const { removeRecords } = await import('../db');
                await removeRecords('stock', [edit.id]);
                setEdit(null);
              }}>Delete</button>
            )}
          </div>
        </section>
      )}

      {!list.length ? (
        <Empty>{items.length ? 'No parts match.' : 'Add the parts you keep on the shelf – oil, filters, pads, batteries – and Spannr keeps count as you use them on jobs.'}</Empty>
      ) : (
        <div className="stock-list">
          {list.map((s) => (
            <button key={s.id} className={`stock-row${isLow(s) ? ' low' : ''}`} onClick={() => setEdit(s)}>
              <span className="stock-name"><strong>{s.name}</strong><small>{[s.partNumber, s.supplier, s.location].filter(Boolean).join(' · ')}</small></span>
              <span className="stock-qty"><strong>{s.onHand}</strong><small>{isLow(s) ? 'low' : 'on hand'}</small></span>
              <span className="stock-price">{money(s.price)}</span>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">Parts added to a job from stock come off the shelf when the job is completed. Receiving an order adds them back.</p>
    </>
  );
}
