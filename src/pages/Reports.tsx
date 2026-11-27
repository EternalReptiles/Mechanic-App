import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { PageHeader } from '../components/ui';
import { db } from '../db';
import { useSettings } from '../hooks';
import type { Job } from '../types';
import { money, PAYMENT_LABEL, totals } from '../utils';

type Period = 'month' | 'last' | 'quarter' | 'year' | '12m';
const LABEL: Record<Period, string> = { month: 'This month', last: 'Last month', quarter: 'This quarter', year: 'This financial year', '12m': 'Last 12 months' };

function range(p: Period): [Date, Date] {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (p) {
    case 'month': return [new Date(y, m, 1), new Date(y, m + 1, 1)];
    case 'last': return [new Date(y, m - 1, 1), new Date(y, m, 1)];
    case 'quarter': { const q = Math.floor(m / 3) * 3; return [new Date(y, q, 1), new Date(y, q + 3, 1)]; }
    case 'year': { const fy = m >= 6 ? y : y - 1; return [new Date(fy, 6, 1), new Date(fy + 1, 6, 1)]; } // Australian FY (1 July)
    default: return [new Date(y, m - 11, 1), new Date(y, m + 1, 1)];
  }
}
const inRange = (iso: string | undefined, [a, b]: [Date, Date]) => !!iso && new Date(iso) >= a && new Date(iso) < b;

