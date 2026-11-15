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
const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * @param http  createPoliteFetch() instance
 * @param log   progress/warning logger
 */
export function createArchiveClient(http, { log = () => {} } = {}) {
  async function scrape(query, cursor, fields) {
    // most downloaded first, so a --limit run gets the popular tracks
    const p = new URLSearchParams({ q: query, fields: fields.join(','), count: String(ROWS), sorts: 'downloads desc' });
    if (cursor) p.set('cursor', cursor);
    const res = await http.json(`${IA}/services/search/v1/scrape?${p}`);
    return { items: res.items ?? [], cursor: res.cursor ?? null, total: res.total ?? 0 };
  }

  // advancedsearch.php: page-number paging; used when the Scrape API misbehaves
  async function advanced(query, page, fields) {
    const p = new URLSearchParams({ q: query, rows: String(ROWS), page: String(page), output: 'json' });
    fields.forEach(f => p.append('fl[]', f));
    p.append('sort[]', 'downloads desc');
    const res = await http.json(`${IA}/advancedsearch.php?${p}`);
    const items = res.response?.docs ?? [], total = res.response?.numFound ?? 0;
    const next = items.length && page * ROWS < total ? `${ADV_PREFIX}${page + 1}` : null;
    return { items, cursor: next, at: `${ADV_PREFIX}${page}`, total };
  }

  return {
    /**
     * One page of search results. Pass the returned `cursor` to get the next page (null = done).
     * `expectCollections`: when given, a Scrape page whose items are not in those collections
     * is treated as a bad response (seen live: the endpoint returning a stale result for every
     * query) and paging switches to advancedsearch.php.
     * `at` (when present) is the cursor that re-fetches THIS page, for resuming mid-page.
     */
    async search(query, { cursor, expectCollections, fields = SCRAPE_FIELDS } = {}) {
      if (cursor?.startsWith(ADV_PREFIX)) return advanced(query, Number(cursor.slice(ADV_PREFIX.length)), fields);
      const page = await scrape(query, cursor, fields);
      const wrong = expectCollections && page.items.find(i => !asList(i.collection).some(c => expectCollections.includes(c)));
      if (!wrong) return page;
      log(`  ! Scrape API returned items outside the query (${wrong.identifier}); switching to advancedsearch.php`);
      return advanced(query, 1, fields);
    },
    metadata: identifier => http.json(`${IA}/metadata/${encodeURIComponent(identifier)}`),
  };
}
