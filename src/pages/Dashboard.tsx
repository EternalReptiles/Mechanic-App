import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import JobCard from '../components/JobCard';
import { Empty, PageHeader } from '../components/ui';
import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { daysLeft } from '../plans';
import { platform } from '../native';
import { supabase } from '../cloud/supabase';
import SyncBadge from '../cloud/SyncBadge';
import { createJob, db } from '../db';
import { useLookups, useSettings } from '../hooks';
import SpannrAlerts from '../components/SpannrAlerts';
import GettingStarted from '../components/GettingStarted';
import { addDays, dayKey, daysUntil, money, STATUS, totals } from '../utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const settings = useSettings();
  const { isAdmin, businessId, plan, businessName: cloudName } = useCloud();
  // Customers who've answered a video walk-around since we last looked.
  const [responses, setResponses] = useState<{ job_id: string; signed_name: string; kind: string }[]>([]);
  useEffect(() => {
    if (!navigator.onLine) return;
    supabase
      .from('walkarounds')
      .select('job_id, signed_name, kind')
      .eq('business_id', businessId)
      .not('responded_at', 'is', null)
      .is('seen_by_business_at', null)
      .then(({ data }) => setResponses(data ?? []));
  }, [businessId]);
  const [unreadTexts, setUnreadTexts] = useState(0);
  useEffect(() => {
    const load = () => navigator.onLine && void supabase.rpc('unread_replies', { bid: businessId }).then(({ data }) => setUnreadTexts(Number(data) || 0));
    load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    return () => window.clearInterval(t);
  }, [businessId]);
  const { customerMap, vehicleMap } = useLookups();
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];
  const lowStock = (useLiveQuery(() => db.stock.toArray(), []) ?? []).filter((s) => s.reorderAt > 0 && s.onHand <= s.reorderAt).length;
  const remindersDue = vehicles.filter(
    (v) => (v.nextServiceDate && daysUntil(v.nextServiceDate) <= 30 && v.reminders?.service?.for !== v.nextServiceDate)
      || (v.regoExpiry && daysUntil(v.regoExpiry) <= 30 && v.reminders?.rego?.for !== v.regoExpiry),
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

  // Workshop: cars physically on site right now.
  const hasWorkshop = settings.businessType !== 'mobile';
  const workshopOnly = settings.businessType === 'workshop';
  const onSite = jobs.filter((j) => j.location === 'workshop' && j.droppedOffAt && !j.collectedAt && j.status !== 'cancelled');
  const readyForPickup = onSite.filter((j) => ['completed', 'invoiced', 'paid'].includes(j.status));
  const dueToday = onSite
    .filter((j) => j.promisedAt && dayKey(new Date(j.promisedAt)) === today && !readyForPickup.includes(j))
    .sort((a, b) => a.promisedAt!.localeCompare(b.promisedAt!));
  const workingOn = onSite.filter((j) => j.status === 'in_progress').length;
  const onHold = onSite.filter((j) => j.status === 'waiting').length;
  const finishedByTech = jobs
    .filter((j) => j.finishedAt && j.status === 'completed')
    .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));
  const card = (j: (typeof jobs)[number]) => (
    <JobCard key={j.id} job={j} customer={customerMap.get(j.customerId)} vehicle={vehicleMap.get(j.vehicleId)} gst={settings.gstRegistered} />
  );

  async function newJob() {
    if (plan.effective === 'expired') {
      navigate('/settings/billing');
      return;
    }
    const job = await createJob();
    navigate(`/jobs/${job.id}`);
  }

  return (
    <>
      <PageHeader
        title={settings.businessName && settings.businessName !== 'My Mobile Mechanics' ? settings.businessName : cloudName || settings.businessName || 'Dashboard'}
        actions={<><SyncBadge /><button className="btn primary" onClick={newJob}>+ New job</button></>}
      />

      {(plan.effective === 'expired' || plan.status === 'past_due' || (plan.effective === 'trial' && daysLeft(plan.trialEndsAt) <= 7)) && (
        <Link to="/settings/billing" className="banner attention">
          <span>
            {plan.effective === 'expired'
              ? `⭐ Your free trial has ended${platform === 'ios' ? '.' : ' – choose a plan to keep creating jobs.'}`
              : plan.status === 'past_due'
                ? "⚠ Your Spannr payment didn't go through – update your card."
                : `⭐ ${daysLeft(plan.trialEndsAt)} days left in your free trial${platform === 'ios' ? '.' : ' – choose a plan.'}`}
          </span>
          <span>›</span>
        </Link>
      )}

      {responses.length > 0 && (
        <Link to={`/jobs/${responses[0].job_id}?tab=${responses[0].kind === 'walkaround' ? 'inspection' : 'billing'}`} className="banner attention">
          <span>
            ✍ <strong>{responses.length === 1 ? `${responses[0].signed_name} signed` : `${responses.length} customers signed`}</strong> – tap to see
            {responses.length === 1 ? ' their response' : ' the first'}
          </span>
          <span>›</span>
        </Link>
      )}

      {unreadTexts > 0 && (
        <Link to="/messages" className="banner attention">
          <span>💬 <strong>{unreadTexts} new {unreadTexts === 1 ? 'text' : 'texts'}</strong> from customers – tap to read and reply</span>
          <span>›</span>
        </Link>
      )}

      <SpannrAlerts />
      {isAdmin && <GettingStarted />}

      {isAdmin && <div className="stats">
        <Link to="/jobs?status=invoiced" className="stat">
          <span className="stat-value">{money(owing)}</span>
          <span className="stat-label">Owing ({invoiced.length})</span>
        </Link>
        <Link to="/jobs?status=invoiced" className={`stat${overdue.length ? ' warn' : ''}`}>
          <span className="stat-value">{overdue.length}</span>
          <span className="stat-label">Overdue invoices</span>
        </Link>
        <Link to="/reports" className="stat">
          <span className="stat-value">{money(paidThisMonth)}</span>
          <span className="stat-label">Paid this month · Reports ›</span>
        </Link>
      </div>}

      {isAdmin && lowStock > 0 && (
        <Link to="/stock" className="banner attention">
          <span>📦 <strong>{lowStock}</strong> part{lowStock === 1 ? ' is' : 's are'} low on stock – tap to order</span>
          <span>›</span>
        </Link>
      )}

      <Link to="/reminders" className={`banner${remindersDue ? ' attention' : ''}`}>
        <span>🔔 <strong>{remindersDue}</strong> service / rego reminder{remindersDue === 1 ? '' : 's'} to send (next 30 days)</span>
        <span>›</span>
      </Link>

      {finishedByTech.length > 0 && (
        <>
          <h2>✓ Finished by technicians – ready to invoice</h2>
          {finishedByTech.map(card)}
        </>
      )}

      {hasWorkshop && (
        <>
          <h2>In the workshop</h2>
          <Link to="/schedule" className="workshop-tiles">
            <span><strong>{onSite.length}</strong>Cars on site</span>
            <span><strong>{workingOn}</strong>Being worked on</span>
            <span className={onHold ? 'hold' : ''}><strong>{onHold}</strong>On hold</span>
            <span className={readyForPickup.length ? 'ready' : ''}><strong>{readyForPickup.length}</strong>Ready for pickup</span>
          </Link>
          {readyForPickup.length > 0 && (
            <>
              <h3 className="sub">Ready for pickup</h3>
              {readyForPickup.map(card)}
            </>
          )}
          {dueToday.length > 0 && (
            <>
              <h3 className="sub">Promised today</h3>
              {dueToday.map(card)}
            </>
          )}
        </>
      )}

      <div className="pipeline">
        {(['quote', 'scheduled', 'in_progress', 'waiting', 'completed'] as const).map((s) => (
          <Link key={s} to={`/jobs?status=${s}`} className="pipe" style={{ borderColor: STATUS[s].color }}>
            <strong>{count(s)}</strong>
            <span>{STATUS[s].label}</span>
          </Link>
        ))}
      </div>

      <div className="two-col">
      <div>
      <h2>{workshopOnly ? 'Booked in today' : 'Today'}</h2>
      {todays.length ? todays.map(card) : <Empty>Nothing booked today.</Empty>}

      </div>
      <div>
      <h2>{workshopOnly ? 'Booked in tomorrow' : 'Tomorrow'}</h2>
      {tomorrows.length ? tomorrows.map(card) : <Empty>Nothing booked tomorrow.</Empty>}
      </div>
      </div>
    </>
  );
}
