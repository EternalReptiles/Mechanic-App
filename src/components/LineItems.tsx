import type { LineItem, LineItemType } from '../types';
import { money, totals, uid } from '../utils';

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
  const t = totals(items, gst);
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

  return (
    <div className="line-items">
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
              <input type="number" inputMode="decimal" step="any" value={i.qty}
                onChange={(e) => set(i.id, { qty: e.target.valueAsNumber || 0 })} />
            </label>
            <label className="mini">
              Unit price (ex GST)
              <input type="number" inputMode="decimal" step="any" value={i.unitPrice}
                onChange={(e) => set(i.id, { unitPrice: e.target.valueAsNumber || 0 })} />
            </label>
            <span className="line-total">{money(i.qty * i.unitPrice)}</span>
            <button className="icon-btn danger" aria-label="Remove line"
              onClick={() => onChange(items.filter((x) => x.id !== i.id))}>✕</button>
          </div>
        </div>
      ))}
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
    </div>
  );
}
