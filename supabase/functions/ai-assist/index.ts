// Spannr AI assistant: tidy dictated notes, turn an inspection into a quote, draft text replies.
// Called from the app with the signed-in user's token: { action, businessId, ... }.
import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const MONTHLY_LIMIT = 500;
const MODEL = 'claude-opus-5-5';

const STYLE = 'You work inside Spannr, job management software for Australian mechanics. Use Australian English and plain text only – no markdown, no headings, no emoji.';

type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
    const body = await req.json();
    const businessId = String(body.businessId ?? '');
    const { data: member } = await admin.from('members').select('role').eq('business_id', businessId).eq('user_id', auth.user.id).maybeSingle();
    if (!member) return json({ error: 'You are not a member of this business.' }, 403);
    if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'The AI assistant isn\'t switched on yet.' }, 503);

    const { data: used, error: limitErr } = await admin.rpc('ai_use', { bid: businessId, lim: MONTHLY_LIMIT });
    if (limitErr) throw limitErr;
    if (used === -1) return json({ error: `You've used this month's ${MONTHLY_LIMIT} AI requests. It resets on the 1st.` }, 429);

    switch (body.action) {
      case 'notes': return json(await notes(body));
      case 'quote': return json(await quote(body));
      case 'reply': return json(await reply(body));
      default: return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return json({ error: 'The AI is busy right now – try again in a minute.' }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: 'The AI assistant had a problem. Try again.' }, 502);
    return json({ error: (e as Error).message || 'Something went wrong' }, 400);
  }
});

// Keys made at the organisation level (not inside a workspace) need the workspace named on each request.
const workspace = Deno.env.get('ANTHROPIC_WORKSPACE_ID');
const client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});

/** One request with a JSON-schema answer. */
async function ask<T>(system: string, user: string, schema: Schema, maxTokens = 4000): Promise<T> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    // deno-lint-ignore no-explicit-any
    fallbacks: 'default' as any,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: `${STYLE}\n\n${system}`,
    messages: [{ role: 'user', content: user }],
  // deno-lint-ignore no-explicit-any
  } as any);
  if (res.stop_reason === 'refusal') throw new Error('The AI couldn\'t help with that one.');
  if (res.stop_reason === 'max_tokens') throw new Error('That was too long for the AI – try a shorter note.');
  // deno-lint-ignore no-explicit-any
  const text = (res.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text) as T;
}

const clip = (s: unknown, n = 6000) => String(s ?? '').slice(0, n);

/** Rough, dictated notes → tidy workshop notes + a plain-English summary for the customer. */
function notes(b: Record<string, unknown>) {
  return ask<{ workNotes: string; customerSummary: string }>(
    `Turn a mechanic's rough or dictated notes into two things:
1. workNotes: tidy technical job notes for the workshop file. Keep every fact, measurement, part number and reading. Fix dictation errors and spelling; short lines starting with "- " are fine. Don't invent work that isn't mentioned.
2. customerSummary: a short, friendly explanation for the car owner (2–5 sentences) of what was found and done and anything they should do next, without jargon. Don't mention prices unless the notes do.`,
    `Vehicle: ${clip(b.vehicle, 200)}\nJob: ${clip(b.title, 200)}\n\nNotes:\n${clip(b.text)}`,
    obj({ workNotes: str, customerSummary: str }),
  );
}

/** Inspection findings → suggested quote lines grouped by repair. */
function quote(b: Record<string, unknown>) {
  const rate = Number(b.labourRate) || 0;
  return ask<{ lines: { repair: string; type: 'labour' | 'part'; description: string; qty: number; unitPrice: number }[]; note: string }>(
    `Suggest quote lines for the repairs a vehicle inspection found. Group lines by repair (e.g. "Front brakes"). For each repair add a labour line (qty = typical hours for that job on that vehicle, to the nearest 0.25; unitPrice = the labour rate ${rate}) and the parts usually needed.
Part prices: if a part matches the business's price list, use that price; otherwise set unitPrice to 0 so the mechanic fills it in. All prices exclude GST. Only quote for items marked urgent or attention, unless the notes ask for more. note: one short sentence for the mechanic about anything to check (e.g. prices to fill in, extra items worth looking at).`,
    `Vehicle: ${clip(b.vehicle, 200)}\nJob: ${clip(b.title, 200)}\nLabour rate (ex GST): ${rate}\n\nInspection findings:\n${clip(b.findings)}\n\nMechanic's notes:\n${clip(b.notes, 3000)}\n\nPrice list (name: lines):\n${clip(b.priceList, 6000)}`,
    obj({
      lines: { type: 'array', items: obj({ repair: str, type: { type: 'string', enum: ['labour', 'part'] }, description: str, qty: { type: 'number' }, unitPrice: { type: 'number' } }) },
      note: str,
    }),
  );
}

/** Draft a reply to the customer's latest text. */
function reply(b: Record<string, unknown>) {
  return ask<{ reply: string }>(
    `Draft the business's next text message to a customer, replying to the conversation below. Keep it short (under 300 characters), friendly and professional, signed off with nothing (the business name is added automatically). Don't promise prices, times or work the conversation doesn't support; if something needs checking, say you'll check and get back to them. If the mechanic gave instructions, follow them.`,
    `Business: ${clip(b.businessName, 100)}\nCustomer first name: ${clip(b.customerName, 60)}\nJob: ${clip(b.job, 300)}\n\nConversation (oldest first):\n${clip(b.thread, 5000)}\n\nMechanic's instructions: ${clip(b.hint, 500) || '(none)'}`,
    obj({ reply: str }),
    1500,
  );
}
