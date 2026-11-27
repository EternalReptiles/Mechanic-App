import { supabase } from '../cloud/supabase';

/** Calls the ai-assist Edge Function as the signed-in user. */
export async function aiAssist<T>(action: 'notes' | 'quote' | 'reply', businessId: string, extra: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine) throw new Error('The AI assistant needs signal.');
  const { data, error } = await supabase.functions.invoke('ai-assist', { body: { action, businessId, ...extra } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json().catch(() => null);
      if (body?.error) throw new Error(body.error);
    }
    throw new Error("Couldn't reach the AI assistant. Check your signal.");
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}
