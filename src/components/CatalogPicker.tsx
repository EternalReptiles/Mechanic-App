import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db';
import type { CatalogItem } from '../types';
import { money, round2 } from '../utils';

export const catalogTotal = (c: CatalogItem) => round2(c.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));

export default function CatalogPicker({ onPick, onClose }: { onPick: (item: CatalogItem) => void; onClose: () => void }) {
  const items = useLiveQuery(() => db.catalog.orderBy('name').toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = items.filter(
    (i) => !needle || i.name.toLowerCase().includes(needle) || i.lines.some((l) => l.description.toLowerCase().includes(needle)),
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Price list</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <input autoFocus type="search" placeholder="Search services & parts…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="sheet-list">
          {list.map((i) => (
            <button key={i.id} className="picker-hit" onClick={() => onPick(i)}>
              <span className="row between">
                <strong>{i.name}</strong>
                <span>{money(catalogTotal(i))}</span>
              </span>
              {i.lines.length > 1 && <span className="muted small">{i.lines.map((l) => l.description).join(' · ')}</span>}
            </button>
          ))}
          {!list.length && <p className="empty">Nothing matches.</p>}
        </div>
        <Link to="/settings/price-list" className="small">Edit price list</Link>
      </div>
    </div>
  );
}
