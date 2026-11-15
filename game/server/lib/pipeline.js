// Song id -> level. Used by the server (GET /charts/:id) and by `npm run ingest -- --pregenerate N`.
//
//  1. look the song up in Typesense (the client only sends an id: no arbitrary URLs)
//  2. refuse anything not allowed: unknown, explicit/blocked, not a song, ND (or NC unless allowed), non-archive.org audio
//  3. first 30 s of audio: disk cache, else an HTTP Range download from archive.org
//  4. decode -> generate charts (services/chartgen) -> cache by song id + generator version
//  5. write bpm / difficulty / chart_status / chart_url back to the Typesense document
import { checkExplicit, compileBlocklist } from '../../src/services/archive/content-filter.js';
import { isLicenseAllowed } from '../../src/services/archive/licenses.js';
import { fetchStart, segmentByteBudget } from '../../src/online/audio-segment.js';
import { GENERATOR_VERSION, NotASongError, generateCharts } from '../../src/services/chartgen/generate.js';
import { DEFAULT_USER_AGENT } from '../../src/services/archive/http.js';
import { withTimeout } from './limits.js';

export const SONG_ID = /^(ia|fma)_[A-Za-z0-9._-]{1,200}$/;
const AUDIO_HOSTS = /^https:\/\/(archive\.org|[a-z0-9-]+\.us\.archive\.org)\/download\//;

export class NotFoundError extends Error {}

const defaultDecode = (...args) => import('./decode.js').then(m => m.decodeStart(...args));

/**
 * @param o { cfg (serverConfig), typesense (admin client or null), audioCache, chartStore, blocklist (raw json),
 *            queue (createJobQueue), fetchFn, log, decode (defaults to the WASM decoders, loaded on first use) }
 */
export function createPipeline({ cfg, typesense, audioCache, chartStore, blocklist = {}, queue, fetchFn = (...a) => globalThis.fetch(...a), log = () => {}, decode = defaultDecode }) {
  const compiled = compileBlocklist(blocklist);
  const collection = cfg.typesense?.collection ?? 'songs';
  const inFlight = new Map();

  async function lookup(id) {
    if (!SONG_ID.test(id)) throw new NotFoundError('invalid song id');
    if (!typesense) throw new Error('Typesense is not configured on the server');
    let doc;
    try { doc = await typesense.getDocument(collection, id); }
    catch (e) { if (e.status === 404) throw new NotFoundError('unknown song'); throw e; }
    const why = refusal(doc);
    if (why) throw new NotFoundError(`song not available: ${why}`);
    return doc;
  }

  function refusal(doc) {
    if (doc.is_explicit !== false) return 'explicit or unchecked';
    if (doc.is_song !== true) return 'not a playable song';
    if (checkExplicit({ id: doc.id, title: doc.title, artist: doc.artist, album: doc.album, tags: doc.genre }, compiled).explicit) return 'blocked';
    if (!isLicenseAllowed(doc.license_url, { allowNonCommercial: cfg.allowNonCommercial })) return 'license';
    if (!AUDIO_HOSTS.test(doc.audio_url ?? '')) return 'audio source';
    return null;
  }

  /** First `sec` seconds of the song's file (bytes), from the cache or archive.org. */
  async function audioStart(doc, sec = cfg.levelSec) {
    const key = `${doc.id}.${sec}s`;
    const cached = await audioCache.get(key);
    if (cached) return cached;
    const ua = { 'User-Agent': DEFAULT_USER_AGENT };
    const { bytes } = await fetchStart(doc.audio_url, segmentByteBudget(sec, doc.bitrate_kbps), { fetchFn: (url, init) => fetchFn(url, { ...init, headers: { ...init.headers, ...ua } }) });
    await audioCache.put(key, bytes);
    return Buffer.from(bytes);
  }

  async function setStatus(id, fields) {
    if (!typesense) return;
    try { await typesense.updateDocument(collection, id, fields); }
    catch (e) { log(`  ! could not update ${id} in Typesense: ${e.message}`); }
  }

  async function generate(doc) {
    await setStatus(doc.id, { chart_status: 'generating' });
    try {
      const bytes = await audioStart(doc);
      const audio = await decode(bytes, { name: doc.audio_url, maxSec: cfg.levelSec });
      const { charts, meta } = generateCharts({ channels: audio.channels, sampleRate: audio.sampleRate, songId: doc.id, levelSec: cfg.levelSec });
      const entry = {
        songId: doc.id, generatorVersion: GENERATOR_VERSION, createdAt: new Date().toISOString(), generated: true,
        meta, charts,
        song: { title: doc.title, artist: doc.artist, attribution: doc.attribution, licenseName: doc.license_name, licenseUrl: doc.license_url, itemUrl: doc.item_url },
      };
      await chartStore.put(doc.id, GENERATOR_VERSION, entry);
      await setStatus(doc.id, { chart_status: 'ready', chart_url: `/charts/${doc.id}`, chart_version: GENERATOR_VERSION, bpm: meta.bpm, difficulty: meta.difficulty });
      log(`  generated ${doc.id}: ${meta.bpm} BPM, difficulty ${meta.difficulty}`);
      return entry;
    } catch (e) {
      if (e instanceof NotASongError) {   // no clear beat after all: hide it from search
        await setStatus(doc.id, { chart_status: 'failed', is_song: false, rhythm_score: e.music.score });
        throw new NotFoundError(`not a playable song (${e.music.reasons.join('; ')})`);
      }
      await setStatus(doc.id, { chart_status: 'failed' });
      throw e;
    }
  }

  return {
    lookup, audioStart,
    /** Cached chart entry, or null (never generates). */
    cached: id => chartStore.get(id, GENERATOR_VERSION),

    /** Cached or newly generated charts for a song id. Concurrent calls share one job. */
    async charts(id) {
      const doc = await lookup(id);   // also re-checks the rules for cached songs (blocklist may have changed)
      const hit = await chartStore.get(id, GENERATOR_VERSION);
      if (hit) return { entry: hit, cached: true };
      if (!inFlight.has(id)) {
        const job = queue.run(() => withTimeout(generate(doc), cfg.limits.jobTimeoutMs, 'level generation took too long'));
        inFlight.set(id, job);
        job.finally(() => inFlight.delete(id)).catch(() => {});
      }
      return { entry: await inFlight.get(id), cached: false };
    },
  };
}
