import { loadConnectAndInitialize, type StripeConnectInstance } from '@stripe/connect-js';
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
  ConnectPayments,
} from '@stripe/react-connect-js';
import { useEffect, useMemo, useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { PageHeader } from '../components/ui';
import { STRIPE_PUBLISHABLE_KEY, stripeApi, type PaymentsStatus } from './api';

/** Settings → Card payments: Stripe's embedded onboarding and payments, inside Spannr. */
export default function CardPayments() {
  const { businessId, isAdmin } = useCloud();
  const [status, setStatus] = useState<PaymentsStatus | null>(null);
  const [err, setErr] = useState('');
  const [onboarding, setOnboarding] = useState(false);

  async function refresh() {
    setErr('');
    try {
      setStatus(await stripeApi<PaymentsStatus>('status', businessId));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect: StripeConnectInstance | null = useMemo(() => {
    // Embedded Stripe components are for owners/admins (account sessions are created server-side for them only).
    if (!STRIPE_PUBLISHABLE_KEY || !isAdmin || (!status?.connected && !onboarding)) return null;
    return loadConnectAndInitialize({
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      fetchClientSecret: async () => (await stripeApi<{ clientSecret: string }>('onboard', businessId)).clientSecret,
      appearance: { variables: { colorPrimary: '#f59e0b', borderRadius: '10px', fontFamily: 'system-ui, sans-serif' } },
    });
  }, [businessId, isAdmin, status?.connected, onboarding]);

  const active = status?.cardPayments === 'active';

  return (
    <>
      <PageHeader back title="Card payments" />
      {!STRIPE_PUBLISHABLE_KEY && <p className="error">Card payments aren't configured for this app yet.</p>}
      {err && <p className="error">{err}</p>}
      {!status && !err && <p className="muted">Checking…</p>}

      {status && (
        <section className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Stripe</h2>
            <span className={`pay-pill ${active ? 'on' : ''}`}>
              {active ? '✓ Taking card payments' : status.connected ? 'Setup not finished' : 'Not set up'}
            </span>
          </div>
          <p className="muted small">
            Customers pay your invoices by card, Apple Pay or Google Pay. Money goes straight to your bank account through Stripe.
            Stripe's card fees apply, plus a 0.5% Spannr fee per payment.
          </p>
          {!isAdmin && !active && <p className="small">Ask the owner or an admin to set up card payments.</p>}
          {isAdmin && !active && !onboarding && (
            <button className="btn primary block" onClick={() => setOnboarding(true)}>
              {status.connected ? 'Continue setting up card payments' : 'Set up card payments'}
            </button>
          )}
          {active && (
            <a className="btn block" href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">Open Stripe Dashboard</a>
          )}
        </section>
      )}

      {connect && (
        <ConnectComponentsProvider connectInstance={connect}>
          {status?.connected && <ConnectNotificationBanner />}
          {onboarding && !active && (
            <section className="card stripe-embed">
              <ConnectAccountOnboarding
                onExit={() => {
                  setOnboarding(false);
                  void refresh();
                }}
              />
            </section>
          )}
          {active && (
            <section className="card stripe-embed">
              <h2>Recent payments</h2>
              <ConnectPayments />
            </section>
          )}
        </ConnectComponentsProvider>
      )}
    </>
  );
}
