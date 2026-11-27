import { useCallback, useEffect, useRef, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { sendFromSpannr } from '../components/SendMessage';
import type { Customer } from '../types';

type Item = { dir: 'in' | 'out'; body: string; at: string; kind: string; status: string; read_at: string | null; id: string };

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const LABEL: Record<string, string> = { confirmation: 'Booking confirmation', reminder: 'Reminder', receipt: 'Receipt' };

/** The text conversation with a customer: Spannr's texts and their replies, with a reply box. */
export default function TextThread({ customer, jobId = '' }: { customer?: Customer; jobId?: string }) {
  const { businessId } = useCloud();
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!customer || !navigator.onLine) return;
    const { data } = await supabase.rpc('customer_thread', { bid: businessId, p_customer: customer.id });
    const list = (data as Item[]) ?? [];
    setItems(list);
    if (list.some((i) => i.dir === 'in' && !i.read_at)) {
      void supabase.rpc('mark_customer_replies_read', { bid: businessId, p_customer: customer.id }).then(() => undefined);
    }
  }, [businessId, customer]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), 20000);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [items?.length]);

  if (!customer?.phone) return null;

  async function send() {
    if (!text.trim()) return;
    setErr('');
    setBusy(true);
    try {
      await sendFromSpannr(businessId, customer!.id, jobId, 'sms', '', text.trim());
      setText('');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card text-thread">
      <h2>💬 Texts with {customer.name?.split(' ')[0] || 'customer'}</h2>
      <div className="thread">
        {items === null ? <p className="muted small">Loading…</p> : !items.length ? (
          <p className="muted small">No texts yet. Messages you send from Spannr – and their replies – show here.</p>
        ) : items.map((i) => (
          <div key={i.id + i.dir} className={`bubble ${i.dir}${i.dir === 'in' && !i.read_at ? ' unread' : ''}`}>
            {LABEL[i.kind] && <div className="bubble-tag">{LABEL[i.kind]}</div>}
            <div className="bubble-body">{i.body}</div>
            <div className="bubble-meta">{when(i.at)}{i.dir === 'out' && i.status === 'failed' ? ' · not delivered' : ''}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="reply-box">
        <textarea rows={2} placeholder={`Text ${customer.name?.split(' ')[0] || 'the customer'}…`} value={text}
          onChange={(e) => setText(e.target.value)} />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
