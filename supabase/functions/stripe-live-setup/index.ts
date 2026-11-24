// ONE-OFF: sets up Spannr's plans, GST, billing portal and webhooks on whichever Stripe account
// STRIPE_SECRET_KEY belongs to. Protected by SPANNR_SETUP_TOKEN. Deleted after use.
import { stripe } from '../_shared/stripe.ts';

const PLANS = [
  { key: 'solo', name: 'Spannr Solo', desc: '1 user. Jobs, quotes, invoices, inspections, card payments.', monthly: 3900 },
  { key: 'pro', name: 'Spannr Pro', desc: 'Up to 3 users. Adds remote sign-offs, video walk-arounds and automatic messages (100 texts/month).', monthly: 6500 },
  { key: 'team', name: 'Spannr Team', desc: 'Up to 8 users. Adds workshop board, technician assignment and Tap to Pay (300 texts/month).', monthly: 9500 },
  { key: 'business', name: 'Spannr Business', desc: 'Unlimited users, 1,000 texts/month, priority support.', monthly: 14900 },
];
const WEBHOOK = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-webhook`;

Deno.serve(async (req) => {
  const token = Deno.env.get('SPANNR_SETUP_TOKEN');
  if (!token || req.headers.get('x-setup-token') !== token) return new Response('forbidden', { status: 403 });
  const log: string[] = [];
  try {
    const acct = await stripe.accounts.retrieve();
    log.push(`account ${acct.id} (${acct.settings?.dashboard?.display_name ?? ''}), charges_enabled=${acct.charges_enabled}`);

    for (const p of PLANS) {
      const keys = [`spannr_${p.key}_monthly`, `spannr_${p.key}_yearly`];
      const existing = await stripe.prices.list({ lookup_keys: keys, limit: 2 });
      if (existing.data.length === 2) { log.push(`${p.name}: already set up (livemode=${existing.data[0].livemode})`); continue; }
      const product = await stripe.products.create({ name: p.name, description: p.desc, metadata: { spannr_plan: p.key } });
      for (const [interval, amount, lookup] of [['month', p.monthly, keys[0]], ['year', p.monthly * 10, keys[1]]] as const) {
        await stripe.prices.create({
          product: product.id, currency: 'aud', unit_amount: amount, tax_behavior: 'exclusive',
          recurring: { interval }, lookup_key: lookup, transfer_lookup_key: true, metadata: { spannr_plan: p.key },
        });
      }
      log.push(`${p.name}: created (livemode=${product.livemode})`);
    }

    const rates = await stripe.taxRates.list({ active: true, limit: 100 });
    let gst = rates.data.find((r) => r.metadata?.spannr === 'gst');
    if (!gst) gst = await stripe.taxRates.create({ display_name: 'GST', percentage: 10, inclusive: false, country: 'AU', jurisdiction: 'AU', tax_type: 'gst', metadata: { spannr: 'gst' } });
    log.push(`GST tax rate ${gst.id}`);

    const allKeys = PLANS.flatMap((p) => [`spannr_${p.key}_monthly`, `spannr_${p.key}_yearly`]);
    const prices = await stripe.prices.list({ lookup_keys: allKeys, limit: 20 });
    const byProduct: Record<string, string[]> = {};
    for (const pr of prices.data) (byProduct[pr.product as string] ??= []).push(pr.id);
    const params: any = {
      business_profile: { headline: 'Manage your Spannr subscription', privacy_policy_url: 'https://spannr.au/privacy', terms_of_service_url: 'https://spannr.au/terms' },
      features: {
        subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: Object.entries(byProduct).map(([product, ids]) => ({ product, prices: ids })) },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
      metadata: { spannr: 'portal' },
    };
    const cfgs = await stripe.billingPortal.configurations.list({ limit: 100 });
    const found = cfgs.data.find((c) => c.metadata?.spannr === 'portal');
    const portal = found ? await stripe.billingPortal.configurations.update(found.id, params) : await stripe.billingPortal.configurations.create(params);
    log.push(`billing portal ${portal.id}`);

    const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
    const want = [
      { connect: false, events: ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'] },
      { connect: true, events: ['invoice.paid', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible', 'invoice.finalized', 'account.updated', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'] },
    ];
    for (const w of want) {
      const ex = hooks.data.find((h) => h.url === WEBHOOK && !!h.application === w.connect);
      if (ex) { await stripe.webhookEndpoints.update(ex.id, { enabled_events: w.events as any }); log.push(`webhook (${w.connect ? 'connect' : 'platform'}) updated ${ex.id}`); }
      else {
        const created = await stripe.webhookEndpoints.create({ url: WEBHOOK, enabled_events: w.events as any, connect: w.connect, description: `Spannr ${w.connect ? 'connected accounts' : 'subscriptions'}` } as any);
        log.push(`webhook (${w.connect ? 'connect' : 'platform'}) created ${created.id} livemode=${created.livemode}`);
      }
    }
    return Response.json({ ok: true, log });
  } catch (e) {
    return Response.json({ ok: false, log, error: (e as any)?.raw?.message ?? String(e) }, { status: 400 });
  }
});
