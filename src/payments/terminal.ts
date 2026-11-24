// Tap to Pay on iPhone / Android, through Stripe Terminal on the business's own Stripe account.
import { StripeTerminal, TerminalConnectTypes, TerminalEventsEnum } from '@capacitor-community/stripe-terminal';
import { isNative } from '../native';
import { STRIPE_PUBLISHABLE_KEY, stripeApi } from './api';

/** Tap to Pay is only in the native app (a phone's NFC isn't available to web pages). */
export const tapToPayAvailable = isNative && !!STRIPE_PUBLISHABLE_KEY;

let business = '';
let started: Promise<void> | null = null;
let connectedFor = '';

/** Starts Stripe Terminal once; it asks Spannr's server for a fresh one-time token whenever it needs one. */
function start(): Promise<void> {
  if (!started) {
    started = (async () => {
      await StripeTerminal.addListener(TerminalEventsEnum.RequestedConnectionToken, async () => {
        try {
          const { secret } = await stripeApi<{ secret: string }>('terminal_token', business);
          if (secret) await StripeTerminal.setConnectionToken({ token: secret });
        } catch (e) {
          console.error('Tap to Pay: could not get a connection token', e);
        }
      });
      await StripeTerminal.initialize({ isTest: STRIPE_PUBLISHABLE_KEY.startsWith('pk_test') });
    })().catch((e) => {
      started = null;
      throw e;
    });
  }
  return started;
}

/** Gets this phone ready to take payments for the business (first time: Apple's Tap to Pay terms appear). */
export async function prepareTapToPay(businessId: string, businessName: string) {
  business = businessId;
  await start();
  if (connectedFor === businessId && (await StripeTerminal.getConnectedReader()).reader) return;
  if (connectedFor && connectedFor !== businessId) await StripeTerminal.disconnectReader();
  const { locationId } = await stripeApi<{ locationId: string }>('terminal_location', businessId);
  const { readers } = await StripeTerminal.discoverReaders({ type: TerminalConnectTypes.TapToPay, locationId });
  if (!readers.length) throw new Error("This phone can't take Tap to Pay payments (it needs an iPhone XS or newer, or an Android phone with NFC).");
  await StripeTerminal.connectReader({
    reader: readers[0],
    merchantDisplayName: businessName || 'Spannr',
    autoReconnectOnUnexpectedDisconnect: true,
  });
  connectedFor = businessId;
}

export type TapResult = { status: string; amount?: number; receiptUrl?: string | null; paidAt?: string | null };

/** Takes the job's total by tap: card, phone or watch. Resolves once Stripe has confirmed it. */
export async function tapToPayForJob(businessId: string, businessName: string, jobId: string): Promise<TapResult> {
  await prepareTapToPay(businessId, businessName);
  const pi = await stripeApi<{ clientSecret: string; id: string; amount: number }>('terminal_payment', businessId, { jobId });
  try {
    await StripeTerminal.collectPaymentMethod({ paymentIntent: pi.clientSecret });
    await StripeTerminal.confirmPaymentIntent();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/cancel/i.test(msg)) throw new Error('Payment cancelled – nothing was charged.');
    if (/declin/i.test(msg)) throw new Error('The card was declined – try another card.');
    throw new Error(msg || 'The payment did not go through.');
  }
  // Stripe is the record of truth: the server checks the payment, marks the job paid and sends the receipt.
  return stripeApi<TapResult>('terminal_complete', businessId, { paymentIntentId: pi.id });
}

export async function cancelTap() {
  try {
    await StripeTerminal.cancelCollectPaymentMethod();
  } catch {
    /* nothing in progress */
  }
}
