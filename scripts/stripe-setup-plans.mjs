// Sets up Spannr's subscription plans, GST rate and billing portal in Stripe (safe to re-run).
// Run once per Stripe environment, e.g.  STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup-plans.mjs
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

const plans = [
  { key: 'solo', name: 'Spannr Solo', desc: '1 user. Jobs, quotes, invoices, inspections, card payments.', monthly: 3900 },
  { key: 'pro', name: 'Spannr Pro', desc: 'Up to 3 users. Adds remote sign-offs, video walk-arounds and automatic messages (100 texts/month).', monthly: 6500 },
  { key: 'team', name: 'Spannr Team', desc: 'Up to 8 users. Adds workshop board, technician assignment and Tap to Pay (300 texts/month).', monthly: 9500 },
  { key: 'business', name: 'Spannr Business', desc: 'Unlimited users, 1,000 texts/month, priority support.', monthly: 14900 },
];

for (const p of plans) {
  const keys = [`spannr_${p.key}_monthly`, `spannr_${p.key}_yearly`];
  const existing = await stripe.prices.list({ lookup_keys: keys, limit: 2 });
  if (existing.data.length === 2) {
    console.log(p.name, 'already set up');
    continue;
  }
  const product = await stripe.products.create({ name: p.name, description: p.desc, metadata: { spannr_plan: p.key } });
  const variants = [
    ['month', p.monthly, keys[0]],
    ['year', p.monthly * 10, keys[1]],
  ];
  for (const [interval, amount, lookupKey] of variants) {
    await stripe.prices.create({
      product: product.id,
      currency: 'aud',
      unit_amount: amount,
      tax_behavior: 'exclusive',
      recurring: { interval },
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      metadata: { spannr_plan: p.key },
    });
  }
  console.log(`${p.name} – $${p.monthly / 100}/month, $${p.monthly / 10}/year (+GST)`);
}

// GST at 10%, added on top (prices are +GST)
const rates = await stripe.taxRates.list({ active: true, limit: 100 });
let gst = rates.data.find((r) => r.metadata && r.metadata.spannr === 'gst');
if (!gst) {
  gst = await stripe.taxRates.create({
    display_name: 'GST', percentage: 10, inclusive: false, country: 'AU', jurisdiction: 'AU', tax_type: 'gst',
    metadata: { spannr: 'gst' },
  });
}
console.log('GST tax rate:', gst.id);

// Billing portal: switch plan (all 8 prices), update card, cancel at period end, see invoices
const allKeys = plans.flatMap((p) => [`spannr_${p.key}_monthly`, `spannr_${p.key}_yearly`]);
const prices = await stripe.prices.list({ lookup_keys: allKeys, limit: 20 });
const byProduct = {};
for (const pr of prices.data) {
  if (!byProduct[pr.product]) byProduct[pr.product] = [];
  byProduct[pr.product].push(pr.id);
}
const params = {
  business_profile: { headline: 'Manage your Spannr subscription' },
  features: {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products: Object.entries(byProduct).map(([product, ids]) => ({ product, prices: ids })),
    },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
  },
  metadata: { spannr: 'portal' },
};
const cfgs = await stripe.billingPortal.configurations.list({ limit: 100 });
const found = cfgs.data.find((c) => c.metadata && c.metadata.spannr === 'portal');
const portal = found
  ? await stripe.billingPortal.configurations.update(found.id, params)
  : await stripe.billingPortal.configurations.create(params);
console.log('Billing portal configuration:', portal.id);
