import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Checklist from '../components/Checklist';
import CustomerVehiclePicker from '../components/CustomerVehiclePicker';
import LineItems from '../components/LineItems';
import Photos from '../components/Photos';
import SignaturePad from '../components/SignaturePad';
import { Field, PageHeader, StatusBadge } from '../components/ui';
import { useCloud } from '../cloud/CloudProvider';
import ApprovalList, { WalkaroundSection } from '../walkaround/WalkaroundList';
import SendSignoff from '../walkaround/SendSignoff';
import JobMessages from '../components/JobMessages';
import Upgrade from '../components/Upgrade';
import TaskChecklist from '../components/TaskChecklist';
import { finishJobPatch, missingRequired, tasksFromTemplate, templatesFor } from '../jobTemplates';
import JobCardPayment from '../payments/JobCardPayment';
import { QuickText } from '../components/SendMessage';
import TextThread from '../messages/TextThread';
import TapToPay from '../payments/TapToPay';
import { quoteOutcome } from '../walkaround/model';
import { db, deleteJob } from '../db';
import { useAutosave, useSettings } from '../hooks';
import type { Job, JobStatus, PaymentMethod, Vehicle } from '../types';
import { whenJobDone } from '../stock';
import JobTimer from '../time/JobTimer';
import JobHistory from '../components/JobHistory';
import AiNotes from '../ai/AiNotes';
import AiQuote from '../ai/AiQuote';
import { billableHours, clockOnPatch, stopAllPatch } from '../time/timer';
import {
  fillTemplate,
  addMonthsISO,
  daysUntil,
  firstName,
  fmtDateTime,
  fmtDay,
  fromLocalInput,
  mapsUrl,
  money,
  PAYMENT_LABEL,
  smsUrl,
  STATUS,
  STATUS_ORDER,
  telUrl,
  toLocalInput,
  totals,
  uid,
} from '../utils';

