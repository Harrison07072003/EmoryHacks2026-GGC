// Song search parameters for the `songs` collection. The Online Library builds every search
// (typed, gaze chips, voice) through buildSearchParams, so there is one search path.

export const QUERY_BY = 'title,artist,album,genre';
export const FACET_BY = 'genre,source,difficulty';

/** Sort options shown in the UI -> Typesense sort_by. */
export const SORTS = {
  relevance: '_text_match:desc,popularity:desc',
  popularity: 'popularity:desc',
  duration: 'duration:asc',
  bpm: 'bpm(missing_values: last):asc,popularity:desc',
  random: null,   // built per request from a seed, see buildSearchParams
};

/** Backtick-quote a filter value so commas, spaces and colons are safe. */
const quote = v => `\`${String(v).replace(/`/g, '')}\``;

/**
 * @param o { q, genres: string[], difficulties: number[], sources: string[], sort, page, perPage, seed }
 */
export function buildSearchParams({ q = '', genres = [], difficulties = [], sources = [], sort = 'relevance', page = 1, perPage = 20, seed = 0 } = {}) {
  const filters = [];
  if (genres.length) filters.push(`genre:=[${genres.map(quote).join(',')}]`);
  if (difficulties.length) filters.push(`difficulty:=[${difficulties.map(d => Math.round(d)).join(',')}]`);
  if (sources.length) filters.push(`source:=[${sources.map(quote).join(',')}]`);
  const query = String(q).trim();
  const sortBy = sort === 'random' ? `_rand(${Math.abs(Math.round(seed)) || 1}):desc` : SORTS[sort] ?? SORTS.relevance;
  return {
    q: query || '*',
    query_by: QUERY_BY,
    prefix: true,              // search-as-you-type
    num_typos: 2,
    typo_tokens_threshold: 1,
    drop_tokens_threshold: 1,
    filter_by: filters.join(' && ') || undefined,
    facet_by: FACET_BY,
    max_facet_values: 30,
    // relevance with an empty query has nothing to match: show popular first instead
    sort_by: !query && sort === 'relevance' ? SORTS.popularity : sortBy,
    page: Math.max(1, page | 0),
    per_page: Math.min(100, Math.max(1, perPage | 0)),
  };
}
