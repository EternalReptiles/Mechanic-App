import { useState } from 'react';
import { db } from '../db';
import type { LineItem, LineItemType } from '../types';
import { money, totals, uid } from '../utils';
import CatalogPicker from './CatalogPicker';
import NumberInput from './NumberInput';

const TYPE_LABEL: Record<LineItemType, string> = { labour: 'Labour', part: 'Part', other: 'Other' };

export default function LineItems({
  items,
  onChange,
  labourRate,
  gst,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  labourRate: number;
  gst: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const t = totals(items, gst);

  async function saveToPriceList() {
    const name = prompt('Name for this price-list item (e.g. "Logbook service – V6")');
    if (!name) return;
    await db.catalog.add({ id: uid(), name, lines: items.map(({ id: _id, ...rest }) => rest) });
    alert(`Saved "${name}" to your price list.`);
  }
  const set = (id: string, patch: Partial<LineItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const add = (type: LineItemType) =>
    onChange([
      ...items,
      {
        id: uid(),
        type,
        description: type === 'labour' ? 'Labour' : '',
        qty: 1,
        unitPrice: type === 'labour' ? labourRate : 0,
      },
    ]);

  const repairNames = [...new Set(items.map((i) => i.repair?.trim()).filter(Boolean))] as string[];

  return (
    <div className="line-items">
      <datalist id="repair-names">
        {repairNames.map((r) => <option key={r} value={r} />)}
      </datalist>
      {items.map((i) => (
        <div key={i.id} className="line-item">
          <div className="row">
            <select value={i.type} onChange={(e) => set(i.id, { type: e.target.value as LineItemType })}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              className="grow"
              placeholder={i.type === 'part' ? 'Part name / number' : 'Description'}
              value={i.description}
              onChange={(e) => set(i.id, { description: e.target.value })}
            />
          </div>
          <div className="row">
            <label className="mini">
              {i.type === 'labour' ? 'Hours' : 'Qty'}
              <NumberInput value={i.qty} onChange={(n) => set(i.id, { qty: n })} />
            </label>
            <label className="mini">
              Unit price (ex GST)
              <NumberInput value={i.unitPrice} onChange={(n) => set(i.id, { unitPrice: n })} />
            </label>
            <span className="line-total">{money(i.qty * i.unitPrice)}</span>
            <button className="icon-btn danger" aria-label="Remove line"
              onClick={() => onChange(items.filter((x) => x.id !== i.id))}>✕</button>
          </div>
          <label className="repair-tag">
            <span>🔧 Repair</span>
            <input list="repair-names" placeholder="e.g. Front brakes (groups lines for customer approval)" value={i.repair ?? ''}
              onChange={(e) => set(i.id, { repair: e.target.value })} />
          </label>
        </div>
      ))}
      <button className="btn primary" onClick={() => setPicking(true)}>📋 Add from price list</button>
      {picking && (
        <CatalogPicker
          onClose={() => setPicking(false)}
          onPick={(c) => {
            // Lines from one price-list item form one repair the customer can approve or decline.
            onChange([...items, ...c.lines.map((l) => ({ ...l, id: uid(), repair: c.name }))]);
            setPicking(false);
          }}
        />
      )}
      <div className="row wrap">
        <button className="btn" onClick={() => add('labour')}>+ Labour</button>
        <button className="btn" onClick={() => add('part')}>+ Part</button>
        <button className="btn" onClick={() => add('other')}>+ Other</button>
      </div>
      <div className="totals">
        <div><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
        {gst && <div><span>GST (10%)</span><span>{money(t.gst)}</span></div>}
        <div className="grand"><span>Total</span><span>{money(t.total)}</span></div>
      </div>
      {items.length > 0 && (
        <button className="btn ghost small" onClick={saveToPriceList}>Save these items to price list</button>
      )}
    </div>
  );
}
