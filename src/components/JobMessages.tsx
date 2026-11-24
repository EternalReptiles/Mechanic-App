import { useEffect, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { fmtDateTime } from '../utils';

interface Msg {
  id: string;
  kind: 'confirmation' | 'reminder' | 'receipt';
  channel: 'sms' | 'email';
  to_address: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  created_at: string;
  sent_at: string | null;
  booking_at: string;
}

const STATUS: Record<Msg['status'], string> = {
  queued: '⏳ Waiting to send',
  sending: '⏳ Sending',
  sent: '✓ Sent',
  failed: '✕ Failed',
  skipped: '– Not sent',
};

/** Automatic messages sent for this job. */
export default function JobMessages({ jobId }: { jobId: string }) {
  const { businessId } = useCloud();
  const [list, setList] = useState<Msg[]>([]);
  useEffect(() => {
    if (!navigator.onLine) return;
    supabase
      .from('notifications')
      .select('id, kind, channel, to_address, status, error, created_at, sent_at, booking_at')
      .eq('business_id', businessId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setList((data ?? []) as Msg[]));
  }, [businessId, jobId]);
  if (!list.length) return null;
  return (
    <div className="job-messages wide">
      <span className="small muted">Automatic messages</span>
      {list.map((m) => (
        <div key={m.id} className={`msg-row ${m.status}`}>
          <span>{m.channel === 'sms' ? '💬' : '✉'} {m.kind === 'confirmation' ? 'Booking confirmation' : m.kind === 'receipt' ? 'Payment receipt' : 'Reminder'}</span>
          <span className="small">
            {STATUS[m.status]} {fmtDateTime(m.sent_at || m.created_at)}
            {m.error && <span className="muted"> – {m.error}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
