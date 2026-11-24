import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { catalogTotal } from '../components/CatalogPicker';
import { Empty, PageHeader } from '../components/ui';
import { db, removeRecords } from '../db';
import type { CatalogItem, LineItemType } from '../types';
import { money, uid } from '../utils';
import NumberInput from '../components/NumberInput';

function Editor({ item, onDone }: { item: CatalogItem; onDone: () => void }) {
  const [c, setC] = useState(item);
  const setLine = (i: number, patch: Partial<CatalogItem['lines'][number]>) =>
    setC({ ...c, lines: c.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <div className="card">
      <label className="field">
        <span>Name</span>
        <input autoFocus value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="e.g. Logbook service – 4 cyl" />
      </label>
      {c.lines.map((l, i) => (
        <div key={i} className="line-item">
          <div className="row">
            <select value={l.type} onChange={(e) => setLine(i, { type: e.target.value as LineItemType })}>
              <option value="labour">Labour</option>
              <option value="part">Part</option>
              <option value="other">Other</option>
            </select>
            <input className="grow" value={l.description} placeholder="Description" onChange={(e) => setLine(i, { description: e.target.value })} />
          </div>
          <div className="row">
            <label className="mini">{l.type === 'labour' ? 'Hours' : 'Qty'}
              <NumberInput value={l.qty} onChange={(n) => setLine(i, { qty: n })} />
            </label>
            <label className="mini">Unit price (ex GST)
              <NumberInput value={l.unitPrice} onChange={(n) => setLine(i, { unitPrice: n })} />
            </label>
            <button className="icon-btn danger" aria-label="Remove line" onClick={() => setC({ ...c, lines: c.lines.filter((_, j) => j !== i) })}>✕</button>
          </div>
        </div>
      ))}
      <div className="row wrap">
        <button className="btn" onClick={() => setC({ ...c, lines: [...c.lines, { type: 'part', description: '', qty: 1, unitPrice: 0 }] })}>+ Line</button>
        <span className="grow" />
        <strong>{money(catalogTotal(c))} ex GST</strong>
      </div>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={async () => {
          if (!c.name.trim()) return alert('Give it a name.');
          await db.catalog.put(c);
          onDone();
        }}>Save</button>
        <button className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn danger" onClick={async () => {
          if (confirm(`Delete "${c.name}"?`)) { await removeRecords('catalog', [c.id]); onDone(); }
        }}>Delete</button>
      </div>
    </div>
  );
}

export default function PriceList() {
  const items = useLiveQuery(() => db.catalog.orderBy('name').toArray(), []) ?? [];
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [q, setQ] = useState('');
  const list = items.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <PageHeader back title="Price list" actions={
        <button className="btn primary" onClick={() => setEditing({ id: uid(), name: '', lines: [{ type: 'labour', description: 'Labour', qty: 1, unitPrice: 120 }] })}>+ Item</button>
      } />
      <p className="muted small">
        Save your common jobs and parts with prices, then add them to any job in one tap. A single item can include
        several lines — e.g. a service package with labour, oil and filter.
      </p>
      {editing && !items.some((i) => i.id === editing.id) && <Editor item={editing} onDone={() => setEditing(null)} />}
      <input className="search" type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.map((i) =>
        editing?.id === i.id ? (
          <Editor key={i.id} item={i} onDone={() => setEditing(null)} />
        ) : (
          <button key={i.id} className="card as-button" onClick={() => setEditing(i)}>
            <span className="row between"><strong>{i.name}</strong><span>{money(catalogTotal(i))}</span></span>
            {i.lines.length > 1 && <span className="muted small">{i.lines.map((l) => l.description).join(' · ')}</span>}
          </button>
        ),
      )}
      {!items.length && <Empty>Your price list is empty.</Empty>}
    </>
  );
}
