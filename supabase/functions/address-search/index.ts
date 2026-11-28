// Address search as you type: "12 ocean pd" → "12 Ocean Parade, Coolangatta QLD 4225".
// Uses Google Places (secret GOOGLE_PLACES_KEY). Photon (free, OpenStreetMap) is kept as an option but
// currently refuses requests from Supabase's servers. Called by the app and the public booking page: { q, lat?, lon? }.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const STATE: Record<string, string> = {
  'queensland': 'QLD', 'new south wales': 'NSW', 'victoria': 'VIC', 'south australia': 'SA', 'western australia': 'WA',
  'tasmania': 'TAS', 'northern territory': 'NT', 'australian capital territory': 'ACT',
};
const AU_BBOX = '112.9,-43.7,153.7,-10.6';

type Photon = { properties: Record<string, string | undefined> };

async function photon(q: string, lat?: number, lon?: number): Promise<string[]> {
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '8');
  u.searchParams.set('lang', 'en');
  u.searchParams.set('bbox', AU_BBOX);
  if (lat && lon) { u.searchParams.set('lat', String(lat)); u.searchParams.set('lon', String(lon)); }
  const r = await fetch(u, { headers: { 'User-Agent': 'Spannr/1.0 (+https://spannr.au)', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Photon ${r.status}`);
  const { features = [] } = (await r.json()) as { features?: Photon[] };
  const out: string[] = [];
  for (const { properties: p } of features) {
    if (p.countrycode && p.countrycode !== 'AU') continue;
    const street = p.street ? `${p.housenumber ? p.housenumber + ' ' : ''}${p.street}` : p.name ?? '';
    const suburb = p.district || p.locality || p.city || p.county || '';
    const state = STATE[(p.state ?? '').toLowerCase()] ?? p.state ?? '';
    const line = [street, [suburb, state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (line && !out.includes(line)) out.push(line);
  }
  return out.slice(0, 6);
}

async function google(key: string, q: string, lat?: number, lon?: number): Promise<string[]> {
  const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({
      input: q,
      includedRegionCodes: ['au'],
      ...(lat && lon ? { locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 50000 } } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Google ${r.status}`);
  const d = (await r.json()) as { suggestions?: { placePrediction?: { text?: { text?: string } } }[] };
  return (d.suggestions ?? [])
    .map((s) => (s.placePrediction?.text?.text ?? '').replace(/, Australia$/, ''))
    .filter(Boolean)
    .slice(0, 6);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { q, lat, lon } = (await req.json()) as { q?: string; lat?: number; lon?: number };
    const query = (q ?? '').trim().slice(0, 120);
    if (query.length < 3) return json({ results: [] });
    const key = Deno.env.get('GOOGLE_PLACES_KEY')?.trim();
    // Photon refuses requests from Supabase's servers, so without a Google key there's nothing to search.
    const results = key ? await google(key, query, lat, lon) : [];
    return json({ results });
  } catch (e) {
    return json({ results: [], error: (e as Error).message }, 200);
  }
});
