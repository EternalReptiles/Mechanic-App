import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { useSettings } from '../hooks';
import type { Job } from '../types';
import { money, totals } from '../utils';
import { cancelTap, tapToPayAvailable, tapToPayForJob } from './tapToPay';

/** "Tap to Pay" on the job: the customer taps their card, phone or watch on the mechanic's phone. */
export default function TapToPay({ job, businessName, onPaid }: { job: Job; businessName: string; onPaid: (paidAt: string) => void }) {
  const { businessId } = useCloud();
  const settings = useSettings();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  if (!tapToPayAvailable) return null;
  const total = totals(job.lineItems, settings.gstRegistered).total;

  async function tap() {
    setErr('');
    if (!navigator.onLine) return setErr("You're offline. Tap to Pay needs signal.");
    setState('busy');
    setMsg('Getting ready…');
    try {
      const r = await tapToPayForJob(businessId, businessName, job.id);
      if (r.status !== 'succeeded') throw new Error('The payment did not go through.');
      setState('done');
      setMsg(`✓ Paid ${money((r.amount ?? 0) / 100)} by card. The receipt is on its way to the customer.`);
      onPaid(r.paidAt ?? new Date().toISOString());
    } catch (e) {
      setState('idle');
      setErr((e as Error).message);
    }
  }

  if (state === 'done') return <p className="paid-note">{msg}</p>;
  return (
    <div className="tap-to-pay">
      <button className="btn primary block big" disabled={state === 'busy' || !job.lineItems.length || total <= 0} onClick={tap}>
        {state === 'busy' ? 'Waiting for the customer to tap…' : `📲 Tap to Pay – ${money(total)}`}
      </button>
      {state === 'busy' && (
        <button className="btn ghost block" onClick={() => void cancelTap()}>Cancel</button>
      )}
      {err && <p className="error">{err}</p>}
      <p className="muted small">The customer taps their card, phone or watch on this phone. No card reader needed.</p>
    </div>
  );
}
