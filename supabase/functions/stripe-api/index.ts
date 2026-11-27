// Spannr ⇄ Stripe Connect: set up card payments for a business and create repair invoices.
// Called from the app with the signed-in user's token: { action, businessId, ... }.
import { admin, APP_FEE_RATE, cardPaymentsStatus, cors, json, settleTerminalPayment, stripe, syncBranding } from '../_shared/stripe.ts';

type Ctx = { businessId: string; userEmail: string; isAdmin: boolean; origin: string };

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
    const origin = /^https?:\/\/[\w.:-]+$/.test(req.headers.get('Origin') ?? '') ? req.headers.get('Origin')! : (Deno.env.get('SPANNR_APP_URL') ?? '');
    const ctx: Ctx = { businessId, userEmail: user.email ?? '', isAdmin: ['owner', 'admin'].includes(member.role), origin };

    switch (body.action) {
      case 'status':
        return json(await status(ctx));
      case 'onboard':
        if (!ctx.isAdmin) return json({ error: 'Only the owner or an admin can set up card payments.' }, 403);
        return json(await onboard(ctx));
      case 'create_invoice':
        return json(await createInvoice(ctx, String(body.jobId ?? '')));
      case 'terminal_location':
        return json({ locationId: await terminalLocation(ctx) });
      case 'terminal_token':
        return json(await terminalToken(ctx));
      case 'terminal_payment':
        return json(await terminalPayment(ctx, String(body.jobId ?? '')));
      case 'terminal_complete':
        return json(await terminalComplete(ctx, String(body.paymentIntentId ?? '')));
      case 'subscribe':
        if (!ctx.isAdmin) return json({ error: 'Only the owner or an admin can change the plan.' }, 403);
        return json(await subscribe(ctx, String(body.plan ?? ''), String(body.interval ?? 'month'), String(body.promo ?? '')));
      case 'portal':
        if (!ctx.isAdmin) return json({ error: 'Only the owner or an admin can manage billing.' }, 403);
        return json(await portal(ctx));
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

/** The business's Stripe account (created once): takes card payments and pays Spannr's subscription. */
async function ensureAccount(ctx: Ctx) {
  const existing = await getRow(ctx.businessId);
  if (existing) return existing;
  const s = await settingsFor(ctx.businessId);
  const name = String(s.businessName || 'My business');
  const account = await stripe.v2.core.accounts.create({
    display_name: name,
    contact_email: ctx.userEmail || undefined,
    dashboard: 'full',
    identity: { country: 'au' },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
      // Lets the business pay Spannr's subscription from the same account.
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
  return { account_id: account.id, card_payments_status: 'pending', gst_tax_rate_id: null, branding_hash: null };
}

/** Creates the business's connected account (once) and an Account Session for embedded components. */
async function onboard(ctx: Ctx) {
  const row = await ensureAccount(ctx);
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

const PLANS = ['solo', 'pro', 'team', 'business'];

/** Stripe Checkout for a Spannr subscription, billed to the business's own Stripe account. */
async function subscribe(ctx: Ctx, plan: string, interval: string, promo = '') {
  if (!PLANS.includes(plan)) throw new Error('Unknown plan.');
  const lookup = `spannr_${plan}_${interval === 'year' ? 'yearly' : 'monthly'}`;
  const { data: biz } = await admin.from('businesses').select('plan, plan_status').eq('id', ctx.businessId).maybeSingle();
  if (biz?.plan && ['active', 'trialing', 'past_due'].includes(biz.plan_status ?? '')) {
    // Already subscribed: plan changes happen in the billing portal (with proration).
    return portal(ctx);
  }
  const row = await ensureAccount(ctx);
  const price = (await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 })).data[0];
  if (!price) throw new Error('That plan is not available.');
  const gst = (await stripe.taxRates.list({ active: true, limit: 100 })).data.find((r) => r.metadata?.spannr === 'gst');
  // A promo code from a link (e.g. ?promo=BUSINESS3) is applied for them; otherwise they can type one at checkout.
  let discounts: { promotion_code: string }[] | undefined;
  const code = promo.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (code) {
    const found = (await stripe.promotionCodes.list({ code, active: true, limit: 1 })).data[0];
    if (!found) throw new Error(`The promo code ${code.toUpperCase()} isn't valid or has expired.`);
    discounts = [{ promotion_code: found.id }];
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    ...(discounts ? { discounts } : { allow_promotion_codes: true }),
    customer_account: row.account_id,
    managed_payments: { enabled: false }, // Spannr is the seller and charges its own GST
    line_items: [{ price: price.id, quantity: 1 }],
    subscription_data: {
      default_tax_rates: gst ? [gst.id] : [],
      metadata: { spannr_business_id: ctx.businessId, spannr_plan: plan },
    },
    metadata: { spannr_business_id: ctx.businessId },
    success_url: `${ctx.origin}/settings/billing?done=1`,
    cancel_url: `${ctx.origin}/settings/billing`,
  } as any);
  return { url: session.url };
}

/** Stripe's billing portal: switch plan, update card, cancel, see invoices. */
async function portal(ctx: Ctx) {
  const row = await getRow(ctx.businessId);
  if (!row) throw new Error('No subscription yet.');
  const cfg = (await stripe.billingPortal.configurations.list({ limit: 100 })).data.find((c) => c.metadata?.spannr === 'portal');
  const session = await stripe.billingPortal.sessions.create({
    customer_account: row.account_id,
    configuration: cfg?.id,
    return_url: `${ctx.origin}/settings/billing`,
  } as any);
  return { url: session.url };
}

// ---------- Tap to Pay (Stripe Terminal, on the business's own Stripe account) ----------

async function requireTapToPayPlan(ctx: Ctx) {
  const { data: plan } = await admin.rpc('business_plan', { bid: ctx.businessId });
  if (!['team', 'business', 'trial'].includes(String(plan))) throw new Error('Tap to Pay is on the Team plan and above.');
}

async function activeAccount(ctx: Ctx) {
  const row = await getRow(ctx.businessId);
  if (!row) throw new Error('Set up card payments in Settings first.');
  if ((await cardPaymentsStatus(row.account_id)) !== 'active')
    throw new Error('Card payments are not active yet – finish setting up in Settings → Card payments.');
  return row as typeof row & { terminal_location_id?: string | null };
}

const STATES = 'NSW|VIC|QLD|SA|WA|TAS|NT|ACT';

/** The business's address for its Terminal location: from Stripe, or the address in Spannr Settings. */
async function locationAddress(ctx: Ctx, accountId: string) {
  const acct = (await stripe.accounts.retrieve(accountId)) as any;
  const a = acct.company?.address ?? acct.individual?.address ?? acct.business_profile?.support_address;
  if (a?.line1 && a?.city && a?.postal_code) return { line1: a.line1, line2: a.line2 || undefined, city: a.city, state: a.state || undefined, postal_code: a.postal_code, country: 'AU' };
  const s = await settingsFor(ctx.businessId);
  const m = String(s.address ?? '').replace(/\s+/g, ' ').trim().match(new RegExp(`^(.+?),\\s*([^,]+?),?\\s+(${STATES})\\s+(\\d{4})(,?\\s*Australia)?$`, 'i'));
  if (!m) throw new Error('Add your full business address in Settings first (e.g. 12 Main St, Newcastle NSW 2300) – Tap to Pay needs it.');
  return { line1: m[1], city: m[2], state: m[3].toUpperCase(), postal_code: m[4], country: 'AU' };
}

/** The business's Terminal location (created once from its address). */
async function terminalLocation(ctx: Ctx) {
  const row = await activeAccount(ctx);
  if (row.terminal_location_id) return row.terminal_location_id;
  const s = await settingsFor(ctx.businessId);
  const loc = await stripe.terminal.locations.create({
    display_name: String(s.businessName || 'My business').slice(0, 100),
    address: await locationAddress(ctx, row.account_id),
    metadata: { spannr_business_id: ctx.businessId },
  } as any, { stripeAccount: row.account_id });
  await admin.from('stripe_accounts').update({ terminal_location_id: loc.id }).eq('business_id', ctx.businessId);
  return loc.id;
}

/** A one-time Terminal connection token for the business's Stripe account. */
async function terminalToken(ctx: Ctx) {
  const locationId = await terminalLocation(ctx);
  const row = await getRow(ctx.businessId);
  const token = await stripe.terminal.connectionTokens.create({ location: locationId }, { stripeAccount: row!.account_id });
  return { secret: token.secret, locationId };
}

/** Job total in cents, same as the invoice: lines (+10% GST when registered). */
async function jobForPayment(ctx: Ctx, jobId: string) {
  const { data: jobRow } = await admin.from('jobs').select('data, deleted').eq('business_id', ctx.businessId).eq('id', jobId).maybeSingle();
  if (!jobRow || jobRow.deleted) throw new Error('Job not found – make sure it has synced (check the sync badge).');
  const job = jobRow.data as Record<string, any>;
  if (job.status === 'paid') throw new Error('This job is already marked as paid.');
  const lines = (job.lineItems ?? []) as { qty: number; unitPrice: number }[];
  if (!lines.length) throw new Error('Add labour and parts to the job first.');
  const s = await settingsFor(ctx.businessId);
  const subtotal = lines.reduce((sum, l) => sum + cents((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)), 0);
  const total = s.gstRegistered !== false ? Math.round(subtotal * 1.1) : subtotal;
  if (total < 50) throw new Error('The job total must be at least $0.50.');
  return { job, total, businessName: String(s.businessName || '') };
}

/** Creates the in-person PaymentIntent for a job (Spannr's fee taken from it). */
async function terminalPayment(ctx: Ctx, jobId: string) {
  await requireTapToPayPlan(ctx);
  const row = await activeAccount(ctx);
  const opt = { stripeAccount: row.account_id };
  const { job, total, businessName } = await jobForPayment(ctx, jobId);
  const appFee = Math.round(total * APP_FEE_RATE);
  const pi = await stripe.paymentIntents.create({
    amount: total,
    currency: 'aud',
    allowed_payment_method_types: ['card_present'],
    capture_method: 'automatic',
    application_fee_amount: appFee || undefined,
    description: [`Job #${job.number}`, job.title].filter(Boolean).join(' – '),
    statement_descriptor_suffix: businessName ? businessName.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 22) || undefined : undefined,
    metadata: { spannr_job_id: jobId, spannr_business_id: ctx.businessId, spannr_job_number: String(job.number ?? '') },
  }, opt);
  await admin.from('stripe_terminal_payments').insert({
    id: pi.id, business_id: ctx.businessId, job_id: jobId, account_id: row.account_id,
    amount: total, application_fee: appFee, status: pi.status,
  });
  return { clientSecret: pi.client_secret, id: pi.id, amount: total };
}

/** Called after the tap: checks the payment with Stripe and marks the job paid. */
async function terminalComplete(ctx: Ctx, paymentIntentId: string) {
  const { data: rec } = await admin.from('stripe_terminal_payments').select('*').eq('id', paymentIntentId).eq('business_id', ctx.businessId).maybeSingle();
  if (!rec) throw new Error('Payment not found.');
  return settleTerminalPayment(rec.account_id, paymentIntentId);
}
