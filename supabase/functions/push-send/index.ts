// Sends push notifications to a business's iPhones through Apple's push service (APNs, token auth).
// Called from the database (public.push_to_business) with the PUSH_TOKEN; not callable by app users.
import { admin } from '../_shared/stripe.ts';

const TEAM = Deno.env.get('APNS_TEAM_ID') ?? '';
const KEY_ID = Deno.env.get('APNS_KEY_ID') ?? '';
const BUNDLE = Deno.env.get('APNS_BUNDLE_ID') ?? 'au.spannr.app';
const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' } as const;

const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let cached: { jwt: string; at: number } | null = null;
async function apnsJwt(): Promise<string> {
  if (cached && Date.now() - cached.at < 40 * 60 * 1000) return cached.jwt; // Apple wants a refresh every 20–60 min
  const pem = (Deno.env.get('APNS_KEY') ?? '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: TEAM, iat: Math.floor(Date.now() / 1000) }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`));
  const jwt = `${head}.${claims}.${b64url(sig)}`;
  cached = { jwt, at: Date.now() };
  return jwt;
}

async function sendOne(token: string, env: 'production' | 'sandbox', payload: unknown) {
  const res = await fetch(`${HOSTS[env]}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await apnsJwt()}`,
      'apns-topic': BUNDLE,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = res.status === 200 ? '' : await res.text();
  return { status: res.status, reason: text ? (JSON.parse(text).reason as string) : '' };
}

Deno.serve(async (req) => {
  const token = Deno.env.get('PUSH_TOKEN');
  if (!token || req.headers.get('x-push-token') !== token) return new Response('forbidden', { status: 403 });
  if (!KEY_ID || !Deno.env.get('APNS_KEY')) return Response.json({ ok: false, error: 'APNs key not configured' }, { status: 503 });
  const { business_id, title, body, url, admins_only } = await req.json();

  let users: string[] | null = null;
  if (admins_only) {
    const { data } = await admin.from('members').select('user_id').eq('business_id', business_id).in('role', ['owner', 'admin']);
    users = (data ?? []).map((m) => m.user_id);
  }
  let q = admin.from('push_devices').select('token, user_id, apns_env').eq('business_id', business_id);
  if (users) q = q.in('user_id', users.length ? users : ['00000000-0000-0000-0000-000000000000']);
  const { data: devices } = await q;

  const payload = { aps: { alert: { title, body }, sound: 'default' }, url: url || '/' };
  const results: Record<string, number> = {};
  for (const d of devices ?? []) {
    // Builds installed from Xcode use Apple's sandbox; App Store / TestFlight builds use production.
    const order: ('production' | 'sandbox')[] = d.apns_env === 'sandbox' ? ['sandbox', 'production'] : ['production', 'sandbox'];
    let r = await sendOne(d.token, order[0], payload);
    if (r.status === 400 && r.reason === 'BadDeviceToken') {
      r = await sendOne(d.token, order[1], payload);
      if (r.status === 200) await admin.from('push_devices').update({ apns_env: order[1] }).eq('token', d.token);
    } else if (r.status === 200 && !d.apns_env) {
      await admin.from('push_devices').update({ apns_env: order[0] }).eq('token', d.token);
    }
    if (r.status === 410 || (r.status === 400 && r.reason === 'BadDeviceToken')) {
      await admin.from('push_devices').delete().eq('token', d.token); // uninstalled / invalid
    }
    results[r.reason || String(r.status)] = (results[r.reason || String(r.status)] ?? 0) + 1;
  }
  return Response.json({ ok: true, sent: devices?.length ?? 0, results });
});
