import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { useSettings } from '../hooks';
import type { Customer, Job, Vehicle } from '../types';
import { dayKey, firstName, fmtDay, groupRepairs, money, totals, vehicleLabel } from '../utils';
import { fillTerms, fmtMB, KIND_LABEL, MAX_VIDEO_BYTES, VIDEO_BUCKET, type RequestKind, type WalkContent } from './model';
import { readingsText } from '../inspection';
import VideoRecorder from './VideoRecorder';
import ShareSent from './ShareSent';

/** Billing tab: send the quote (before work) or the finished job (after work) to the customer to sign remotely. */
export default function SendSignoff({ job, customer, vehicle, onSent }: { job: Job; customer?: Customer; vehicle?: Vehicle; onSent: () => void }) {
  const settings = useSettings();
  const { businessId, userId, email, memberName } = useCloud();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ token: string; message: string; subject: string } | null>(null);
  // Sent with the quote, so the customer gets one link: the video and the inspection results.
  const checked = (job.checklist ?? []).filter((c) => c.result);
  const [withInspection, setWithInspection] = useState(true);
  const [oldVideo, setOldVideo] = useState<{ path: string; at: string } | null>(null);
  const [withOldVideo, setWithOldVideo] = useState(true);
  const [video, setVideo] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  // A quote for the booked job is approved as a whole; extra work found during the job is itemised.
  const repairCount = groupRepairs(job.lineItems, settings.gstRegistered).length;
  const [itemise, setItemise] = useState(!['quote', 'scheduled'].includes(job.status));
  useEffect(() => {
    if (!navigator.onLine) return;
    void supabase.from('walkarounds').select('video_path, created_at').eq('business_id', businessId).eq('job_id', job.id)
      .not('video_path', 'is', null).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => { const r = data?.[0]; if (r) setOldVideo({ path: r.video_path as string, at: r.created_at as string }); });
  }, [businessId, job.id]);

  async function send(kind: Exclude<RequestKind, 'walkaround'>) {
    setErr('');
    if (!customer) return setErr('Add the customer to the job first.');
    if (!job.lineItems.length) return setErr('Add labour and parts first, so the customer can see what they are agreeing to pay.');
    if (!navigator.onLine) return setErr("You're offline. Sending needs signal.");
    if (kind === 'quote' && video && video.size > MAX_VIDEO_BYTES) return setErr('The video is over 50 MB – record a shorter one.');
    setBusy(true);
    let video_path: string | null = null;
    const addInspection = kind === 'quote' && withInspection && checked.length > 0;
    if (kind === 'quote' && video) {
      const type = (video.type || 'video/mp4').split(';')[0];
      const ext = type === 'video/webm' ? 'webm' : type === 'video/quicktime' ? 'mov' : 'mp4';
      video_path = `${businessId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from(VIDEO_BUCKET).upload(video_path, video, { contentType: type });
      if (up.error) { setBusy(false); return setErr(`Couldn't upload the video: ${up.error.message}`); }
    } else if (kind === 'quote' && oldVideo && withOldVideo) video_path = oldVideo.path;
    const extras = [video_path ? 'a video' : '', addInspection ? 'the inspection results' : ''].filter(Boolean).join(' and ');
    const t = totals(job.lineItems, settings.gstRegistered);
    const issued = job.invoicedAt ? new Date(job.invoicedAt) : new Date();
    const due = new Date(issued.getTime() + settings.paymentTermsDays * 86400000);
    const v = vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.rego : 'vehicle';
    const repairs = kind === 'quote' && itemise ? groupRepairs(job.lineItems, settings.gstRegistered) : [];
    const message =
      kind === 'quote'
        ? repairs.length >= 2
          ? `Hi ${firstName(customer.name)}, here's the quote for your ${v}${extras ? ` with ${extras}` : ''}: ${repairs.length} repairs, ${money(t.total)} for everything. Choose which ones you'd like done now, then sign.`
          : `Hi ${firstName(customer.name)}, here's the quote for your ${v}${extras ? ` with ${extras}` : ''} (${money(t.total)}). Please check it, then approve or decline and sign.`
        : `Hi ${firstName(customer.name)}, the work on your ${v} is done. Please check the details and sign off (${money(t.total)}, due ${fmtDay(dayKey(due))}).`;
    const content: WalkContent = {
      business: { name: settings.businessName, phone: settings.phone, email: settings.email, logo: settings.logo, abn: settings.abn, brandColor: settings.brandColor },
      customerName: customer.name,
      vehicle: vehicleLabel(vehicle),
      message,
      gst: settings.gstRegistered,
      sentBy: memberName(userId) || email,
      items: [],
      terms: fillTerms(settings.terms, settings.businessName, settings.paymentTermsDays),
      jobNumber: job.number,
      title: job.title,
      description: kind === 'quote' ? job.description : '',
      workNotes: kind === 'completion' ? job.workNotes : '',
      lines: job.lineItems.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, amount: Math.round(l.qty * l.unitPrice * 100) / 100 })),
      subtotal: t.subtotal,
      gstAmount: t.gst,
      total: t.total,
      dueDate: kind === 'completion' ? dayKey(due) : undefined,
      inspection: addInspection
        ? checked.map((c) => ({ label: c.label, result: c.result, detail: readingsText(c) || undefined, note: c.note || undefined }))
        : undefined,
      repairs:
        repairs.length >= 2
          ? repairs.map((r) => ({
              id: r.id,
              title: r.title,
              lines: r.lines.map((l) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, amount: Math.round(l.qty * l.unitPrice * 100) / 100 })),
              lineIds: r.lines.map((l) => l.id),
              subtotal: r.subtotal,
              total: r.total,
            }))
          : undefined,
    };
    const { data, error } = await supabase
      .from('walkarounds')
      .insert({ business_id: businessId, job_id: job.id, kind, content, video_path })
      .select('token')
      .single();
    setBusy(false);
    if (error) return setErr(`Couldn't send: ${error.message}`);
    setSent({ token: data.token as string, message, subject: `${KIND_LABEL[kind]} – ${settings.businessName}` });
    onSent();
  }

  if (sent) return <ShareSent token={sent.token} jobId={job.id} customer={customer} message={sent.message} subject={sent.subject} onDone={() => setSent(null)} onDelivered={onSent} />;

  const before = ['quote', 'scheduled'].includes(job.status);
  return (
    <section className="card">
      <h2>✍ Remote sign-off</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Send a link so the customer can sign on their own phone. They agree to the amount and your terms &amp; conditions, and you get a
        signed record.
      </p>
      {recording && <VideoRecorder onDone={(b) => { setVideo(b); setRecording(false); }} onCancel={() => setRecording(false)} />}
      {repairCount >= 2 && !recording && (
        <div className="seg two" style={{ marginBottom: 10 }}>
          <button className={!itemise ? 'on solid' : ''} onClick={() => setItemise(false)}>One price – approve the lot</button>
          <button className={itemise ? 'on solid' : ''} onClick={() => setItemise(true)}>Let them pick each repair</button>
        </div>
      )}
      {before && !recording && (
        <div className="quote-extras">
          <span className="small muted">Send with the quote:</span>
          {checked.length > 0 ? (
            <label className="check-row"><input type="checkbox" checked={withInspection} onChange={(e) => setWithInspection(e.target.checked)} />
              📋 Inspection results ({checked.filter((c) => c.result === 'urgent' || c.result === 'attention').length} to look at, {checked.length} checked)</label>
          ) : <span className="small muted">📋 No inspection done yet – do it on the Inspection tab to include it.</span>}
          {video ? (
            <span className="small">🎥 New video ({fmtMB(video.size)}) <button className="link small" onClick={() => setVideo(null)}>Remove</button></span>
          ) : oldVideo ? (
            <label className="check-row"><input type="checkbox" checked={withOldVideo} onChange={(e) => setWithOldVideo(e.target.checked)} />
              🎥 The video you recorded {fmtDay(dayKey(new Date(oldVideo.at)))}</label>
          ) : null}
          {!video && <button className="btn small" onClick={() => setRecording(true)}>🎥 {oldVideo ? 'Record a new video' : 'Add a video'}</button>}
        </div>
      )}
      <div className="row wrap">
        <button className={`btn grow wrap-text ${before ? 'primary' : ''}`} disabled={busy} onClick={() => send('quote')}>{busy && video ? 'Uploading video…' : '📄 Send quote to approve'}</button>
        <button className={`btn grow wrap-text ${!before ? 'primary' : ''}`} disabled={busy} onClick={() => send('completion')}>✅ Send job sign-off</button>
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
