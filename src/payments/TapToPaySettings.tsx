import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import Upgrade from '../components/Upgrade';
import { PageHeader } from '../components/ui';
import { useSettings } from '../hooks';
import { platform } from '../native';
import ContactlessIcon from './ContactlessIcon';
import { TapToPayProgress } from './TapToPay';
import {
  deviceSupport,
  enableTapToPay,
  isAccountLinked,
  isEnabledHere,
  showHowToTap,
  TAP_TO_PAY_NAME,
  tapToPayAvailable,
  friendlyTapError,
} from './terminal';

/** Settings → Tap to Pay on iPhone: turn it on for this phone, accept Apple's terms, learn how to tap. */
export default function TapToPaySettings() {
  const { businessId, can, isAdmin } = useCloud();
  const settings = useSettings();
  const [cardsActive, setCardsActive] = useState<boolean | null>(null);
  const [support, setSupport] = useState<{ supported: boolean; education: boolean; native: boolean } | null>(null);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(() => isEnabledHere(businessId));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get('enable') === '1' && !isEnabledHere(businessId) && isAdmin) void enable();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tapToPayAvailable) return;
    void supabase.from('stripe_accounts').select('card_payments_status').eq('business_id', businessId).maybeSingle()
      .then(({ data }) => setCardsActive(data?.card_payments_status === 'active'));
    void deviceSupport().then(setSupport);
    void isAccountLinked(businessId).then(setLinked);
  }, [businessId]);

  if (!tapToPayAvailable)
    return (
      <>
        <PageHeader back title="Tap to Pay on iPhone" />
        <p className="muted">Tap to Pay works in the Spannr iPhone app. Your customers tap their card, phone or watch on your iPhone – no card reader needed.</p>
      </>
    );

  async function enable() {
    setErr('');
    setMsg('');
    if (!navigator.onLine) return setErr("You're offline. Setting up Tap to Pay needs signal.");
    setBusy(true);
    try {
      await enableTapToPay(businessId, settings.businessName);
      setEnabled(true);
      setLinked(await isAccountLinked(businessId));
      setMsg(`✓ ${TAP_TO_PAY_NAME} is ready on this phone.`);
    } catch (e) {
      setErr(friendlyTapError(e) || "Tap to Pay couldn't be set up.");
    } finally {
      setBusy(false);
    }
  }

  const ready = enabled && linked !== false;

  return (
    <>
      <PageHeader back title={TAP_TO_PAY_NAME} />
      {!can('tapToPay') ? (
        <Upgrade feature="tapToPay" what={TAP_TO_PAY_NAME} />
      ) : (
        <section className="card ttp-setup">
          <div className="ttp-hero">
            <ContactlessIcon size={44} />
            <div>
              <h2 style={{ margin: 0 }}>Accept contactless payments on your {platform === 'ios' ? 'iPhone' : 'phone'}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                Customers tap their contactless card, iPhone, Apple Watch or other digital wallet on your phone. No extra hardware.
              </p>
            </div>
          </div>

          {cardsActive === false ? (
            <p className="notice small">First set up card payments: <Link to="/settings/payments">Settings → Card payments</Link>.</p>
          ) : support && !support.supported ? (
            <p className="notice small">This phone can't use {TAP_TO_PAY_NAME}. It needs an iPhone XS or later with the latest iOS.</p>
          ) : ready ? (
            <p className="paid-note">✓ {TAP_TO_PAY_NAME} is set up on this phone. Take payments from a job's Billing tab.</p>
          ) : (
            <p className="small">
              Set it up once on each phone. Apple will ask you to accept the {TAP_TO_PAY_NAME} terms with your Apple ID, then shows how customers tap.
            </p>
          )}

          {!isAdmin && !ready && (
            <p className="notice small">Only the business owner or an admin can accept the {TAP_TO_PAY_NAME} terms. Ask them to turn it on in Settings.</p>
          )}
          {busy && <TapToPayProgress />}
          {cardsActive !== false && support?.supported !== false && isAdmin && (
            <div className="row wrap">
              {!ready && (
                <button className="btn primary grow" disabled={busy || cardsActive === null} onClick={enable}>
                  {busy ? 'Setting up…' : `Enable ${TAP_TO_PAY_NAME}`}
                </button>
              )}
              {platform === 'ios' && support?.education && (
                <button className="btn grow" disabled={busy} onClick={() => {
                  setErr('');
                  showHowToTap().catch((e) => setErr((e as Error).message));
                }}>How to Tap</button>
              )}
            </div>
          )}
          {msg && <p className="paid-note">{msg}</p>}
          {support && !support.native && platform === 'ios' && (
            <p className="small muted">Note: this copy of the app is missing Spannr's iPhone add-on (Apple's How to Tap guide). Update the app from the Mac.</p>
          )}
          {err && <p className="error">{err}</p>}
          <p className="muted small" style={{ marginBottom: 0 }}>
            Payments go to your Stripe account. Stripe's card fees apply, plus a 0.5% Spannr fee.
          </p>
        </section>
      )}
    </>
  );
}
