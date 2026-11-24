import { isAnswered } from '../jobTemplates';
import type { JobTask } from '../types';

/** A job checklist: tick boxes, yes/no, numbers with units, text and choices. */
export default function TaskChecklist({
  tasks,
  onChange,
  readOnly = false,
}: {
  tasks: JobTask[];
  onChange: (tasks: JobTask[]) => void;
  readOnly?: boolean;
}) {
  const set = (id: string, patch: Partial<JobTask>) => onChange(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const done = tasks.filter(isAnswered).length;

  return (
    <div className="tasks">
      <div className="task-progress">
        <div className="bar"><span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></div>
        <span className="small muted">{done} of {tasks.length} done</span>
      </div>
      {tasks.map((t) => {
        const answered = isAnswered(t);
        return (
          <div key={t.id} className={`task ${answered ? 'done' : ''}`}>
            <div className="task-label">
              {t.label}
              {t.required && !answered && <span className="req" title="Required"> *</span>}
            </div>

            {t.type === 'check' && (
              <button
                className={`task-check ${t.value ? 'on' : ''}`}
                disabled={readOnly}
                aria-pressed={!!t.value}
                onClick={() => set(t.id, { value: !t.value })}
              >
                {t.value ? '✓ Done' : 'Tap when done'}
              </button>
            )}

            {t.type === 'yesno' && (
              <div className="seg two">
                {[true, false].map((v) => (
                  <button key={String(v)} disabled={readOnly} className={t.value === v ? 'on solid' : ''} onClick={() => set(t.id, { value: t.value === v ? null : v })}>
                    {v ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            )}

            {t.type === 'number' && (
              <div className="task-number">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  disabled={readOnly}
                  aria-label={t.label}
                  value={t.value === null || t.value === undefined ? '' : String(t.value)}
                  onChange={(e) => set(t.id, { value: e.target.value === '' ? null : e.target.valueAsNumber })}
                />
                {t.unit && <span className="unit">{t.unit}</span>}
              </div>
            )}

            {t.type === 'text' && (
              <input disabled={readOnly} aria-label={t.label} value={(t.value as string) ?? ''} onChange={(e) => set(t.id, { value: e.target.value })} />
            )}

            {t.type === 'choice' && (
              <div className="chips wrap">
                {(t.options ?? []).map((o) => (
                  <button key={o} disabled={readOnly} className={`chip ${t.value === o ? 'active' : ''}`} onClick={() => set(t.id, { value: t.value === o ? null : o })}>
                    {o}
                  </button>
                ))}
              </div>
            )}

            {(t.note || !readOnly) && (
              <input
                className="task-note"
                placeholder="Note (optional)"
                disabled={readOnly}
                aria-label={`${t.label} note`}
                value={t.note ?? ''}
                onChange={(e) => set(t.id, { note: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
