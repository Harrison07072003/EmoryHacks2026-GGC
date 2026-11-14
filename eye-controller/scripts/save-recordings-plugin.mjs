// Dev-server only: lets the debug page save files straight into the project instead of
// the browser's Downloads folder. Not part of the production build.
//   POST /__save/recordings?name=label  -> recordings/<label>_<date-time>.json
//   POST /__save/baselines?name=label   -> baselines/<label>_<date-time>.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 50e6;
const KINDS = {
  recordings: data => Array.isArray(data.frames),
  baselines: data => typeof data.players === 'number' && !!data.gram,
};

/** Label -> safe file name: letters, digits, dash and underscore only. */
export const safeName = label => (label || 'session').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'session';

export function saveRecordings() {
  return {
    name: 'save-to-project',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const reply = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        const url = new URL(req.url, 'http://localhost'), kind = url.pathname.replace(/^\/+|\/+$/g, '');
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        if (!Object.hasOwn(KINDS, kind)) return reply(404, { error: 'unknown kind' });
        const chunks = [];
        let size = 0;
        req.on('data', c => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
        req.on('end', () => {
          if (size > MAX_BYTES) return reply(413, { error: 'file too large' });
          const body = Buffer.concat(chunks);
          try { if (!KINDS[kind](JSON.parse(body))) throw new Error(); } catch { return reply(400, { error: `not a valid file for ${kind}` }); }
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const file = `${safeName(url.searchParams.get('name'))}_${stamp}.json`;
          mkdirSync(join(ROOT, kind), { recursive: true });
          writeFileSync(join(ROOT, kind, file), body);
          reply(200, { file: `${kind}/${file}` });
        });
      });
    },
  };
}
