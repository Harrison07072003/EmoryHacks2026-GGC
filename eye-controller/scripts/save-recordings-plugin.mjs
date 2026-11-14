// Dev-server only: lets the debug page save a recording straight into recordings/
// (POST /__recordings?name=label). Not part of the production build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'recordings');
const MAX_BYTES = 50e6;

/** Label -> safe file name: letters, digits, dash and underscore only. */
export const safeName = label => (label || 'session').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'session';

export function saveRecordings() {
  return {
    name: 'save-recordings',
    configureServer(server) {
      server.middlewares.use('/__recordings', (req, res) => {
        const reply = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        const chunks = [];
        let size = 0;
        req.on('data', c => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
        req.on('end', () => {
          if (size > MAX_BYTES) return reply(413, { error: 'recording too large' });
          const body = Buffer.concat(chunks);
          try { if (!Array.isArray(JSON.parse(body).frames)) throw new Error(); } catch { return reply(400, { error: 'not a recording' }); }
          const label = new URL(req.url, 'http://localhost').searchParams.get('name');
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const file = `${safeName(label)}_${stamp}.json`;
          mkdirSync(DIR, { recursive: true });
          writeFileSync(join(DIR, file), body);
          reply(200, { file: `recordings/${file}` });
        });
      });
    },
  };
}
