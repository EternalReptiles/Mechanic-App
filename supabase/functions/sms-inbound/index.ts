// ClickSend inbound SMS rule → here. Each customer reply is filed against the business/customer/job
// (public.receive_sms) and the business is emailed. Protected by ?token=SMS_INBOUND_TOKEN.
import { admin } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = Deno.env.get('SMS_INBOUND_TOKEN');
  if (!token || url.searchParams.get('token') !== token) return new Response('forbidden', { status: 403 });
  if (req.method !== 'POST') return new Response('ok');

  let f: Record<string, string> = {};
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) f = await req.json();
    else f = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const from = String(f.from ?? f.sender ?? f.originator ?? '').trim();
  const body = String(f.body ?? f.message ?? f.text ?? '').trim();
  if (!from || !body) return new Response('ignored');
  const { error } = await admin.rpc('receive_sms', {
    p_from: from,
    p_body: body,
    p_custom: String(f.custom_string ?? f.original_custom_string ?? ''),
    p_provider_id: String(f.message_id ?? f.messageid ?? ''),
  });
  if (error) {
    console.error('receive_sms failed', error);
    return new Response('error', { status: 500 });
  }
  return new Response('ok');
});
