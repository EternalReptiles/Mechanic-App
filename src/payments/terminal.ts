// Tap to Pay on iPhone / Android, through Stripe Terminal on the business's own Stripe account.
import { StripeTerminal, TerminalConnectTypes, TerminalEventsEnum } from '@capacitor-community/stripe-terminal';
import { registerPlugin } from '@capacitor/core';
import { isNative, platform } from '../native';
import { STRIPE_PUBLISHABLE_KEY, stripeApi } from './api';

/** Tap to Pay is only in the native app (a phone's NFC isn't available to web pages). */
export const tapToPayAvailable = isNative && !!STRIPE_PUBLISHABLE_KEY;

/** Apple's required wording on iPhone. */
export const TAP_TO_PAY_NAME = platform === 'ios' ? 'Tap to Pay on iPhone' : 'Tap to Pay';

/** Spannr's native helper (iOS): Apple's "How to Tap" guide and whether this iPhone supports Tap to Pay. */
const Education = registerPlugin<{
  status(): Promise<{ supported: boolean; education: boolean }>;
  showHowToTap(): Promise<{ shown: boolean }>;
}>('TapToPayEducation');

/** Shows Apple's "How to Tap" guide (iPhone, iOS 18+). Returns false where it isn't available; throws with the reason if it fails. */
export async function showHowToTap(opts: { quiet?: boolean } = {}): Promise<boolean> {
  if (platform !== 'ios') return false;
  try {
    return (await Education.showHowToTap()).shown;
  } catch (e) {
    console.error('How to Tap guide unavailable', e);
    if (opts.quiet) return false;
    const msg = String((e as Error)?.message ?? e);
    throw new Error(/not implemented|UNIMPLEMENTED|not available/i.test(msg)
      ? "This version of the Spannr app doesn't include Apple's How to Tap guide yet – update the app from the Mac."
      : `Apple's How to Tap guide couldn't open: ${msg}`);
  }
}

export async function deviceSupport(): Promise<{ supported: boolean; education: boolean; native: boolean }> {
  if (platform !== 'ios') return { supported: platform === 'android', education: false, native: false };
  try {
    return { ...(await Education.status()), native: true };
  } catch {
    // App build without Spannr's native helper: assume supported and let Stripe decide.
    return { supported: true, education: true, native: false };
  }
}

// Remembers (per phone and business) that Tap to Pay was set up here, so it can connect in the background.
const enabledKey = (businessId: string) => `spannr-ttp-enabled-${businessId}`;
export function isEnabledHere(businessId: string): boolean {
  try {
    return localStorage.getItem(enabledKey(businessId)) === '1';
  } catch {
    return false;
  }
}
function markEnabled(businessId: string) {
  try {
    localStorage.setItem(enabledKey(businessId), '1');
  } catch {
    /* private mode */
  }
}

let business = '';
let started: Promise<void> | null = null;
let connectedFor = '';

/** Apple's Tap to Pay configuration progress (0–1), or null when it isn't configuring. */
type ProgressFn = (p: number | null) => void;
const progressFns = new Set<ProgressFn>();
let lastProgress: number | null = null;
const emitProgress = (p: number | null) => {
  lastProgress = p;
  progressFns.forEach((f) => f(p));
};
export function onTapToPayProgress(fn: ProgressFn): () => void {
  progressFns.add(fn);
  fn(lastProgress);
  return () => progressFns.delete(fn);
}

/** Turns Stripe/Apple errors into plain English (incl. Apple's required "update iOS" message). */
export function friendlyTapError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e ?? '');
  if (/osVersionNotSupported|os version|update.*ios|ios.*(too old|not supported)/i.test(msg))
    return 'Tap to Pay on iPhone needs a newer version of iOS. Update your iPhone in Settings → General → Software Update, then try again.';
  if (/cancel/i.test(msg)) return 'Payment cancelled – nothing was charged.';
  if (/declin/i.test(msg)) return 'The card was declined – no money was taken. Ask the customer to try another card.';
  if (/timed? ?out/i.test(msg)) return 'The payment timed out – nothing was charged. Try again.';
  return msg || 'The payment did not go through.';
}

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
      await StripeTerminal.addListener(TerminalEventsEnum.StartInstallingUpdate, () => emitProgress(0));
      await StripeTerminal.addListener(TerminalEventsEnum.ReaderSoftwareUpdateProgress, ({ progress }) => emitProgress(progress));
      await StripeTerminal.addListener(TerminalEventsEnum.FinishInstallingUpdate, () => emitProgress(null));
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
  emitProgress(null);
  connectedFor = businessId;
}

/** Has this business's Stripe account accepted Apple's Tap to Pay terms on this Apple ID? (iOS only, never cached.) */
export async function isAccountLinked(businessId: string): Promise<boolean | null> {
  if (platform !== 'ios') return null;
  business = businessId;
  try {
    await start();
    return (await StripeTerminal.isTapToPayAccountLinked()).isLinked;
  } catch {
    return null;
  }
}

/**
 * Settings → Tap to Pay on iPhone → Enable: connects this phone (Apple shows its terms the first time),
 * then shows Apple's "How to Tap" guide.
 */
export async function enableTapToPay(businessId: string, businessName: string) {
  await prepareTapToPay(businessId, businessName);
  markEnabled(businessId);
  await showHowToTap({ quiet: true });
}

/** Connects quietly in the background (app start / back to the app) so the first tap is instant. */
export async function warmTapToPay(businessId: string, businessName: string) {
  if (!tapToPayAvailable || !isEnabledHere(businessId) || !navigator.onLine) return;
  try {
    await prepareTapToPay(businessId, businessName);
  } catch (e) {
    console.warn('Tap to Pay warm-up skipped', e);
  }
}

export type TapResult = { status: string; amount?: number; receiptUrl?: string | null; paidAt?: string | null };

export type TapPhase = 'preparing' | 'tapping' | 'processing';

/**
 * Takes the job's total by tap: card, phone or watch. If Tap to Pay isn't set up on this phone yet, this first
 * runs setup (Apple's terms, then How to Tap). Reports each phase so the screen can show what's happening.
 */
export async function tapToPayForJob(businessId: string, businessName: string, jobId: string, onPhase: (p: TapPhase) => void = () => {}): Promise<TapResult> {
  onPhase('preparing');
  const firstTime = !isEnabledHere(businessId);
  await prepareTapToPay(businessId, businessName);
  markEnabled(businessId);
  if (firstTime) await showHowToTap({ quiet: true });
  const pi = await stripeApi<{ clientSecret: string; id: string; amount: number }>('terminal_payment', businessId, { jobId });
  try {
    onPhase('tapping');
    await StripeTerminal.collectPaymentMethod({ paymentIntent: pi.clientSecret });
    onPhase('processing');
    await StripeTerminal.confirmPaymentIntent();
  } catch (e) {
    throw new Error(friendlyTapError(e));
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