const NEXT_STEP: Partial<Record<JobStatus, { label: string; to: JobStatus }>> = {
  quote: { label: 'Quote accepted → Book it in', to: 'scheduled' },
  scheduled: { label: '▶ Start job', to: 'in_progress' },
  in_progress: { label: '✓ Job complete', to: 'completed' },
  waiting: { label: '▶ Resume job', to: 'in_progress' },
  completed: { label: '🧾 Create invoice', to: 'invoiced' },
};

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'billing', label: 'Billing' },
  { key: 'photos', label: 'Photos & sign' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function JobPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'details';
  const settings = useSettings();
  const { team, can, userId, memberName } = useCloud();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [signing, setSigning] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const deleted = useRef(false);

  const customer = useLiveQuery(() => (job?.customerId ? db.customers.get(job.customerId) : undefined), [job?.customerId]);
  const vehicle = useLiveQuery(() => (job?.vehicleId ? db.vehicles.get(job.vehicleId) : undefined), [job?.vehicleId]);
  const photoCount = useLiveQuery(() => db.photos.where('jobId').equals(id).count(), [id]) ?? 0;

  useEffect(() => {
    setJob(undefined);
    deleted.current = false;
    db.jobs.get(id).then((j) => setJob(j ?? null));
  }, [id]);

  // Saves every change automatically, including when leaving the screen or locking the phone.
  const saved = useAutosave(job, (j) => !deleted.current && db.jobs.put(j), id);
  // Parts from stock come off the shelf once the job is done.
  const stockBusy = useRef(false);
  useEffect(() => {
    if (!job || (job.stockDeducted && job.serviceDueSet) || stockBusy.current) return;
    stockBusy.current = true;
    void whenJobDone(job).then((patch) => {
      stockBusy.current = false;
      if (patch) setJob((j) => (j ? { ...j, ...patch } : j));
    });
  }, [job?.status, job?.stockDeducted, job?.serviceDueSet, job?.vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (job === undefined) return null;
  if (job === null)
    return (
      <>
        <PageHeader title="Job not found" back />
        <Link to="/jobs" className="btn">Back to jobs</Link>
      </>
    );

  const update = (patch: Partial<Job>) => setJob((j) => (j ? { ...j, ...patch } : j));
  const updateVehicle = (patch: Partial<Vehicle>) => vehicle && db.vehicles.update(vehicle.id, patch);
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  function setStatus(to: JobStatus, paymentMethod?: PaymentMethod) {
    const patch: Partial<Job> = { status: to, ...(['completed', 'invoiced', 'paid', 'cancelled', 'waiting'].includes(to) ? stopAllPatch(job!) : {}) };
    const now = new Date().toISOString();
    if ((to === 'invoiced' || to === 'paid') && !job!.invoicedAt) patch.invoicedAt = now;
    if (to === 'paid') {
      patch.paidAt = job!.paidAt || now;
      if (paymentMethod) patch.paymentMethod = paymentMethod;
    }
    if (to === 'invoiced') setTab('billing');
    update(patch);
  }

  function setNextService() {
    const km = Number(String(job!.odometer || vehicle?.odometer || '').replace(/\D/g, ''));
    updateVehicle({
      nextServiceDate: addMonthsISO(settings.serviceIntervalMonths),
      nextServiceKm: km ? String(km + settings.serviceIntervalKm) : vehicle?.nextServiceKm ?? '',
    });
  }

  async function remove() {
    if (!confirm(`Delete job #${job!.number}? This cannot be undone.`)) return;
    deleted.current = true;
    await deleteJob(job!.id);
    navigate('/jobs', { replace: true });
  }

  const next = NEXT_STEP[job.status];
  const inWorkshop = job.location === 'workshop';
  const vehicleName = vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.rego : 'car';
  const readyText = customer
    ? fillTemplate(settings.readyMessage, {
        name: firstName(customer.name),
        business: settings.businessName,
        vehicle: vehicleName,
        rego: vehicle?.rego ?? '',
        total: money(totals(job.lineItems, settings.gstRegistered).total),
      })
    : '';
  const nowISO = () => new Date().toISOString();
  const address = job.siteAddress || customer?.address || '';
  const t = totals(job.lineItems, settings.gstRegistered);
  const flagged = (job.checklist ?? []).filter((c) => c.result === 'attention' || c.result === 'urgent').length;
  const serviceDue = vehicle?.nextServiceDate;
  const showServicePrompt =
    vehicle && (job.status === 'completed' || job.status === 'invoiced') && (!serviceDue || daysUntil(serviceDue) < 30);

  return (
    <>
      <PageHeader
        back
        title={<>Job #{job.number} <StatusBadge status={job.status} /></>}
        actions={<span className="muted small">{saved ? 'Saved ✓' : 'Saving…'}</span>}
      />

      {next && (
        <button className="btn primary block big" onClick={() => next.to === 'in_progress'
          ? void clockOnPatch(job, userId).then((p) => { setStatus('in_progress'); update(p); })
          : setStatus(next.to)}>
          {next.label}
        </button>
      )}
      {job.status === 'in_progress' && (
        <button className="btn block" onClick={() => setStatus('waiting')}>⏸ On hold – waiting on parts / approval</button>
      )}
      {(['scheduled', 'in_progress', 'waiting'].includes(job.status) || (job.timeEntries?.length ?? 0) > 0) && <JobTimer job={job} update={update} />}
      {job.status === 'invoiced' && (
        <div className="pay-row">
          <span className="small muted">Payment received ({money(t.total)}):</span>
          <div className="row">
            {(['cash', 'card', 'transfer'] as const).map((m) => (
              <button key={m} className="btn primary grow" onClick={() => setStatus('paid', m)}>{PAYMENT_LABEL[m]}</button>
            ))}
          </div>
        </div>
      )}
      {job.status === 'paid' && (
        <p className="paid-note">
          ✓ Paid {job.paymentMethod ? `by ${PAYMENT_LABEL[job.paymentMethod].toLowerCase()} ` : ''}
          {job.paidAt && `on ${new Date(job.paidAt).toLocaleDateString('en-AU')}`}
        </p>
      )}

      {showServicePrompt && (
        <div className="banner">
          <span>
            {serviceDue ? `Next service was due ${fmtDay(serviceDue)}.` : 'No next-service reminder set for this car.'}
          </span>
          <button className="btn" onClick={setNextService}>
            Remind in {settings.serviceIntervalMonths} months
          </button>
        </div>
      )}

      <div className="row wrap quick-actions">
        {customer?.phone && <a className="btn" href={telUrl(customer.phone)}>📞 Call</a>}
        {customer?.phone && !inWorkshop && (
          <QuickText customer={customer} jobId={job.id} label="💬 On my way"
            text={`Hi ${firstName(customer.name)}, it's ${settings.businessName}. I'm on my way and should be with you shortly.`} />
        )}
        {address && !inWorkshop && <a className="btn" href={mapsUrl(address)} target="_blank" rel="noreferrer">🧭 Navigate</a>}
        {customer?.phone && inWorkshop && (
          <QuickText customer={customer} jobId={job.id} label="💬 Car's ready" text={readyText} />
        )}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'on' : ''} onClick={() => setTab(x.key)}>
            {x.label}
            {x.key === 'inspection' && flagged > 0 && <span className="dot">{flagged}</span>}
            {x.key === 'photos' && photoCount > 0 && <span className="dot muted-dot">{photoCount}</span>}
          </button>
        ))}
      </div>

      {job.customerReply && (
        <div className={`banner ${job.customerReply.answer === 'cancel' ? 'attention' : ''}`}>
          <span>
            {job.customerReply.answer === 'confirmed'
              ? `✓ ${customer?.name?.split(' ')[0] || 'The customer'} confirmed this booking by text`
              : `⚠ ${customer?.name?.split(' ')[0] || 'The customer'} replied C – they want to cancel or change this booking`}
            <span className="small muted"> · {new Date(job.customerReply.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          </span>
          <button className="link small" onClick={() => update({ customerReply: undefined })}>Clear</button>
        </div>
      )}

      {tab === 'details' && (
        <div className="tab-body">
          <TextThread customer={customer} jobId={job.id} />
          <section className="card">
            <h2>Customer &amp; vehicle</h2>
            <CustomerVehiclePicker
              customerId={job.customerId}
              vehicleId={job.vehicleId}
              onChange={(c, v) =>
                update({
                  customerId: c?.id ?? '',
                  vehicleId: v?.id ?? '',
                  siteAddress: job.siteAddress || c?.address || '',
                })
              }
            />
            {vehicle && (
              <div className="grid two-up vehicle-extra">
                <Field label="Odometer (km)">
                  <input inputMode="numeric" value={job.odometer} placeholder={vehicle.odometer ? `Last: ${vehicle.odometer}` : ''}
                    onChange={(e) => {
                      update({ odometer: e.target.value });
                      updateVehicle({ odometer: e.target.value });
                    }} />
                </Field>
                <Field label="Next service due">
                  <input type="date" value={vehicle.nextServiceDate ?? ''} onChange={(e) => updateVehicle({ nextServiceDate: e.target.value })} />
                </Field>
              </div>
            )}
          </section>
          <JobHistory job={job} />

          {inWorkshop && (
            <section className="card grid">
              <h2 className="wide">Workshop check-in</h2>
              <Field label="Key tag #">
                <input inputMode="numeric" value={job.keyTag ?? ''} onChange={(e) => update({ keyTag: e.target.value })} />
              </Field>
              <Field label="Promised ready by">
                <input type="datetime-local" value={toLocalInput(job.promisedAt ?? '')} onChange={(e) => update({ promisedAt: fromLocalInput(e.target.value) })} />
              </Field>
              <div className="wide row wrap">
                {job.droppedOffAt ? (
                  <span className="pill-ok">✓ Dropped off {fmtDateTime(job.droppedOffAt)}</span>
                ) : (
                  <button className="btn" onClick={() => update({ droppedOffAt: nowISO() })}>🚗 Car dropped off</button>
                )}
                {job.collectedAt ? (
                  <span className="pill-ok">✓ Collected {fmtDateTime(job.collectedAt)}</span>
                ) : (
                  job.droppedOffAt && <button className="btn" onClick={() => update({ collectedAt: nowISO() })}>👋 Car collected</button>
                )}
              </div>
            </section>
          )}

          <section className="card grid two-up">
            <h2 className="wide">Job</h2>
            {(settings.businessType === 'both' || (settings.businessType === 'mobile') === inWorkshop) && (
              <div className="seg wide two">
                <button className={!inWorkshop ? 'on solid' : ''} onClick={() => update({ location: 'onsite' })}>🚐 At customer</button>
                <button className={inWorkshop ? 'on solid' : ''} onClick={() => update({ location: 'workshop' })}>🔧 In workshop</button>
              </div>
            )}
            {team.length > 1 && can('workshop') && (
              <Field label="Technician" wide>
                <select value={job.assignedTo ?? ''} onChange={(e) => update({ assignedTo: e.target.value })}>
                  <option value="">— Unassigned —</option>
                  {team.map((t) => <option key={t.userId} value={t.userId}>{t.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="What's the job?" wide>
              <input value={job.title} placeholder="e.g. Logbook service, brake pads" onChange={(e) => update({ title: e.target.value })} />
            </Field>
            <Field label="Booking time" wide>
              <input type="datetime-local" value={toLocalInput(job.scheduledStart)}
                onChange={(e) => update({
                  scheduledStart: fromLocalInput(e.target.value),
                  status: job.status === 'quote' && e.target.value ? 'scheduled' : job.status,
                })} />
            </Field>
            <Field label="Duration">
              <select value={job.durationMins} onChange={(e) => update({ durationMins: Number(e.target.value) })}>
                {[30, 60, 90, 120, 180, 240, 360, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={job.status} onChange={(e) => setStatus(e.target.value as JobStatus)}>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </select>
            </Field>
            <JobMessages jobId={job.id} />
            {!inWorkshop && (
              <Field label="Where's the car?" wide>
                <input value={job.siteAddress} placeholder={customer?.address || 'Address'} onChange={(e) => update({ siteAddress: e.target.value })} />
              </Field>
            )}
            <Field label="Customer says…" wide>
              <textarea rows={2} value={job.description} placeholder="Noise from front left when braking…" onChange={(e) => update({ description: e.target.value })} />
            </Field>
            <Field label="Work done & recommendations (on invoice)" wide>
              <textarea rows={3} value={job.workNotes} onChange={(e) => update({ workNotes: e.target.value })} />
              <AiNotes job={job} vehicle={vehicle} customer={customer} update={update} />
            </Field>
          </section>
          <button className="btn ghost danger small delete-job" onClick={remove}>Delete job</button>
        </div>
      )}

      {tab === 'inspection' && (
        <>
        <section className="card">
          <h2>☑ Job checklist</h2>
          {job.tasks?.length ? (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>
                {job.tasksTemplate}
                {job.finishedAt && ` · finished ${fmtDateTime(job.finishedAt)}${job.finishedBy ? ` by ${memberName(job.finishedBy)}` : ''}`}
              </p>
              <TaskChecklist tasks={job.tasks} onChange={(tasks) => update({ tasks })} />
              {!job.finishedAt && (
                <button className="btn primary block" onClick={() => {
                  const miss = missingRequired(job.tasks);
                  if (miss.length) return alert(`Still to do: ${miss.map((t) => t.label).join(', ')}`);
                  const { patch, odometer } = finishJobPatch(job, userId);
                  update(patch);
                  if (odometer && vehicle) void db.vehicles.update(vehicle.id, { odometer });
                }}>✓ Mark job finished</button>
              )}
              <button className="btn ghost small" onClick={() => confirm('Remove this checklist from the job?') && update({ tasks: undefined, tasksTemplate: undefined })}>Remove checklist</button>
            </>
          ) : (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>Give the technician a checklist to fill in (with measurements like oil litres).</p>
              <div className="row wrap">
                {templatesFor(settings.jobTemplates).map((t) => (
                  <button key={t.id} className="btn" onClick={() => update({ tasks: tasksFromTemplate(t), tasksTemplate: t.name })}>{t.name}</button>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="card">
          <h2>Vehicle inspection</h2>
          <Checklist items={job.checklist ?? []} template={settings.checklistTemplate} onChange={(checklist) => update({ checklist })} />
          {(job.checklist?.length ?? 0) > 0 && (
            <Link className="btn block" to={`/jobs/${job.id}/report`}>📋 View inspection report</Link>
          )}
        </section>
        <AiQuote job={job} vehicle={vehicle} labourRate={settings.labourRate} update={update} />
        {!can('walkarounds') ? <Upgrade feature="walkarounds" what="Video walk-arounds" /> : <WalkaroundSection
          job={job}
          onAddLines={(lines, walkId) =>
            update({ lineItems: [...job.lineItems, ...lines], appliedWalkarounds: [...(job.appliedWalkarounds ?? []), walkId] })
          }
        />}
        </>
      )}

      {tab === 'billing' && (
        <>
          {job.status !== 'paid' && job.lineItems.length > 0 && (
            <TapToPay job={job} customer={customer} businessName={settings.businessName}
              onPaid={(paidAt) => update({ status: 'paid', paymentMethod: 'card', paidAt, invoicedAt: job.invoicedAt || paidAt })} />
          )}
          <section className="card">
            <h2>Labour &amp; parts</h2>
            {billableHours(job) > 0 && !job.lineItems.some((l) => l.timeLine) && (
              <button className="btn small" style={{ marginBottom: 8 }} onClick={() => update({ lineItems: [...job.lineItems, {
                id: uid(), type: 'labour', description: 'Labour', qty: billableHours(job), unitPrice: settings.labourRate, timeLine: true,
              }] })}>⏱ Add labour from clocked time ({billableHours(job)} h)</button>
            )}
            <LineItems items={job.lineItems} onChange={(lineItems) => update({ lineItems })}
              labourRate={settings.labourRate} gst={settings.gstRegistered} />
          </section>
          <div className="row wrap">
            <Link className="btn grow" to={`/jobs/${job.id}/quote`}>📄 Quote</Link>
            <Link className="btn grow" to={`/jobs/${job.id}/invoice`}>🧾 Invoice</Link>
          </div>
          <JobCardPayment
            job={job}
            customer={customer}
            businessName={settings.businessName}
            onInvoiced={() => {
              if (!['invoiced', 'paid'].includes(job.status)) setStatus('invoiced');
            }}
            onPaid={(paidAt) => update({ status: 'paid', paymentMethod: 'card', paidAt, invoicedAt: job.invoicedAt || paidAt })}
          />
          {can('signoffs') ? (
            <SendSignoff job={job} customer={customer} vehicle={vehicle} onSent={() => setSentCount((n) => n + 1)} />
          ) : (
            <Upgrade feature="signoffs" what="Remote quote approval and sign-off" />
          )}
          <ApprovalList
            job={job}
            kinds={['quote', 'completion']}
            refreshKey={sentCount}
            onApplyQuote={(w) => {
              // Keep only the repairs the customer approved, and note the declined ones on the job.
              const qo = quoteOutcome(w.decisions);
              const declinedRepairs = (w.content.repairs ?? []).filter((r) => qo?.items[r.id] === 'declined');
              const dropIds = new Set(declinedRepairs.flatMap((r) => r.lineIds));
              const when = new Date(w.responded_at!).toLocaleDateString('en-AU');
              const note = `Recommended but declined by customer on ${when}: ${declinedRepairs.map((r) => r.title).join(', ')}.`;
              update({
                lineItems: job.lineItems.filter((l) => !dropIds.has(l.id)),
                workNotes: [job.workNotes.trim(), note].filter(Boolean).join('\n'),
                appliedWalkarounds: [...(job.appliedWalkarounds ?? []), w.id],
                status: job.status === 'quote' && qo?.outcome !== 'declined' ? 'scheduled' : job.status,
              });
            }}
          />
          {job.status === 'paid' && (
            <Field label="Payment method">
              <select value={job.paymentMethod ?? ''} onChange={(e) => update({ paymentMethod: e.target.value as PaymentMethod })}>
                <option value="">—</option>
                {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          )}
        </>
      )}

      {tab === 'photos' && (
        <>
          <section className="card">
            <h2>Photos</h2>
            <Photos jobId={job.id} />
          </section>
          <section className="card">
            <h2>Customer sign-off</h2>
            {signing ? (
              <>
                <Field label="Customer name">
                  <input value={job.signedName ?? customer?.name ?? ''} onChange={(e) => update({ signedName: e.target.value })} />
                </Field>
                <SignaturePad
                  onCancel={() => setSigning(false)}
                  onSave={(signature) => {
                    update({ signature, signedName: job.signedName || customer?.name || '', signedAt: new Date().toISOString() });
                    setSigning(false);
                  }}
                />
              </>
            ) : job.signature ? (
              <>
                <img className="sig-img" src={job.signature} alt="Customer signature" />
                <p className="muted small">Signed by {job.signedName} · {fmtDateTime(job.signedAt ?? '')}</p>
                <button className="btn ghost" onClick={() => update({ signature: '', signedName: '', signedAt: '' })}>Remove signature</button>
              </>
            ) : (
              <>
                <p className="muted small">Get the customer to sign to approve the quote or confirm the work is done.</p>
                <button className="btn primary" onClick={() => setSigning(true)}>✍ Get signature</button>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
