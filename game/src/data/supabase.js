// Optional remote database: Supabase (PostgreSQL) over its REST API, with no extra
// dependency. Enabled only when both variables are set (e.g. in game/.env.local):
//   VITE_SUPABASE_URL=https://<project>.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon key>
// Tables are created with db/schema.sql. Every write is an upsert on a client-made id, so
// retries never duplicate rows.

export function supabaseConfig(env = import.meta.env ?? {}) {
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

export function createSupabaseClient({ url, key }, fetchFn = globalThis.fetch) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    async upsert(table, rows) {
      const res = await fetchFn(`${url}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text().catch(() => '')}`);
    },
    async select(table, query = '') {
      const res = await fetchFn(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`);
      return res.json();
    },
  };
}
