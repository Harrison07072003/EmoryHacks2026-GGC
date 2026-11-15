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
    expect(p.filter_by).toBeUndefined();
  });

  it('empty query browses popular first', () => {
    expect(buildSearchParams({}).q).toBe('*');
    expect(buildSearchParams({}).sort_by).toBe('popularity:desc');
  });

  it('builds quoted filters and sorts', () => {
    const p = buildSearchParams({ genres: ['drum & bass', 'lo-fi, chill'], difficulties: [2, 3], sort: 'bpm', page: 3, perPage: 500 });
    expect(p.filter_by).toBe('genre:=[`drum & bass`,`lo-fi, chill`] && difficulty:=[2,3]');
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
  const scrapePage = (cols, cursor) => ({ items: [{ identifier: 'x', collection: cols }], cursor, total: 300 });
  const advPage = (n) => ({ response: { numFound: 250, docs: [{ identifier: `adv${n}`, collection: ['netlabels'] }] } });
  const client = responder => { const urls = []; return { urls, c: createArchiveClient({ json: async u => { urls.push(u); return responder(u); } }) }; };

  it('uses the Scrape API cursor when its results match the query', async () => {
    const { c, urls } = client(() => scrapePage(['label', 'netlabels'], 'CUR'));
    const page = await c.search('q', { expectCollections: ['netlabels'] });
    expect(page.cursor).toBe('CUR');
    expect(urls[0]).toContain('/services/search/v1/scrape?');
    expect(urls[0]).toContain('sorts=downloads+desc');
  });

  it('falls back to advancedsearch.php paging when Scrape returns unrelated items', async () => {
    const { c, urls } = client(u => (u.includes('scrape') ? scrapePage(['freemusicarchive'], 'CUR') : advPage(u.match(/page=(\d+)/)[1])));
    const p1 = await c.search('q', { expectCollections: ['netlabels'] });
    expect(p1.items[0].identifier).toBe('adv1');
    expect(p1.cursor).toBe('adv:2');
    const p2 = await c.search('q', { cursor: p1.cursor });
    expect(p2.items[0].identifier).toBe('adv2');
    expect((await c.search('q', { cursor: 'adv:3' })).cursor).toBeNull();   // 3 * 100 >= 250
    expect(urls.filter(u => u.includes('scrape'))).toHaveLength(1);
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
  const search = { importDocuments: async (c, docs) => { imported.push(...docs); return docs.map(() => ({ success: true })); } };
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

  it('dry run writes nothing and returns a sample', async () => {
    const f = fakes({ pages, items });
    const r = await runIngest({ ...f, search: null, sources: ['internet_archive'], dryRun: true, limit: 4 });
    expect(r.tracks).toBe(4);
    expect(r.sample).toHaveLength(3);
    expect(f.imported).toHaveLength(0);
    expect(f.saved).toEqual({});
  });
});
