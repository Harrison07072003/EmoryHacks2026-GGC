// Tiny async key-value storage abstraction. Everything above this file only uses
// get / set / delete / keys, so swapping localStorage for IndexedDB is one line:
//   createEyeController({ storage: indexedDbStore() })
// Values are plain JSON-safe objects.

export function memoryStore() {
  const m = new Map();
  return {
    async get(key) { return m.has(key) ? JSON.parse(m.get(key)) : null; },
    async set(key, value) { m.set(key, JSON.stringify(value)); },
    async delete(key) { m.delete(key); },
    async keys(prefix = '') { return [...m.keys()].filter(k => k.startsWith(prefix)); },
  };
}

export function localStorageStore(namespace = 'eyectl', ls = globalThis.localStorage) {
  const full = key => `${namespace}:${key}`;
  return {
    async get(key) { const raw = ls.getItem(full(key)); return raw === null ? null : JSON.parse(raw); },
    async set(key, value) { ls.setItem(full(key), JSON.stringify(value)); },
    async delete(key) { ls.removeItem(full(key)); },
    async keys(prefix = '') {
      const start = full(prefix), out = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k.startsWith(start)) out.push(k.slice(namespace.length + 1));
      }
      return out;
    },
  };
}

export function indexedDbStore(dbName = 'eyectl', idb = globalThis.indexedDB) {
  const STORE = 'kv';
  const wrap = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  let opening = null;
  const db = () => (opening ??= new Promise((resolve, reject) => {
    const req = idb.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => wrap(fn((await db()).transaction(STORE, mode).objectStore(STORE)));
  return {
    async get(key) { return (await run('readonly', s => s.get(key))) ?? null; },
    async set(key, value) { await run('readwrite', s => s.put(value, key)); },
    async delete(key) { await run('readwrite', s => s.delete(key)); },
    async keys(prefix = '') { return (await run('readonly', s => s.getAllKeys())).filter(k => String(k).startsWith(prefix)); },
  };
}

/** localStorage in a browser, in-memory elsewhere (tests, private windows that block storage). */
export function defaultStore() {
  try {
    const ls = globalThis.localStorage;
    ls.setItem('eyectl:probe', '1'); ls.removeItem('eyectl:probe');
    return localStorageStore();
  } catch { return memoryStore(); }
}
