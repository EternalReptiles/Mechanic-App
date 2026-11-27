import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { Empty, PageHeader } from '../components/ui';
import { db } from '../db';

type Convo = { from_number: string; customer_id: string | null; job_id: string | null; last_body: string; last_at: string; unread: number };

/** Customer replies to texts, newest first. */
export default function Messages() {
  const { businessId } = useCloud();
  const [list, setList] = useState<Convo[] | null>(null);
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? [];
  useEffect(() => {
    const load = () => navigator.onLine && void supabase.rpc('message_inbox', { bid: businessId }).then(({ data }) => setList((data as Convo[]) ?? []));
    load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 20000);
    return () => window.clearInterval(t);
  }, [businessId]);
  const name = (c: Convo) => customers.find((x) => x.id === c.customer_id)?.name || c.from_number.replace(/^\+61/, '0');

  return (
    <>
      <PageHeader back title="Messages" />
      <p className="muted small" style={{ marginTop: 0 }}>Replies to texts sent from Spannr. Open one to see the conversation and reply.</p>
      {list === null ? <p className="muted">Loading…</p> : !list.length ? <Empty>No replies yet.</Empty> : list.map((c) => {
        const inner = (
          <>
            <div className="row between">
              <strong>{name(c)}</strong>
              <span className="small muted">{new Date(c.last_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
            <div className="small inbox-preview">{c.unread > 0 && <span className="dot-unread" />} {c.last_body}</div>
          </>
        );
        const to = c.job_id ? `/jobs/${c.job_id}` : c.customer_id ? `/customers/${c.customer_id}` : '';
        return to
          ? <Link key={c.from_number} to={to} className={`card inbox-row${c.unread ? ' unread' : ''}`}>{inner}</Link>
          : <div key={c.from_number} className="card inbox-row">{inner}</div>;
      })}
    </>
  );
}
