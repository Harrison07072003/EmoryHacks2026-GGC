// Minimal Typesense REST client (no SDK, like data/supabase.js). The same code runs in the
// browser with a search-only key and in Node scripts/server with the admin key.

/** Server-side config from env: TYPESENSE_HOST / _PORT / _PROTOCOL + an API key. */
export function typesenseConfig(env = {}, { admin = true } = {}) {
  const apiKey = admin ? env.TYPESENSE_ADMIN_API_KEY : env.TYPESENSE_SEARCH_API_KEY;
  if (!env.TYPESENSE_HOST || !apiKey) return null;
  const protocol = env.TYPESENSE_PROTOCOL || 'http';
  const port = env.TYPESENSE_PORT || (protocol === 'https' ? '443' : '8108');
  return { url: `${protocol}://${env.TYPESENSE_HOST}:${port}`, apiKey, collection: env.TYPESENSE_COLLECTION || 'songs' };
}

export class TypesenseError extends Error {
  constructor(status, message) { super(`Typesense ${status}: ${message}`); this.status = status; }
}

export function createTypesenseClient({ url, apiKey }, fetchFn = globalThis.fetch) {
  const base = url.replace(/\/$/, '');
  async function call(method, path, { body, json = true, contentType = 'application/json' } = {}) {
    const res = await fetchFn(`${base}${path}`, {
      method, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      headers: { 'X-TYPESENSE-API-KEY': apiKey, 'Content-Type': contentType },
    });
    const text = await res.text();
    if (!res.ok) throw new TypesenseError(res.status, (() => { try { return JSON.parse(text).message; } catch { return text; } })());
    return json ? JSON.parse(text) : text;
  }

  return {
    health: () => call('GET', '/health'),
    getCollection: name => call('GET', `/collections/${encodeURIComponent(name)}`),
    createCollection: schema => call('POST', '/collections', { body: schema }),

    /** Create the collection if it does not exist. Returns true when it was created. */
    async ensureCollection(schema) {
      try { await call('GET', `/collections/${encodeURIComponent(schema.name)}`); return false; }
      catch (e) { if (e.status !== 404) throw e; }
      await call('POST', '/collections', { body: schema });
      return true;
    },

    /**
     * Bulk import (JSONL). action 'emplace' = create or partially update, so re-running
     * ingestion never wipes fields written later (bpm, chart_status...). Returns per-doc results.
     */
    async importDocuments(collection, docs, action = 'emplace') {
      if (!docs.length) return [];
      const text = await call('POST', `/collections/${encodeURIComponent(collection)}/documents/import?action=${action}`, {
        body: docs.map(d => JSON.stringify(d)).join('\n'), json: false, contentType: 'text/plain',
      });
      return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
    },

    /**
     * Add fields that exist in `schema` but not yet in the live collection (additive migration).
     * Returns the names added.
     */
    async ensureSchemaFields(schema) {
      const live = await call('GET', `/collections/${encodeURIComponent(schema.name)}`);
      const have = new Set(live.fields.map(f => f.name));
      const missing = schema.fields.filter(f => !have.has(f.name));
      if (missing.length) await call('PATCH', `/collections/${encodeURIComponent(schema.name)}`, { body: { fields: missing } });
      return missing.map(f => f.name);
    },

    /** Delete documents by id (missing ids are ignored). Returns the number deleted. */
    async deleteDocuments(collection, ids) {
      if (!ids.length) return 0;
      const filter = `id:[${ids.map(id => `\`${id}\``).join(',')}]`;
      const res = await call('DELETE', `/collections/${encodeURIComponent(collection)}/documents?filter_by=${encodeURIComponent(filter)}`);
      return res.num_deleted ?? 0;
    },

    updateDocument: (collection, id, fields) => call('PATCH', `/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`, { body: fields }),
    getDocument: (collection, id) => call('GET', `/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`),

    search(collection, params) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
      return call('GET', `/collections/${encodeURIComponent(collection)}/documents/search?${qs}`);
    },

    createKey: spec => call('POST', '/keys', { body: spec }),
    listKeys: () => call('GET', '/keys'),
  };
}
