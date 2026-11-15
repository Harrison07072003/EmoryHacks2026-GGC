// npm run typesense:seed
// Exports every song from your local Typesense into server/typesense/songs.jsonl. That file is
// committed and loaded by the Render search service on every start (Render's free tier keeps no
// data), so run this after `npm run ingest` and commit the result to update the live library.
import { writeFileSync } from 'node:fs';
import { GAME_DIR, loadEnv } from './env.mjs';
import { typesenseConfig } from '../src/services/search/typesense.js';

const env = loadEnv(), cfg = typesenseConfig(env);
if (!cfg) { console.error('Set TYPESENSE_HOST and TYPESENSE_ADMIN_API_KEY first (see game/.env.example).'); process.exit(2); }
const res = await fetch(`${cfg.url}/collections/${cfg.collection}/documents/export`, { headers: { 'X-TYPESENSE-API-KEY': cfg.apiKey } })
  .catch(e => { console.error(`Typesense not reachable at ${cfg.url}: ${e.message} (npm run typesense)`); process.exit(1); });
if (!res.ok) { console.error(`Export failed: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
const lines = (await res.text()).split('\n').filter(Boolean);
const file = `${GAME_DIR}server/typesense/songs.jsonl`;
writeFileSync(file, `${lines.join('\n')}\n`);
console.log(`Wrote ${lines.length} songs to ${file}. Commit it and push; Render reloads it on its next deploy.`);
