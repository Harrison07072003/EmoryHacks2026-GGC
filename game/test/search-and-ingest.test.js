import { describe, expect, it } from 'vitest';
import { buildSearchParams } from '../src/services/search/query.js';
import { createPoliteFetch } from '../src/services/archive/http.js';
import { createArchiveClient, sourceQuery } from '../src/services/archive/ia-client.js';
import { runIngest } from '../src/services/archive/ingest.js';
import { typesenseConfig } from '../src/services/search/typesense.js';

describe('search params', () => {
  it('search-as-you-type over title/artist/album/genre with typos and facets', () => {
    const p = buildSearchParams({ q: 'lofi bea' });
    expect(p).toMatchObject({ q: 'lofi bea', query_by: 'title,artist,album,genre', prefix: true, num_typos: 2, facet_by: 'genre,source,difficulty', page: 1, per_page: 20 });
    expect(p.sort_by).toBe('_text_match:desc,popularity:desc');
    expect(p.filter_by).toBe('is_explicit:false && is_song:true');
  });

  it('empty query browses popular first', () => {
    expect(buildSearchParams({}).q).toBe('*');
    expect(buildSearchParams({}).sort_by).toBe('popularity:desc');
  });

  it('builds quoted filters and sorts', () => {
    const p = buildSearchParams({ genres: ['drum & bass', 'lo-fi, chill'], difficulties: [2, 3], sort: 'bpm', page: 3, perPage: 500 });
    expect(p.filter_by).toBe('is_explicit:false && is_song:true && genre:=[`drum & bass`,`lo-fi, chill`] && difficulty:=[2,3]');
    expect(buildSearchParams({ excludeIds: ['ia_a_1', 'fma_b'] }).filter_by).toBe('is_explicit:false && is_song:true && id:!=[`ia_a_1`,`fma_b`]');
    expect(p.sort_by).toBe('bpm(missing_values: last):asc,popularity:desc');
    expect(p.page).toBe(3);
    expect(p.per_page).toBe(100);
    expect(buildSearchParams({ sort: 'random', seed: 42 }).sort_by).toBe('_rand(42):desc');
  });
});

describe('config and source queries', () => {
  it('reads Typesense env (local and cloud)', () => {
    expect(typesenseConfig({})).toBeNull();
    expect(typesenseConfig({ TYPESENSE_HOST: 'localhost', TYPESENSE_ADMIN_API_KEY: 'k' })).toEqual({ url: 'http://localhost:8108', apiKey: 'k', collection: 'songs' });
    expect(typesenseConfig({ TYPESENSE_HOST: 'x.typesense.net', TYPESENSE_PROTOCOL: 'https', TYPESENSE_SEARCH_API_KEY: 's' }, { admin: false }).url).toBe('https://x.typesense.net:443');
  });

  it('keeps FMA mirrors out of the internet_archive source', () => {
    expect(sourceQuery('internet_archive')).toContain('NOT collection:freemusicarchive');
    expect(sourceQuery('fma')).toContain('(collection:freemusicarchive)');
  });
});

describe('polite fetch', () => {
  const response = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => null } });

  it('retries 429/5xx with backoff and sends the User-Agent', async () => {
    const calls = [], codes = [503, 429, 200];
    const http = createPoliteFetch({ minIntervalMs: 0, baseDelayMs: 1, userAgent: 'UA/1', fetch: async (url, init) => { calls.push(init.headers['User-Agent']); return response(codes.shift(), { ok: 1 }); } });
    expect(await http.json('u')).toEqual({ ok: 1 });
    expect(calls).toEqual(['UA/1', 'UA/1', 'UA/1']);
  });

  it('does not retry 404 and gives up after the retry budget', async () => {
    let n = 0;
    const http404 = createPoliteFetch({ minIntervalMs: 0, baseDelayMs: 1, fetch: async () => { n++; return response(404); } });
    await expect(http404.json('u')).rejects.toThrow('HTTP 404');
    expect(n).toBe(1);
    n = 0;
    const http500 = createPoliteFetch({ minIntervalMs: 0, baseDelayMs: 1, retries: 2, fetch: async () => { n++; return response(500); } });
    await expect(http500.json('u')).rejects.toThrow('HTTP 500');
    expect(n).toBe(3);
  });
});

