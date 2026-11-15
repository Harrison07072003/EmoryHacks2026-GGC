// npm run ingest -- [options]
// Pages through Internet Archive (and FMA's mirror on archive.org), maps each playable track
// to a document and emplaces it into the Typesense `songs` collection in batches.
//
//   --source internet_archive|fma|all   (default all)
//   --limit N          stop after N tracks (default: no limit)
//   --collection NAME  Typesense collection (default TYPESENSE_COLLECTION or songs)
//   --ia-collections a,b,c   archive.org collections for internet_archive (default netlabels;
//                     opensource_audio,audio_music are open user uploads with unreliable licenses: opt in only)
//   --dry-run          fetch and map, print a sample, write nothing
//   --restart          forget saved progress and start from the beginning
//   --batch N          documents per import call (default 100)
//   --rate MS          minimum ms between archive.org requests (default 1000)
//   --min-sec / --max-sec   accepted track length (default 30..600)
import { parseArgs } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { GAME_DIR, envFlag, loadEnv } from './env.mjs';
import { createPoliteFetch, DEFAULT_USER_AGENT } from '../src/services/archive/http.js';
import { createArchiveClient, SOURCES } from '../src/services/archive/ia-client.js';
import { runIngest } from '../src/services/archive/ingest.js';
import { createTypesenseClient, typesenseConfig } from '../src/services/search/typesense.js';
import { songsSchema } from '../src/services/search/schema.js';

const env = loadEnv();
const { values: o } = parseArgs({
  options: {
    source: { type: 'string', default: 'all' },
    limit: { type: 'string' },
    collection: { type: 'string' },
    'ia-collections': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    restart: { type: 'boolean', default: false },
    batch: { type: 'string', default: '100' },
    rate: { type: 'string', default: '1000' },
    'min-sec': { type: 'string', default: '30' },
    'max-sec': { type: 'string', default: '600' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (o.help) { console.log((await readFile(new URL(import.meta.url), 'utf8')).split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n')); process.exit(0); }

const sources = o.source === 'all' ? Object.keys(SOURCES) : o.source.split(',');
for (const s of sources) if (!SOURCES[s]) { console.error(`Unknown --source ${s}. Use: ${Object.keys(SOURCES).join(', ')}, all`); process.exit(2); }

const cfg = typesenseConfig(env);
if (!o['dry-run'] && !cfg) { console.error('Set TYPESENSE_HOST and TYPESENSE_ADMIN_API_KEY (see game/.env.example), or use --dry-run.'); process.exit(2); }
const collection = o.collection ?? cfg?.collection ?? 'songs';
const allowNonCommercial = envFlag(env.ALLOW_NONCOMMERCIAL, false);

const stateDir = `${GAME_DIR}.cache/ingest/`;
const stateFile = source => `${stateDir}${collection}.${source}.json`;
const state = {
  load: async source => { try { return JSON.parse(await readFile(stateFile(source), 'utf8')); } catch { return null; } },
  save: async (source, st) => { await mkdir(stateDir, { recursive: true }); await writeFile(stateFile(source), JSON.stringify(st, null, 2)); },
};
if (o.restart) for (const s of sources) await rm(stateFile(s), { force: true });

const http = createPoliteFetch({ userAgent: env.INGEST_USER_AGENT || DEFAULT_USER_AGENT, minIntervalMs: Number(o.rate), log: console.log });
const search = cfg ? createTypesenseClient(cfg) : null;

if (!o['dry-run']) {
  await search.health().catch(e => { console.error(`Typesense not reachable at ${cfg.url}: ${e.message}`); process.exit(1); });
  if (await search.ensureCollection(songsSchema(collection))) console.log(`created collection "${collection}"`);
}

console.log(`${o['dry-run'] ? 'DRY RUN · ' : ''}collection ${collection} · NonCommercial ${allowNonCommercial ? 'allowed' : 'excluded'} · NoDerivatives excluded`);
const started = Date.now();
const report = await runIngest({
  archive: createArchiveClient(http, { log: console.log }), search, collection, sources, state,
  limit: o.limit ? Number(o.limit) : Infinity,
  batchSize: Number(o.batch), dryRun: o['dry-run'],
  collections: o['ia-collections']?.split(',').map(s => s.trim()).filter(Boolean),
  mapOptions: { allowNonCommercial, minSec: Number(o['min-sec']), maxSec: Number(o['max-sec']) },
  log: console.log,
});

if (o['dry-run']) for (const d of report.sample) console.log(JSON.stringify(d, null, 2));
console.log(`\n${report.tracks} tracks from ${report.items} items in ${Math.round((Date.now() - started) / 1000)}s${report.failed ? `, ${report.failed} failed imports` : ''}`);
if (Object.keys(report.skipped).length) console.log('skipped:', Object.entries(report.skipped).map(([k, v]) => `${k} ×${v}`).join(', '));
process.exit(report.failed ? 1 : 0);
