// Spannr ⇄ Stripe Connect: set up card payments for a business and create repair invoices.
// Called from the app with the signed-in user's token: { action, businessId, ... }.
import { admin, APP_FEE_RATE, cardPaymentsStatus, cors, json, stripe, syncBranding } from '../_shared/stripe.ts';

type Ctx = { businessId: string; userEmail: string; isAdmin: boolean };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const body = await req.json();
    const businessId = String(body.businessId ?? '');
    const { data: member } = await admin
      .from('members').select('role').eq('business_id', businessId).eq('user_id', user.id).maybeSingle();
    if (!member) return json({ error: 'You are not a member of this business.' }, 403);
    const ctx: Ctx = { businessId, userEmail: user.email ?? '', isAdmin: ['owner', 'admin'].includes(member.role) };

    switch (body.action) {
      case 'status':
        return json(await status(ctx));
      case 'onboard':
        if (!ctx.isAdmin) return json({ error: 'Only the owner or an admin can set up card payments.' }, 403);
        return json(await onboard(ctx));
      case 'create_invoice':
        return json(await createInvoice(ctx, String(body.jobId ?? '')));
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    const err = e as { message?: string; raw?: { message?: string } };
    console.error(e);
    return json({ error: err.raw?.message || err.message || 'Something went wrong' }, 400);
  }
});

async function getRow(businessId: string) {
  const { data } = await admin.from('stripe_accounts').select('*').eq('business_id', businessId).maybeSingle();
  return data as { account_id: string; card_payments_status: string; gst_tax_rate_id: string | null; branding_hash: string | null } | null;
}

async function settingsFor(businessId: string) {
  const { data } = await admin.from('settings').select('data').eq('business_id', businessId).eq('id', 'settings').maybeSingle();
  return (data?.data ?? {}) as Record<string, any>;
}

/** Is card payments set up? Refreshes the capability status from Stripe. */
async function status(ctx: Ctx) {
  const row = await getRow(ctx.businessId);
  if (!row) return { connected: false };
  const cardPayments = await cardPaymentsStatus(row.account_id);
  if (cardPayments !== row.card_payments_status) {
    await admin.from('stripe_accounts')
      .update({ card_payments_status: cardPayments, updated_at: new Date().toISOString() })
      .eq('business_id', ctx.businessId);
  }
  if (cardPayments === 'active') {
    try {
      await syncBranding(ctx.businessId, row.account_id, row.branding_hash);
    } catch (e) {
      console.error('branding sync failed', e);
    }
  }
  return { connected: true, accountId: row.account_id, cardPayments };
}

/** Creates the business's connected account (once) and an Account Session for embedded components. */
async function onboard(ctx: Ctx) {
  let row = await getRow(ctx.businessId);
  if (!row) {
    const s = await settingsFor(ctx.businessId);
    const name = String(s.businessName || 'My business');
    const account = await stripe.v2.core.accounts.create({
      display_name: name,
      contact_email: ctx.userEmail || undefined,
      dashboard: 'full',
      identity: { country: 'au' },
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        // Lets the business pay Spannr's subscription from the same account later.
        customer: { capabilities: { automatic_indirect_tax: { requested: true } } },
      },
      defaults: {
        currency: 'aud',
        locales: ['en-AU'],
        responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
      },
      metadata: { spannr_business_id: ctx.businessId },
    } as any, { idempotencyKey: `spannr-account-${ctx.businessId}` });
    await admin.from('stripe_accounts').insert({ business_id: ctx.businessId, account_id: account.id });
    row = { account_id: account.id, card_payments_status: 'pending', gst_tax_rate_id: null, branding_hash: null };
  }
  const session = await stripe.accountSessions.create({
    account: row.account_id,
    components: {
      account_onboarding: { enabled: true },
      notification_banner: { enabled: true },
      account_management: { enabled: true },
      payments: { enabled: true },
      payouts: { enabled: true },
    },
  });
  return { accountId: row.account_id, clientSecret: session.client_secret };
}

const cents = (n: number) => Math.round(n * 100);

