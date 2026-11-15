// HTTP routes of the Online Library server (plain node:http, no framework).
//
//   GET /health                 { ok, typesense, generatorVersion }
//   GET /charts/:songId         the song's generated level (cached, or generated now: a few seconds)
//   GET /audio/:songId          the first 30 s of the song's audio (proxy + cache; fallback for CORS problems)
//
// Protection: song ids are validated and looked up in Typesense (no client-supplied URLs),
// per-IP rate limits (stricter for new generations), a bounded generation queue, CORS limited
// to CORS_ORIGINS, GET/OPTIONS only.
import { BusyError, createRateLimiter } from './lib/limits.js';
import { NotFoundError, SONG_ID } from './lib/pipeline.js';
import { GENERATOR_VERSION } from '../src/services/chartgen/generate.js';

export function createApp({ cfg, pipeline, log = () => {} }) {
  const general = createRateLimiter({ perMin: cfg.limits.requestsPerMin });
  const generations = createRateLimiter({ perMin: cfg.limits.generationsPerMin, burst: Math.max(2, Math.ceil(cfg.limits.generationsPerMin / 2)) });
  const audio = createRateLimiter({ perMin: cfg.limits.audioPerMin });

  const clientIp = req => (cfg.trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

  function cors(req, res) {
    const origin = String(req.headers.origin ?? '').replace(/\/$/, '');
    if (origin && cfg.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const limited = (res, r) => send(res, 429, { error: 'too many requests, slow down' }, { 'Retry-After': String(r.retryAfterSec) });

  async function handle(req, res) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, OPTIONS' });
    const ip = clientIp(req);
    const g = general.take(ip);
    if (!g.ok) return limited(res, g);

    const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
    if (path === '/health') return send(res, 200, { ok: true, typesense: !!cfg.typesense, generatorVersion: GENERATOR_VERSION });

    const m = path.match(/^\/(charts|audio)\/([^/]+)$/);
    if (!m) return send(res, 404, { error: 'not found' });
    const [, kind, raw] = m;
    let id;
    try { id = decodeURIComponent(raw); } catch { return send(res, 400, { error: 'invalid song id' }); }
    if (!SONG_ID.test(id)) return send(res, 400, { error: 'invalid song id' });

    try {
      if (kind === 'audio') {
        const a = audio.take(ip);
        if (!a.ok) return limited(res, a);
        const doc = await pipeline.lookup(id);
        const bytes = await pipeline.audioStart(doc);
        res.writeHead(200, { 'Content-Type': /\.ogg$/i.test(doc.audio_url) ? 'audio/ogg' : 'audio/mpeg', 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        res.end(bytes);
        return;
      }
      // charts: cache hits are cheap; only new generations count against the stricter limit
      if (!(await pipeline.cached(id))) {
        await pipeline.lookup(id);   // refused/unknown songs answer 404 without using a generation token
        const r = generations.take(ip);
        if (!r.ok) return limited(res, r);
      }
      const { entry, cached } = await pipeline.charts(id);
      return send(res, 200, { ...entry, cached }, { 'Cache-Control': 'public, max-age=3600' });
    } catch (e) {
      if (e instanceof NotFoundError) return send(res, 404, { error: e.message });
      if (e instanceof BusyError) return send(res, 503, { error: e.message }, { 'Retry-After': '30' });
      log(`  ! ${kind} ${id}: ${e.message}`);
      return send(res, 502, { error: `could not make this level: ${e.message}` });
    }
  }

  return (req, res) => handle(req, res).catch(e => { log(`  ! ${e.stack}`); if (!res.headersSent) send(res, 500, { error: 'internal error' }); });
}
