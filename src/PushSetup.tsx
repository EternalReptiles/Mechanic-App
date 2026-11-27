import { PushNotifications } from '@capacitor/push-notifications';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCloud } from './cloud/CloudProvider';
import { supabase } from './cloud/supabase';
import { isNative, platform } from './native';

let listenersAdded = false;

/**
 * iPhone/Android app: asks to send notifications (new customer texts, payments), registers this phone with
 * the business, and opens the right screen when a notification is tapped.
 */
export default function PushSetup() {
  const { businessId } = useCloud();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative || !businessId) return;
    let cancelled = false;
    (async () => {
      if (!listenersAdded) {
        listenersAdded = true;
        await PushNotifications.addListener('registration', ({ value }) => {
          void supabase.rpc('register_push_device', { bid: businessId, p_token: value, p_platform: platform }).then(({ error }) => {
            if (error) console.warn('Push registration not saved', error.message);
          });
        });
        await PushNotifications.addListener('registrationError', (e) => console.warn('Push registration failed', e));
        await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
          const url = (notification.data as { url?: string } | undefined)?.url;
          if (url && url.startsWith('/')) navigate(url);
        });
      }
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        await new Promise((r) => setTimeout(r, 2500)); // let the app settle before iOS asks
        if (cancelled) return;
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive === 'granted') await PushNotifications.register();
    })().catch((e) => console.warn('Push setup skipped', e));
    return () => {
      cancelled = true;
    };
  }, [businessId, navigate]);

  return null;
}
