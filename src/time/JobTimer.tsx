import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import type { Job } from '../types';
import { clockOffPatch, clockOnPatch, entryMs, fmtDuration, running } from './timer';

/** Clock on / off for the job, with time so far (per person). */
export default function JobTimer({ job, update, compact = false }: { job: Job; update: (p: Partial<Job>) => void; compact?: boolean }) {
  const { userId, memberName } = useCloud();
  const [, tick] = useState(0);
  const mine = running(job, userId);
  useEffect(() => {
    if (!job.timeEntries?.some((e) => !e.end)) return;
    const t = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, [job.timeEntries]);

  const entries = job.timeEntries ?? [];
  const byPerson = new Map<string, number>();
  entries.forEach((e) => byPerson.set(e.userId, (byPerson.get(e.userId) ?? 0) + entryMs(e)));
  const total = [...byPerson.values()].reduce((a, b) => a + b, 0);
  const done = ['completed', 'invoiced', 'paid', 'cancelled'].includes(job.status);
  if (done && !entries.length) return null;

  return (
    <div className={`job-timer${mine ? ' on' : ''}${compact ? ' compact' : ''}`}>
      <div className="row between">
        <span>
          ⏱ {mine ? <strong>On the clock · {fmtDuration(entryMs(mine))}</strong> : <span>Time on this job: <strong>{fmtDuration(total)}</strong></span>}
        </span>
        {!done && (mine
          ? <button className="btn small" onClick={() => update(clockOffPatch(job, userId))}>■ Clock off</button>
          : <button className="btn small primary" onClick={() => void clockOnPatch(job, userId).then(update)}>▶ Clock on</button>)}
      </div>
      {!compact && byPerson.size > 0 && byPerson.size > 1 && (
        <div className="small muted" style={{ marginTop: 4 }}>
          {[...byPerson].map(([u, ms]) => `${memberName(u) || 'You'}: ${fmtDuration(ms)}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
