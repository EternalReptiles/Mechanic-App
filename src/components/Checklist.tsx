import type { CheckItem, CheckResult } from '../types';
import { CHECK_LABEL, uid } from '../utils';

const OPTIONS: { value: CheckResult; short: string }[] = [
  { value: 'ok', short: '✓ OK' },
  { value: 'attention', short: '! Soon' },
  { value: 'urgent', short: '✕ Urgent' },
  { value: 'na', short: 'N/A' },
];

export default function Checklist({
  items,
  template,
  onChange,
}: {
  items: CheckItem[];
  template: string[];
  onChange: (items: CheckItem[]) => void;
}) {
  if (!items.length)
    return (
      <div>
        <p className="muted small">
          Run a quick health check while you're on the car. Results print on the invoice and the inspection report,
          so the customer can see what needs doing next.
        </p>
        <button className="btn primary" onClick={() => onChange(template.filter((l) => l.trim()).map((label) => ({ id: uid(), label, result: '', note: '' })))}>
          Start inspection
        </button>
      </div>
    );

  const set = (id: string, patch: Partial<CheckItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const done = items.filter((i) => i.result).length;
  const flagged = items.filter((i) => i.result === 'attention' || i.result === 'urgent').length;

  return (
    <div className="checklist">
      <div className="row between small">
        <span className="muted">{done} of {items.length} checked{flagged ? ` · ${flagged} flagged` : ''}</span>
        <button className="btn ghost" onClick={() => onChange(items.map((i) => (i.result ? i : { ...i, result: 'ok' })))}>
          Mark rest OK
        </button>
      </div>
      {items.map((i) => (
        <div key={i.id} className="check-item">
          <div className="check-label">{i.label}</div>
          <div className="seg">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                className={i.result === o.value ? 'on' : ''}
                style={i.result === o.value ? { background: CHECK_LABEL[o.value].color, borderColor: CHECK_LABEL[o.value].color } : undefined}
                onClick={() => set(i.id, { result: i.result === o.value ? '' : o.value })}
              >
                {o.short}
              </button>
            ))}
          </div>
          {(i.result === 'attention' || i.result === 'urgent' || i.note) && (
            <input placeholder="Note for customer (e.g. 3mm left, replace within 5,000 km)" value={i.note}
              onChange={(e) => set(i.id, { note: e.target.value })} />
          )}
        </div>
      ))}
      <div className="row wrap">
        <button className="btn" onClick={() => {
          const label = prompt('Item to check');
          if (label) onChange([...items, { id: uid(), label, result: '', note: '' }]);
        }}>+ Add item</button>
        <button className="btn ghost danger" onClick={() => confirm('Clear the whole inspection?') && onChange([])}>Clear inspection</button>
      </div>
    </div>
  );
}
