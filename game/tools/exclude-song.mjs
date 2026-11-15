// npm run exclude-song -- <song id> [<song id> ...]
// Excludes specific archive songs by hand: adds their ids to src/config/content-blocklist.json
// (so ingestion never adds them again and the game filters them out of every search) and
// deletes them from the Typesense index right away. Commit the JSON change to share it.
import { loadEnv } from './env.mjs';
import { readBlocklist, writeBlocklist } from './blocklist.mjs';
import { createTypesenseClient, typesenseConfig } from '../src/services/search/typesense.js';

const ids = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (!ids.length) { console.error('Usage: npm run exclude-song -- <song id> [...]   (ids look like ia_<identifier>_<key> or fma_...)'); process.exit(2); }

const list = await readBlocklist();
const added = ids.filter(id => !list.ids.includes(id));
list.ids = [...list.ids, ...added].sort();
await writeBlocklist(list);
console.log(added.length ? `added to the blocklist: ${added.join(', ')}` : 'already in the blocklist');

const cfg = typesenseConfig(loadEnv());
if (!cfg) { console.log('Typesense not configured: the index was not changed (ingestion will skip these ids).'); process.exit(0); }
try {
  const n = await createTypesenseClient(cfg).deleteDocuments(cfg.collection, ids);
  console.log(`removed ${n} document(s) from "${cfg.collection}"`);
} catch (e) {
  console.error(`could not update Typesense (${e.message}); the blocklist was saved, so the game hides them anyway`);
  process.exit(1);
}
