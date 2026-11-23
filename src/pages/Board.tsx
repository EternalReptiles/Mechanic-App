import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { db } from '../db';
import { useLookups } from '../hooks';
import type { Job, JobStatus } from '../types';
import { fmtDateTime, fmtTime, STATUS } from '../utils';

const COLUMNS: { key: string; title: string; match: (j: Job) => boolean; color: string }[] = [
  { key: 'booked', title: 'Booked in', match: (j) => j.status === 'scheduled', color: STATUS.scheduled.color },
  { key: 'progress', title: 'In progress', match: (j) => j.status === 'in_progress', color: STATUS.in_progress.color },
  { key: 'hold', title: 'On hold', match: (j) => j.status === 'waiting', color: STATUS.waiting.color },
  {
    key: 'ready',
    title: 'Ready for pickup',
    match: (j) => (['completed', 'invoiced', 'paid'] as JobStatus[]).includes(j.status),
    color: STATUS.completed.color,
  },
];

/** Every car currently at the workshop, by stage. */
export default function Board() {
  const { memberName } = useCloud();
  const { customerMap, vehicleMap } = useLookups();
  const jobs =
    useLiveQuery(
      () => db.jobs.filter((j) => j.location === 'workshop' && !j.collectedAt && j.status !== 'cancelled' && j.status !== 'quote').toArray(),
      [],
    ) ?? [];
  // A paid job only stays on the board while the car is still here.
  const onBoard = jobs.filter((j) => j.status !== 'paid' || j.droppedOffAt);

  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const list = onBoard
          .filter(col.match)
          .sort((a, b) => (a.promisedAt || a.scheduledStart || '~').localeCompare(b.promisedAt || b.scheduledStart || '~'));
        return (
          <section key={col.key} className="board-col">
            <h3 style={{ borderColor: col.color }}>
              {col.title} <span className="muted">{list.length}</span>
            </h3>
            {list.map((j) => {
              const v = vehicleMap.get(j.vehicleId);
              const c = customerMap.get(j.customerId);
              const late = j.promisedAt && new Date(j.promisedAt) < new Date() && col.key !== 'ready';
              return (
                <Link key={j.id} to={`/jobs/${j.id}`} className="board-card" style={{ borderLeftColor: col.color }}>
                  <div className="row between">
                    <span className="rego">{v?.rego || `#${j.number}`}</span>
                    {j.keyTag && <span className="key-tag">🔑 {j.keyTag}</span>}
                  </div>
                  <div className="small">{[v?.make, v?.model].filter(Boolean).join(' ')}</div>
                  <div className="small">{c?.name}{j.title && ` · ${j.title}`}</div>
                  <div className="row between small muted">
                    <span>{memberName(j.assignedTo) || 'Unassigned'}</span>
                    {j.promisedAt ? (
                      <span className={late ? 'danger-text' : ''}>Due {fmtTime(j.promisedAt)}</span>
                    ) : (
                      col.key === 'booked' && j.scheduledStart && <span>{fmtDateTime(j.scheduledStart)}</span>
                    )}
                  </div>
                  {col.key === 'booked' && !j.droppedOffAt && <div className="small muted">Not dropped off yet</div>}
                </Link>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
