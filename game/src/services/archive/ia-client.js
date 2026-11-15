// Internet Archive client: the Scrape API for paging through large result sets (cursor based,
// https://archive.org/services/search/v1/scrape) and the Metadata API for an item's files.
import { ARCHIVE_LICENSE_QUERY } from './licenses.js';

const IA = 'https://archive.org';
export const SCRAPE_FIELDS = ['identifier', 'title', 'creator', 'subject', 'licenseurl', 'date', 'downloads', 'collection'];

/**
 * Where each source's tracks come from. FMA's public API is discontinued; its catalogue is
 * mirrored on archive.org in the `freemusicarchive` collection (each item links back to FMA).
 *
 * Internet Archive defaults to `netlabels` only: labels publishing their own catalogues, so the
 * license is set by the rights holder. `opensource_audio` and `audio_music` are open user
 * uploads and contain mislabeled commercial music (e.g. TV soundtracks marked public domain);
 * opt in with --ia-collections if you accept that risk.
 */
export const OPT_IN_IA_COLLECTIONS = ['opensource_audio', 'audio_music'];
export const SOURCES = {
  internet_archive: { collections: ['netlabels'], exclude: ['freemusicarchive'] },
  fma: { collections: ['freemusicarchive'], exclude: [] },
};

/** Scrape query for a source: audio items in its collections with a CC/PD license URL. */
export function sourceQuery(source, collections = SOURCES[source].collections) {
  const inCols = collections.map(c => `collection:${c}`).join(' OR ');
  const notCols = SOURCES[source].exclude.map(c => ` AND NOT collection:${c}`).join('');
  return `mediatype:audio AND (${inCols}) AND ${ARCHIVE_LICENSE_QUERY}${notCols}`;
}

const ADV_PREFIX = 'adv:';
const ROWS = 100;
export const ADVANCED_MAX_RESULTS = 10000;   // archive.org's deep-paging limit for advancedsearch.php
const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Two ways to page through search results:
 *  - advancedsearch.php (default): page numbers, sorted by downloads, reliable, but archive.org
 *    stops at 10,000 results per query (HTTP 507 DEEP_PAGING) — the 10,000 most downloaded
 *    items, far more than the game needs.
 *  - Scrape API (opt-in, `useScrape`): cursor paging with no limit, but seen live returning
 *    results for a different query and repeating the same page for every cursor. Each page is
 *    validated; a bad page switches to advancedsearch.php.
 *
 * @param http  createPoliteFetch() instance
 * @param o     { log, useScrape }
 */
export function createArchiveClient(http, { log = () => {}, useScrape = false } = {}) {
  let lastScrapeFirst = null;

  async function scrape(query, cursor, fields) {
    const p = new URLSearchParams({ q: query, fields: fields.join(','), count: String(ROWS), sorts: 'downloads desc' });
    if (cursor) p.set('cursor', cursor);
    const res = await http.json(`${IA}/services/search/v1/scrape?${p}`);
    return { items: res.items ?? [], cursor: res.cursor ?? null, total: res.total ?? 0 };
  }

  async function advanced(query, page, fields) {
    if ((page - 1) * ROWS >= ADVANCED_MAX_RESULTS) {
      log(`  archive.org paging limit reached (${ADVANCED_MAX_RESULTS} items for one query); narrow it with --ia-collections for more`);
      return { items: [], cursor: null, at: `${ADV_PREFIX}${page}`, total: 0, capped: true };
    }
    const p = new URLSearchParams({ q: query, rows: String(ROWS), page: String(page), output: 'json' });
    fields.forEach(f => p.append('fl[]', f));
    p.append('sort[]', 'downloads desc');
    const res = await http.json(`${IA}/advancedsearch.php?${p}`);
    const items = res.response?.docs ?? [], total = res.response?.numFound ?? 0;
    const next = items.length && page * ROWS < Math.min(total, ADVANCED_MAX_RESULTS) ? `${ADV_PREFIX}${page + 1}` : null;
    return { items, cursor: next, at: `${ADV_PREFIX}${page}`, total };
  }

  return {
    /**
     * One page of search results, most downloaded first. Pass the returned `cursor` to get the
     * next page (null = done). `at` is the cursor that re-fetches THIS page (resume mid-page).
     * `expectCollections` lets a Scrape page be checked against the query.
     */
    async search(query, { cursor, expectCollections, fields = SCRAPE_FIELDS } = {}) {
      if (!useScrape || cursor?.startsWith(ADV_PREFIX)) return advanced(query, cursor ? Number(cursor.slice(ADV_PREFIX.length)) : 1, fields);
      const page = await scrape(query, cursor, fields);
      const first = page.items[0]?.identifier ?? null;
      const wrong = expectCollections && page.items.find(i => !asList(i.collection).some(c => expectCollections.includes(c)));
      const repeated = cursor && first !== null && first === lastScrapeFirst;
      lastScrapeFirst = first;
      if (!wrong && !repeated) return page;
      log(`  ! Scrape API ${wrong ? `returned items outside the query (${wrong.identifier})` : 'repeated the previous page'}; switching to advancedsearch.php`);
      return advanced(query, 1, fields);
    },
    metadata: identifier => http.json(`${IA}/metadata/${encodeURIComponent(identifier)}`),
  };
}
