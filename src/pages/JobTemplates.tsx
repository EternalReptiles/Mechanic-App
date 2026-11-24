import { useEffect, useState } from 'react';
import { Field, PageHeader } from '../components/ui';
import { db, getSettings } from '../db';
import { useAutosave } from '../hooks';
import { DEFAULT_TEMPLATES, templatesFor } from '../jobTemplates';
import type { JobTemplate, Settings, TaskFieldType, TaskTemplateItem } from '../types';
import { uid } from '../utils';

const TYPE_LABEL: Record<TaskFieldType, string> = { check: 'Tick box', yesno: 'Yes / No', number: 'Number', text: 'Text', choice: 'Choice' };

/** Settings → Job checklists: the templates technicians fill in on each job. */
export default function JobTemplates() {
  const [s, setS] = useState<Settings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    getSettings().then(setS);
  }, []);
  useAutosave(s, (x) => db.settings.put(x));
  if (!s) return null;
  const templates = templatesFor(s.jobTemplates);
  const save = (t: JobTemplate[]) => setS({ ...s, jobTemplates: t });
  const setT = (id: string, patch: Partial<JobTemplate>) => save(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const setItem = (t: JobTemplate, iid: string, patch: Partial<TaskTemplateItem>) =>
    setT(t.id, { items: t.items.map((i) => (i.id === iid ? { ...i, ...patch } : i)) });
  const move = (t: JobTemplate, idx: number, dir: -1 | 1) => {
    const items = [...t.items];
    const [x] = items.splice(idx, 1);
    items.splice(Math.max(0, Math.min(items.length, idx + dir)), 0, x);
    setT(t.id, { items });
  };

  return (
    <>
      <PageHeader back title="Job checklists" />
      <p className="muted small">
        Technicians fill these in on each job – tick boxes, measurements like oil litres or pad thickness, and choices. Items marked
        required must be done before a job can be marked finished. Number items can add to the invoice automatically (e.g. litres of oil × price per litre).
      </p>
      {templates.map((t) => (
        <section key={t.id} className="card">
          <div className="row between">
            <button className="link" style={{ padding: 0, fontSize: '1.05rem' }} onClick={() => setOpen(open === t.id ? null : t.id)}>
              {open === t.id ? '▾' : '▸'} {t.name}
            </button>
            <span className="small muted">{t.items.length} items</span>
          </div>
          {open === t.id && (
            <div className="tpl-edit">
              <Field label="Checklist name"><input value={t.name} onChange={(e) => setT(t.id, { name: e.target.value })} /></Field>
              {t.items.map((it, idx) => (
                <div key={it.id} className="tpl-item">
                  <div className="row">
                    <input className="grow" value={it.label} aria-label="Item" onChange={(e) => setItem(t, it.id, { label: e.target.value })} />
                    <select value={it.type} aria-label="Type" onChange={(e) => setItem(t, it.id, { type: e.target.value as TaskFieldType })}>
                      {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="row wrap small">
                    {it.type === 'number' && (
                      <input className="unit-in" placeholder="Unit (L, mm, km)" value={it.unit ?? ''} onChange={(e) => setItem(t, it.id, { unit: e.target.value })} />
                    )}
                    {it.type === 'choice' && (
                      <input className="grow" placeholder="Options, separated by commas" value={(it.options ?? []).join(', ')}
                        onChange={(e) => setItem(t, it.id, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} />
                    )}
                    <label className="field checkbox"><input type="checkbox" checked={!!it.required} onChange={(e) => setItem(t, it.id, { required: e.target.checked })} /><span>Required</span></label>
                    {it.type === 'number' && (
                      <label className="field checkbox">
                        <input type="checkbox" checked={!!it.invoice} onChange={(e) => setItem(t, it.id, { invoice: e.target.checked ? { description: it.label, unitPrice: 0 } : undefined })} />
                        <span>Add to invoice</span>
                      </label>
                    )}
                    {it.invoice && (
                      <>
                        <input className="grow" placeholder="Invoice line" value={it.invoice.description} onChange={(e) => setItem(t, it.id, { invoice: { ...it.invoice!, description: e.target.value } })} />
                        <input className="unit-in" type="number" step="any" aria-label={`Price per ${it.unit || 'unit'} ex GST`} placeholder="$ / unit"
                          value={it.invoice.unitPrice} onChange={(e) => setItem(t, it.id, { invoice: { ...it.invoice!, unitPrice: e.target.valueAsNumber || 0 } })} />
                        <span className="muted">per {it.unit || 'unit'} ex GST</span>
                      </>
                    )}
                    <span className="grow" />
                    <button className="icon-btn" aria-label="Move up" onClick={() => move(t, idx, -1)}>↑</button>
                    <button className="icon-btn" aria-label="Move down" onClick={() => move(t, idx, 1)}>↓</button>
                    <button className="icon-btn danger" aria-label="Remove item" onClick={() => setT(t.id, { items: t.items.filter((x) => x.id !== it.id) })}>✕</button>
                  </div>
                </div>
              ))}
              <div className="row wrap">
                <button className="btn" onClick={() => setT(t.id, { items: [...t.items, { id: uid(), label: 'New item', type: 'check' }] })}>+ Add item</button>
                <span className="grow" />
                <button className="btn danger" onClick={() => confirm(`Delete the "${t.name}" checklist?`) && save(templates.filter((x) => x.id !== t.id))}>Delete checklist</button>
              </div>
            </div>
          )}
        </section>
      ))}
      <div className="row wrap">
        <button className="btn primary" onClick={() => { const id = uid(); save([...templates, { id, name: 'New checklist', items: [] }]); setOpen(id); }}>+ New checklist</button>
        <button className="btn ghost" onClick={() => confirm('Add back the starter checklists (Logbook service, Brake job)?') && save([...templates.filter((t) => !DEFAULT_TEMPLATES.some((d) => d.id === t.id)), ...DEFAULT_TEMPLATES])}>Restore starter checklists</button>
      </div>
    </>
  );
}
