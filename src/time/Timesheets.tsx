import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { PageHeader } from '../components/ui';
import { db } from '../db';
import { entryMs, fmtDuration } from './timer';

const DAY = 86400000;
/** Monday 00:00 of the week containing d, shifted by `weeks`. */
function weekStart(weeks: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7);
  return d;
}

/** Timesheets: hours each person clocked on jobs, by week. */
export default function Timesheets() {
  const { team, memberName, isAdmin, userId } = useCloud();
  const [week, setWeek] = useState(0);
  const [person, setPerson] = useState(isAdmin ? '' : userId);
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];
  const from = weekStart(week), to = new Date(from.getTime() + 7 * DAY);
  const days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * DAY));

  const rows = useMemo(() => jobs.flatMap((j) => (j.timeEntries ?? [])
    .filter((e) => { const s = Date.parse(e.start); return s >= from.getTime() && s < to.getTime() && (!person || e.userId === person); })
    .map((e) => ({ e, job: j }))).sort((a, b) => a.e.start.localeCompare(b.e.start)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [jobs, week, person]);

  const people = [...new Set([...team.map((t) => t.userId), ...rows.map((r) => r.e.userId)])];
  const perPerson = people.map((u) => {
    const mine = rows.filter((r) => r.e.userId === u);
    return { u, total: mine.reduce((t, r) => t + entryMs(r.e), 0),
      perDay: days.map((d) => mine.filter((r) => new Date(r.e.start).toDateString() === d.toDateString()).reduce((t, r) => t + entryMs(r.e), 0)) };
  }).filter((p) => p.total > 0 || !person);
  const rego = (id?: string) => vehicles.find((v) => v.id === id)?.rego;
  const hrs = (ms: number) => (ms ? (Math.round(ms / 360000) / 10).toFixed(1) : '–');

  return (
    <>
      <PageHeader back title="Timesheets" />
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div className="row">
          <button className="btn small" onClick={() => setWeek(week - 1)} aria-label="Previous week">‹</button>
          <strong>{week === 0 ? 'This week' : week === -1 ? 'Last week' : `Week of ${from.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`}</strong>
          <button className="btn small" disabled={week >= 0} onClick={() => setWeek(week + 1)} aria-label="Next week">›</button>
        </div>
        {isAdmin && team.length > 1 && (
          <select value={person} onChange={(e) => setPerson(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Everyone</option>
            {team.map((t) => <option key={t.userId} value={t.userId}>{t.name || t.email}</option>)}
          </select>
        )}
      </div>

      <section className="card" style={{ overflowX: 'auto' }}>
        <table className="report-table timesheet">
          <thead><tr><th></th>{days.map((d) => <th key={d.toISOString()}>{d.toLocaleDateString('en-AU', { weekday: 'short' })}<br /><small>{d.getDate()}</small></th>)}<th>Total</th></tr></thead>
          <tbody>
            {perPerson.map((p) => (
              <tr key={p.u}><td>{memberName(p.u) || 'Technician'}</td>{p.perDay.map((ms, i) => <td key={i}>{hrs(ms)}</td>)}<td><strong>{hrs(p.total)}</strong></td></tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>Hours clocked on jobs. Tap ▶ Clock on / ■ Clock off on a job, or press Start job – finishing a job stops the clock.</p>
      </section>

      <section className="card">
        <h2>Entries</h2>
        {!rows.length ? <p className="muted small">Nothing clocked this week.</p> : rows.map(({ e, job }) => (
          <Link key={e.id} to={`/jobs/${job.id}`} className="row between entry-row">
            <span>
              <strong>{new Date(e.start).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</strong>{' '}
              {new Date(e.start).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}–{e.end ? new Date(e.end).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : 'now'}
              <br /><span className="small muted">#{job.number} {job.title}{rego(job.vehicleId) ? ` · ${rego(job.vehicleId)}` : ''}{!person ? ` · ${memberName(e.userId) || 'Technician'}` : ''}</span>
            </span>
            <strong>{fmtDuration(entryMs(e))}</strong>
          </Link>
        ))}
      </section>
    </>
  );
}
