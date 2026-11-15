// Search service for Render (free tier). Starts Typesense on $PORT, then loads the songs from
// songs.jsonl and recreates the search key with a fixed value, every start: the free tier keeps
// no data, and the website's search key (derived from that value) must keep working.
//
// Env: TYPESENSE_ADMIN_API_KEY, TYPESENSE_SEARCH_PARENT_KEY (both from `npm run render:keys`),
//      PORT (set by Render), optional TYPESENSE_COLLECTION, TYPESENSE_BIN, TYPESENSE_DATA_DIR,
//      TYPESENSE_PEERING_PORT (internal, default 8107).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createTypesenseClient } from '../../src/services/search/typesense.js';
import { songsSchema } from '../../src/services/search/schema.js';

const env = process.env;
const port = env.PORT || '8108';
const admin = env.TYPESENSE_ADMIN_API_KEY, parent = env.TYPESENSE_SEARCH_PARENT_KEY;
const collection = env.TYPESENSE_COLLECTION || 'songs';
const dataDir = env.TYPESENSE_DATA_DIR || '/tmp/typesense-data';
if (!admin || !parent) { console.error('Set TYPESENSE_ADMIN_API_KEY and TYPESENSE_SEARCH_PARENT_KEY (npm run render:keys).'); process.exit(2); }

mkdirSync(dataDir, { recursive: true });
const server = spawn(env.TYPESENSE_BIN || 'typesense-server',
  [`--data-dir=${dataDir}`, `--api-key=${admin}`, `--api-port=${port}`, '--api-address=0.0.0.0', '--enable-cors',
    // single node: keep the internal peering port on localhost
    '--peering-address=127.0.0.1', `--peering-port=${env.TYPESENSE_PEERING_PORT || 8107}`],
  { stdio: 'inherit' });
server.on('exit', code => process.exit(code ?? 1));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.kill(sig));

const ts = createTypesenseClient({ url: `http://127.0.0.1:${port}`, apiKey: admin });
await waitForHealth();
await seed();

async function waitForHealth() {
  for (let i = 0; i < 120; i++) {
    try { await ts.health(); return; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  console.error('[boot] Typesense did not become healthy in 60 s'); server.kill(); process.exit(1);
}

async function seed() {
  await ts.ensureCollection(songsSchema(collection));
  const docs = readFileSync(new URL('./songs.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const results = await ts.importDocuments(collection, docs, 'emplace');
  const failed = results.filter(r => !r.success);
  console.log(`[boot] loaded ${results.length - failed.length}/${docs.length} songs into "${collection}"`);
  if (failed.length) console.error('[boot] first failure:', failed[0].error);
  const keys = await ts.listKeys();
  if (!keys.keys?.some(k => k.value_prefix === parent.slice(0, 4) && k.description?.includes('game client'))) {
    await ts.createKey({ value: parent, description: `RhythmEyez game client: search ${collection} only`, actions: ['documents:search'], collections: [collection] });
  }
  console.log('[boot] search key ready');
}
