import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { useCloud } from '../cloud/CloudProvider';

const SUPPORT_EMAIL = 'hello@spannr.au';

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: 'How do I send a quote the customer can approve?', a: <>Add labour and parts on the job's <strong>Billing</strong> tab, then <strong>Send quote to approve</strong>. They get a link, tick the repairs they want and sign – you get a notification straight away. Tap <strong>Apply</strong> on the job to book it in.</> },
  { q: 'How do customers pay by card?', a: <>Set up <Link to="/settings/payments">Card payments</Link> once. Then on any job, <strong>Send invoice – pay by card</strong> texts a pay link (card, Apple Pay, Google Pay) – the job marks itself paid when they pay. On iPhone you can also take <strong>Tap to Pay</strong> in person.</> },
  { q: 'How do automatic texts work?', a: <>Turn them on in <Link to="/settings?s=messages">Automatic messages</Link>: booking confirmations, reminders, unpaid-invoice reminders, Google review requests and service reminders. They come from Spannr with your business name, never at night, and customers can reply – replies land in <Link to="/messages">Messages</Link>.</> },
  { q: 'How are texts counted?', a: <>Each 160 characters is one text (70 if it has emoji). Your plan's monthly allowance is in Automatic messages; Spannr keeps texts short and shows "uses 2" before you send a long one.</> },
  { q: 'Can I bring my customers and history from another app?', a: <>Yes – <Link to="/settings/import">Import from ServiceM8</Link> takes the Client List and Job List exports (customers, cars and past jobs), or any spreadsheet with names, phones and emails.</> },
  { q: 'How do service reminders work?', a: <>When you finish a job with "service" in it, the car's next service is set automatically (your interval is in Inspections &amp; service reminders). Due cars show in <Link to="/reminders">Reminders</Link>; with automatic service reminders on, Spannr texts them for you and moves them to <strong>Sent</strong>, ready to book.</> },
  { q: 'How do I add technicians?', a: <>Settings → <Link to="/settings/team">Team</Link> → invite by email. Technicians get a simple app with just their jobs, checklists, photos and the job clock.</> },
  { q: 'Does it work without signal?', a: <>Yes. Everything saves on your phone and uploads when you're back in signal – the badge at the top shows anything waiting.</> },
  { q: 'How do I put Spannr on my computer?', a: <>Use the <strong>Install Spannr</strong> button at the bottom of the sidebar (Chrome or Edge), or in Safari choose File → Add to Dock. It opens in its own window and updates itself.</> },
  { q: 'Is my data safe and backed up?', a: <>Your data is stored securely in the cloud (over encrypted connections) and on your devices. You can also download a full copy any time in <Link to="/settings?s=backup">Backup</Link>.</> },
];

/** Settings → Help & support: quick answers and how to reach us. */
export default function Help() {
  const { email, businessName } = useCloud();
  const mail = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Spannr help – ${businessName}`)}&body=${encodeURIComponent(`\n\n—\nBusiness: ${businessName}\nLogin: ${email}`)}`;
  return (
    <>
      <PageHeader back title="Help & support" />
      <section className="card">
        <h2>Talk to us</h2>
        <p className="small" style={{ marginTop: 0 }}>Real people who know workshops. We usually reply the same day.</p>
        <div className="row wrap">
          <a className="btn primary" href={mail}>✉ Email {SUPPORT_EMAIL}</a>
        </div>
      </section>
      <section className="card">
        <h2>Quick answers</h2>
        {FAQ.map((f) => (
          <details key={f.q} className="faq">
            <summary>{f.q}</summary>
            <p className="small">{f.a}</p>
          </details>
        ))}
      </section>
    </>
  );
}
