// npm run render:keys
// Makes the keys for the Render search service, once. Prints:
//   - two SECRET values for Render (Environment): TYPESENSE_ADMIN_API_KEY, TYPESENSE_SEARCH_PARENT_KEY
//   - one PUBLIC value for the website (GitHub -> Settings -> Secrets and variables -> Actions ->
//     Variables): VITE_TYPESENSE_SEARCH_API_KEY, a scoped key derived from the parent key.
// Render recreates the parent key with the same value on every start, so the website's key keeps
// working after restarts. Run it again only to replace all three (then update both places).
import { randomBytes } from 'node:crypto';
import { envFlag, loadEnv } from './env.mjs';
import { scopedSearchKey } from './typesense-setup.mjs';

const env = loadEnv();
const admin = randomBytes(24).toString('hex'), parent = randomBytes(24).toString('hex');
const filter = `is_explicit:false && is_song:true${envFlag(env.ALLOW_NONCOMMERCIAL, false) ? '' : ' && is_commercial_ok:true'}`;
const client = scopedSearchKey(parent, { filter_by: filter });

console.log('\n=== Render -> your search service -> Environment (keep these SECRET) ===\n');
console.log(`TYPESENSE_ADMIN_API_KEY=${admin}`);
console.log(`TYPESENSE_SEARCH_PARENT_KEY=${parent}`);
console.log('\n=== GitHub -> Settings -> Secrets and variables -> Actions -> Variables (public) ===\n');
console.log(`VITE_TYPESENSE_SEARCH_API_KEY=${client}`);
console.log('VITE_TYPESENSE_URL=https://<your-service>.onrender.com\n');
console.log(`(the search key only allows searching songs where ${filter})\n`);