describe('archive client paging', () => {
  const scrapePage = (cols, cursor, first = 'x') => ({ items: [{ identifier: first, collection: cols }], cursor, total: 300 });
  const advPage = n => ({ response: { numFound: 250, docs: [{ identifier: `adv${n}`, collection: ['netlabels'] }] } });
  const client = (responder, opts) => { const urls = []; return { urls, c: createArchiveClient({ json: async u => { urls.push(u); return responder(u); } }, opts) }; };
  const adv = u => advPage(u.match(/page=(\d+)/)[1]);

  it('pages with advancedsearch.php by default, most downloaded first', async () => {
    const { c, urls } = client(adv);
    const p1 = await c.search('q');
    expect(urls[0]).toContain('/advancedsearch.php?');
    expect(urls[0]).toContain('sort%5B%5D=downloads+desc');
    expect(p1).toMatchObject({ cursor: 'adv:2', at: 'adv:1' });
    expect((await c.search('q', { cursor: 'adv:3' })).cursor).toBeNull();   // 3 * 100 >= 250
  });

  it('stops at the 10,000-result deep-paging limit without calling the API', async () => {
    const { c, urls } = client(() => ({ response: { numFound: 50000, docs: [{ identifier: 'z' }] } }));
    expect((await c.search('q', { cursor: 'adv:100' })).cursor).toBeNull();
    const beyond = await c.search('q', { cursor: 'adv:101' });
    expect(beyond).toMatchObject({ items: [], cursor: null, capped: true });
    expect(urls).toHaveLength(1);
  });

  it('opt-in Scrape API: uses its cursor while results look right', async () => {
    const { c, urls } = client(() => scrapePage(['label', 'netlabels'], 'CUR'), { useScrape: true });
    expect((await c.search('q', { expectCollections: ['netlabels'] })).cursor).toBe('CUR');
    expect(urls[0]).toContain('/services/search/v1/scrape?');
  });

  it('opt-in Scrape API: falls back when results are for another query', async () => {
    const { c } = client(u => (u.includes('scrape') ? scrapePage(['freemusicarchive'], 'CUR') : adv(u)), { useScrape: true });
    expect((await c.search('q', { expectCollections: ['netlabels'] })).items[0].identifier).toBe('adv1');
  });

  it('opt-in Scrape API: falls back when the next cursor repeats the same page', async () => {
    const { c } = client(u => (u.includes('scrape') ? scrapePage(['netlabels'], 'SAME', 'NS050') : adv(u)), { useScrape: true });
    expect((await c.search('q', { expectCollections: ['netlabels'] })).items[0].identifier).toBe('NS050');
    expect((await c.search('q', { cursor: 'SAME', expectCollections: ['netlabels'] })).items[0].identifier).toBe('adv1');
  });
});

// ---- ingestion against fakes ----
const LIC = 'http://creativecommons.org/licenses/by/4.0/';
const meta = (id, tracks = 2, licenseurl = LIC) => ({
  metadata: { identifier: id, title: id, creator: 'A', licenseurl, subject: ['rock'] },
  files: Array.from({ length: tracks }, (_, i) => ({ name: `${i}.mp3`, source: 'original', format: 'VBR MP3', length: '120' })),
});

function fakes({ pages, items }) {
  const imported = [];
  const archive = {
    search: async (q, { cursor }) => pages[cursor ?? 'start'],
    metadata: async id => { if (!items[id]) throw new Error('HTTP 404'); return items[id]; },
  };
  const search = { importDocuments: async (c, docs) => { imported.push(...docs); return docs.map(() => ({ success: true })); }, deleteDocuments: async (c, ids) => ids.length };
  const saved = {};
  const state = { load: async s => saved[s] ?? null, save: async (s, st) => { saved[s] = JSON.parse(JSON.stringify(st)); } };
  return { archive, search, state, imported, saved };
}

