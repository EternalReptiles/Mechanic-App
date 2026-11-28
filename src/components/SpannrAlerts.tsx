import { useEffect, useState } from 'react';
import { supabase } from '../cloud/supabase';

type Alerts = {
  clicksend?: { balance?: number; currency?: string; low?: boolean; failed_credit_24h?: number; checked_at?: string };
  threshold?: number;
} | null;

/** Spannr's own ClickSend credit (only Spannr admins get anything back from the server). */
export function useSpannrAlerts() {
  const [a, setA] = useState<Alerts>(null);
  useEffect(() => {
    if (!navigator.onLine) return;
    void supabase.rpc('spannr_alerts').then(({ data }) => setA((data as Alerts) ?? null));
  }, []);
  return a;
}

/** Red banner when ClickSend is low or out of credit, so customer texts never quietly stop. */
export default function SpannrAlerts() {
  const a = useSpannrAlerts();
  const cs = a?.clicksend;
  if (!cs?.low) return null;
  const failed = cs.failed_credit_24h ?? 0;
  return (
    <a className="banner attention" href="https://dashboard.clicksend.com/" target="_blank" rel="noreferrer">
      <span>
        ⚠ <strong>{failed ? `${failed} text${failed > 1 ? 's' : ''} failed – ClickSend is out of credit.` : `ClickSend credit is low: $${(cs.balance ?? 0).toFixed(2)} left.`}</strong>{' '}
        Top up so customer texts keep going out (only you see this – it's Spannr's account).
      </span>
      <span>Top up ›</span>
    </a>
  );
}
