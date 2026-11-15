// End-to-end against the REAL services: archive.org + the local Typesense.
//   npm run test:online      (skipped in `npm test`: needs network, Typesense and the server's decoders)
//
// ingest ~20 tracks into a temporary collection -> search them the way the game does -> generate
// levels with the server pipeline -> load them through the game's normal songById/loadChart.
// Uses its own collection and cache folder, and deletes both afterwards.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const RUN = !!process.env.ONLINE_IT;
const COLLECTION = `songs_it_${Date.now()}`;

describe.skipIf(!RUN)('online pipeline (live)', async () => {
  const { loadEnv } = await import('../tools/env.mjs');
  const { createPoliteFetch } = await import('../src/services/archive/http.js');
  const { createArchiveClient } = await import('../src/services/archive/ia-client.js');
  const { runIngest } = await import('../src/services/archive/ingest.js');
  const { compileBlocklist } = await import('../src/services/archive/content-filter.js');
  const { createTypesenseClient, typesenseConfig } = await import('../src/services/search/typesense.js');
  const { songsSchema } = await import('../src/services/search/schema.js');
  const { createOnlineSearch } = await import('../src/online/search-client.js');
  const { pipelineFromEnv } = await import('../server/lib/setup.js');
  const { toLevelSong } = await import('../src/online/level.js');
  const { registerOnlineSong } = await import('../src/online/registry.js');
  const { loadChart, songById } = await import('../src/songs/index.js');
  const { validateChart } = await import('../src/services/chartgen/validate.js');
  const blocklist = (await import('../src/config/content-blocklist.json', { with: { type: 'json' } })).default;

  const env = loadEnv(), cfg = typesenseConfig(env);
  const admin = createTypesenseClient(cfg);
  const dataDir = await mkdtemp(join(tmpdir(), 'rhythmeyez-it-'));
  afterAll(async () => {
    await fetch(`${cfg.url}/collections/${COLLECTION}`, { method: 'DELETE', headers: { 'X-TYPESENSE-API-KEY': cfg.apiKey } }).catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  });

  let songs = [];

  it('ingests about 20 tracks', async () => {
    await admin.ensureCollection(songsSchema(COLLECTION));
    const saved = {};
    const report = await runIngest({
      archive: createArchiveClient(createPoliteFetch({ minIntervalMs: 500 })),
      search: admin, collection: COLLECTION, sources: ['internet_archive'], limit: 20, batchSize: 10,
      mapOptions: { blocklist: compileBlocklist(blocklist) },
      state: { load: async s => saved[s] ?? null, save: async (s, st) => { saved[s] = st; } },
    });
    expect(report.tracks).toBe(20);
    expect(report.failed).toBe(0);
  }, 180000);

  it('finds them through the game\'s search path (top 5, explicit filtered)', async () => {
    const search = createOnlineSearch({ typesenseUrl: cfg.url, searchKey: cfg.apiKey, collection: COLLECTION, searchEnabled: true });
    const res = await search.search({ q: '' });
    expect(res.found).toBeGreaterThanOrEqual(5);
    expect(res.songs).toHaveLength(5);
    songs = res.songs;
    for (const s of songs) expect(s.attribution).toMatch(/ by .+ · CC|Public Domain/);
  }, 30000);

  it('generates levels and loads them with the existing level loader', async () => {
    const { pipeline } = await pipelineFromEnv({ ...env, TYPESENSE_COLLECTION: COLLECTION, ONLINE_LIBRARY_DIR: `${dataDir}/` }, { concurrent: 1 });
    let made = 0;
    for (const song of songs.slice(0, 3)) {
      const { entry } = await pipeline.charts(song.id);
      registerOnlineSong(toLevelSong(song, entry, entry.meta.levelSec));
      const level = songById(song.id);
      expect(level.online).toBe(true);
      for (const difficulty of ['practice', 'normal', 'hard']) {
        const chart = await loadChart(level, difficulty);
        expect(chart.notes.length).toBeGreaterThan(0);
        expect(validateChart(entry.charts[difficulty], { durationSec: entry.meta.levelSec })).toEqual([]);
      }
      const doc = await admin.getDocument(COLLECTION, song.id);
      expect(doc).toMatchObject({ chart_status: 'ready', bpm: entry.meta.bpm, difficulty: entry.meta.difficulty });
      made++;
    }
    expect(made).toBe(3);
  }, 240000);
});
