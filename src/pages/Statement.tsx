import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { brandVars } from '../brand';
import { Empty, PageHeader } from '../components/ui';
import { db } from '../db';
import { useSettings } from '../hooks';
import type { Customer, Job } from '../types';
import { invoiceDue, money, PAYMENT_LABEL, termsLabel, totals } from '../utils';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const monthStart = (y: number, m: number) => new Date(y, m, 1);

/** Statement for an account customer: what's owing (with how overdue), and this month's invoices and payments. */
export default function Statement() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const s = useSettings();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const customer = useLiveQuery(() => db.customers.get(id), [id]);
  const jobs = useLiveQuery(() => db.jobs.where('customerId').equals(id).toArray(), [id]) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.where('customerId').equals(id).toArray(), [id]) ?? [];

  const st = useMemo(() => {
    const from = monthStart(ym.y, ym.m), to = monthStart(ym.y, ym.m + 1);
    const end = new Date(to.getTime() - 1);
    const total = (j: Job) => totals(j.lineItems, s.gstRegistered).total;
    const inv = (j: Job) => j.invoicedAt || j.paidAt;
    const billed = jobs.filter((j) => (j.status === 'invoiced' || j.status === 'paid') && inv(j));
    // Owing at the end of the statement month: invoiced by then and not paid by then.
    const open = billed.filter((j) => new Date(inv(j)) < to && !(j.status === 'paid' && j.paidAt && new Date(j.paidAt) < to))
      .sort((a, b) => inv(a).localeCompare(inv(b)));
    const age = (j: Job) => Math.floor((end.getTime() - invoiceDue(inv(j), s.paymentTermsDays, customer?.account).getTime()) / 86400000);
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
    open.forEach((j) => {
      const a = age(j);
      if (a <= 0) buckets.current += total(j); else if (a <= 30) buckets.d30 += total(j); else if (a <= 60) buckets.d60 += total(j); else buckets.d90 += total(j);
    });
    const newThisMonth = billed.filter((j) => new Date(inv(j)) >= from && new Date(inv(j)) < to);
    const paidThisMonth = billed.filter((j) => j.status === 'paid' && j.paidAt && new Date(j.paidAt) >= from && new Date(j.paidAt) < to);
    return { from, end, open, age, buckets, due: open.reduce((t, j) => t + total(j), 0), newThisMonth, paidThisMonth, total };
  }, [jobs, ym, s.gstRegistered, s.paymentTermsDays, customer?.account]);

  if (customer === undefined) return null;
  if (!customer) return <PageHeader back title="Customer not found" />;
  const rego = (j: Job) => vehicles.find((v) => v.id === j.vehicleId)?.rego ?? '';
  const monthName = st.from.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const docName = `Statement ${monthName} - ${customer.name}`;

  function print() {
    const prev = document.title;
    document.title = docName;
    window.print();
    document.title = prev;
  }
  const email = customer.account?.billingEmail || customer.email;
  const mail = email
    ? `mailto:${email}?subject=${encodeURIComponent(`Statement – ${monthName} – ${s.businessName}`)}&body=${encodeURIComponent(
      `Hi ${customer.name},\n\nYour statement for ${monthName} from ${s.businessName}: ${money(st.due)} owing (${st.open.length} invoice${st.open.length === 1 ? '' : 's'}).\n\n${st.open.map((j) => `INV-${j.number}  ${fmt(j.invoicedAt || j.paidAt)}  ${j.poNumber ? `PO ${j.poNumber}  ` : ''}${money(st.total(j))}`).join('\n')}\n\n${s.bsb && s.accountNumber ? `Pay by bank transfer: ${s.accountName || s.businessName}, BSB ${s.bsb}, account ${s.accountNumber}.\n\n` : ''}The PDF statement is attached.\n\nThanks,\n${s.businessName}`)}`
    : '';

  return (
    <div className="doc-page">
      <div className="doc-toolbar no-print">
        <button className="btn" onClick={() => navigate(-1)}>← Back</button>
        <button className="btn" onClick={() => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}>‹</button>
        <strong style={{ alignSelf: 'center' }}>{monthName}</strong>
        <button className="btn" onClick={() => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}>›</button>
        <button className="btn primary" onClick={print}>Print / Save PDF</button>
        {mail && <a className="btn" href={mail}>✉ Email</a>}
      </div>

      <article className="doc statement" style={brandVars(s.brandColor)}>
        <header className="doc-head">
          <div>
            {s.logo && <img src={s.logo} alt="" className="doc-logo" />}
            <h2>{s.businessName}</h2>
            <div className="small">
              {s.abn && <div>ABN {s.abn}</div>}
              {s.address && <div>{s.address}</div>}
              {[s.phone, s.email].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="doc-meta">
            <h1>Statement</h1>
            <div><span>Date</span> {fmt(st.end.toISOString())}</div>
            {customer.account?.enabled && <div><span>Terms</span> {termsLabel(customer.account)}</div>}
            <div><span>Amount due</span> <strong>{money(st.due)}</strong></div>
          </div>
        </header>

        <section className="doc-parties">
          <div>
            <h3>Account</h3>
            <strong>{customer.name}</strong>
            {customer.address && <div>{customer.address}</div>}
            {email && <div>{email}</div>}
          </div>
        </section>

        <h3>Outstanding invoices</h3>
        {st.open.length ? (
          <table className="doc-table">
            <thead><tr><th>Date</th><th>Invoice</th><th>PO</th><th>Vehicle / work</th><th>Due</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {st.open.map((j) => {
                const d = invoiceDue(j.invoicedAt || j.paidAt, s.paymentTermsDays, customer.account);
                const a = st.age(j);
                return (
                  <tr key={j.id}>
                    <td>{fmt(j.invoicedAt || j.paidAt)}</td><td>INV-{j.number}</td><td>{j.poNumber ?? ''}</td>
                    <td>{[rego(j), j.title].filter(Boolean).join(' · ')}</td>
                    <td>{fmt(d.toISOString())}{a > 0 && <div className="small" style={{ color: '#b91c1c' }}>{a} days overdue</div>}</td>
                    <td style={{ textAlign: 'right' }}>{money(st.total(j))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p>Nothing owing – thank you.</p>}

        <table className="doc-table statement-aging">
          <thead><tr><th>Current</th><th>1–30 days overdue</th><th>31–60 days</th><th>Over 60 days</th><th style={{ textAlign: 'right' }}>Total due</th></tr></thead>
          <tbody><tr>
            <td>{money(st.buckets.current)}</td><td>{money(st.buckets.d30)}</td><td>{money(st.buckets.d60)}</td><td>{money(st.buckets.d90)}</td>
            <td style={{ textAlign: 'right' }}><strong>{money(st.due)}</strong></td>
          </tr></tbody>
        </table>

        {(st.newThisMonth.length > 0 || st.paidThisMonth.length > 0) && (
          <>
            <h3>Activity in {monthName}</h3>
            <table className="doc-table">
              <tbody>
                {st.newThisMonth.map((j) => <tr key={`n${j.id}`}><td>{fmt(j.invoicedAt || j.paidAt)}</td><td>Invoice INV-{j.number}{j.poNumber ? ` (PO ${j.poNumber})` : ''}</td><td style={{ textAlign: 'right' }}>{money(st.total(j))}</td></tr>)}
                {st.paidThisMonth.map((j) => <tr key={`p${j.id}`}><td>{fmt(j.paidAt)}</td><td>Payment – INV-{j.number}{j.paymentMethod ? ` (${PAYMENT_LABEL[j.paymentMethod] ?? 'other'})` : ''}</td><td style={{ textAlign: 'right' }}>−{money(st.total(j))}</td></tr>)}
              </tbody>
            </table>
          </>
        )}

        {s.bsb && s.accountNumber && (
          <p className="small"><strong>Pay by bank transfer:</strong> {s.accountName || s.businessName} · BSB {s.bsb} · Account {s.accountNumber}{s.bankName ? ` · ${s.bankName}` : ''}. Please use your invoice numbers as the reference.</p>
        )}
      </article>
    </div>
  );
}

/** All account customers and what they owe – the starting point for monthly statements. */
export function Statements() {
  const s = useSettings();
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? [];
  const jobs = useLiveQuery(() => db.jobs.where('status').equals('invoiced').toArray(), []) ?? [];
  const accounts = customers.filter((c) => c.account?.enabled);
  const owing = (c: Customer) => jobs.filter((j) => j.customerId === c.id);
  const sum = (list: Job[]) => list.reduce((t, j) => t + totals(j.lineItems, s.gstRegistered).total, 0);
  const overdue = (c: Customer) => owing(c).filter((j) => j.invoicedAt && Date.now() > invoiceDue(j.invoicedAt, s.paymentTermsDays, c.account).getTime());
  return (
    <>
      <PageHeader back title="Account customers" />
      <p className="small muted" style={{ marginTop: 0 }}>Fleet and business customers who pay on terms. Open one for their monthly statement.</p>
      {!accounts.length ? (
        <Empty>No account customers yet. Open a customer and tick <strong>Account customer</strong> to set their terms (e.g. 30 days end of month).</Empty>
      ) : accounts.sort((a, b) => sum(owing(b)) - sum(owing(a))).map((c) => (
        <Link key={c.id} to={`/customers/${c.id}/statement`} className="card row between">
          <span><strong>{c.name}</strong><br /><span className="small muted">{termsLabel(c.account)}{c.account?.requirePO ? ' · PO required' : ''}</span></span>
          <span style={{ textAlign: 'right' }}>
            <strong>{money(sum(owing(c)))}</strong>
            {overdue(c).length > 0 && <><br /><span className="small" style={{ color: 'var(--danger)' }}>{money(sum(overdue(c)))} overdue</span></>}
          </span>
        </Link>
      ))}
    </>
  );
}