describe('runIngest', () => {
  const pages = {
    start: { items: [{ identifier: 'a', downloads: 5 }, { identifier: 'nd' }, { identifier: 'missing' }], cursor: 'p2', total: 5 },
    p2: { items: [{ identifier: 'b' }, { identifier: 'c' }], cursor: null, total: 5 },
  };
  const items = { a: meta('a'), nd: meta('nd', 2, 'http://creativecommons.org/licenses/by-nd/4.0/'), b: meta('b'), c: meta('c', 3) };

  it('imports every allowed track, skips broken/forbidden items and marks the source done', async () => {
    const f = fakes({ pages, items });
    const r = await runIngest({ ...f, sources: ['internet_archive'], batchSize: 2 });
    expect(f.imported.map(d => d.id.split('_')[1])).toEqual(['a', 'a', 'b', 'b', 'c', 'c', 'c']);
    expect(f.imported[0].popularity).toBe(5);
    expect(r).toMatchObject({ tracks: 7, failed: 0 });
    expect(r.skipped).toMatchObject({ 'metadata error': 1 });
    expect(Object.keys(r.skipped).some(k => k.startsWith('license CC BY-ND'))).toBe(true);
    expect(f.saved.internet_archive.done).toBe(true);
  });

  it('stops at --limit and resumes where it stopped without duplicates or gaps', async () => {
    const f = fakes({ pages, items });
    const r1 = await runIngest({ ...f, sources: ['internet_archive'], limit: 3, batchSize: 2 });
    expect(r1.tracks).toBe(3);
    expect(f.saved.internet_archive).toMatchObject({ cursor: 'p2', offset: 0, done: false });
    const r2 = await runIngest({ ...f, sources: ['internet_archive'], batchSize: 2 });
    // item b is re-imported (it was cut by the limit); emplace makes that harmless
    expect(new Set(f.imported.map(d => d.id)).size).toBe(7);
    expect(r2.tracks).toBe(5);
    expect(f.saved.internet_archive.done).toBe(true);
    const r3 = await runIngest({ ...f, sources: ['internet_archive'] });
    expect(r3.tracks).toBe(0);
  });

  it('skips forbidden licenses from the search result without fetching metadata', async () => {
    const f = fakes({ pages: { start: { items: [{ identifier: 'x', licenseurl: 'http://creativecommons.org/licenses/by-nc-nd/4.0/' }, { identifier: 'a', licenseurl: LIC }], cursor: null } }, items });
    const fetched = [], metadata = f.archive.metadata;
    f.archive.metadata = id => { fetched.push(id); return metadata(id); };
    await runIngest({ ...f, sources: ['internet_archive'] });
    expect(fetched).toEqual(['a']);
  });

  it('stops a source when the archive keeps returning pages it already processed', async () => {
    const loop = { start: { items: [{ identifier: 'a' }], cursor: 'again' }, again: { items: [{ identifier: 'a' }], cursor: 'again' } };
    const f = fakes({ pages: loop, items });
    const r = await runIngest({ ...f, sources: ['internet_archive'] });
    expect(r.tracks).toBe(2);
    expect(f.imported).toHaveLength(2);
  });

  it('with an audio check, keeps only songs (marked is_song + rhythm_score) and removes the rest', async () => {
    const f = fakes({ pages: { start: { items: [{ identifier: 'a' }, { identifier: 'c' }], cursor: null } }, items });
    const removed = [];
    f.search.deleteDocuments = async (c, ids) => { removed.push(...ids); return ids.length; };
    const checked = [];
    const checkAudio = async d => { checked.push(d.id); return d.source_id.startsWith('a/') ? { isSong: true, score: 0.6, reasons: [] } : { isSong: false, score: 0.05, reasons: ['no clear beat'] }; };
    const r = await runIngest({ ...f, sources: ['internet_archive'], checkAudio });
    expect(f.imported.map(d => [d.source_id, d.is_song, d.rhythm_score])).toEqual([['a/0.mp3', true, 0.6], ['a/1.mp3', true, 0.6]]);
    expect(r.skipped['not a song (audio check)']).toBe(3);
    expect(removed).toHaveLength(3);
  });

  it('stops downloading an album whose first 3 tracks are not songs', async () => {
    const f = fakes({ pages: { start: { items: [{ identifier: 'big' }], cursor: null } }, items: { big: meta('big', 8) } });
    const checked = [];
    await runIngest({ ...f, sources: ['internet_archive'], checkAudio: async d => { checked.push(d.id); return { isSong: false, score: 0, reasons: ['x'] }; } });
    expect(checked).toHaveLength(3);
    expect(f.imported).toHaveLength(0);
  });

  it('skips items tagged as non-music before any audio is checked', async () => {
    const speech = { ...meta('talk'), metadata: { ...meta('talk').metadata, subject: ['Spoken Word', 'poetry'] } };
    const f = fakes({ pages: { start: { items: [{ identifier: 'talk' }], cursor: null } }, items: { talk: speech } });
    let checks = 0;
    const r = await runIngest({ ...f, sources: ['internet_archive'], checkAudio: async () => { checks++; return { isSong: true, score: 1, reasons: [] }; } });
    expect(checks).toBe(0);
    expect(r.skipped['not music (tags)']).toBe(1);
  });

  it('dry run writes nothing and returns a sample', async () => {
    const f = fakes({ pages, items });
    const r = await runIngest({ ...f, search: null, sources: ['internet_archive'], dryRun: true, limit: 4 });
    expect(r.tracks).toBe(4);
    expect(r.sample).toHaveLength(3);
    expect(f.imported).toHaveLength(0);
    expect(f.saved).toEqual({});
  });
});

