// Spannr on Cloudflare: spannr.au shows the home page; app.spannr.au (and workers.dev) show the app.
const HOME_HOSTS = new Set(['spannr.au', 'www.spannr.au']);
// Files the home page itself uses.
const HOME_FILES = new Set(['/icon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/robots.txt']);
// Pages on spannr.au.
const PAGES = { '/terms': '/landing/terms/', '/privacy': '/landing/privacy/' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (HOME_HOSTS.has(url.hostname)) {
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
