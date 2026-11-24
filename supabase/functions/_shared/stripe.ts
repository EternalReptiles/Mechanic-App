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

const sha256 = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Copies the business's logo and brand colour (Spannr Settings) to its Stripe account, so Stripe
 * invoices, the payment page, receipts and PDFs carry the mechanic's branding. Skips if unchanged.
 */
export async function syncBranding(businessId: string, accountId: string, currentHash: string | null) {
  const { data } = await admin.from('settings').select('data').eq('business_id', businessId).eq('id', 'settings').maybeSingle();
  const s = (data?.data ?? {}) as Record<string, any>;
  const color = /^#[0-9a-f]{6}$/i.test(s.brandColor ?? '') ? s.brandColor : '#f59e0b';
  const logo = typeof s.logo === 'string' ? s.logo : '';
  const hash = await sha256(color + '|' + logo);
  if (hash === currentHash) return;

  const branding: Record<string, string> = { primary_color: color, secondary_color: '#0f172a' };
  const m = logo.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/);
  if (m) {
    const bytes = Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0));
    if (bytes.length <= 512 * 1024) {
      const file = await stripe.files.create(
        { purpose: 'business_logo', file: { data: bytes, name: 'logo.' + (m[2] === 'png' ? 'png' : 'jpg'), type: m[1] } } as any,
        { stripeAccount: accountId },
      );
      branding.logo = file.id;
    }
  }
  await stripe.accounts.update(accountId, { settings: { branding } });
  await admin.from('stripe_accounts').update({ branding_hash: hash }).eq('account_id', accountId);
}

/** Australian mobile in +61 format, or null. */
export function auMobile(phone: string | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (/^04\d{8}$/.test(d)) return '+61' + d.slice(1);
  if (/^614\d{8}$/.test(d)) return '+' + d;
  return null;
}

/** Queues a "payment received" text/email with the paid invoice link (sent by the messages pipeline). */
export async function queueReceipt(businessId: string, jobId: string, inv: { number?: string | null; total: number; hosted_invoice_url?: string | null }, paidAtIso: string) {
  const [{ data: st }, { data: job }] = await Promise.all([
    admin.from('settings').select('data').eq('business_id', businessId).eq('id', 'settings').maybeSingle(),
    admin.from('jobs').select('data').eq('business_id', businessId).eq('id', jobId).maybeSingle(),
  ]);
  const s = (st?.data ?? {}) as Record<string, any>;
  if (s.notify?.receiptEnabled === false) return;
  const customerId = (job?.data as Record<string, any> | undefined)?.customerId;
  if (!customerId) return;
  const { data: c } = await admin.from('customers').select('data').eq('business_id', businessId).eq('id', customerId).maybeSingle();
  const cust = (c?.data ?? {}) as Record<string, any>;
  if (cust.noAutoMessages) return;
  const business = String(s.businessName || 'us');
  const first = String(cust.name || '').trim().split(/\s+/)[0] || 'there';
  const amount = '$' + (inv.total / 100).toFixed(2);
  const body = `Hi ${first}, thanks for your payment of ${amount} to ${business} for ${inv.number ?? 'your invoice'}. Your paid invoice: ${inv.hosted_invoice_url ?? ''}`.trim();
  const rows = [] as Record<string, unknown>[];
  const sms = auMobile(cust.phone);
  if (sms) rows.push({ channel: 'sms', to_address: sms });
  if (cust.email) rows.push({ channel: 'email', to_address: String(cust.email).trim() });
  for (const r of rows) {
    await admin.from('notifications').insert({
      business_id: businessId, job_id: jobId, kind: 'receipt', booking_at: paidAtIso,
      subject: `Payment received – ${business}`, body, ...r,
    });
  }
}
