// Online Library server: routes, validation, CORS, rate limits, the generation pipeline
// (refusals, caching, dedupe, Typesense write-back) and the disk caches. No network: Typesense,
// archive.org and the audio decoder are faked.
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { serverConfig } from '../server/lib/config.js';
import { createPipeline } from '../server/lib/pipeline.js';
import { BusyError, createJobQueue, createRateLimiter } from '../server/lib/limits.js';
import { createAudioCache, createChartStore } from '../server/lib/stores.js';
import { GENERATOR_VERSION } from '../src/services/chartgen/generate.js';
import defaultBlocklist from '../src/config/content-blocklist.json' with { type: 'json' };

const RATE = 22050;
const OK_LICENSE = 'http://creativecommons.org/licenses/by/4.0/';
const doc = (id, over = {}) => ({
  id, title: 'Song', artist: 'Artist', album: 'A', genre: ['rock'], license_url: OK_LICENSE, license_name: 'CC BY 4.0',
  attribution: '"Song" by Artist · CC BY 4.0', item_url: 'https://archive.org/details/x', is_explicit: false,
  audio_url: 'https://archive.org/download/x/song.mp3', bitrate_kbps: 128, ...over,
});

// 30 s of clicks at 120 BPM: what the fake decoder "decodes"
function clicks() {
  const x = new Float32Array(RATE * 30);
  for (let t = 0.5; t < 29; t += 0.5) for (let i = 0; i < 2000; i++) x[Math.round(t * RATE) + i] = Math.sin(i / 3) * Math.exp(-i / 300);
  return { channels: [x], sampleRate: RATE, duration: 30 };
}

let dir, server, base, updates, docs, downloads, decodes;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rhythmeyez-server-'));
  updates = []; downloads = 0; decodes = 0;
  docs = {
    ia_ok_1: doc('ia_ok_1'),
    ia_ok_2: doc('ia_ok_2'),
    ia_nd_1: doc('ia_nd_1', { license_url: 'http://creativecommons.org/licenses/by-nd/4.0/' }),
    ia_nc_1: doc('ia_nc_1', { license_url: 'http://creativecommons.org/licenses/by-nc/4.0/' }),
    ia_explicit_1: doc('ia_explicit_1', { title: 'Fucking Loud' }),
    ia_flag_1: doc('ia_flag_1', { is_explicit: true }),
    ia_host_1: doc('ia_host_1', { audio_url: 'https://evil.example/download/x.mp3' }),
    ia_blocked_1: doc('ia_blocked_1'),
  };
  const typesense = {
    getDocument: async (c, id) => { if (!docs[id]) throw Object.assign(new Error('nf'), { status: 404 }); return docs[id]; },
    updateDocument: async (c, id, fields) => { updates.push({ id, ...fields }); },
  };
  const cfg = { ...serverConfig({ CORS_ORIGINS: 'https://me.github.io', GENERATION_LIMIT_PER_MIN: '4', RATE_LIMIT_PER_MIN: '1000' }), dataDir: dir, typesense: { collection: 'songs' } };
  const pipeline = createPipeline({
    cfg, typesense,
    audioCache: createAudioCache(join(dir, 'audio'), 10 * 1024 * 1024),
    chartStore: createChartStore(join(dir, 'charts')),
    queue: createJobQueue({ concurrent: 1, queued: 5 }),
    blocklist: { ...defaultBlocklist, ids: ['ia_blocked_1'] },
    fetchFn: async (url, init) => { downloads++; expect(init.headers.Range).toMatch(/^bytes=0-/); return { ok: true, status: 206, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(1000) }; },
    decode: async () => { decodes++; return clicks(); },
  });
  server = createServer(createApp({ cfg, pipeline }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { server?.close(); await rm(dir, { recursive: true, force: true }); });

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers });

