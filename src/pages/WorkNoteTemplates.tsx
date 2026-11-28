import { useEffect, useState } from 'react';
import { Field, PageHeader } from '../components/ui';
import { db, getSettings } from '../db';
import { useAutosave } from '../hooks';
import type { Settings, WorkNoteTemplate } from '../types';
import { uid } from '../utils';
import { workNotesFor } from '../workNotes';

/** Settings → Work done templates: saved wording for the "Work done" notes on the invoice, one per kind of job. */
export default function WorkNoteTemplates() {
  const [s, setS] = useState<Settings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void getSettings().then(setS); }, []);
  const saved = useAutosave(s, (x) => db.settings.put(x));
  if (!s) return null;
  const list = workNotesFor(s);
  const save = (l: WorkNoteTemplate[]) => setS({ ...s, workNoteTemplates: l });
  const set = (id: string, patch: Partial<WorkNoteTemplate>) => save(list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const add = () => {
    const t: WorkNoteTemplate = { id: uid(), name: 'New template', keywords: '', text: '' };
    save([...list, t]);
    setOpen(t.id);
  };

  return (
    <>
      <PageHeader back title="Work done templates" actions={<span className="muted small">{saved ? 'Saved ✓' : 'Saving…'}</span>} />
      <p className="small muted">
        Your usual wording for "Work done" on the invoice. On a job, tap one to add it. When a job is finished with nothing written,
        the template that matches the job (e.g. "logbook" in the job title) is filled in for you.
      </p>
      {list.map((t) => (
        <section key={t.id} className="card">
          <div className="row between">
            <button className="link" style={{ padding: 0, fontSize: '1.05rem' }} onClick={() => setOpen(open === t.id ? null : t.id)}>
              {open === t.id ? '▾' : '▸'} {t.name || 'Untitled'}
            </button>
            {t.keywords && <span className="small muted">{t.keywords}</span>}
          </div>
          {open === t.id && (
            <div className="grid" style={{ marginTop: 10 }}>
              <Field label="Name" wide>
                <input value={t.name} onChange={(e) => set(t.id, { name: e.target.value })} />
              </Field>
              <Field label="Use for jobs that mention (comma separated)" wide>
                <input value={t.keywords ?? ''} placeholder="e.g. logbook, service" onChange={(e) => set(t.id, { keywords: e.target.value })} />
              </Field>
              <Field label="Work done" wide>
                <textarea rows={6} value={t.text} onChange={(e) => set(t.id, { text: e.target.value })} />
                <small className="muted">Fills in by itself: {'{makeModel}'} {'{rego}'} {'{odometer}'} {'{serviceKm}'} {'{frontBrakes}'} {'{rearBrakes}'} {'{nextServiceDate}'} {'{nextServiceKm}'} {'{vehicle}'}</small>
              </Field>
              <div className="wide row">
                <span className="grow" />
                <button className="btn ghost danger small" onClick={() => confirm(`Delete "${t.name}"?`) && save(list.filter((x) => x.id !== t.id))}>Delete</button>
              </div>
            </div>
          )}
        </section>
      ))}
      <button className="btn block" onClick={add}>+ Add a template</button>
    </>
  );
}
