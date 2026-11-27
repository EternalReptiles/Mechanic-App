import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import ContactlessIcon from './ContactlessIcon';
import { isEnabledHere, TAP_TO_PAY_NAME, tapToPayAvailable } from './terminal';

const seenKey = (bid: string) => `spannr-ttp-intro-${bid}`;

/**
 * Full-screen introduction shown once to every eligible business (Apple 3.2 / 3.3 / 6.2): businesses on a plan with
 * Tap to Pay, using the iPhone app, that haven't turned it on yet.
 */
export default function TapToPayIntro() {
  const { businessId, can } = useCloud();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!tapToPayAvailable || !can('tapToPay') || isEnabledHere(businessId)) return;
    try {
      if (localStorage.getItem(seenKey(businessId))) return;
    } catch {
      return;
    }
    const t = window.setTimeout(() => setShow(true), 1200);
    return () => window.clearTimeout(t);
  }, [businessId, can]);

  if (!show) return null;
  const close = () => {
    try { localStorage.setItem(seenKey(businessId), new Date().toISOString()); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div className="ttp-intro" role="dialog" aria-modal="true" aria-label={`Introducing ${TAP_TO_PAY_NAME}`}>
      <div className="ttp-intro-inner">
        <div className="ttp-intro-icon"><ContactlessIcon size={64} /></div>
        <h1>Accept contactless payments with {TAP_TO_PAY_NAME}</h1>
        <p>
          Take payment on the spot with just your iPhone – no extra hardware needed. Customers tap their contactless card, iPhone,
          Apple Watch or other digital wallet, right at the car.
        </p>
        <ul>
          <li>Get paid before you leave the job</li>
          <li>Secure – card details aren't stored on your iPhone</li>
          <li>The receipt goes to the customer automatically</li>
        </ul>
        <button className="btn primary block big" onClick={() => {
          close();
          void supabase.from('stripe_accounts').select('card_payments_status').eq('business_id', businessId).maybeSingle()
            .then(({ data }) => navigate(data?.card_payments_status === 'active' ? '/settings/tap-to-pay?enable=1' : '/settings/payments'));
        }}>
          Enable {TAP_TO_PAY_NAME}
        </button>
        <button className="btn ghost block" onClick={close}>Not now</button>
        <p className="small muted">You can turn it on any time in Settings → {TAP_TO_PAY_NAME}.</p>
      </div>
    </div>
  );
}
