// Shared Stripe + Supabase clients for Spannr's Edge Functions (Deno).
import Stripe from 'npm:stripe@23.2.0';
import { createClient } from 'npm:@supabase/supabase-js@2.47.10';

/** One Stripe client instance (no global API key). fetch-based for Deno. */
export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  httpClient: Stripe.createFetchHttpClient(),
});

/** Service-role database client: bypasses row-level security, server-side only. */
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

/** Spannr's fee on each card payment, as a fraction (default 0.5%). */
export const APP_FEE_RATE = Number(Deno.env.get('SPANNR_APP_FEE_PERCENT') ?? '0.5') / 100;

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** v2 capability status for taking card payments on direct charges. */
export async function cardPaymentsStatus(accountId: string): Promise<string> {
  const acct = await stripe.v2.core.accounts.retrieve(accountId, { include: ['configuration.merchant'] });
  return acct.configuration?.merchant?.capabilities?.card_payments?.status ?? 'unknown';
}

/** Marks a job paid by card (the change syncs to every device). */
export async function markJobPaid(businessId: string, jobId: string, paidAtIso: string) {
  const { data: job } = await admin.from('jobs').select('data').eq('business_id', businessId).eq('id', jobId).maybeSingle();
  if (!job) return;
  const d = job.data as Record<string, unknown>;
  // Stripe is the record of truth for a card payment: use its method and time, even if the
  // job was already marked paid by hand.
  if (d.status === 'paid' && d.paymentMethod === 'card' && d.paidAt === paidAtIso) return;
  const next = {
    ...d,
    status: 'paid',
    paymentMethod: 'card',
    paidAt: paidAtIso,
    invoicedAt: d.invoicedAt || paidAtIso,
  };
  await admin.from('jobs').update({ data: next, updated_at: Date.now() }).eq('business_id', businessId).eq('id', jobId);
}
