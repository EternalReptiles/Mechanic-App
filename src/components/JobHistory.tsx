import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db';
import { useSettings } from '../hooks';
import type { Job } from '../types';
import { money, STATUS, totals } from '../utils';

/** Past jobs for this car (or this customer, if no car is set) – right on the job, so you know its history at the car. */
export default function JobHistory({ job, compact = false }: { job: Job; compact?: boolean }) {
  const settings = useSettings();
  const [all, setAll] = useState(false);
  const jobs = useLiveQuery(async () => {
    if (!job.vehicleId && !job.customerId) return [];
    const list = job.vehicleId
      ? await db.jobs.where('vehicleId').equals(job.vehicleId).toArray()
      : await db.jobs.where('customerId').equals(job.customerId).toArray();
    return list
      .filter((j) => j.id !== job.id && j.status !== 'cancelled' && j.status !== 'quote')
      .sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt));
  }, [job.id, job.vehicleId, job.customerId]);

  if (!jobs?.length) return null;
  const shown = all ? jobs : jobs.slice(0, 3);
  const date = (j: Job) => new Date(j.paidAt || j.finishedAt || j.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const notes = (j: Job) => j.workNotes.split('\n').map((l) => l.trim()).filter((l) => l && !/^[\d,. ]+\s*k(m|ms)?$/i.test(l) && !/^.{2,40}?\s[-–]\s[A-Za-z0-9]{2,7}$/.test(l)).slice(compact ? 1 : 0, compact ? 3 : 4).join(' · ');

  return (
    <details className="card job-history" open={!compact}>
      <summary>
        <h2 style={{ display: 'inline', margin: 0 }}>🕘 {job.vehicleId ? 'This car' : 'This customer'}'s history</h2>
        <span className="small muted"> · {jobs.length} past job{jobs.length > 1 ? 's' : ''}</span>
      </summary>
      {shown.map((j) => (
        <Link key={j.id} to={`/jobs/${j.id}`} className="history-row">
          <div className="row between">
            <strong>{date(j)} · {j.title || `Job #${j.number}`}</strong>
            <span className="small muted">{totals(j.lineItems, settings.gstRegistered).total ? money(totals(j.lineItems, settings.gstRegistered).total) : STATUS[j.status]?.label}</span>
          </div>
          <div className="small muted">
            #{j.number}{j.odometer ? ` · ${Number(j.odometer).toLocaleString('en-AU')} km` : ''}{j.imported ? ` · from ${j.imported}` : ''}
          </div>
          {notes(j) && <div className="small history-notes">{notes(j)}</div>}
        </Link>
      ))}
      {jobs.length > 3 && !all && <button className="link small" onClick={() => setAll(true)}>Show all {jobs.length}</button>}
    </details>
  );
}
