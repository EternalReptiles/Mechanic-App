// Stripe Connect webhook: keeps Spannr in step with invoices and accounts.
// Security: we never trust the request body. Each event is fetched back from Stripe by id
// (on the connected account it came from), so a forged request can't mark anything paid.
import { admin, applySubscription, rewardReferral, cardPaymentsStatus, markJobPaid, queueReceipt, settleTerminalPayment, stripe } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  let body: { id?: string; account?: string; type?: string };
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
    // After a business disconnects Spannr, its events can't be fetched any more. Confirm the disconnect by
    // checking Spannr really has lost access to that account, then forget it.
    if (body.type === 'account.application.deauthorized' && body.account?.startsWith('acct_')) {
      const lost = await stripe.accounts.retrieve(body.account).then(() => false, () => true);
      if (lost) {
        await admin.from('stripe_accounts').update({ linked_account_id: null, linked_at: null, card_payments_status: 'pending', terminal_location_id: null, gst_tax_rate_id: null })
          .eq('linked_account_id', body.account);
        return new Response('ok');
      }
    }
    return new Response('unknown event', { status: 400 });
  }

  // Handle each event once.
  const { error: dup } = await admin.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dup) return new Response('already handled');

  try {
    if (event.type.startsWith('customer.subscription.')) {
      // Spannr's own subscriptions (platform events)
      await applySubscription(event.data.object);
    } else if (event.type === 'checkout.session.completed') {
      const cs = event.data.object as { mode?: string; subscription?: string };
      if (cs.mode === 'subscription' && cs.subscription) await applySubscription(await stripe.subscriptions.retrieve(cs.subscription));
    } else if (event.type.startsWith('invoice.')) {
      const inv = event.data.object as { id: string; status: string; total: number; hosted_invoice_url?: string; status_transitions?: { paid_at?: number } };
      const { data: row } = await admin.from('stripe_invoices').select('business_id, job_id').eq('id', inv.id).maybeSingle();
      // Spannr subscription invoice (platform): the first one actually paid rewards whoever referred this business.
      const subBiz = (inv as any).parent?.subscription_details?.metadata?.spannr_business_id ?? (inv as any).subscription_details?.metadata?.spannr_business_id;
      if (!row && !event.account && event.type === 'invoice.paid' && subBiz && ((inv as any).amount_paid ?? 0) > 0) {
        await rewardReferral(subBiz);
      }
      if (row) {
        const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null;
        await admin.from('stripe_invoices').update({
          status: inv.status,
          last_event: event.type,
          paid_at: paidAt,
          hosted_invoice_url: inv.hosted_invoice_url ?? undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', inv.id);
        if (event.type === 'invoice.paid') {
          const when = paidAt ?? new Date().toISOString();
          await markJobPaid(row.business_id, row.job_id, when);
          await queueReceipt(row.business_id, row.job_id, { number: (inv as any).number, total: inv.total, hosted_invoice_url: inv.hosted_invoice_url }, when);
        }
      }
    } else if (event.type.startsWith('payment_intent.') && event.account) {
      // Tap to Pay payments (backup for when the phone loses signal right after the tap).
      const pi = event.data.object as { id: string; amount?: number; metadata?: Record<string, string>; last_payment_error?: { message?: string; decline_code?: string } };
      if (pi.metadata?.spannr_job_id) {
        await settleTerminalPayment(event.account, pi.id);
        if (event.type === 'payment_intent.payment_failed' && pi.metadata.spannr_business_id) {
          const reason = pi.last_payment_error?.decline_code?.replace(/_/g, ' ') || pi.last_payment_error?.message || null;
          await admin.rpc('notify_tap_failed', { p_business: pi.metadata.spannr_business_id, p_job: pi.metadata.spannr_job_id, p_amount: pi.amount ?? 0, p_reason: reason });
        }
      }
    } else if (event.type === 'account.updated' && event.account) {
      const status = await cardPaymentsStatus(event.account);
      await admin.from('stripe_accounts').update({ card_payments_status: status, updated_at: new Date().toISOString() })
        .or(`account_id.eq.${event.account},linked_account_id.eq.${event.account}`);
    } else if (event.type === 'account.application.deauthorized' && event.account) {
      // The business disconnected Spannr from their own Stripe account.
      await admin.from('stripe_accounts').update({ linked_account_id: null, linked_at: null, card_payments_status: 'pending', terminal_location_id: null, gst_tax_rate_id: null })
        .eq('linked_account_id', event.account);
    }
  } catch (e) {
    console.error(e);
    // Let Stripe retry later.
    await admin.from('stripe_events').delete().eq('id', event.id);
    return new Response('error', { status: 500 });
  }
  return new Response('ok');
});
