import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { PageHeader } from '../components/ui';
import { stripeApi } from '../payments/api';
import { daysLeft, PLAN_ORDER, PLANS, planLabel, type PlanKey } from '../plans';
import { platform } from '../native';

// Apple doesn't allow buying a subscription outside the App Store from inside an iPhone app,
// so the iPhone app only shows the plan.
const VIEW_ONLY = platform === 'ios';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Settings → Plan & billing: choose a plan (Stripe Checkout) or manage it (Stripe billing portal). */
export default function Billing() {
  const { businessId, isAdmin, plan, refreshPlan } = useCloud();
  const [params] = useSearchParams();
  const [interval, setInterval] = useState<'month' | 'year'>(plan.interval ?? 'month');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const subscribed = !!plan.plan && ['active', 'trialing', 'past_due'].includes(plan.status ?? '');

  // Back from Stripe Checkout: the plan updates a moment later (via Stripe's notification).
  useEffect(() => {
    if (!params.get('done')) return;
    let n = 0;
    const t = window.setInterval(() => {
      void refreshPlan();
      if (++n > 10) window.clearInterval(t);
    }, 2000);
    return () => window.clearInterval(t);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  async function go(action: 'subscribe' | 'portal', planKey?: PlanKey) {
    setErr('');
    setBusy(planKey ?? action);
    try {
      const { url } = await stripeApi<{ url: string }>(action, businessId, { plan: planKey, interval, promo: params.get('promo') ?? '' });
      window.location.href = url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader back title="Plan & billing" />
      {params.get('done') && !subscribed && <p className="notice">Thanks! Confirming your subscription with Stripe…</p>}
      {params.get('promo') && !subscribed && !VIEW_ONLY && (
        <p className="notice">🎁 Promo code <strong>{params.get('promo')!.toUpperCase()}</strong> will be applied when you choose your plan.</p>
      )}

      <section className={`card plan-now ${plan.effective === 'expired' || plan.status === 'past_due' ? 'warn' : ''}`}>
        <div className="row between">
          <div>
            <div className="small muted">Current plan</div>
            <strong className="plan-name">{planLabel(plan)}</strong>
          </div>
          {subscribed && isAdmin && !VIEW_ONLY && (
            <button className="btn" disabled={!!busy} onClick={() => go('portal')}>{busy === 'portal' ? 'Opening…' : 'Manage billing'}</button>
          )}
        </div>
        {plan.effective === 'trial' && (
          <p className="small">Everything is unlocked during your trial. It ends on {fmt(plan.trialEndsAt)} ({daysLeft(plan.trialEndsAt)} days){VIEW_ONLY ? '.' : ' – choose a plan to keep going.'}</p>
        )}
        {plan.effective === 'expired' && <p className="small">Your free trial has ended. {VIEW_ONLY ? '' : 'Choose a plan to keep creating jobs and sending quotes.'}</p>}
        {plan.status === 'past_due' && <p className="small">⚠ Your last payment didn't go through. Tap Manage billing to update your card.</p>}
        {subscribed && plan.periodEnd && (
          <p className="small muted">
            {plan.cancelAtPeriodEnd ? `Cancels on ${fmt(plan.periodEnd)}` : `Renews ${fmt(plan.periodEnd)}`} · billed {plan.interval === 'year' ? 'yearly' : 'monthly'}
          </p>
        )}
      </section>

      {VIEW_ONLY ? (
        <p className="muted small">Plan changes aren't available in the iPhone app.</p>
      ) : (
      <>
      {!isAdmin && <p className="muted small">Only the owner or an admin can change the plan.</p>}
      {err && <p className="error">{err}</p>}

      <div className="seg two interval">
        <button className={interval === 'month' ? 'on solid' : ''} onClick={() => setInterval('month')}>Monthly</button>
        <button className={interval === 'year' ? 'on solid' : ''} onClick={() => setInterval('year')}>Yearly – 2 months free</button>
      </div>

      <div className="plans">
        {PLAN_ORDER.map((k) => {
          const p = PLANS[k];
          const current = subscribed && plan.plan === k;
          const price = interval === 'year' ? p.monthly * 10 : p.monthly;
          return (
            <section key={k} className={`card plan-card ${k === 'pro' ? 'popular' : ''} ${current ? 'current' : ''}`}>
              {k === 'pro' && <span className="tag">Most popular</span>}
              <h2>{p.name}</h2>
              <p className="small muted">{p.blurb}</p>
              <div className="price"><strong>${price}</strong><span>/{interval === 'year' ? 'year' : 'month'} + GST</span></div>
              <ul>{p.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
              {isAdmin && (
                current ? (
                  <button className="btn block" disabled>Current plan</button>
                ) : (
                  <button className="btn primary block" disabled={!!busy} onClick={() => go(subscribed ? 'portal' : 'subscribe', k)}>
                    {busy === k ? 'Opening Stripe…' : subscribed ? `Switch to ${p.name}` : `Choose ${p.name}`}
                  </button>
                )
              )}
            </section>
          );
        })}
      </div>
      <p className="muted small">Prices in AUD plus GST. One price per business. Cancel any time from Manage billing. Payments are handled securely by Stripe.</p>
      </>
      )}
    </>
  );
}
