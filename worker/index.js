// Cloudflare Worker: a tiny proxy so the Unsplash Access Key never ships in the page.
// Routes:  GET /search?q=...&page=1      -> Unsplash photo search, 30 per page (cached 1h)
//          GET /download?loc=<url>       -> pings a photo's download_location (Unsplash download tracking)
// The key lives in a Worker secret named UNSPLASH_ACCESS_KEY (see worker/README.md).

const ALLOWED_ORIGINS = ['https://yi-xuen.github.io', 'http://localhost:8765'];
const API = 'https://api.unsplash.com';
// download_location values look like https://api.unsplash.com/photos/<id>/download?ixid=...
const DOWNLOAD_RE = /^https:\/\/api\.unsplash\.com\/photos\/[A-Za-z0-9_-]+\/download(\?[A-Za-z0-9_=&%.-]*)?$/;

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET' || !ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403, headers: cors });

    const url = new URL(req.url);
    const auth = { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`, 'Accept-Version': 'v1' };

    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (!q) return new Response('Missing q', { status: 400, headers: cors });
      const page = Math.min(20, Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1));
      const upstream = `${API}/search/photos?per_page=30&content_filter=high&page=${page}&query=${encodeURIComponent(q)}`;
      const cache = caches.default, key = new Request(upstream);
      let res = await cache.match(key);
      if (!res) {
        res = await fetch(upstream, { headers: auth });
        if (res.ok) {
          res = new Response(res.body, res);
          res.headers.set('Cache-Control', 'public, max-age=3600');
          ctx.waitUntil(cache.put(key, res.clone()));
        }
      }
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
      return out;
    }

    if (url.pathname === '/download') {
      const loc = url.searchParams.get('loc') || '';
      if (!DOWNLOAD_RE.test(loc)) return new Response('Bad location', { status: 400, headers: cors });
      ctx.waitUntil(fetch(loc, { headers: auth }));
      return new Response(null, { status: 204, headers: cors });
    }

    return new Response('Not found', { status: 404, headers: cors });
  },
};
