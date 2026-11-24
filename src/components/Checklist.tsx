import { autoRating, BATTERY_RESULTS, batteryHealth, itemsFromTemplate, normalizeInspection } from '../inspection';
import type { CheckItem, CheckResult, InspectionTemplateItem } from '../types';
import { CHECK_LABEL, uid } from '../utils';

const OPTIONS: { value: CheckResult; short: string }[] = [
  { value: 'ok', short: '✓ OK' },
  { value: 'attention', short: '! Soon' },
  { value: 'urgent', short: '✕ Urgent' },
  { value: 'na', short: 'N/A' },
];

const num = (v: string) => (v === '' ? null : Number(v));

/** Vehicle inspection: OK/Soon/Urgent ratings, measured items (mm per wheel) and a battery test. */
export default function Checklist({
  items,
  template,
  onChange,
}: {
  items: CheckItem[];
  template: (string | InspectionTemplateItem)[];
  onChange: (items: CheckItem[]) => void;
}) {
  if (!items.length)
    return (
      <div>
        <p className="muted small">
          Run a quick health check while you're on the car – battery test, pad, rotor and tyre measurements. Results print on the
          invoice and the inspection report, so the customer can see what needs doing next.
        </p>
        <button className="btn primary" onClick={() => onChange(itemsFromTemplate(normalizeInspection(template)))}>Start inspection</button>
      </div>
    );

  const set = (id: string, patch: Partial<CheckItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const done = items.filter((i) => i.result).length;
  const flagged = items.filter((i) => i.result === 'attention' || i.result === 'urgent').length;

  const ratingButtons = (i: CheckItem) => (
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
  );

  return (
    <div className="checklist">
      <div className="row between small">
        <span className="muted">{done} of {items.length} checked{flagged ? ` · ${flagged} flagged` : ''}</span>
        <button className="btn ghost" onClick={() => onChange(items.map((i) => (i.result ? i : { ...i, result: 'ok' })))}>Mark rest OK</button>
      </div>

      {items.map((i) => (
        <div key={i.id} className="check-item">
          <div className="check-label">{i.label}</div>

          {i.kind === 'battery' ? (
            <>
              <div className="readings">
                {([['volts', 'Voltage', 'V'], ['cca', 'CCA measured', 'CCA'], ['rated', 'CCA rated', 'CCA']] as const).map(([k, label, unit]) => (
                  <label key={k} className="reading">
                    <span>{label}</span>
                    <span className="reading-in">
                      <input type="number" inputMode="decimal" step="any" aria-label={`${i.label} ${label}`}
                        value={i.battery?.[k] ?? ''} onChange={(e) => set(i.id, { battery: { ...i.battery, [k]: num(e.target.value) } })} />
                      <em>{unit}</em>
                    </span>
                  </label>
                ))}
              </div>
              {batteryHealth(i.battery) !== null && <div className="small muted">Battery health: <strong>{batteryHealth(i.battery)}%</strong> of rated CCA</div>}
              <div className="seg">
                {BATTERY_RESULTS.map((r) => (
                  <button
                    key={r.label}
                    className={i.result === r.result ? 'on' : ''}
                    style={i.result === r.result ? { background: CHECK_LABEL[r.result].color, borderColor: CHECK_LABEL[r.result].color } : undefined}
                    onClick={() => set(i.id, { result: i.result === r.result ? '' : r.result })}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </>
          ) : i.kind === 'measure' ? (
            <>
              <div className="readings">
                {(i.positions ?? ['Reading']).map((p) => (
                  <label key={p} className="reading">
                    <span>{p}</span>
                    <span className="reading-in">
                      <input type="number" inputMode="decimal" step="any" aria-label={`${i.label} ${p}`}
                        value={i.readings?.[p] ?? ''}
                        onChange={(e) => {
                          const next = { ...i, readings: { ...i.readings, [p]: num(e.target.value) } };
                          // Readings set the rating (pads under 3 mm = urgent, etc.) unless it's been chosen by hand.
                          const auto = autoRating(next);
                          set(i.id, { readings: next.readings, ...(auto && (!i.result || i.result === autoRating(i)) ? { result: auto } : {}) });
                        }} />
                      <em>{i.unit}</em>
                    </span>
                  </label>
                ))}
              </div>
              {ratingButtons(i)}
            </>
          ) : (
            ratingButtons(i)
          )}

          {(i.result === 'attention' || i.result === 'urgent' || i.note) && (
            <input placeholder="Note for customer (e.g. replace within 5,000 km)" value={i.note}
              onChange={(e) => set(i.id, { note: e.target.value })} />
          )}
        </div>
      ))}

      <div className="row wrap">
        <button className="btn" onClick={() => {
          const label = prompt('Item to check');
          if (label) onChange([...items, { id: uid(), label, result: '', note: '', kind: 'rating' }]);
        }}>+ Add item</button>
        <button className="btn ghost danger" onClick={() => confirm('Clear the whole inspection?') && onChange([])}>Clear inspection</button>
      </div>
    </div>
  );
}
