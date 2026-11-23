import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import JobCard from '../components/JobCard';
import { Empty, PageHeader } from '../components/ui';
import { useCloud } from '../cloud/CloudProvider';
import SyncBadge from '../cloud/SyncBadge';
import { createJob, db } from '../db';
import { useLookups, useSettings } from '../hooks';
import { addDays, dayKey, daysUntil, money, STATUS, totals } from '../utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const settings = useSettings();
  const { isAdmin } = useCloud();
  const { customerMap, vehicleMap } = useLookups();
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];
  const remindersDue = vehicles.filter(
    (v) => (v.nextServiceDate && daysUntil(v.nextServiceDate) <= 30) || (v.regoExpiry && daysUntil(v.regoExpiry) <= 30),
  ).length;
  const needsSetup = isAdmin && !settings.abn || settings.businessName === 'My Mobile Mechanics';

  const today = dayKey(new Date());
  const tomorrow = dayKey(addDays(new Date(), 1));
  const byStart = (a: { scheduledStart: string }, b: { scheduledStart: string }) =>
    a.scheduledStart.localeCompare(b.scheduledStart);
  const active = jobs.filter((j) => j.status !== 'cancelled' && j.status !== 'paid');
  const todays = active.filter((j) => j.scheduledStart && dayKey(new Date(j.scheduledStart)) === today).sort(byStart);
  const tomorrows = active.filter((j) => j.scheduledStart && dayKey(new Date(j.scheduledStart)) === tomorrow).sort(byStart);

  const invoiced = jobs.filter((j) => j.status === 'invoiced');
  const owing = invoiced.reduce((s, j) => s + totals(j.lineItems, settings.gstRegistered).total, 0);
  const overdue = invoiced.filter(
    (j) => j.invoicedAt && Date.now() - new Date(j.invoicedAt).getTime() > settings.paymentTermsDays * 86400000,
  );
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const paidThisMonth = jobs
    .filter((j) => j.status === 'paid' && j.paidAt && new Date(j.paidAt).getTime() >= monthStart)
    .reduce((s, j) => s + totals(j.lineItems, settings.gstRegistered).total, 0);

  const count = (s: keyof typeof STATUS) => jobs.filter((j) => j.status === s).length;

  async function newJob() {
    const job = await createJob();
    navigate(`/jobs/${job.id}`);
  }

  return (
    <>
      <PageHeader
        title={settings.businessName || 'Dashboard'}
        actions={<><SyncBadge /><button className="btn primary" onClick={newJob}>+ New job</button></>}
      />

      {needsSetup && (
        <Link to="/settings" className="banner">
          <span><strong>Set up your business</strong><br />Add your business name, ABN, logo and bank details so they appear on invoices.</span>
          <span>›</span>
        </Link>
      )}

      {isAdmin && <div className="stats">
        <Link to="/jobs?status=invoiced" className="stat">
          <span className="stat-value">{money(owing)}</span>
          <span className="stat-label">Owing ({invoiced.length})</span>
        </Link>
        <Link to="/jobs?status=invoiced" className={`stat${overdue.length ? ' warn' : ''}`}>
          <span className="stat-value">{overdue.length}</span>
          <span className="stat-label">Overdue invoices</span>
        </Link>
        <div className="stat">
          <span className="stat-value">{money(paidThisMonth)}</span>
          <span className="stat-label">Paid this month</span>
        </div>
      </div>}

      <Link to="/reminders" className={`banner${remindersDue ? ' attention' : ''}`}>
        <span>🔔 <strong>{remindersDue}</strong> service / rego reminder{remindersDue === 1 ? '' : 's'} due in the next 30 days</span>
        <span>›</span>
      </Link>

      <div className="pipeline">
        {(['quote', 'scheduled', 'in_progress', 'waiting', 'completed'] as const).map((s) => (
          <Link key={s} to={`/jobs?status=${s}`} className="pipe" style={{ borderColor: STATUS[s].color }}>
            <strong>{count(s)}</strong>
            <span>{STATUS[s].label}</span>
          </Link>
        ))}
      </div>

      <h2>Today</h2>
      {todays.length ? (
        todays.map((j) => (
          <JobCard key={j.id} job={j} customer={customerMap.get(j.customerId)} vehicle={vehicleMap.get(j.vehicleId)} gst={settings.gstRegistered} />
        ))
      ) : (
        <Empty>Nothing booked today.</Empty>
      )}

      <h2>Tomorrow</h2>
      {tomorrows.length ? (
        tomorrows.map((j) => (
          <JobCard key={j.id} job={j} customer={customerMap.get(j.customerId)} vehicle={vehicleMap.get(j.vehicleId)} gst={settings.gstRegistered} />
        ))
      ) : (
        <Empty>Nothing booked tomorrow.</Empty>
      )}
    </>
  );
}
