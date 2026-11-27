// Spannr on Cloudflare: spannr.au shows the home page; app.spannr.au (and workers.dev) show the app.
const HOME_HOSTS = new Set(['spannr.au', 'www.spannr.au']);
// Files the home page itself uses.
const HOME_FILES = new Set(['/icon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/robots.txt']);
// Pages on spannr.au.
const PAGES = { '/terms': '/landing/terms/', '/privacy': '/landing/privacy/' };

const SUPABASE_URL = 'https://lmtmsnkjowgeturblzzj.supabase.co';
// Public (publishable) key – safe to ship; it can only call functions granted to anonymous users.
const SUPABASE_KEY = 'sb_publishable_t4j0d740o15eYkSnsjqtVQ_0VrVMrWm';

async function shortLink(code) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_short_link`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
    });
    const target = r.ok ? await r.json() : null;
    if (typeof target === 'string' && /^https:\/\//.test(target)) return Response.redirect(target, 302);
  } catch {
    // fall through
  }
  return new Response('This link has expired or is not valid.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (HOME_HOSTS.has(url.hostname)) {
      // Short links in texts: spannr.au/r/<code> → the full link (receipts, invoices, videos, reviews).
      const short = url.hostname === 'spannr.au' && url.pathname.match(/^\/r\/([A-Za-z0-9]{6,16})\/?$/);
      if (short) return shortLink(short[1]);
      if (url.hostname === 'www.spannr.au') return Response.redirect(`https://spannr.au${url.pathname}${url.search}`, 301);
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return env.ASSETS.fetch(new Request(new URL('/landing/', url), request));
      }
      const page = PAGES[url.pathname.replace(/\/$/, '')];
      if (page) return env.ASSETS.fetch(new Request(new URL(page, url), request));
      if (!url.pathname.startsWith('/landing/') && !HOME_FILES.has(url.pathname)) {
        // Anything else (an old link, /v/<token>, /jobs/…) belongs to the app.
        return Response.redirect(`https://app.spannr.au${url.pathname}${url.search}`, 302);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
