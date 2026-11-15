// Ingestion loop: page through a source, map items to track documents, import them into
// Typesense in batches. Dependencies are injected (archive client, Typesense client, state
// store), so it runs from the CLI (tools/ingest.mjs) and in tests with fakes.
//
// Resumable: after every flushed batch the state stores the page cursor and the offset of the
// next item in that page. Idempotent: documents are emplaced by stable id, so re-running only
// refreshes metadata and never touches bpm/difficulty/chart fields.
import { itemToDocuments } from './metadata.js';
import { isLicenseAllowed, parseLicense } from './licenses.js';
import { SOURCES, sourceQuery } from './ia-client.js';

const freshState = () => ({ cursor: null, offset: 0, items: 0, tracks: 0, done: false });

/**
 * @param o {
 *   archive, search (null in dry run), collection, sources: string[], limit (tracks, Infinity = all),
 *   batchSize, dryRun, mapOptions: { allowNonCommercial, minSec, maxSec }, collections (IA override),
 *   state: { load(source), save(source, st) }, log
 * }
 * @returns {{ tracks, items, failed, skipped: Record<string, number>, sample: object[] }}
 */
export async function runIngest({ archive, search, collection = 'songs', sources, limit = Infinity, batchSize = 100, dryRun = false, mapOptions = {}, collections, state, log = () => {} }) {
  const report = { tracks: 0, items: 0, failed: 0, skipped: {}, sample: [] };
  const skip = reason => { const key = reason.startsWith('duration') ? 'duration out of range' : reason; report.skipped[key] = (report.skipped[key] ?? 0) + 1; };
  let buffer = [];

  async function flush() {
    if (!buffer.length) return;
    if (dryRun) { report.sample.push(...buffer.slice(0, Math.max(0, 3 - report.sample.length))); }
    else {
      const results = await search.importDocuments(collection, buffer, 'emplace');
      const bad = results.filter(r => !r.success);
      report.failed += bad.length;
      for (const r of bad.slice(0, 3)) log(`  ! import failed: ${r.error} ${r.document ?? ''}`.slice(0, 300));
    }
    report.tracks += buffer.length;
    buffer = [];
  }

  for (const source of sources) {
    const st = dryRun ? freshState() : { ...freshState(), ...(await state.load(source)) };
    if (st.done) { log(`${source}: already complete (use --restart to run again from the start)`); continue; }
    const cols = (source === 'internet_archive' && collections?.length) ? collections : SOURCES[source].collections;
    const query = sourceQuery(source, cols);
    log(`${source}: ${st.cursor ? 'resuming' : 'starting'} — ${query}`);

    const tracksAtStart = report.tracks;
    const save = async offset => { if (!dryRun) await state.save(source, { ...st, tracks: st.tracks + report.tracks - tracksAtStart, offset }); };
    while (true) {
      const firstPage = !st.cursor && !st.items;
      const page = await archive.search(query, { cursor: st.cursor, expectCollections: cols });
      if (page.at) st.cursor = page.at;   // the page actually served (after a fallback) is the one to resume
      if (firstPage) log(`${source}: ${page.total} matching items`);
      for (let i = st.offset; i < page.items.length; i++) {
        if (report.tracks + buffer.length >= limit) { await flush(); await save(i); return report; }
        const item = page.items[i];
        // the search result already carries the license: skip forbidden items without fetching them
        if (item.licenseurl && !isLicenseAllowed(item.licenseurl, mapOptions)) { skip(`license ${parseLicense(item.licenseurl).name}`); continue; }
        let meta;
        try { meta = await archive.metadata(item.identifier); }
        catch (e) { skip('metadata error'); log(`  - ${item.identifier}: ${e.message}`); continue; }
        const { docs, skipped } = itemToDocuments(meta, { source, popularity: item.downloads, ...mapOptions });
        skipped.forEach(s => skip(s.reason));
        const room = limit - report.tracks - buffer.length;
        buffer.push(...docs.slice(0, room));
        // limit hit inside this item: stop here and resume AT this item next time (emplace is idempotent)
        if (docs.length > room) { report.items++; await flush(); await save(i); return report; }
        st.items++; report.items++;
        if (buffer.length >= batchSize) {
          await flush();
          await save(i + 1);
          log(`  ${report.tracks} tracks from ${report.items} items`);
        }
      }
      await flush();
      st.offset = 0;
      if (!page.cursor || !page.items.length) { st.done = true; st.cursor = null; await save(0); log(`${source}: complete`); break; }
      st.cursor = page.cursor;
      await save(0);
    }
  }
  return report;
}
