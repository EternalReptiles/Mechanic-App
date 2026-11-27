import { useCallback, useEffect, useRef, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { aiAssist } from '../ai/ai';
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
  const { businessId, businessName } = useCloud();
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!customer || !navigator.onLine) return;
    const { data } = await supabase.rpc('customer_thread', { bid: businessId, p_customer: customer.id });
    const list = (data as Item[]) ?? [];
    setItems(list);
    if (list.some((i) => i.dir === 'in' && !i.read_at)) setOpen(true);
    if (list.some((i) => i.dir === 'in' && !i.read_at)) {
      void supabase.rpc('mark_customer_replies_read', { bid: businessId, p_customer: customer.id }).then(() => undefined);
    }
  }, [businessId, customer]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), 20000);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }); }, [items?.length, open]);

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

  const first = customer.name?.split(' ')[0] || 'customer';
  const last = items?.[items.length - 1];
  if (!open)
    return (
      <button className="card thread-closed" onClick={() => setOpen(true)}>
        <span>💬 <strong>Texts with {first}</strong>{items?.length ? <span className="muted"> · {items.length}</span> : null}</span>
        <span className="small muted thread-last">{last ? last.body : 'Send a text from Spannr'}</span>
      </button>
    );

  return (
    <section className="card text-thread">
      <div className="row between"><h2 style={{ margin: 0 }}>💬 Texts with {first}</h2><button className="link small" onClick={() => setOpen(false)}>Hide</button></div>
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
      {items?.some((i) => i.dir === 'in') && (
        <button className="link small ai-draft" disabled={busy} onClick={async () => {
          setErr(''); setBusy(true);
          try {
            const thread = items.slice(-12).map((i) => `${i.dir === 'in' ? 'Customer' : 'Business'}: ${i.body}`).join('\n');
            const r = await aiAssist<{ reply: string }>('reply', businessId, { thread, hint: text, customerName: first, businessName, job: '' });
            setText(r.reply);
          } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
        }}>✨ {text.trim() ? 'Write it for me (using your words as instructions)' : 'Draft a reply'}</button>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
