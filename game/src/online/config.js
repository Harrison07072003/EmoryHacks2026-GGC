// Where the Online Library finds its services. Only PUBLIC values live here: the Typesense
// search-only (scoped) key and URLs. The admin key never reaches the browser.
//
// Build-time env (game/.env or the CI environment):
//   VITE_TYPESENSE_URL             e.g. https://xxx.a1.typesense.net  (empty in dev = Vite proxy /typesense)
//   VITE_TYPESENSE_SEARCH_API_KEY  scoped search-only key from `npm run typesense:setup`
//   VITE_TYPESENSE_COLLECTION      default songs
//   VITE_SERVER_URL                the Node server, e.g. https://rhythmeyez-api.onrender.com (empty in dev = Vite proxy /api)
//
// In dev the Vite server proxies /typesense and /api, so the game works through Coder's port
// forwarding without exposing more ports. A production build without these vars still works:
// built-in songs play and search shows "unavailable".

const trim = s => String(s ?? '').trim().replace(/\/+$/, '');

export function onlineConfig(env = import.meta.env ?? {}) {
  const base = env.BASE_URL ?? '/';
  const typesenseUrl = trim(env.VITE_TYPESENSE_URL) || (env.DEV ? trim(`${base}typesense`) : '');
  const serverUrl = trim(env.VITE_SERVER_URL) || (env.DEV ? trim(`${base}api`) : '');
  const searchKey = String(env.VITE_TYPESENSE_SEARCH_API_KEY ?? '').trim();
  return {
    typesenseUrl,
    searchKey,
    collection: String(env.VITE_TYPESENSE_COLLECTION ?? '').trim() || 'songs',
    serverUrl,
    searchEnabled: !!(typesenseUrl && searchKey),
  };
}
