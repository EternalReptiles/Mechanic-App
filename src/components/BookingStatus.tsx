import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { useSyncStatus } from '../cloud/sync';
import type { Customer, Job, Settings } from '../types';
import { firstName, fmtDateTime } from '../utils';

type Note = { status: string; error: string | null; channel: string; sent_at: string | null; created_at: string; booking_at: string };

/**
 * "Book job" and what happened next: the job is saved, synced, and the booking confirmation
 * text goes out within a minute – so the mechanic can see it actually worked.
 */
export default function BookingStatus({ job, customer, settings, onBook }: {
  job: Job; customer?: Customer; settings: Settings; onBook: () => void;
}) {
  const { businessId, can } = useCloud();
  const sync = useSyncStatus();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const start = job.scheduledStart;
  // Older bookings (made before this button, or with the top button) count as booked too.
  const booked = job.status === 'scheduled' && (!!job.bookedAt || Date.now() - new Date(job.createdAt || 0).getTime() > 3600e3);

  // While a confirmation is on its way, check every few seconds (for about 3 minutes).
  useEffect(() => {
    if (!booked || !start) return;
    let n = 0;
    let stop = false;
    const look = () => void supabase.from('notifications').select('status, error, channel, sent_at, created_at, booking_at')
      .eq('business_id', businessId).eq('job_id', job.id).eq('kind', 'confirmation')
      .then(({ data }) => {
        if (stop) return;
        const mine = ((data ?? []) as Note[]).filter((x) => new Date(x.booking_at).getTime() === new Date(start).getTime());
        setNotes(mine);
        const done = mine.length > 0 && mine.every((x) => !['queued', 'sending'].includes(x.status));
        if (!done && ++n < 36) timer = window.setTimeout(look, 5000);
      });
    let timer = window.setTimeout(look, 1500);
    return () => { stop = true; window.clearTimeout(timer); };
  }, [booked, start, businessId, job.id]);

  if (!['quote', 'scheduled'].includes(job.status)) return null;

  const missing = !job.customerId ? 'Pick the customer' : !start ? 'Set the booking time' : '';
  if (!booked) {
    return (
      <div className="wide booking-box">
        <button className="btn primary block big" disabled={!!missing} onClick={onBook}>📅 Book job</button>
        <small className="muted">{missing || (confirmOn(settings, can) && customer?.phone
          ? `Saves the booking and texts ${firstName(customer.name)} a confirmation.`
          : 'Saves the booking.')}</small>
      </div>
    );
  }

  const who = customer ? firstName(customer.name) : 'the customer';
  let text: string;
  let tone = '';
  if (!confirmOn(settings, can)) text = 'Booking confirmation texts are off (Settings → Automatic messages).';
  else if (!customer?.phone && !customer?.email) { text = `${who} has no mobile or email, so no confirmation was sent.`; tone = 'warn'; }
  else if (customer?.noAutoMessages) text = `Automatic messages are off for ${who}.`;
  else if (new Date(start).getTime() < Date.now()) text = 'The booking time has passed, so no confirmation was sent.';
  else if (notes?.some((x) => x.status === 'sent')) {
    const s = notes.find((x) => x.status === 'sent')!;
    text = `✓ Confirmation sent to ${who} ${fmtDateTime(s.sent_at || s.created_at)}`; tone = 'ok';
  } else if (notes?.some((x) => x.status === 'failed')) {
    text = `✕ Confirmation didn't send: ${notes.find((x) => x.status === 'failed')!.error ?? 'unknown error'}`; tone = 'warn';
  } else if (sync.state === 'offline') text = `No signal – the confirmation to ${who} goes once you're back online.`;
  else if (quietHours(settings.timezone)) text = `⏳ It's after hours – the confirmation to ${who} goes at 7:30am.`;
  else text = `⏳ Sending the confirmation to ${who}…`;

  return (
    <div className={`wide booking-box booked ${tone}`}>
      <strong>✓ Booked {fmtDateTime(start)}</strong>
      <span className="small">{text}</span>
    </div>
  );
}

function confirmOn(settings: Settings, can: (f: 'autoMessages') => boolean) {
  return !!settings.notify?.confirmEnabled && can('autoMessages');
}

function quietHours(tz?: string) {
  try {
    const t = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: tz || 'Australia/Sydney' }).format(new Date());
    const [h, m] = t.split(':').map(Number);
    return h >= 21 || h * 60 + m < 7 * 60 + 30;
  } catch { return false; }
}
