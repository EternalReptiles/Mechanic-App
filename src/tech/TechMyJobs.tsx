import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import SyncBadge from '../cloud/SyncBadge';
import { Empty, PageHeader, StatusBadge } from '../components/ui';
import { db } from '../db';
import { useLookups } from '../hooks';
import { isAnswered } from '../jobTemplates';
import type { Job } from '../types';
import { dayKey, fmtDateTime, fmtTime } from '../utils';

const ACTIVE = ['scheduled', 'in_progress', 'waiting'];

/** Technician home: the jobs assigned to me, today first. No prices or money. */
export default function TechMyJobs() {
  const { userId, plan } = useCloud();
  const { customerMap, vehicleMap } = useLookups();
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const today = dayKey(new Date());
  const mine = jobs.filter((j) => j.assignedTo === userId);
  const byTime = (a: Job, b: Job) => (a.scheduledStart || '~').localeCompare(b.scheduledStart || '~');
  const todays = mine.filter((j) => ACTIVE.includes(j.status) && (!j.scheduledStart || dayKey(new Date(j.scheduledStart)) <= today)).sort(byTime);
  const upcoming = mine.filter((j) => ACTIVE.includes(j.status) && j.scheduledStart && dayKey(new Date(j.scheduledStart)) > today).sort(byTime);
  const finished = mine
    .filter((j) => j.finishedAt && Date.now() - new Date(j.finishedAt).getTime() < 3 * 86400000)
    .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));
  const unassigned = jobs.filter((j) => !j.assignedTo && ACTIVE.includes(j.status)).sort(byTime);

  const card = (j: Job, opts: { claim?: boolean } = {}) => {
    const v = vehicleMap.get(j.vehicleId);
    const c = customerMap.get(j.customerId);
    const tasks = j.tasks ?? [];
    const done = tasks.filter(isAnswered).length;
    return (
      <div key={j.id} className="card tech-card">
        <Link to={`/jobs/${j.id}`} className="tech-card-link">
          <div className="row between">
            <span className="rego">{v?.rego || `#${j.number}`}</span>
            <StatusBadge status={j.status} />
          </div>
          <div><strong>{j.title || 'Job'}</strong></div>
          <div className="small muted">{[v?.year, v?.make, v?.model].filter(Boolean).join(' ')}{c ? ` · ${c.name.split(' ')[0]}` : ''}</div>
          <div className="row between small">
            <span>
              {j.scheduledStart ? (dayKey(new Date(j.scheduledStart)) === today ? `Today ${fmtTime(j.scheduledStart)}` : fmtDateTime(j.scheduledStart)) : 'No time set'}
              {j.location === 'workshop' ? ` · 🔧 Workshop${j.keyTag ? ` · 🔑 ${j.keyTag}` : ''}` : j.siteAddress ? ` · 📍 ${j.siteAddress}` : ''}
            </span>
            {tasks.length > 0 && <span className="muted">☑ {done}/{tasks.length}</span>}
          </div>
        </Link>
        {opts.claim && (
          <button className="btn small" onClick={() => db.jobs.update(j.id, { assignedTo: userId })}>Take this job</button>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader title="My jobs" actions={<SyncBadge />} />
      {plan.effective === 'expired' && <p className="notice small">The business's Spannr trial has ended – ask the owner to choose a plan.</p>}
      <h2>Today</h2>
      {todays.length ? todays.map((j) => card(j)) : <Empty>No jobs for you today.</Empty>}
      {upcoming.length > 0 && (<><h2>Coming up</h2>{upcoming.map((j) => card(j))}</>)}
      {unassigned.length > 0 && (<><h2>Not assigned yet</h2>{unassigned.map((j) => card(j, { claim: true }))}</>)}
      {finished.length > 0 && (<><h2>Finished recently</h2>{finished.map((j) => card(j))}</>)}
    </>
  );
}
