import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, PageHeader } from '../components/ui';
import { createJob, db } from '../db';
import { useSettings } from '../hooks';
import type { Customer, ReminderSent, Vehicle } from '../types';
import { daysUntil, fillTemplate, firstName, fmtDay, smsUrl, telUrl, vehicleLabel } from '../utils';
import { QuickText } from '../components/SendMessage';

type Due = { vehicle: Vehicle; customer?: Customer; kind: 'Service' | 'Rego'; date: string; days: number; sent?: ReminderSent };
const key = (d: Due) => (d.kind === 'Service' ? 'service' : 'rego') as 'service' | 'rego';

export default function Reminders() {
  const navigate = useNavigate();
  const settings = useSettings();
  const [windowDays, setWindowDays] = useState(30);
  const [tab, setTab] = useState<'todo' | 'sent'>('todo');
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? [];
  const cmap = new Map(customers.map((c) => [c.id, c]));

  const due: Due[] = [];
  for (const v of vehicles) {
    const customer = cmap.get(v.customerId);
    const sentFor = (k: 'service' | 'rego', date: string) => (v.reminders?.[k]?.for === date ? v.reminders[k] : undefined);
    if (v.nextServiceDate) due.push({ vehicle: v, customer, kind: 'Service', date: v.nextServiceDate, days: daysUntil(v.nextServiceDate), sent: sentFor('service', v.nextServiceDate) });
    if (v.regoExpiry) due.push({ vehicle: v, customer, kind: 'Rego', date: v.regoExpiry, days: daysUntil(v.regoExpiry), sent: sentFor('rego', v.regoExpiry) });
  }
  // Texted reminders move to "Sent" (newest first), where you can book them in when the customer gets back to you.
  const todo = due.filter((d) => !d.sent && d.days <= windowDays).sort((a, b) => a.days - b.days);
  const sentList = due.filter((d) => d.sent).sort((a, b) => b.sent!.sentAt.localeCompare(a.sent!.sentAt));
  const list = tab === 'todo' ? todo : sentList;
  const bookedJob = (d: Due) => (d.sent?.jobId ? jobs.find((j) => j.id === d.sent!.jobId && j.status !== 'cancelled') : undefined);

  /** Marks a reminder as sent for this due date. */
  async function markSent(d: Due, jobId?: string) {
    const v = await db.vehicles.get(d.vehicle.id);
    if (!v) return;
    const prev = v.reminders?.[key(d)];
    const entry: ReminderSent = { for: d.date, sentAt: prev?.for === d.date ? prev.sentAt : new Date().toISOString(), ...(jobId ? { jobId } : prev?.for === d.date && prev.jobId ? { jobId: prev.jobId } : {}) };
    await db.vehicles.put({ ...v, reminders: { ...v.reminders, [key(d)]: entry } });
  }

  function message(d: Due) {
    const base = fillTemplate(settings.reminderMessage, {
      name: firstName(d.customer?.name ?? ''),
      business: settings.businessName,
      vehicle: [d.vehicle.make, d.vehicle.model].filter(Boolean).join(' ') || d.vehicle.rego,
      rego: d.vehicle.rego,
      date: fmtDay(d.date),
    });
    return d.kind === 'Rego'
      ? `Hi ${firstName(d.customer?.name ?? '')}, it's ${settings.businessName}. Just a heads-up that the rego on ${d.vehicle.rego} is due ${fmtDay(d.date)}. Need a safety/pink slip inspection? Reply and we'll come to you.`
      : base;
  }

  /** Take a reminder off the list (clears the car's due date, so no automatic reminder goes out either). */
  async function remove(d: Due) {
    if (!confirm(`Remove the ${d.kind.toLowerCase()} reminder for ${d.vehicle.rego || 'this car'}? You can set a new date on the car any time.`)) return;
    await db.vehicles.update(d.vehicle.id, d.kind === 'Service' ? { nextServiceDate: '', nextServiceKm: '' } : { regoExpiry: '' });
  }

  async function book(d: Due) {
    const job = await createJob({
      customerId: d.vehicle.customerId,
      vehicleId: d.vehicle.id,
      siteAddress: d.customer?.address ?? '',
      title: d.kind === 'Service' ? 'Scheduled service' : 'Rego inspection',
    });
    await markSent(d, job.id); // booked: it moves to (or stays in) Sent, marked as booked
    navigate(`/jobs/${job.id}`);
  }

  return (
    <>
      <PageHeader back title="Reminders" />
      <div className="tabs" role="tablist" style={{ marginBottom: 10 }}>
        <button role="tab" aria-selected={tab === 'todo'} className={tab === 'todo' ? 'on' : ''} onClick={() => setTab('todo')}>
          To send{todo.length ? <span className="dot">{todo.length}</span> : null}
        </button>
        <button role="tab" aria-selected={tab === 'sent'} className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>
          Sent{sentList.length ? <span className="dot muted-dot">{sentList.length}</span> : null}
        </button>
      </div>
      {tab === 'todo' && (
        <div className="chips">
          {[7, 30, 60, 90].map((n) => (
            <button key={n} className={`chip${windowDays === n ? ' active' : ''}`} onClick={() => setWindowDays(n)}>
              Due within {n} days
            </button>
          ))}
        </div>
      )}
      {list.length ? (
        list.map((d) => (
          <div key={d.vehicle.id + d.kind} className={`card reminder${d.days < 0 ? ' overdue' : ''}`}>
            <div className="row between">
              <strong>{d.kind} due · {vehicleLabel(d.vehicle)}</strong>
              <span className={`small ${d.days < 0 ? 'danger-text' : 'muted'}`}>
                {d.days < 0 ? `${-d.days} days overdue` : d.days === 0 ? 'Today' : `in ${d.days} days`}
              </span>
            </div>
            <div className="small">
              {d.customer ? <Link to={`/customers/${d.customer.id}`}>{d.customer.name}</Link> : 'No customer'} · {fmtDay(d.date)}
              {d.kind === 'Service' && d.vehicle.nextServiceKm && ` or ${d.vehicle.nextServiceKm} km`}
            </div>
            <div className="row wrap">
              {d.sent && (
                <span className="small muted reminder-sent">
                  💬 Texted {new Date(d.sent.sentAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  {bookedJob(d) && <> · <Link to={`/jobs/${bookedJob(d)!.id}`}>Booked – job #{bookedJob(d)!.number}</Link></>}
                </span>
              )}
              {!d.sent && d.customer?.phone && (
                <QuickText customer={d.customer} jobId={`vehicle:${d.vehicle.id}`} label="💬 Text reminder" text={message(d)} onSent={() => void markSent(d)} />
              )}
              {!d.sent && <button className="btn ghost small" onClick={() => void markSent(d)} title="Already contacted them another way">✓ Mark sent</button>}
              {d.customer?.phone && <a className="btn" href={telUrl(d.customer.phone)}>📞 Call</a>}
              {!bookedJob(d) && <button className="btn primary" onClick={() => book(d)}>Book job</button>}
              <button className="btn ghost small reminder-remove" onClick={() => void remove(d)} aria-label="Remove reminder">✕ Remove</button>
            </div>
          </div>
        ))
      ) : (
        tab === 'sent' ? <Empty>No reminders sent yet. When you text a reminder (or Spannr sends one automatically) it moves here, so you can book the job when they get back to you.</Empty> :
        <Empty>
          Nothing to send in the next {windowDays} days. Set "Next service due" on a vehicle (or tap "Remind in {settings.serviceIntervalMonths} months" when
          you finish a job) and it will show up here.
        </Empty>
      )}
    </>
  );
}