describe('result diversity', async () => {
  const { diversify } = await import('../src/online/search-client.js');
  const s = (id, itemId) => ({ id, itemId });
  it('keeps popularity order but at most one song per release, filling with repeats only if needed', () => {
    const ranked = [s('a1', 'A'), s('a2', 'A'), s('b1', 'B'), s('a3', 'A'), s('c1', 'C'), s('d1', 'D'), s('e1', 'E'), s('f1', 'F')];
    expect(diversify(ranked).map(x => x.id)).toEqual(['a1', 'b1', 'c1', 'd1', 'e1']);
    expect(diversify([s('a1', 'A'), s('a2', 'A'), s('b1', 'B')]).map(x => x.id)).toEqual(['a1', 'b1', 'a2']);
  });
});

describe('online config and the unavailable path', async () => {
  const { onlineConfig } = await import('../src/online/config.js');
  const { createOnlineSearch, SearchUnavailable } = await import('../src/online/search-client.js');

  it('dev defaults to the Vite proxy under the base path; production needs explicit URLs', () => {
    expect(onlineConfig({ DEV: true, BASE_URL: '/', VITE_TYPESENSE_SEARCH_API_KEY: 'k' })).toMatchObject({ typesenseUrl: '/typesense', serverUrl: '/api', searchEnabled: true });
    expect(onlineConfig({ DEV: true, BASE_URL: '/repo/', VITE_TYPESENSE_SEARCH_API_KEY: 'k' }).typesenseUrl).toBe('/repo/typesense');
    expect(onlineConfig({ DEV: false, BASE_URL: '/repo/', VITE_TYPESENSE_SEARCH_API_KEY: 'k' })).toMatchObject({ typesenseUrl: '', serverUrl: '', searchEnabled: false });
    expect(onlineConfig({ DEV: false, VITE_TYPESENSE_URL: 'https://x.typesense.net/', VITE_TYPESENSE_SEARCH_API_KEY: 'k', VITE_SERVER_URL: 'https://api.example/' }))
      .toMatchObject({ typesenseUrl: 'https://x.typesense.net', serverUrl: 'https://api.example', searchEnabled: true });
    expect(onlineConfig({ DEV: true }).searchEnabled).toBe(false);   // no key: unavailable, game still works
  });

  it('search reports "unavailable" when not configured or when Typesense is down', async () => {
    await expect(createOnlineSearch(onlineConfig({ DEV: false })).search({ q: 'x' })).rejects.toBeInstanceOf(SearchUnavailable);
    const down = createOnlineSearch(onlineConfig({ DEV: true, BASE_URL: '/', VITE_TYPESENSE_SEARCH_API_KEY: 'k' }), async () => { throw new TypeError('fetch failed'); });
    await expect(down.search({ q: 'x' })).rejects.toBeInstanceOf(SearchUnavailable);
    expect(await down.genres()).toEqual([]);
  });
});
