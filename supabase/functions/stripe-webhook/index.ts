// Stripe Connect webhook: keeps Spannr in step with invoices and accounts.
// Security: we never trust the request body. Each event is fetched back from Stripe by id
// (on the connected account it came from), so a forged request can't mark anything paid.
import { admin, cardPaymentsStatus, markJobPaid, stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  let body: { id?: string; account?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!body.id?.startsWith('evt_')) return new Response('bad request', { status: 400 });

  let event;
  try {
    event = await stripe.events.retrieve(body.id, {}, body.account ? { stripeAccount: body.account } : undefined);
  } catch {
    return new Response('unknown event', { status: 400 });
  }

  // Handle each event once.
  const { error: dup } = await admin.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dup) return new Response('already handled');

  try {
    if (event.type.startsWith('invoice.')) {
      const inv = event.data.object as { id: string; status: string; total: number; hosted_invoice_url?: string; status_transitions?: { paid_at?: number } };
      const { data: row } = await admin.from('stripe_invoices').select('business_id, job_id').eq('id', inv.id).maybeSingle();
      if (row) {
        const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null;
        await admin.from('stripe_invoices').update({
          status: inv.status,
          last_event: event.type,
          paid_at: paidAt,
          hosted_invoice_url: inv.hosted_invoice_url ?? undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', inv.id);
        if (event.type === 'invoice.paid') await markJobPaid(row.business_id, row.job_id, paidAt ?? new Date().toISOString());
      }
    } else if (event.type === 'account.updated' && event.account) {
      const status = await cardPaymentsStatus(event.account);
      await admin.from('stripe_accounts').update({ card_payments_status: status, updated_at: new Date().toISOString() }).eq('account_id', event.account);
    }
  } catch (e) {
    console.error(e);
    // Let Stripe retry later.
    await admin.from('stripe_events').delete().eq('id', event.id);
    return new Response('error', { status: 500 });
  }
  return new Response('ok');
});
