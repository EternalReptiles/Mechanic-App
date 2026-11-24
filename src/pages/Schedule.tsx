import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import Board from './Board';
import { useCloud } from '../cloud/CloudProvider';
import { Link } from 'react-router-dom';
import JobCard from '../components/JobCard';
import { Empty, PageHeader } from '../components/ui';
import { db } from '../db';
import { useLookups, useSettings } from '../hooks';
import { addDays, dayKey, fmtTime, startOfWeek, STATUS } from '../utils';

export default function Schedule() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const settings = useSettings();
  const { can } = useCloud();
  const hasWorkshop = settings.businessType !== 'mobile' && can('workshop');
  const [chosen, setView] = useState<'board' | 'week' | null>(null);
  const view = chosen ?? (settings.businessType === 'workshop' ? 'board' : 'week');
  const { customerMap, vehicleMap } = useLookups();
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];

  const visible = jobs.filter((j) => j.status !== 'cancelled');
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = dayKey(new Date());
  const unscheduled = visible.filter(
    (j) => !j.scheduledStart && (j.status === 'quote' || j.status === 'scheduled' || j.status === 'in_progress'),
  );

  const label = `${weekStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${addDays(weekStart, 6).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const toggle = hasWorkshop && (
    <div className="seg two">
      <button className={view === 'board' ? 'on solid' : ''} onClick={() => setView('board')}>🔧 Workshop board</button>
      <button className={view === 'week' ? 'on solid' : ''} onClick={() => setView('week')}>📅 Week</button>
    </div>
  );

  if (hasWorkshop && view === 'board')
    return (
      <>
        <PageHeader title="Workshop" />
        {toggle}
        <Board />
      </>
    );

  return (
    <>
      <PageHeader title="Schedule" />
      {toggle}
      <div className="row between week-nav">
        <button className="btn" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Prev</button>
        <button className="btn ghost" onClick={() => setWeekStart(startOfWeek(new Date()))}>{label}</button>
        <button className="btn" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next ›</button>
      </div>

      {days.map((d) => {
        const key = dayKey(d);
        const dayJobs = visible
          .filter((j) => j.scheduledStart && dayKey(new Date(j.scheduledStart)) === key)
          .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
        return (
          <section key={key} className={`day${key === todayKey ? ' today' : ''}`}>
            <h3>{d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
            {dayJobs.length ? (
              dayJobs.map((j) => {
                const c = customerMap.get(j.customerId);
                return (
                  <Link key={j.id} to={`/jobs/${j.id}`} className="slot" style={{ borderLeftColor: STATUS[j.status].color }}>
                    <span className="slot-time">{fmtTime(j.scheduledStart)}</span>
                    <span className="slot-body">
                      <strong>{c?.name || 'No customer'}</strong> {j.title && `– ${j.title}`}
                      <span className="muted small">{j.location === 'workshop' ? '🔧 In workshop' : j.siteAddress || c?.address}</span>
                    </span>
                  </Link>
                );
              })
            ) : (
              <p className="muted small">—</p>
            )}
          </section>
        );
      })}

      <h2>Unscheduled</h2>
      {unscheduled.length ? (
        unscheduled.map((j) => (
          <JobCard key={j.id} job={j} customer={customerMap.get(j.customerId)} vehicle={vehicleMap.get(j.vehicleId)} gst={settings.gstRegistered} showTime={false} />
        ))
      ) : (
        <Empty>Every open job has a booking time.</Empty>
      )}
    </>
  );
}
