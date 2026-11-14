/** Minimal event emitter. `on` returns an unsubscribe function. */
export function createEmitter() {
  const subs = new Map();
  return {
    on(name, cb) {
      if (!subs.has(name)) subs.set(name, new Set());
      subs.get(name).add(cb);
      return () => subs.get(name).delete(cb);
    },
    emit(name, ...args) {
      for (const cb of [...(subs.get(name) ?? [])]) {
        try { cb(...args); } catch (e) { console.error(`eye-controller: error in ${name} handler`, e); }
      }
    },
  };
}
