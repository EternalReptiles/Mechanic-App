import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import CatalogPicker from '../components/CatalogPicker';
import { Field, PageHeader } from '../components/ui';
import { db } from '../db';
import { useSettings } from '../hooks';
import { firstName, money, smsUrl, uid, vehicleLabel } from '../utils';
import { readingsText } from '../inspection';
import {
  fillTerms,
  fmtMB,
  itemTotal,
  MAX_VIDEO_BYTES,
  PRIORITY,
  shareLink,
  VIDEO_BUCKET,
  type Priority,
  type WalkContent,
  type WalkItem,
} from './model';
import VideoRecorder from './VideoRecorder';
import NumberInput from '../components/NumberInput';
import SendMessage from '../components/SendMessage';

export default function Compose() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const { businessId, userId, email, memberName } = useCloud();
  const data = useLiveQuery(async () => {
    const job = await db.jobs.get(id);
    if (!job) return null;
    return {
      job,
      customer: job.customerId ? await db.customers.get(job.customerId) : undefined,
      vehicle: job.vehicleId ? await db.vehicles.get(job.vehicleId) : undefined,
    };
  }, [id]);

  const [video, setVideo] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [items, setItems] = useState<WalkItem[] | null>(null);
  const [message, setMessage] = useState('');
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [sending, setSending] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ token: string } | null>(null);
  const videoSrc = useMemo(() => (video ? URL.createObjectURL(video) : ''), [video]);
  useEffect(() => () => void (videoSrc && URL.revokeObjectURL(videoSrc)), [videoSrc]);

  // Start from anything flagged in the inspection.
  useEffect(() => {
    if (!data || items) return;
    const flagged = (data.job.checklist ?? []).filter((c) => c.result === 'urgent' || c.result === 'attention');
    setItems(
      flagged.map((c) => ({
        id: uid(),
        title: c.label,
        note: [readingsText(c), c.note].filter(Boolean).join(' – '),
        priority: c.result === 'urgent' ? 'urgent' : 'soon',
        lines: [],
        total: 0,
      })),
    );
    const v = data.vehicle ? [data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ') || data.vehicle.rego : 'car';
    setMessage(
      `Hi ${firstName(data.customer?.name ?? '')}, here's a video of your ${v}. Tap Yes/No for each item, then sign:`,
    );
  }, [data, items]);

  if (data === undefined || !items) return null;
  if (data === null) return <PageHeader back title="Job not found" />;
  const { job, customer, vehicle } = data;

  const setItem = (iid: string, patch: Partial<WalkItem>) =>
    setItems(items.map((i) => (i.id === iid ? { ...i, ...patch, total: itemTotal(patch.lines ?? i.lines, settings.gstRegistered) } : i)));

  function chooseFile(f?: File) {
    if (!f) return;
    if (f.size > MAX_VIDEO_BYTES)
      return setErr(`That video is ${fmtMB(f.size)} – the limit is 50 MB. Use "Record" in the app instead (it makes much smaller files) or pick a shorter clip.`);
    setErr('');
    setVideo(f);
  }

  async function send() {
    setErr('');
    if (!navigator.onLine) return setErr("You're offline. Sending needs signal – try again when you have reception.");
    if (!items!.length && !video) return setErr('Add a video or at least one item.');
    const unnamed = items!.find((i) => !i.title.trim());
    if (unnamed) return setErr('Every item needs a name.');
    if (video && video.size > MAX_VIDEO_BYTES) return setErr('The video is over 50 MB.');
    try {
      let video_path: string | null = null;
      if (video) {
        setSending(`Uploading video (${fmtMB(video.size)})…`);
        const type = (video.type || 'video/mp4').split(';')[0];
        const ext = type === 'video/webm' ? 'webm' : type === 'video/quicktime' ? 'mov' : 'mp4';
        video_path = `${businessId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(video_path, video, { contentType: type });
        if (error) throw error;
      }
      setSending('Creating link…');
      const content: WalkContent = {
        business: {
          name: settings.businessName,
          phone: settings.phone,
          email: settings.email,
          logo: settings.logo,
          abn: settings.abn, brandColor: settings.brandColor,
        },
        customerName: customer?.name ?? '',
        vehicle: vehicleLabel(vehicle),
        message: message.trim(),
        gst: settings.gstRegistered,
        sentBy: memberName(userId) || email,
        items: items!.map((i) => ({ ...i, title: i.title.trim(), total: itemTotal(i.lines, settings.gstRegistered) })),
        terms: fillTerms(settings.terms, settings.businessName, settings.paymentTermsDays),
      };
      const { data: row, error } = await supabase
        .from('walkarounds')
        .insert({ business_id: businessId, job_id: job.id, video_path, content })
        .select('token')
        .single();
      if (error) throw error;
      setSent({ token: row.token as string });
    } catch (e) {
      setErr(`Couldn't send: ${(e as Error).message}`);
    } finally {
      setSending('');
    }
  }

  if (sent) {
    const link = shareLink(sent.token);
    const text = `${message.trim()}\n\n${link}`;
    return (
      <div className="content">
        <PageHeader title="Ready to send" />
        <div className="card">
          <p>Your walk-around is saved. Send this link to {customer?.name || 'the customer'}:</p>
          <p className="link-box">{link}</p>
          <SendMessage customer={customer} jobId={job.id} text={text}
            subject={`Your ${vehicleLabel(vehicle) || 'vehicle'} – video & quote from ${settings.businessName}`} />
          <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(link).then(() => alert('Link copied'))}>📋 Copy link</button>
          <p className="muted small">You'll see when they open it and when they sign, on the job's Inspection tab.</p>
        </div>
        <Link className="btn block" to={`/jobs/${job.id}?tab=inspection`}>Back to job</Link>
      </div>
    );
  }

  const grand = items.reduce((s, i) => s + i.total, 0);

  return (
    <div className="content">
      <PageHeader back title="Video walk-around" />
      <p className="muted small">
        Job #{job.number} · {customer?.name || 'No customer'} · {vehicleLabel(vehicle) || 'No vehicle'}
      </p>

      <section className="card">
        <h2>1. Video</h2>
        {recording ? (
          <VideoRecorder onCancel={() => setRecording(false)} onDone={(b) => { setRecording(false); setVideo(b); }} />
        ) : video ? (
          <>
            <video className="wa-video" src={videoSrc} controls playsInline />
            <div className="row between small">
              <span className="muted">{fmtMB(video.size)}</span>
              <button className="btn ghost" onClick={() => setVideo(null)}>Remove / redo</button>
            </div>
          </>
        ) : (
          <div className="row wrap">
            <button className="btn primary grow big" onClick={() => setRecording(true)}>🎥 Record</button>
            <label className="btn grow big">
              📁 Choose a video
              <input type="file" accept="video/*" hidden onChange={(e) => { chooseFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
        )}
      </section>

      <section className="card">
        <h2>2. What needs doing</h2>
        {!items.length && <p className="muted small">Add the work you recommend. Items flagged in the inspection appear here automatically.</p>}
        {items.map((i) => (
          <div key={i.id} className="wa-edit-item" style={{ borderLeftColor: PRIORITY[i.priority].color }}>
            <div className="row">
              <input className="grow" placeholder="e.g. Front brake pads" value={i.title} onChange={(e) => setItem(i.id, { title: e.target.value })} />
              <button className="icon-btn danger" aria-label="Remove item" onClick={() => setItems(items.filter((x) => x.id !== i.id))}>✕</button>
            </div>
            <div className="seg three">
              {(Object.keys(PRIORITY) as Priority[]).map((p) => (
                <button key={p} className={i.priority === p ? 'on' : ''}
                  style={i.priority === p ? { background: PRIORITY[p].color, borderColor: PRIORITY[p].color } : undefined}
                  onClick={() => setItem(i.id, { priority: p })}>{PRIORITY[p].label}</button>
              ))}
            </div>
            <input placeholder="Note for the customer (optional)" value={i.note} onChange={(e) => setItem(i.id, { note: e.target.value })} />
            {i.lines.map((l, n) => (
              <div key={n} className="row small">
                <input className="grow" value={l.description} onChange={(e) => setItem(i.id, { lines: i.lines.map((x, k) => (k === n ? { ...x, description: e.target.value } : x)) })} />
                <NumberInput className="qty" value={l.qty} aria-label="Qty"
                  onChange={(v) => setItem(i.id, { lines: i.lines.map((x, k) => (k === n ? { ...x, qty: v } : x)) })} />
                <NumberInput className="price" value={l.unitPrice} aria-label="Unit price ex GST"
                  onChange={(v) => setItem(i.id, { lines: i.lines.map((x, k) => (k === n ? { ...x, unitPrice: v } : x)) })} />
                <button className="icon-btn danger" aria-label="Remove price line" onClick={() => setItem(i.id, { lines: i.lines.filter((_, k) => k !== n) })}>✕</button>
              </div>
            ))}
            <div className="row wrap between">
              <div className="row">
                <button className="btn small" onClick={() => setPickingFor(i.id)}>📋 Price list</button>
                <button className="btn small" onClick={() => setItem(i.id, { lines: [...i.lines, { type: 'part', description: i.title || 'Parts & labour', qty: 1, unitPrice: 0 }] })}>+ Price</button>
              </div>
              <strong>{money(i.total)}{settings.gstRegistered ? ' inc GST' : ''}</strong>
            </div>
          </div>
        ))}
        <button className="btn" onClick={() => setItems([...items, { id: uid(), title: '', note: '', priority: 'soon', lines: [], total: 0 }])}>+ Add item</button>
        {items.length > 0 && <p className="right"><strong>If they approve everything: {money(grand)}</strong></p>}
      </section>

      <section className="card">
        <h2>3. Message</h2>
        <Field label="Shown at the top of their page and in the text">
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
      </section>

      {pickingFor && (
        <CatalogPicker
          onClose={() => setPickingFor(null)}
          onPick={(c) => {
            const it = items.find((x) => x.id === pickingFor)!;
            setItem(pickingFor, { lines: [...it.lines, ...c.lines], title: it.title || c.name });
            setPickingFor(null);
          }}
        />
      )}

      {err && <p className="error">{err}</p>}
      <button className="btn primary block big" disabled={!!sending} onClick={send}>
        {sending || '📤 Send to customer'}
      </button>
    </div>
  );
}