/** Creates (or returns) a Stripe invoice for a job on the business's connected account. */
async function createInvoice(ctx: Ctx, jobId: string) {
  const row = await getRow(ctx.businessId);
  if (!row) throw new Error('Set up card payments in Settings first.');
  const cardPayments = await cardPaymentsStatus(row.account_id);
  if (cardPayments !== 'active') throw new Error('Card payments are not active yet – finish setting up in Settings → Card payments.');
  const opt = { stripeAccount: row.account_id };
  try {
    await syncBranding(ctx.businessId, row.account_id, row.branding_hash); // logo + colour on the Stripe invoice
  } catch (e) {
    console.error('branding sync failed', e);
  }

  const { data: jobRow } = await admin.from('jobs').select('data, deleted').eq('business_id', ctx.businessId).eq('id', jobId).maybeSingle();
  if (!jobRow || jobRow.deleted) throw new Error('Job not found – make sure it has synced (check the sync badge).');
  const job = jobRow.data as Record<string, any>;
  // Never ask a customer to pay for a job that's already been paid (e.g. cash or a card reader).
  if (job.status === 'paid') throw new Error('This job is already marked as paid, so no card invoice was sent.');
  const lines = (job.lineItems ?? []) as { description: string; qty: number; unitPrice: number }[];
  if (!lines.length) throw new Error('Add labour and parts to the job first.');
  if (!job.customerId) throw new Error('Add a customer to the job first.');
  const { data: custRow } = await admin.from('customers').select('data').eq('business_id', ctx.businessId).eq('id', job.customerId).maybeSingle();
  const cust = (custRow?.data ?? {}) as Record<string, any>;
  const s = await settingsFor(ctx.businessId);
  const gst = s.gstRegistered !== false;

  const subtotal = lines.reduce((sum, l) => sum + cents((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)), 0);
  const total = gst ? Math.round(subtotal * 1.1) : subtotal;

  // Reuse an open invoice for the same amount; replace it if the job has changed.
  const { data: existing } = await admin.from('stripe_invoices').select('*')
    .eq('business_id', ctx.businessId).eq('job_id', jobId).order('created_at', { ascending: false });
  const open = (existing ?? []).find((i) => i.status === 'open');
  if (open && open.total === total) return { id: open.id, url: open.hosted_invoice_url, number: open.number, total, reused: true };
  if (open) {
    await stripe.invoices.voidInvoice(open.id, {}, opt);
    await admin.from('stripe_invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', open.id);
  }

  // GST tax rate on the connected account (created once).
  let taxRateId = row.gst_tax_rate_id;
  if (gst && !taxRateId) {
    const tr = await stripe.taxRates.create(
      { display_name: 'GST', percentage: 10, inclusive: false, country: 'AU', jurisdiction: 'AU', tax_type: 'gst' }, opt);
    taxRateId = tr.id;
    await admin.from('stripe_accounts').update({ gst_tax_rate_id: taxRateId }).eq('business_id', ctx.businessId);
  }

  // The mechanic's customer, on the mechanic's own Stripe account.
  const { data: map } = await admin.from('stripe_customers').select('stripe_customer_id')
    .eq('business_id', ctx.businessId).eq('spannr_customer_id', job.customerId).maybeSingle();
  const customerFields = {
    name: cust.name || undefined,
    email: cust.email || undefined,
    phone: cust.phone || undefined,
    metadata: { spannr_customer_id: job.customerId },
  };
  let customerId = map?.stripe_customer_id as string | undefined;
  if (customerId) await stripe.customers.update(customerId, customerFields, opt);
  else {
    customerId = (await stripe.customers.create(customerFields, opt)).id;
    await admin.from('stripe_customers').insert({ business_id: ctx.businessId, spannr_customer_id: job.customerId, stripe_customer_id: customerId });
  }

  const attempt = (existing ?? []).length;
  const number = `INV-${job.number}${attempt ? `-${attempt + 1}` : ''}`;
  const appFee = Math.round(total * APP_FEE_RATE);
  const invoice = await stripe.invoices.create({
    customer: customerId,
    number,
    collection_method: 'send_invoice',
    days_until_due: Number(s.paymentTermsDays) || 7,
    auto_advance: false,
    pending_invoice_items_behavior: 'exclude',
    default_tax_rates: gst && taxRateId ? [taxRateId] : [],
    application_fee_amount: appFee || undefined,
    description: [`Job #${job.number}`, job.title].filter(Boolean).join(' – '),
    footer: s.invoiceFooter || undefined,
    metadata: { spannr_job_id: jobId, spannr_business_id: ctx.businessId },
  }, opt);
  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      currency: 'aud',
      amount: cents(qty * (Number(l.unitPrice) || 0)),
      description: `${l.description || 'Item'}${qty !== 1 ? ` × ${qty}` : ''}`,
    }, opt);
  }
  const fin = await stripe.invoices.finalizeInvoice(invoice.id, {}, opt);
  // Stripe emails the invoice and sends reminders (per the business's Dashboard settings) when there's an email.
  if (cust.email) await stripe.invoices.sendInvoice(fin.id, {}, opt);

  await admin.from('stripe_invoices').insert({
    id: fin.id, business_id: ctx.businessId, job_id: jobId, account_id: row.account_id,
    number: fin.number, status: fin.status, total: fin.total, hosted_invoice_url: fin.hosted_invoice_url,
    application_fee: appFee, last_event: 'created',
  });
  return { id: fin.id, url: fin.hosted_invoice_url, number: fin.number, total: fin.total, emailed: !!cust.email };
}
