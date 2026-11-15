// The ONE search path of the Online Library. Keyboard, gaze and voice all call search().
// Results: the top 5 by popularity. Explicit and hand-excluded songs are filtered here as a
// backup to the scoped search key and to ingestion.
import { createTypesenseClient } from '../services/search/typesense.js';
import { buildSearchParams } from '../services/search/query.js';
import blocklist from '../config/content-blocklist.json';
import { GENERATOR_VERSION } from '../services/chartgen/generate.js';

export const RESULT_COUNT = 5;
// Popularity is the archive ITEM's download count, so every track of a popular album ties.
// Fetch more candidates and keep at most one song per item, so the 5 are different releases.
const CANDIDATES = 30;

/** Top `n` songs, in order, preferring distinct items; repeats only fill remaining places. */
export function diversify(songs, n = RESULT_COUNT) {
  const picked = [], seen = new Set();
  for (const s of songs) if (picked.length < n && !seen.has(s.itemId)) { picked.push(s); seen.add(s.itemId); }
  for (const s of songs) if (picked.length < n && !picked.includes(s)) picked.push(s);
  return picked;
}

export class SearchUnavailable extends Error {}

/** Typesense document -> what the screens show and play. */
export function toSong(doc) {
  return {
    id: doc.id,
    itemId: String(doc.source_id ?? doc.id).split('/')[0],
    title: doc.title,
    artist: doc.artist,
    album: doc.album ?? '',
    genre: doc.genre ?? [],
    duration: doc.duration ?? 0,
    licenseName: doc.license_name ?? 'Creative Commons',
    licenseUrl: doc.license_url ?? '',
    attribution: doc.attribution ?? `"${doc.title}" by ${doc.artist}`,
    itemUrl: doc.item_url ?? '',
    audioUrl: doc.audio_url,
    bitrateKbps: doc.bitrate_kbps ?? 0,
    // a level made by an older generator version will be regenerated, so it is not 'ready'
    chartStatus: doc.chart_status === 'ready' && doc.chart_version !== GENERATOR_VERSION ? 'none' : doc.chart_status ?? 'none',
    bpm: doc.bpm ?? null,
    source: doc.source,
  };
}

/**
 * @param config  onlineConfig()
 * @param fetchFn injectable for tests
 */
export function createOnlineSearch(config, fetchFn = (...a) => globalThis.fetch(...a)) {
  const ts = config.searchEnabled ? createTypesenseClient({ url: config.typesenseUrl, apiKey: config.searchKey }, fetchFn) : null;
  const excludeIds = blocklist.ids ?? [];
  let genresPromise = null;

  async function run(params) {
    if (!ts) throw new SearchUnavailable('Online search is not configured');
    try { return await ts.search(config.collection, params); }
    catch (e) { throw new SearchUnavailable(e.message); }
  }

  return {
    get available() { return !!ts; },

    /**
     * @param o { q: text, genre: exact genre value or null }
     * @returns {{ songs: object[], found: number, query: { q, genre } }}
     */
    async search({ q = '', genre = null } = {}) {
      const params = buildSearchParams({ q, genres: genre ? [genre] : [], sort: 'popularity', perPage: CANDIDATES, excludeIds });
      const res = await run(params);
      const all = (res.hits ?? []).map(h => toSong(h.document)).filter(s => s.audioUrl && !excludeIds.includes(s.id));
      return { songs: diversify(all), found: res.found ?? all.length, query: { q, genre } };
    },

    /** Known genre values (most common first), for matching spoken genres. Cached; [] on failure. */
    genres() {
      genresPromise ??= run({ ...buildSearchParams({ excludeIds }), per_page: 0, facet_by: 'genre', max_facet_values: 150 })
        .then(res => res.facet_counts?.find(f => f.field_name === 'genre')?.counts.map(c => c.value) ?? [])
        .catch(() => { genresPromise = null; return []; });
      return genresPromise;
    },
  };
}
