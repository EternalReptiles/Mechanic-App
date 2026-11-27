import { supabase } from '../cloud/supabase';

export const STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? '';

export interface PaymentsStatus {
  connected: boolean;
  accountId?: string;
  /** Card payments go to the business's own existing Stripe account */
  linked?: boolean;
  /** v2 card_payments capability: active | pending | restricted | unsupported */
  cardPayments?: string;
}

export interface StripeInvoiceRow {
  id: string;
  number: string | null;
  status: string;
  total: number;
  hosted_invoice_url: string | null;
  created_at: string;
  paid_at: string | null;
}

/** Calls the stripe-api Edge Function as the signed-in user. */
export async function stripeApi<T>(action: string, businessId: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('stripe-api', { body: { action, businessId, ...extra } });
  if (error) {
    // Surface the function's own error message when there is one.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        if (body?.error) throw new Error(body.error);
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
      }
    }
    throw new Error(error.message || "Couldn't reach the payments service. Check your signal.");
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}
