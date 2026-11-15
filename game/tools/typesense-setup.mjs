// npm run typesense:setup
// Creates the `songs` collection (if missing) and a SEARCH-ONLY API key limited to it, then
// prints the key to put in .env as TYPESENSE_SEARCH_API_KEY / VITE_TYPESENSE_SEARCH_API_KEY.
// The admin key is only ever used here, in tools/ingest.mjs and in game/server.
//
// The printed key is a *scoped* key with a filter embedded that Typesense applies to every
// search: `is_explicit:false && is_song:true`, plus `is_commercial_ok:true` unless
// ALLOW_NONCOMMERCIAL=true. So the game can never see explicit, non-song or NC tracks.
import { createHmac } from 'node:crypto';
import { envFlag, loadEnv } from './env.mjs';
import { createTypesenseClient, typesenseConfig } from '../src/services/search/typesense.js';
import { songsSchema } from '../src/services/search/schema.js';

/** Typesense scoped key: base64(hmac_sha256_base64(params, key) + key[0:4] + params). */
export function scopedSearchKey(searchKey, params) {
  const json = JSON.stringify(params);
  const digest = createHmac('sha256', searchKey).update(json).digest('base64');
  return Buffer.from(`${digest}${searchKey.slice(0, 4)}${json}`).toString('base64');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv(), cfg = typesenseConfig(env);
  if (!cfg) { console.error('Set TYPESENSE_HOST and TYPESENSE_ADMIN_API_KEY first (see game/.env.example).'); process.exit(2); }
  const ts = createTypesenseClient(cfg);
  await ts.health().catch(e => { console.error(`Typesense not reachable at ${cfg.url}: ${e.message}`); process.exit(1); });
  if (await ts.ensureCollection(songsSchema(cfg.collection))) console.log(`created collection "${cfg.collection}"`);
  else {
    const added = await ts.ensureSchemaFields(songsSchema(cfg.collection));
    console.log(`collection "${cfg.collection}" exists${added.length ? `; added fields: ${added.join(', ')}` : ''}`);
    await backfillItemIds(ts, cfg);
  }

  const key = await ts.createKey({ description: `RhythmEyez game client: search ${cfg.collection} only`, actions: ['documents:search'], collections: [cfg.collection] });
  const filter = `is_explicit:false && is_song:true${envFlag(env.ALLOW_NONCOMMERCIAL, false) ? '' : ' && is_commercial_ok:true'}`;
  const clientKey = scopedSearchKey(key.value, { filter_by: filter });
  console.log(`\nSearch-only key (id ${key.id}, scoped to "${filter}"). Put this in game/.env:\n`);
  console.log(`TYPESENSE_SEARCH_API_KEY=${clientKey}`);
  console.log(`VITE_TYPESENSE_SEARCH_API_KEY=${clientKey}`);
}

/** Older documents have no item_id (used to show one song per release): derive it from source_id. */
async function backfillItemIds(ts, cfg) {
  const res = await fetch(`${cfg.url}/collections/${cfg.collection}/documents/export?include_fields=id,source,source_id,item_id`, { headers: { 'X-TYPESENSE-API-KEY': cfg.apiKey } });
  const docs = (await res.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(d => !d.item_id && d.source_id);
  if (!docs.length) return;
  const updates = docs.map(d => ({ id: d.id, item_id: `${d.source === 'fma' ? 'fma' : 'ia'}_${d.source_id.split('/')[0]}` }));
  const results = await ts.importDocuments(cfg.collection, updates, 'update');
  console.log(`added item_id to ${results.filter(r => r.success).length} existing document(s)`);
}
