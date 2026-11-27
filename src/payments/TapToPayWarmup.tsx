import { useEffect } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { useSettings } from '../hooks';
import { tapToPayAvailable, warmTapToPay } from './terminal';

/**
 * Apple's guidelines: have Tap to Pay ready before the customer is waiting. Once it's been set up on this
 * phone, connect quietly when the app opens and whenever it comes back to the screen.
 */
export default function TapToPayWarmup() {
  const { businessId, can } = useCloud();
  const { businessName } = useSettings();
  const allowed = tapToPayAvailable && can('tapToPay');
  useEffect(() => {
    if (!allowed || !businessId) return;
    const warm = () => {
      if (document.visibilityState === 'visible') void warmTapToPay(businessId, businessName);
    };
    const t = window.setTimeout(warm, 1500);
    document.addEventListener('visibilitychange', warm);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', warm);
    };
  }, [allowed, businessId, businessName]);
  return null;
}
