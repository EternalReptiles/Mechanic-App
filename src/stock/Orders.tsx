import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import NumberInput from '../components/NumberInput';
import { Empty, Field, PageHeader } from '../components/ui';
import { db } from '../db';
import { useAutosave, useSettings } from '../hooks';
import { nextOrderNumber, receiveOrder } from '../stock';
import type { PurchaseOrder } from '../types';
import { money, uid } from '../utils';

const STATUS_LABEL: Record<PurchaseOrder['status'], string> = { draft: 'Draft', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' };
const orderTotal = (o: PurchaseOrder) => o.lines.reduce((t, l) => t + l.qty * l.cost, 0);

/** Purchase orders list. */
export function OrdersList() {
  const navigate = useNavigate();
  const orders = useLiveQuery(() => db.orders.orderBy('number').reverse().toArray(), []) ?? [];
  async function create() {
    const id = uid();
    await db.orders.add({ id, number: await nextOrderNumber(), supplier: '', status: 'draft', lines: [], notes: '', createdAt: new Date().toISOString() });
    navigate(`/orders/${id}`);
  }
  return (
    <>
      <PageHeader back title="Purchase orders" actions={<button className="btn primary" onClick={() => void create()}>+ Order</button>} />
      {!orders.length ? <Empty>No orders yet. Create one here, or use "Order low stock" on the Stock page.</Empty> : orders.map((o) => (
        <Link key={o.id} to={`/orders/${o.id}`} className="card row between">
          <span><strong>PO-{o.number} · {o.supplier || 'No supplier'}</strong><br /><span className="small muted">{o.lines.length} line{o.lines.length === 1 ? '' : 's'} · {new Date(o.createdAt).toLocaleDateString('en-AU')}</span></span>
          <span className="row" style={{ gap: 8 }}><span className={`po-pill ${o.status}`}>{STATUS_LABEL[o.status]}</span><strong>{money(orderTotal(o))}</strong></span>
        </Link>
      ))}
    </>
  );
}

/** One purchase order: supplier, parts, mark ordered, send to supplier, receive into stock. */
export function OrderPage() {
  const { id = '' } = useParams();
  const settings = useSettings();
  const [o, setO] = useState<PurchaseOrder | null | undefined>(undefined);
  const stock = useLiveQuery(() => db.stock.orderBy('name').toArray(), []) ?? [];
  const suppliers = [...new Set(stock.map((s) => s.supplier).filter(Boolean))];
  useEffect(() => { void db.orders.get(id).then((x) => setO(x ?? null)); }, [id]);
  const saved = useAutosave(o, (x) => db.orders.put(x), id);
  if (o === undefined) return null;
  if (o === null) return <><PageHeader back title="Order not found" /></>;
  const locked = o.status === 'received' || o.status === 'cancelled';
  const set = (patch: Partial<PurchaseOrder>) => setO({ ...o, ...patch });
  const setLine = (i: number, patch: Partial<PurchaseOrder['lines'][number]>) => set({ lines: o.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });

  const text = [
    `Purchase order PO-${o.number} from ${settings.businessName}`,
    '',
    ...o.lines.map((l) => `${l.qty} × ${l.description}${l.partNumber ? ` (${l.partNumber})` : ''}`),
    o.notes ? `\n${o.notes}` : '',
    '',
    [settings.phone, settings.email, settings.address].filter(Boolean).join(' · '),
  ].join('\n');

  return (
    <>
      <PageHeader back title={`PO-${o.number}`} actions={<span className="muted small">{saved ? 'Saved ✓' : 'Saving…'}</span>} />
      <section className="card grid two-up">
        <Field label="Supplier" wide>
          <input list="po-suppliers" value={o.supplier} disabled={locked} placeholder="e.g. Repco, Burson" onChange={(e) => set({ supplier: e.target.value })} />
          <datalist id="po-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <div className="wide small muted">Status: <span className={`po-pill ${o.status}`}>{STATUS_LABEL[o.status]}</span>
          {o.orderedAt && ` · ordered ${new Date(o.orderedAt).toLocaleDateString('en-AU')}`}{o.receivedAt && ` · received ${new Date(o.receivedAt).toLocaleDateString('en-AU')}`}</div>
      </section>

      <section className="card">
        <h2>Parts</h2>
        {o.lines.map((l, i) => (
          <div key={i} className="line-item">
            <div className="row">
              <input className="grow" value={l.description} disabled={locked} placeholder="Part" onChange={(e) => setLine(i, { description: e.target.value })} />
              {!locked && <button className="icon-btn danger" aria-label="Remove" onClick={() => set({ lines: o.lines.filter((_, k) => k !== i) })}>✕</button>}
            </div>
            <div className="row">
              <label className="mini qty-col">Qty<NumberInput value={l.qty} disabled={locked} onChange={(n) => setLine(i, { qty: n })} /></label>
              <label className="mini">Cost ex GST<NumberInput value={l.cost} disabled={locked} onChange={(n) => setLine(i, { cost: n })} /></label>
              <span className="line-total">{money(l.qty * l.cost)}</span>
            </div>
          </div>
        ))}
        {!locked && (
          <div className="row wrap add-lines">
            <select value="" onChange={(e) => {
              const s = stock.find((x) => x.id === e.target.value);
              if (s) set({ supplier: o.supplier || s.supplier, lines: [...o.lines, { stockId: s.id, description: s.name, partNumber: s.partNumber, qty: 1, cost: s.cost }] });
            }}>
              <option value="">+ Add from stock…</option>
              {stock.map((s) => <option key={s.id} value={s.id}>{s.name}{s.partNumber ? ` (${s.partNumber})` : ''} – {s.onHand} on hand</option>)}
            </select>
            <button className="btn" onClick={() => set({ lines: [...o.lines, { description: '', qty: 1, cost: 0 }] })}>+ Other part</button>
          </div>
        )}
        <div className="row between" style={{ marginTop: 10 }}><strong>Total (ex GST)</strong><strong>{money(orderTotal(o))}</strong></div>
        <Field label="Notes for supplier"><textarea rows={2} value={o.notes} disabled={locked} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </section>

      <div className="row wrap">
        {o.status === 'draft' && (
          <>
            <button className="btn primary grow" disabled={!o.lines.length} onClick={() => set({ status: 'ordered', orderedAt: new Date().toISOString() })}>Mark as ordered</button>
            <button className="btn grow" onClick={() => navigator.clipboard?.writeText(text).then(() => alert('Order copied – paste it into an email or text to your supplier.'))}>📋 Copy order</button>
          </>
        )}
        {o.status === 'ordered' && (
          <button className="btn primary grow" onClick={async () => {
            if (!confirm(`Received everything on PO-${o.number}? This adds the parts to stock.`)) return;
            await receiveOrder(o);
            setO(await db.orders.get(o.id));
          }}>✓ Received – add to stock</button>
        )}
        {!locked && o.status !== 'draft' && <button className="btn ghost" onClick={() => set({ status: 'cancelled' })}>Cancel order</button>}
      </div>
    </>
  );
}