/** Reports: takings, money owed, job numbers and who your best customers are. */
export default function Reports() {
  const settings = useSettings();
  const { memberName, isAdmin } = useCloud();
  const [period, setPeriod] = useState<Period>('month');
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? [];

  const r = useMemo(() => {
    const rg = range(period);
    const total = (j: Job) => totals(j.lineItems, settings.gstRegistered);
    const live = jobs.filter((j) => j.status !== 'cancelled');
    const paid = live.filter((j) => j.status === 'paid' && inRange(j.paidAt, rg));
    const paidTotal = paid.reduce((s, j) => s + total(j).total, 0);
    const gst = paid.reduce((s, j) => s + total(j).gst, 0);
    const labour = paid.reduce((s, j) => s + j.lineItems.filter((l) => l.type === 'labour').reduce((t, l) => t + l.qty * l.unitPrice, 0), 0);
    const parts = paid.reduce((s, j) => s + j.lineItems.filter((l) => l.type === 'part').reduce((t, l) => t + l.qty * l.unitPrice, 0), 0);
    // Everything else (imported jobs' totals, "other" lines), so the breakdown adds up to the total.
    const other = Math.max(0, paidTotal - gst - labour - parts);
    const invoiced = live.filter((j) => inRange(j.invoicedAt || j.paidAt, rg));
    const owing = live.filter((j) => j.status === 'invoiced');
    const owingTotal = owing.reduce((s, j) => s + total(j).total, 0);
    const overdue = owing.filter((j) => j.invoicedAt && Date.now() - new Date(j.invoicedAt).getTime() > settings.paymentTermsDays * 86400000);
    const quotes = live.filter((j) => inRange(j.createdAt, rg));
    const booked = quotes.filter((j) => j.status !== 'quote');
    const online = quotes.filter((j) => j.bookedOnline).length;

    const byMethod = new Map<string, number>();
    paid.forEach((j) => byMethod.set(j.paymentMethod || 'other', (byMethod.get(j.paymentMethod || 'other') ?? 0) + total(j).total));
    const byCustomer = new Map<string, number>();
    paid.forEach((j) => j.customerId && byCustomer.set(j.customerId, (byCustomer.get(j.customerId) ?? 0) + total(j).total));
    const byTech = new Map<string, number>();
    live.filter((j) => j.finishedBy && inRange(j.finishedAt, rg)).forEach((j) => byTech.set(j.finishedBy!, (byTech.get(j.finishedBy!) ?? 0) + 1));
    const byWork = new Map<string, number>();
    paid.forEach((j) => { const k = (j.title || 'Other').trim(); byWork.set(k, (byWork.get(k) ?? 0) + 1); });

    // Takings per month, last 12 months.
    const months: { label: string; total: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const a = new Date(now.getFullYear(), now.getMonth() - i, 1), b = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      months.push({
        label: a.toLocaleDateString('en-AU', { month: 'short' }),
        total: live.filter((j) => j.status === 'paid' && inRange(j.paidAt, [a, b])).reduce((s, j) => s + total(j).total, 0),
      });
    }
    return {
      paid, paidTotal, gst, labour, parts, other, invoiced, owing, owingTotal, overdue, quotes, booked, online, months,
      avg: paid.length ? paidTotal / paid.length : 0,
      byMethod: [...byMethod].sort((a, b) => b[1] - a[1]),
      byCustomer: [...byCustomer].sort((a, b) => b[1] - a[1]).slice(0, 5),
      byTech: [...byTech].sort((a, b) => b[1] - a[1]),
      byWork: [...byWork].sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }, [jobs, period, settings.gstRegistered, settings.paymentTermsDays]);

  if (!isAdmin) return (<><PageHeader back title="Reports" /><p className="muted">Reports are for the owner and admins.</p></>);
  const max = Math.max(1, ...r.months.map((m) => m.total));
  const name = (id: string) => customers.find((c) => c.id === id)?.name || 'Customer';

  return (
    <>
      <PageHeader back title="Reports" />
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        {(Object.keys(LABEL) as Period[]).map((p) => (
          <button key={p} className={`chip ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>{LABEL[p]}</button>
        ))}
      </div>

      <div className="stats report-stats">
        <div className="stat"><span className="stat-value">{money(r.paidTotal)}</span><span className="stat-label">Paid ({r.paid.length} jobs)</span></div>
        <div className="stat"><span className="stat-value">{money(r.avg)}</span><span className="stat-label">Average job</span></div>
        <Link to="/jobs?status=invoiced" className={`stat${r.overdue.length ? ' warn' : ''}`}>
          <span className="stat-value">{money(r.owingTotal)}</span><span className="stat-label">Owing now ({r.owing.length}){r.overdue.length ? ` · ${r.overdue.length} overdue` : ''}</span>
        </Link>
        <div className="stat"><span className="stat-value">{r.booked.length}/{r.quotes.length}</span><span className="stat-label">New jobs booked{r.online ? ` · ${r.online} online` : ''}</span></div>
      </div>

      <section className="card">
        <h2>Takings – last 12 months</h2>
        <div className="bars" role="img" aria-label="Paid each month for the last 12 months">
          {r.months.map((m, i) => (
            <div key={i} className="bar-col" title={`${m.label}: ${money(m.total)}`}>
              <span className="bar-val">{m.total ? `$${m.total >= 1000 ? `${Math.round(m.total / 100) / 10}k` : Math.round(m.total)}` : ''}</span>
              <span className="bar" style={{ height: `${(m.total / max) * 100}%` }} />
              <span className="bar-label">{m.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Breakdown ({LABEL[period].toLowerCase()})</h2>
          <table className="report-table"><tbody>
            <tr><td>Labour (ex GST)</td><td>{money(r.labour)}</td></tr>
            <tr><td>Parts (ex GST)</td><td>{money(r.parts)}</td></tr>
            {r.other >= 0.01 && <tr><td>Other &amp; imported jobs (ex GST)</td><td>{money(r.other)}</td></tr>}
            <tr><td>GST collected</td><td>{money(r.gst)}</td></tr>
            <tr className="total"><td>Total paid</td><td>{money(r.paidTotal)}</td></tr>
          </tbody></table>
          {r.byMethod.length > 0 && (
            <table className="report-table"><tbody>
              {r.byMethod.map(([m, v]) => <tr key={m}><td>{PAYMENT_LABEL[m] ?? 'Other'}</td><td>{money(v)}</td></tr>)}
            </tbody></table>
          )}
        </section>

        <section className="card">
          <h2>Top customers</h2>
          {r.byCustomer.length ? (
            <table className="report-table"><tbody>
              {r.byCustomer.map(([id, v]) => <tr key={id}><td><Link to={`/customers/${id}`}>{name(id)}</Link></td><td>{money(v)}</td></tr>)}
            </tbody></table>
          ) : <p className="muted small">No paid jobs in this period.</p>}
          {r.byWork.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Most common work</h3>
              <table className="report-table"><tbody>
                {r.byWork.map(([w, c]) => <tr key={w}><td>{w}</td><td>{c} job{c > 1 ? 's' : ''}</td></tr>)}
              </tbody></table>
            </>
          )}
          {r.byTech.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Jobs finished by technicians</h3>
              <table className="report-table"><tbody>
                {r.byTech.map(([u, c]) => <tr key={u}><td>{memberName(u) || 'Technician'}</td><td>{c}</td></tr>)}
              </tbody></table>
            </>
          )}
        </section>
      </div>
      <p className="muted small">Based on jobs marked paid, using each job's paid date. Financial year runs 1 July – 30 June.</p>
    </>
  );
}
