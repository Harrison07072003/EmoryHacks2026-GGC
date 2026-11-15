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
//   --verbose          log every skipped track with the reason
//   --pregenerate N    afterwards, generate levels for the N most popular songs that have none yet
//                      (same pipeline and caches as the server); --limit 0 skips ingestion
//   --scrape           page with archive.org's Scrape API instead of advancedsearch.php (no 10,000-item
//                      limit, but unreliable when tested; bad pages fall back automatically)
//
// Explicit tracks (src/config/content-blocklist.json) are skipped and removed from the index.
// Only SONGS are indexed (src/config/music-filter.json): items tagged as non-music (spoken word,
// field recordings...) are skipped, and every other track's first 30 s is downloaded and
// analyzed; tracks without a clear beat are skipped. Verdicts are cached in .cache/ingest/,
// the audio in the server's cache (online-library/audio/), so levels reuse it.
//   --skip-audio-check   index without the audio check (those tracks stay hidden from search
//                        until a run with the check marks them is_song)
import { parseArgs } from 'node:util';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { GAME_DIR, envFlag, loadEnv } from './env.mjs';
import { createPoliteFetch, DEFAULT_USER_AGENT } from '../src/services/archive/http.js';
import { createArchiveClient, SOURCES } from '../src/services/archive/ia-client.js';
import { runIngest } from '../src/services/archive/ingest.js';
import { createTypesenseClient, typesenseConfig } from '../src/services/search/typesense.js';
import { songsSchema } from '../src/services/search/schema.js';
import { loadBlocklist } from './blocklist.mjs';

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
    verbose: { type: 'boolean', short: 'v', default: false },
    scrape: { type: 'boolean', default: false },
    pregenerate: { type: 'string' },
    'skip-audio-check': { type: 'boolean', default: false },
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
  else { const added = await search.ensureSchemaFields(songsSchema(collection)); if (added.length) console.log(`added fields: ${added.join(', ')}`); }
}

const skipIngest = o.limit === '0';
let report = { tracks: 0, items: 0, failed: 0, removed: 0, skipped: {}, sample: [] };
if (!skipIngest) {
console.log(`${o['dry-run'] ? 'DRY RUN · ' : ''}collection ${collection} · NonCommercial ${allowNonCommercial ? 'allowed' : 'excluded'} · NoDerivatives excluded`);
const started = Date.now();
report = await runIngest({
  archive: createArchiveClient(http, { log: console.log, useScrape: o.scrape }), search, collection, sources, state,
  limit: o.limit ? Number(o.limit) : Infinity,
  batchSize: Number(o.batch), dryRun: o['dry-run'],
  collections: o['ia-collections']?.split(',').map(s => s.trim()).filter(Boolean),
  mapOptions: { allowNonCommercial, minSec: Number(o['min-sec']), maxSec: Number(o['max-sec']), blocklist: await loadBlocklist() },
  log: console.log, verbose: o.verbose,
  checkAudio: o['skip-audio-check'] ? null : await createAudioChecker(),
});
await saveVerdicts?.();

if (o['dry-run']) for (const d of report.sample) console.log(JSON.stringify(d, null, 2));
console.log(`\n${report.tracks} tracks from ${report.items} items in ${Math.round((Date.now() - started) / 1000)}s${report.failed ? `, ${report.failed} failed imports` : ''}${report.removed ? `, ${report.removed} explicit tracks removed from the index` : ''}`);
if (Object.keys(report.skipped).length) console.log('skipped:', Object.entries(report.skipped).map(([k, v]) => `${k} ×${v}`).join(', '));
}

if (o.pregenerate && !o['dry-run']) await pregenerate(Number(o.pregenerate));
process.exit(report.failed ? 1 : 0);

/**
 * Is this track a song? Downloads its first 30 s (throttled, Range request; reuses the server's
 * audio cache), analyzes it like the level generator does. Verdicts are cached per track and
 * thresholds, so re-runs do not download again.
 */
var saveVerdicts;
async function createAudioChecker() {
  const { createAudioChecker: make } = await import('../server/lib/audio-check.js').catch(() => {
    console.error('The audio check needs the server\'s decoders: run `npm run server:install` once (or use --skip-audio-check).');
    process.exit(2);
  });
  const { MUSIC_RULES } = await import('../src/services/chartgen/musicality.js');
  const { createAudioCache } = await import('../server/lib/stores.js');
  const { serverConfig } = await import('../server/lib/config.js');
  const scfg = serverConfig(env);
  const rulesKey = JSON.stringify(MUSIC_RULES);
  const file = `${stateDir}audio-checks.json`;
  let saved = {};
  try { saved = JSON.parse(await readFile(file, 'utf8')); } catch { /* first run */ }
  if (saved._rules !== rulesKey) saved = { _rules: rulesKey };   // thresholds changed: check again
  let unsaved = 0;
  saveVerdicts = async () => { await mkdir(stateDir, { recursive: true }); await writeFile(file, JSON.stringify(saved)); unsaved = 0; };
  return make({
    audioCache: createAudioCache(`${scfg.dataDir}audio`, scfg.audioCacheBytes),
    fetchFn: http.fetch,
    verdicts: { get: id => saved[id], set: (id, v) => { saved[id] = v; if (++unsaved >= 20) saveVerdicts(); } },
  });
}

/** Generate levels for the most popular songs without a current one, so they start instantly. */
async function pregenerate(n) {
  const { pipelineFromEnv } = await import('../server/lib/setup.js');
  const { pipeline } = await pipelineFromEnv({ ...env, TYPESENSE_COLLECTION: collection }, { log: console.log, concurrent: 1 });
  console.log(`\npre-generating levels for up to ${n} popular songs`);
  let done = 0, failed = 0, page = 1;
  while (done + failed < n) {
    const res = await search.search(collection, { q: '*', query_by: 'title', filter_by: 'is_explicit:false && is_song:true', sort_by: 'popularity:desc', per_page: 100, page, include_fields: 'id' });
    if (!res.hits.length) break;
    for (const { document: { id } } of res.hits) {
      if (done + failed >= n) break;
      if (await pipeline.cached(id)) continue;
      try { await pipeline.charts(id); done++; }
      catch (e) { failed++; console.log(`  - ${id}: ${e.message}`); }
    }
    page++;
  }
  console.log(`pre-generated ${done} level(s)${failed ? `, ${failed} failed` : ''}`);
}
