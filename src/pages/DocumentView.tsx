import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';
import { brandVars } from '../brand';
import { BATTERY_RESULTS, readingsText } from '../inspection';
import { db } from '../db';
import { useSettings } from '../hooks';
import type { CheckItem } from '../types';
import { CHECK_LABEL, fmtDate, fmtDay, money, PAYMENT_LABEL, totals, vehicleLabel, invoiceDue, termsLabel } from '../utils';

function InspectionTable({ items, onlyFlagged }: { items: CheckItem[]; onlyFlagged?: boolean }) {
  const rows = items.filter((i) => i.result && (!onlyFlagged || i.result === 'attention' || i.result === 'urgent'));
  if (!rows.length) return null;
  return (
    <table className="doc-table check-table">
      <tbody>
        {rows.map((i) => (
          <tr key={i.id}>
            <td>
              {i.label}
              {readingsText(i) && <div className="small"><strong>{readingsText(i)}</strong></div>}
              {i.note && <div className="small muted">{i.note}</div>}
            </td>
            <td>
              <span className="check-pill" style={{ background: CHECK_LABEL[i.result].color }}>
                {i.kind === 'battery' ? BATTERY_RESULTS.find((r) => r.result === i.result)?.label ?? CHECK_LABEL[i.result].label : CHECK_LABEL[i.result].label}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DocumentView() {
  const { id = '', docType } = useParams();
  const navigate = useNavigate();
  const s = useSettings();
  const data = useLiveQuery(async () => {
    const job = await db.jobs.get(id);
    if (!job) return null;
    const customer = job.customerId ? await db.customers.get(job.customerId) : undefined;
    const vehicle = job.vehicleId ? await db.vehicles.get(job.vehicleId) : undefined;
    return { job, customer, vehicle };
  }, [id]);

  if (data === undefined) return null;
  if (data === null) return <p className="empty">Job not found.</p>;

  const { job, customer, vehicle } = data;
  const isInvoice = docType === 'invoice';
  const isReport = docType === 'report';
  const title = isReport ? 'Inspection Report' : isInvoice ? (s.gstRegistered ? 'Tax Invoice' : 'Invoice') : 'Quote';
  const checklist = job.checklist ?? [];
  const flagged = checklist.filter((i) => i.result === 'attention' || i.result === 'urgent');
  const issued = (isInvoice ? job.invoicedAt : '') || new Date().toISOString();
  const due = invoiceDue(issued, s.paymentTermsDays, customer?.account).toISOString();
  const t = totals(job.lineItems, s.gstRegistered);
  const docName = `${title} ${job.number}${customer ? ` - ${customer.name}` : ''}`;

  async function share() {
    const text = isReport
      ? `${docName}\n${flagged.length ? flagged.map((i) => `• ${i.label}: ${CHECK_LABEL[i.result].label}${i.note ? ` – ${i.note}` : ''}`).join('\n') : 'All checked items OK.'}`
      : `${docName}\nTotal: ${money(t.total)}${isInvoice ? `\nDue: ${fmtDate(due)}` : ''}`;
    if (navigator.share) {
      try { await navigator.share({ title: docName, text }); } catch { /* cancelled */ }
    } else if (customer?.email) {
      location.href = `mailto:${customer.email}?subject=${encodeURIComponent(docName)}&body=${encodeURIComponent(text)}`;
    }
  }

  function print() {
    const prev = document.title;
    document.title = docName; // becomes the default PDF file name
    window.print();
    document.title = prev;
  }

  return (
    <div className="doc-page">
      <div className="doc-toolbar no-print">
        <button className="btn" onClick={() => navigate(-1)}>← Back</button>
        <button className="btn primary" onClick={print}>Print / Save PDF</button>
        <button className="btn" onClick={share}>Share</button>
      </div>

      <article className="doc" style={brandVars(s.brandColor)}>
        <header className="doc-head">
          <div>
            {s.logo && <img src={s.logo} alt="" className="doc-logo" />}
            <h2>{s.businessName}</h2>
            <div className="small">
              {s.abn && <div>ABN {s.abn}</div>}
              {s.address && <div>{s.address}</div>}
              {[s.phone, s.email].filter(Boolean).join(' · ')}
              {s.website && <div>{s.website}</div>}
            </div>
          </div>
          <div className="doc-meta">
            <h1>{title}</h1>
            <div><span>Number</span> {isReport ? 'JOB' : isInvoice ? 'INV' : 'Q'}-{job.number}</div>
            <div><span>Date</span> {fmtDate(issued)}</div>
            {job.poNumber && <div><span>PO</span> {job.poNumber}</div>}
            {isInvoice && customer?.account?.enabled && <div><span>Terms</span> {termsLabel(customer.account)}</div>}
            {isInvoice && job.status !== 'paid' && <div><span>Due</span> {fmtDate(due)}</div>}
          </div>
        </header>

        <section className="doc-parties">
          <div>
            <h3>{isInvoice ? 'Bill to' : 'Customer'}</h3>
            {customer ? (
              <>
                <strong>{customer.name}</strong>
                {customer.address && <div>{customer.address}</div>}
                {customer.phone && <div>{customer.phone}</div>}
                {customer.email && <div>{customer.email}</div>}
              </>
            ) : <div>—</div>}
          </div>
          {vehicle && (
            <div>
              <h3>Vehicle</h3>
              <strong>{vehicleLabel(vehicle)}</strong>
              {vehicle.vin && <div>VIN {vehicle.vin}</div>}
              {(job.odometer || vehicle.odometer) && <div>Odometer {job.odometer || vehicle.odometer} km</div>}
            </div>
          )}
        </section>

        {(job.title || job.description) && (
          <section>
            <h3>{job.title || 'Job'}</h3>
            {job.description && <p className="pre">{job.description}</p>}
          </section>
        )}

        {isReport ? (
          <section>
            <h3>Inspection results</h3>
            <p className="small">
              {flagged.length
                ? `${flagged.length} item${flagged.length === 1 ? '' : 's'} need attention. Urgent items should be fixed as soon as possible for safety.`
                : 'No issues found in the items checked.'}
            </p>
            <InspectionTable items={checklist} />
            {job.workNotes && (<><h3>Technician notes</h3><p className="pre">{job.workNotes}</p></>)}
            {vehicle?.nextServiceDate && <p><strong>Next service due:</strong> {fmtDay(vehicle.nextServiceDate)}{vehicle.nextServiceKm && ` or ${vehicle.nextServiceKm} km`}, whichever comes first.</p>}
          </section>
        ) : (<>
        <table className="doc-table">
          <thead>
            <tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {job.lineItems.map((i) => (
              <tr key={i.id}>
                <td>{i.description || (i.type === 'labour' ? 'Labour' : 'Item')}</td>
                <td>{i.qty}</td>
                <td>{money(i.unitPrice)}</td>
                <td>{money(i.qty * i.unitPrice)}</td>
              </tr>
            ))}
            {!job.lineItems.length && <tr><td colSpan={4} className="muted">No items</td></tr>}
          </tbody>
        </table>

        <div className="totals doc-totals">
          <div><span>Subtotal{s.gstRegistered ? ' (ex GST)' : ''}</span><span>{money(t.subtotal)}</span></div>
          {s.gstRegistered && <div><span>GST</span><span>{money(t.gst)}</span></div>}
          <div className="grand"><span>Total{s.gstRegistered ? ' (inc GST)' : ''}</span><span>{money(t.total)}</span></div>
          {isInvoice && job.status === 'paid' && (
            <div className="paid-stamp">PAID {fmtDate(job.paidAt)}{job.paymentMethod && ` · ${PAYMENT_LABEL[job.paymentMethod]}`}</div>
          )}
        </div>

        {isInvoice && job.workNotes && (
          <section>
            <h3>Work carried out</h3>
            <p className="pre">{job.workNotes}</p>
          </section>
        )}

        {isInvoice && flagged.length > 0 && (
          <section>
            <h3>Recommended work</h3>
            <InspectionTable items={checklist} onlyFlagged />
          </section>
        )}

        {isInvoice && vehicle?.nextServiceDate && (
          <p><strong>Next service due:</strong> {fmtDay(vehicle.nextServiceDate)}{vehicle.nextServiceKm && ` or ${vehicle.nextServiceKm} km`}</p>
        )}

        {isInvoice && job.status !== 'paid' && (s.bsb || s.accountNumber) && (
          <section className="doc-pay">
            <h3>How to pay</h3>
            <div>Direct deposit{s.bankName && ` – ${s.bankName}`}</div>
            {s.accountName && <div>Account name: {s.accountName}</div>}
            <div>BSB: {s.bsb} &nbsp; Account: {s.accountNumber}</div>
            <div>Reference: INV-{job.number}</div>
          </section>
        )}

        </>)}

        {job.signature && (
          <section className="doc-sign">
            <h3>Customer sign-off</h3>
            <img src={job.signature} alt="Customer signature" />
            <div className="small">{job.signedName}{job.signedAt && ` · ${fmtDate(job.signedAt)}`}</div>
          </section>
        )}

        <footer className="doc-foot">{isReport ? `Thank you for choosing ${s.businessName}.` : isInvoice ? s.invoiceFooter : s.quoteFooter}</footer>
      </article>
    </div>
  );
}
