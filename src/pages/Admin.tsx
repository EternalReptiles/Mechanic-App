import { money } from '../utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../cloud/supabase';
import { PageHeader } from '../components/ui';
import { PLANS, type PlanKey } from '../plans';

type Row = {
  id: string; name: string; created_at: string; trial_ends_at: string | null; plan: PlanKey | null; plan_status: string | null;
  plan_interval: 'month' | 'year' | null; current_period_end: string | null; cancel_at_period_end: boolean; complimentary: boolean;
  closed_at: string | null; effective: string; owner_email: string | null; users: number; jobs: number; customers: number;
  last_activity: string | null; sms_used: number; sms_allowance: number; sms_parts: number; sms_cost: number; emails_month: number; card_payments: string | null;
  business_type: string | null;
};

const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};
const paying = (r: Row) => !!r.plan && ['active', 'trialing', 'past_due'].includes(r.plan_status ?? '') && !r.complimentary && !r.closed_at;
const monthly = (r: Row) => (paying(r) && r.plan ? (r.plan_interval === 'year' ? (PLANS[r.plan].monthly * 10) / 12 : PLANS[r.plan].monthly) : 0);

/** Spannr admin: every business on Spannr, their plan and usage. Only visible to Spannr admins. */
export default function Admin() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'trial' | 'paying' | 'expired' | 'closed'>('all');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_overview');
    if (error) setErr(error.message === 'Not allowed' ? 'This page is only for Spannr admins.' : error.message);
    else setRows((data as Row[]) ?? []);
  }, []);
  useEffect(() => void load(), [load]);

  const list = useMemo(() => (rows ?? []).filter((r) => {
    const hit = !q || `${r.name} ${r.owner_email}`.toLowerCase().includes(q.toLowerCase());
    const f = filter === 'all' || (filter === 'trial' && r.effective === 'trial') || (filter === 'paying' && paying(r))
      || (filter === 'expired' && r.effective === 'expired' && !r.closed_at) || (filter === 'closed' && !!r.closed_at);
    return hit && f;
  }), [rows, q, filter]);

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await fn();
    if (error) alert(error.message);
    await load();
  }

  if (err) return (<><PageHeader back title="Spannr admin" /><p className="error">{err}</p></>);
  if (!rows) return (<><PageHeader back title="Spannr admin" /><p className="muted">Loading…</p></>);

  const all = rows.filter((r) => !r.closed_at);
  const mrr = rows.reduce((s, r) => s + monthly(r), 0);
  const stats = [
    { v: all.length, l: 'Businesses' },
    { v: all.filter((r) => r.effective === 'trial').length, l: 'On trial' },
    { v: rows.filter(paying).length, l: 'Paying' },
    { v: `$${Math.round(mrr).toLocaleString('en-AU')}`, l: 'Monthly revenue (ex GST)' },
    { v: all.filter((r) => r.effective === 'expired').length, l: 'Trial ended, not paying' },
    { v: all.reduce((s, r) => s + r.sms_used, 0), l: 'Texts this month' },
    { v: money(all.reduce((s, r) => s + Number(r.sms_cost || 0), 0)), l: 'Text costs this month' },
  ];

  return (
    <>
      <PageHeader back title="Spannr admin" actions={<button className="btn" onClick={() => void load()}>↻ Refresh</button>} />
      <div className="stats admin-stats">
        {stats.map((s) => <div key={s.l} className="stat"><span className="stat-value">{s.v}</span><span className="stat-label">{s.l}</span></div>)}
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Push notifications</h2>
        <div className="row wrap">
          <button className="btn" onClick={async () => {
            const { data, error } = await supabase.rpc('admin_test_push');
            alert(error ? error.message : data ? `Test sent to your ${data} device(s).` : 'No devices yet – open the iPhone app and allow notifications first.');
          }}>Send me a test push</button>
          <button className="btn" onClick={async () => {
            if (!confirm('Send the "Tap to Pay on iPhone is here" push to every eligible business?')) return;
            const { data, error } = await supabase.rpc('admin_push_tap_to_pay_launch');
            alert(error ? error.message : `Sent to ${data} business(es).`);
          }}>Send Tap to Pay launch push</button>
        </div>
      </section>

      <div className="row wrap" style={{ margin: '12px 0' }}>
        <input className="grow" placeholder="Search business or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips wrap">
          {(['all', 'trial', 'paying', 'expired', 'closed'] as const).map((f) => (
            <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'trial' ? 'On trial' : f === 'paying' ? 'Paying' : f === 'expired' ? 'Trial ended' : 'Closed'}
            </button>
          ))}
        </div>
      </div>

      {list.map((r) => (
        <section key={r.id} className={`card admin-biz${r.closed_at ? ' closed' : ''}`}>
          <div className="row between wrap">
            <div>
              <strong>{r.name}</strong>
              <div className="small muted">{r.owner_email ?? 'no owner'} · {r.business_type ?? 'mobile'} · joined {d(r.created_at)}</div>
            </div>
            <span className={`plan-pill p-${r.complimentary ? 'comp' : r.closed_at ? 'closed' : r.effective}`}>
              {r.closed_at ? 'Closed' : r.complimentary ? 'Complimentary' : r.effective === 'trial' ? 'Trial'
                : r.effective === 'expired' ? 'Trial ended' : `${PLANS[r.effective as PlanKey]?.name ?? r.effective}${r.plan_interval === 'year' ? ' · yearly' : ''}`}
            </span>
          </div>
          <div className="admin-facts small">
            {r.closed_at ? <span>Closed {d(r.closed_at)} · deleted {d(new Date(new Date(r.closed_at).getTime() + 90 * 86400000).toISOString())}</span>
              : paying(r) ? <span>{r.cancel_at_period_end ? 'Cancels' : 'Renews'} {d(r.current_period_end)}{r.plan_status === 'past_due' ? ' · ⚠ payment failed' : ''}</span>
              : !r.complimentary && <span>Trial {r.effective === 'trial' ? 'ends' : 'ended'} {d(r.trial_ends_at)}</span>}
            <span>👥 {r.users} users</span>
            <span>🔧 {r.jobs} jobs</span>
            <span>🙋 {r.customers} customers</span>
            <span>💬 {r.sms_used}/{r.sms_allowance} texts{Number(r.sms_cost) ? ` · ${money(Number(r.sms_cost))} ClickSend` : ''}</span>
            <span>✉ {r.emails_month} emails</span>
            <span>💳 {r.card_payments === 'active' ? 'Card payments on' : r.card_payments ? `Card payments ${r.card_payments}` : 'No card payments'}</span>
            <span>Last active {ago(r.last_activity)}</span>
          </div>
          {!r.closed_at && (
            <div className="row wrap">
              <button className="btn small" onClick={() => void act(() => supabase.rpc('admin_set_complimentary', { bid: r.id, on_: !r.complimentary }))}>
                {r.complimentary ? 'Remove complimentary' : '🎁 Make complimentary'}
              </button>
              {!paying(r) && !r.complimentary && (
                <button className="btn small" onClick={() => void act(() => supabase.rpc('admin_extend_trial', { bid: r.id, days: 14 }))}>+14 trial days</button>
              )}
              {r.owner_email && <a className="btn small" href={`mailto:${r.owner_email}?subject=${encodeURIComponent('Spannr')}`}>✉ Email owner</a>}
            </div>
          )}
        </section>
      ))}
      {!list.length && <p className="muted">No businesses match.</p>}
    </>
  );
}
