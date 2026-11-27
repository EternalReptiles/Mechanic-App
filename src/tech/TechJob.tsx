import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Checklist from '../components/Checklist';
import { QuickText } from '../components/SendMessage';
import Photos from '../components/Photos';
import TaskChecklist from '../components/TaskChecklist';
import { Field, PageHeader, StatusBadge } from '../components/ui';
import { useCloud } from '../cloud/CloudProvider';
import { WalkaroundSection } from '../walkaround/WalkaroundList';
import { db } from '../db';
import { useAutosave, useSettings } from '../hooks';
import { finishJobPatch, missingRequired, tasksFromTemplate, templatesFor } from '../jobTemplates';
import type { Job } from '../types';
import { firstName, fmtDateTime, mapsUrl, smsUrl, telUrl } from '../utils';
import { deductStockIfDone } from '../stock';
import JobTimer from '../time/JobTimer';
import AiNotes from '../ai/AiNotes';
import { clockOnPatch, stopAllPatch } from '../time/timer';

/** Technician's job screen: what to do, the checklist, photos, and "Mark finished". No prices. */
export default function TechJob() {
  const { id = '' } = useParams();
  const settings = useSettings();
  const { userId, memberName, can } = useCloud();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const loaded = useRef('');
  const customer = useLiveQuery(() => (job?.customerId ? db.customers.get(job.customerId) : undefined), [job?.customerId]);
  const vehicle = useLiveQuery(() => (job?.vehicleId ? db.vehicles.get(job.vehicleId) : undefined), [job?.vehicleId]);

  useEffect(() => {
    if (loaded.current === id) return;
    loaded.current = id;
    setJob(undefined);
    db.jobs.get(id).then((j) => setJob(j ?? null));
  }, [id]);
  const saved = useAutosave(job, (j) => db.jobs.put(j), id);
  // Parts from stock come off the shelf once the job is done.
  const stockBusy = useRef(false);
  useEffect(() => {
    if (!job || job.stockDeducted || stockBusy.current) return;
    stockBusy.current = true;
    void deductStockIfDone(job).then((patch) => {
      stockBusy.current = false;
      if (patch) setJob((j) => (j ? { ...j, ...patch } : j));
    });
  }, [job?.status, job?.stockDeducted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (job === undefined) return null;
  if (job === null) return (<><PageHeader back title="Job not found" /><Link className="btn" to="/">Back to my jobs</Link></>);

  const update = (patch: Partial<Job>) => {
    setErr('');
    setJob((j) => (j ? { ...j, ...patch } : j));
  };
  const tasks = job.tasks ?? [];
  const missing = missingRequired(tasks);
  const address = job.siteAddress || customer?.address || '';
  const inWorkshop = job.location === 'workshop';

  function finish() {
    setErr('');
    if (missing.length) {
      setErr(`Fill in the required items first: ${missing.map((t) => t.label).join(', ')}.`);
      return;
    }
    const { patch, odometer } = finishJobPatch(job!, userId);
    update(patch);
    if (odometer && vehicle) void db.vehicles.update(vehicle.id, { odometer });
  }

  return (
    <>
      <PageHeader back title={<>Job #{job.number} <StatusBadge status={job.status} /></>} actions={<span className="muted small">{saved ? 'Saved ✓' : 'Saving…'}</span>} />

      <section className="card tech-head">
        <span className="rego big">{vehicle?.rego || 'No rego'}</span>
        <div><strong>{[vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'Vehicle not set'}</strong></div>
        {vehicle?.odometer && <div className="small muted">Last odometer: {vehicle.odometer} km</div>}
        <h2 style={{ marginTop: 10 }}>{job.title || 'Job'}</h2>
        {job.description && <p className="pre" style={{ marginBottom: 6 }}>💬 {job.description}</p>}
        <div className="small">
          🕑 {job.scheduledStart ? fmtDateTime(job.scheduledStart) : 'No time set'}
          {inWorkshop ? ` · 🔧 Workshop${job.keyTag ? ` · 🔑 Key ${job.keyTag}` : ''}` : address ? ` · 📍 ${address}` : ''}
          {job.promisedAt && ` · Ready by ${fmtDateTime(job.promisedAt)}`}
        </div>
        {customer && (
          <div className="row wrap" style={{ marginTop: 10 }}>
            <span className="small">👤 {customer.name}</span>
            {customer.phone && <a className="btn small" href={telUrl(customer.phone)}>📞 Call</a>}
            {customer.phone && !inWorkshop && (
              <QuickText className="btn small" customer={customer} jobId={job.id} label="💬 On my way"
                text={`Hi ${firstName(customer.name)}, it's ${memberName(userId) || 'your mechanic'} from ${settings.businessName}. I'm on my way.`} />
            )}
            {address && !inWorkshop && <a className="btn small" href={mapsUrl(address)} target="_blank" rel="noreferrer">🧭 Navigate</a>}
          </div>
        )}
      </section>

      {job.status === 'scheduled' && <button className="btn primary block big" onClick={() => void clockOnPatch(job, userId).then((p) => update({ ...p, status: 'in_progress' }))}>▶ Start job</button>}
      {job.status === 'waiting' && <button className="btn primary block big" onClick={() => void clockOnPatch(job, userId).then((p) => update({ ...p, status: 'in_progress' }))}>▶ Resume job</button>}
      {!['scheduled', 'waiting'].includes(job.status) && <JobTimer job={job} update={update} />}

      <section className="card">
        <h2>☑ Job checklist</h2>
        {tasks.length ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>{job.tasksTemplate}</p>
            <TaskChecklist tasks={tasks} onChange={(t) => update({ tasks: t })} readOnly={!!job.finishedAt} />
          </>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>Pick the checklist for this job:</p>
            <div className="row wrap">
              {templatesFor(settings.jobTemplates).map((t) => (
                <button key={t.id} className="btn" onClick={() => update({ tasks: tasksFromTemplate(t), tasksTemplate: t.name })}>{t.name}</button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <Field label="Work done / notes for the office">
          <textarea rows={4} value={job.workNotes} onChange={(e) => update({ workNotes: e.target.value })} placeholder="What you did, parts used, anything the customer should know…" />
        </Field>
        <AiNotes job={job} vehicle={vehicle ?? undefined} customer={customer ?? undefined} update={update} />
      </section>

      <section className="card">
        <h2>📷 Photos</h2>
        <Photos jobId={job.id} />
      </section>

      <details className="card">
        <summary><strong>Vehicle inspection</strong> <span className="muted small">(battery, brakes, tyres…)</span></summary>
        <Checklist items={job.checklist ?? []} template={settings.checklistTemplate} onChange={(checklist) => update({ checklist })} />
      </details>

      {can('walkarounds') && (
        <WalkaroundSection
          job={job}
          onAddLines={(lines, walkId) =>
            update({ lineItems: [...job.lineItems, ...lines], appliedWalkarounds: [...(job.appliedWalkarounds ?? []), walkId] })
          }
        />
      )}

      {err && <p className="error">{err}</p>}
      {job.finishedAt ? (
        <p className="paid-note">✓ Finished {fmtDateTime(job.finishedAt)}{job.finishedBy ? ` by ${memberName(job.finishedBy) || 'you'}` : ''}</p>
      ) : (
        ['scheduled', 'in_progress', 'waiting'].includes(job.status) && (
          <>
            {job.status === 'in_progress' && <button className="btn block" onClick={() => update({ status: 'waiting', ...stopAllPatch(job) })}>⏸ On hold – waiting on parts</button>}
            <button className="btn primary block big" onClick={finish}>✓ Mark job finished</button>
          </>
        )
      )}
    </>
  );
}
