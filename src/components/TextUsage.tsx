import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';

type Allowance = { sms_allowance: number; sms_used: number };

/** This month's texts against the plan's allowance. */
export default function TextUsage() {
  const { businessId, isAdmin } = useCloud();
  const [a, setA] = useState<Allowance | null>(null);
  useEffect(() => {
    if (!navigator.onLine) return;
    void supabase.rpc('message_allowance', { bid: businessId }).then(({ data }) => setA((data as Allowance) ?? null));
  }, [businessId]);
  if (!a || a.sms_allowance <= 0) return null;
  const pct = Math.min(100, Math.round((a.sms_used / a.sms_allowance) * 100));
  const level = pct >= 100 ? 'out' : pct >= 80 ? 'low' : '';
  return (
    <div className={`text-usage wide ${level}`}>
      <div className="row between small">
        <strong>Texts this month</strong>
        <span>{a.sms_used} of {a.sms_allowance}</span>
      </div>
      <div className="usage-bar"><span style={{ width: `${pct}%` }} /></div>
      {level && (
        <p className="small" style={{ margin: '4px 0 0' }}>
          {level === 'out' ? 'All used – automatic texts are paused until the 1st (emails still send).' : 'Running low.'}{' '}
          {isAdmin && <Link to="/settings/billing">Upgrade for more</Link>}
        </p>
      )}
    </div>
  );
}
