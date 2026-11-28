/** Spannr subscription plans (prices in AUD, +GST). Must match Stripe and the database rules. */
export type PlanKey = 'solo' | 'pro' | 'team' | 'business';
export type EffectivePlan = PlanKey | 'trial' | 'expired';
export type Feature = 'signoffs' | 'walkarounds' | 'autoMessages' | 'workshop' | 'tapToPay';

export const PLANS: Record<PlanKey, { name: string; monthly: number; users: number | null; sms: number; rego: number; blurb: string; features: string[] }> = {
  solo: {
    name: 'Solo', monthly: 49, users: 1, sms: 50, rego: 30, blurb: 'For the one-person mobile mechanic.',
    features: ['1 user', 'Jobs, quotes & invoices', 'Customers, vehicles & schedule', 'Inspections, photos & signatures', 'Service reminders & customer pages', 'Card payments (Stripe)', 'AI notes & quotes', '50 texts & 30 rego lookups / month'],
  },
  pro: {
    name: 'Pro', monthly: 79, users: 3, sms: 150, rego: 100, blurb: 'Win more work with customer approvals.',
    features: ['Up to 3 users', 'Everything in Solo', 'Remote quote approval & sign-off', 'Video walk-arounds', 'Automatic texts: bookings, reminders, unpaid invoices, reviews', '150 texts & 100 rego lookups / month'],
  },
  team: {
    name: 'Team', monthly: 119, users: 8, sms: 400, rego: 200, blurb: 'For workshops with a few technicians.',
    features: ['Up to 8 users', 'Everything in Pro', 'Workshop board & timesheets', 'Assign jobs to technicians', 'Tap to Pay on iPhone (coming soon)', '400 texts & 200 rego lookups / month'],
  },
  business: {
    name: 'Business', monthly: 189, users: null, sms: 800, rego: 400, blurb: 'Unlimited team, priority support.',
    features: ['Unlimited users', 'Everything in Team', 'Fleet & account customers with statements', '800 texts & 400 rego lookups / month', 'Priority support'],
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
  /** Free, permanent access (e.g. Spannr's founding business) */
  complimentary?: boolean;
  /** Closed by the owner: kept 90 days, then deleted */
  closedAt?: string | null;
}

export const EMPTY_PLAN: PlanInfo = {
  effective: 'trial', plan: null, status: null, interval: null, trialEndsAt: null, periodEnd: null, cancelAtPeriodEnd: false,
};

export function daysLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

export function planLabel(p: PlanInfo): string {
  if (p.complimentary) return `${PLANS.business.name} (complimentary)`;
  if (p.effective === 'trial') return `Free trial – ${daysLeft(p.trialEndsAt)} days left`;
  if (p.effective === 'expired') return 'Trial ended';
  return PLANS[p.effective].name;
}
