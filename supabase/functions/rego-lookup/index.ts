// Rego lookup: plate + state → make, model, year range, body, engine (PlateAPI). The key stays on the server.
// Called from the app with the signed-in user's token: { businessId, plate, state }.
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
// Lookups per month by plan (each one costs Spannr about 10c).
const LIMITS: Record<string, number> = { solo: 30, pro: 100, team: 200, business: 400, trial: 30 };

type PlateVehicle = {
  year_range?: string; lowest_year?: number; highest_year?: number | null; make?: string; model?: string;
  description?: string; body?: string | null; engine?: string | null; vehicle_id?: number | null;
};

// "TOYOTA" → "Toyota", "HILUX" → "Hilux", keeping short codes like "BMW", "GT" or "X5" in capitals.
const nice = (s?: string | null) =>
  (s ?? '').toLowerCase().replace(/\b([a-z])([a-z]*)\b/g, (w, a, b) => (w.length <= 3 && !/[aeiou]/.test(w) ? w.toUpperCase() : a.toUpperCase() + b))
    .replace(/\b(bmw|mg|gwm|ldv|hsv|fpv|amg|gt|gti|gts|xr6|xr8|ss|sv6|crv|hrv|rav4|cx\d+|x\d)\b/gi, (w) => w.toUpperCase());

function shape(v: PlateVehicle) {
  const year = v.lowest_year && v.highest_year === v.lowest_year ? String(v.lowest_year) : (v.year_range ?? '').replace('-', '–');
  return {
    make: nice(v.make), model: nice(v.model), year, body: nice(v.body), engine: v.engine ?? '',
    description: v.description ?? '',
  };
}

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

    const plate = String(body.plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const state = String(body.state ?? '').toUpperCase();
    if (plate.length < 2 || plate.length > 10) return json({ error: 'Type the rego first.' }, 400);
    if (!STATES.includes(state)) return json({ error: 'Pick the state the car is registered in.' }, 400);
    const key = (Deno.env.get('REGO_API_KEY') ?? '').trim();
    if (!key) return json({ error: "Rego lookup isn't switched on yet." }, 503);

    const { data: plan } = await admin.rpc('business_plan', { bid: businessId });
    const limit = LIMITS[String(plan)] ?? 0;
    if (!limit) return json({ error: 'Choose a plan in Settings → Plan & billing to use rego lookup.' }, 403);
    const { data: used, error: limitErr } = await admin.rpc('rego_use', { bid: businessId, lim: limit });
    if (limitErr) throw limitErr;
    if (used === -1) return json({ error: `You've used this month's ${limit} rego lookups on your plan. Type the details in for now, or upgrade for more.` }, 429);

    const res = await fetch(`https://api.plateapi.com.au/api/v1/lookup?plate=${encodeURIComponent(plate)}&state=${state}`, {
      headers: { 'X-API-Key': key, 'User-Agent': 'Spannr/1.0 (rego lookup)' },
    });
    const data = await res.json().catch(() => null) as { success?: boolean; vehicle?: PlateVehicle; alternatives?: PlateVehicle[]; match?: string; code?: string; error?: string } | null;
    if (!data) return json({ error: 'The rego service is busy – try again in a moment.' }, 502);
    if (!data.success) {
      if (data.code === 'not_found' || res.status === 200) return json({ found: false });
      if (res.status === 401) return json({ error: "Rego lookup isn't set up properly (key not accepted)." }, 502);
      if (res.status === 429) return json({ error: 'Rego lookups are busy right now – try again shortly.' }, 429);
      return json({ error: 'The rego service is busy – try again in a moment.' }, 502);
    }
    const options = [data.vehicle!, ...(data.alternatives ?? [])].map(shape)
      .filter((o, i, a) => a.findIndex((x) => x.description === o.description) === i);
    return json({ found: true, match: data.match ?? 'exact', vehicle: options[0], options });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || 'Something went wrong' }, 400);
  }
});
