/** Spannr subscription plans (prices in AUD, +GST). Must match Stripe and the database rules. */
export type PlanKey = 'solo' | 'pro' | 'team' | 'business';
export type EffectivePlan = PlanKey | 'trial' | 'expired';
export type Feature = 'signoffs' | 'walkarounds' | 'autoMessages' | 'workshop' | 'tapToPay';

export const PLANS: Record<PlanKey, { name: string; monthly: number; users: number | null; sms: number; blurb: string; features: string[] }> = {
  solo: {
    name: 'Solo', monthly: 39, users: 1, sms: 0, blurb: 'For the one-person mobile mechanic.',
    features: ['1 user', 'Jobs, quotes & invoices', 'Customers, vehicles & schedule', 'Inspections, photos & signatures', 'Service reminders', 'Card payments (Stripe)'],
  },
  pro: {
    name: 'Pro', monthly: 65, users: 3, sms: 100, blurb: 'Win more work with customer approvals.',
    features: ['Up to 3 users', 'Everything in Solo', 'Remote quote approval & sign-off', 'Video walk-arounds', 'Automatic booking messages', '100 texts / month'],
  },
  team: {
    name: 'Team', monthly: 95, users: 8, sms: 300, blurb: 'For workshops with a few technicians.',
    features: ['Up to 8 users', 'Everything in Pro', 'Workshop board', 'Assign jobs to technicians', 'Tap to Pay on iPhone (coming soon)', '300 texts / month'],
  },
  business: {
    name: 'Business', monthly: 149, users: null, sms: 1000, blurb: 'Unlimited team, priority support.',
    features: ['Unlimited users', 'Everything in Team', '1,000 texts / month', 'Priority support'],
  },
};

export const PLAN_ORDER: PlanKey[] = ['solo', 'pro', 'team', 'business'];

const RANK: Record<EffectivePlan, number> = { expired: 0, solo: 1, pro: 2, team: 3, business: 4, trial: 4 };
const NEEDS: Record<Feature, PlanKey> = { signoffs: 'pro', walkarounds: 'pro', autoMessages: 'pro', workshop: 'team', tapToPay: 'team' };

export function planAllows(plan: EffectivePlan, feature: Feature): boolean {
  return RANK[plan] >= RANK[NEEDS[feature]];
}
export const neededPlan = (feature: Feature) => PLANS[NEEDS[feature]].name;

export interface PlanInfo {
  effective: EffectivePlan;
  plan: PlanKey | null;
  status: string | null;
  interval: 'month' | 'year' | null;
  trialEndsAt: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export const EMPTY_PLAN: PlanInfo = {
  effective: 'trial', plan: null, status: null, interval: null, trialEndsAt: null, periodEnd: null, cancelAtPeriodEnd: false,
};

export function daysLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

export function planLabel(p: PlanInfo): string {
  if (p.effective === 'trial') return `Free trial – ${daysLeft(p.trialEndsAt)} days left`;
  if (p.effective === 'expired') return 'Trial ended';
  return PLANS[p.effective].name;
}