describe('server routes', () => {
  it('health', async () => {
    expect(await (await get('/health')).json()).toMatchObject({ ok: true, generatorVersion: GENERATOR_VERSION });
  });

  it('generates a level once, caches it and writes BPM/difficulty/status back to Typesense', async () => {
    const [a, b] = await Promise.all([get('/charts/ia_ok_1'), get('/charts/ia_ok_1')]);   // concurrent: one job
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    const body = await a.json();
    expect(body.charts.normal).toMatchObject({ format: 1, difficulty: 'normal' });
    expect(body.song.attribution).toContain('CC BY 4.0');
    expect(Math.abs(body.meta.bpm - 120)).toBeLessThan(2);
    expect(decodes).toBe(1);
    expect(updates.filter(u => u.id === 'ia_ok_1').map(u => u.chart_status)).toEqual(['generating', 'ready']);
    expect(updates.at(-1)).toMatchObject({ chart_url: '/charts/ia_ok_1', chart_version: GENERATOR_VERSION, difficulty: expect.any(Number), bpm: expect.any(Number) });
    const again = await (await get('/charts/ia_ok_1')).json();
    expect(again.cached).toBe(true);
    expect(decodes).toBe(1);
    expect((await readdir(join(dir, 'charts')))).toContain(`ia_ok_1.v${GENERATOR_VERSION}.json`);
  });

  it('refuses ND, NC (flag off), explicit, flagged, blocklisted, unknown and non-archive.org songs', async () => {
    for (const id of ['ia_nd_1', 'ia_nc_1', 'ia_explicit_1', 'ia_flag_1', 'ia_blocked_1', 'ia_unknown_1', 'ia_host_1']) {
      const res = await get(`/charts/${id}`);
      expect(res.status, id).toBe(404);
    }
    expect(decodes).toBe(1);   // nothing was generated for them
  });

  it('validates ids and methods', async () => {
    expect((await get('/charts/..%2F..%2Fetc%2Fpasswd')).status).toBe(400);
    expect((await get('/charts/x_123')).status).toBe(400);
    expect((await get('/charts/ia_' + 'a'.repeat(300))).status).toBe(400);
    expect((await get('/nope')).status).toBe(404);
    expect((await fetch(`${base}/charts/ia_ok_1`, { method: 'POST' })).status).toBe(405);
  });

  it('CORS only for the configured origins', async () => {
    const ok = await get('/health', { Origin: 'https://me.github.io' });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://me.github.io');
    const other = await get('/health', { Origin: 'https://evil.example' });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await fetch(`${base}/charts/ia_ok_1`, { method: 'OPTIONS', headers: { Origin: 'https://me.github.io' } });
    expect(pre.status).toBe(204);
  });

  it('audio proxy returns the cached first seconds', async () => {
    const res = await get('/audio/ia_ok_1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    const before = downloads;
    await get('/audio/ia_ok_1');
    expect(downloads).toBe(before);   // served from the disk cache
    expect((await get('/audio/ia_nd_1')).status).toBe(404);
  });

  it('rate-limits new generations per client, but not cache hits', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) { docs[`ia_many_${i}`] = doc(`ia_many_${i}`); statuses.push((await get(`/charts/ia_many_${i}`)).status); }
    expect(statuses).toContain(429);
    expect((await get('/charts/ia_ok_1')).status).toBe(200);   // cached: still served
  });
});

describe('limits and caches', () => {
  it('token bucket refills over time', () => {
    let t = 0;
    const rl = createRateLimiter({ perMin: 60, burst: 2, now: () => t });
    expect([rl.take('a').ok, rl.take('a').ok, rl.take('a').ok]).toEqual([true, true, false]);
    expect(rl.take('b').ok).toBe(true);   // per client
    t += 1000;
    expect(rl.take('a').ok).toBe(true);
  });

  it('job queue bounds concurrency and refuses when full', async () => {
    const q = createJobQueue({ concurrent: 1, queued: 1 });
    let release;
    const first = q.run(() => new Promise(r => { release = r; }));
    const second = q.run(async () => 'second');
    await expect(q.run(async () => 'third')).rejects.toBeInstanceOf(BusyError);
    release('first');
    expect(await first).toBe('first');
    expect(await second).toBe('second');
  });

  it('audio cache evicts the least recently used files over the size limit', async () => {
    const d = join(dir, 'lru');
    const cache = createAudioCache(d, 2500);
    await cache.put('a', new Uint8Array(1000));
    await new Promise(r => setTimeout(r, 20));
    await cache.put('b', new Uint8Array(1000));
    await new Promise(r => setTimeout(r, 20));
    await cache.get('a');                       // a is now more recent than b
    await new Promise(r => setTimeout(r, 20));
    await cache.put('c', new Uint8Array(1000)); // over 2500: b goes
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('a')).not.toBeNull();
    expect(await cache.get('c')).not.toBeNull();
    expect(await cache.size()).toBeLessThanOrEqual(2500);
  });

  it('chart store keeps only the current generator version of a song', async () => {
    const store = createChartStore(join(dir, 'versions'));
    await store.put('ia_v_1', 1, { v: 1 });
    await store.put('ia_v_10', 1, { other: true });
    await store.put('ia_v_1', 2, { v: 2 });
    expect(await store.get('ia_v_1', 1)).toBeNull();
    expect(await store.get('ia_v_1', 2)).toEqual({ v: 2 });
    expect(await store.get('ia_v_10', 1)).toEqual({ other: true });   // another song with a similar id is untouched
  });

  it('config reads the hosting env vars', () => {
    const c = serverConfig({ PORT: '10000', CORS_ORIGINS: 'https://a.github.io/, https://b.example', TRUST_PROXY: 'true', AUDIO_CACHE_MB: '50' });
    expect(c).toMatchObject({ port: 10000, corsOrigins: ['https://a.github.io', 'https://b.example'], trustProxy: true, audioCacheBytes: 50 * 1024 * 1024 });
    expect(serverConfig({}).typesense).toBeNull();
  });
});
