// On-disk caches under online-library/ (generated content, gitignored):
//   audio/   first seconds of archive tracks, size-limited, least recently used evicted first
//   charts/  generated charts, one file per song and generator version
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const safeName = key => String(key).replace(/[^\w.-]/g, '_').slice(0, 200);

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/** LRU by file mtime (touched on every read). */
export function createAudioCache(dir, maxBytes) {
  const ready = mkdir(dir, { recursive: true });
  let evicting = null;

  async function evict() {
    const files = await Promise.all((await readdir(dir)).filter(f => !f.endsWith('.tmp')).map(async f => ({ f, ...(await stat(join(dir, f))) })));
    let total = files.reduce((s, x) => s + x.size, 0);
    for (const x of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= maxBytes) break;
      await rm(join(dir, x.f), { force: true });
      total -= x.size;
    }
  }

  return {
    async get(key) {
      await ready;
      const file = join(dir, safeName(key));
      try {
        const data = await readFile(file);
        const t = new Date();
        await utimes(file, t, t).catch(() => {});
        return data;
      } catch { return null; }
    },
    async put(key, bytes) {
      await ready;
      await writeAtomic(join(dir, safeName(key)), Buffer.from(bytes));
      evicting ??= evict().finally(() => { evicting = null; });
      await evicting;
    },
    async size() {
      await ready;
      const files = await readdir(dir);
      return (await Promise.all(files.map(f => stat(join(dir, f)).then(s => s.size)))).reduce((a, b) => a + b, 0);
    },
  };
}

/** Generated charts: charts/<songId>.v<generatorVersion>.json */
export function createChartStore(dir) {
  const ready = mkdir(dir, { recursive: true });
  const file = (id, version) => join(dir, `${safeName(id)}.v${version}.json`);
  return {
    async get(id, version) {
      await ready;
      try { return JSON.parse(await readFile(file(id, version), 'utf8')); } catch { return null; }
    },
    /** Delete every chart made by another generator version (run at server start). Returns the count. */
    async prune(version) {
      await ready;
      const stale = (await readdir(dir)).filter(f => /\.v\d+\.json$/.test(f) && !f.endsWith(`.v${version}.json`));
      await Promise.all(stale.map(f => rm(join(dir, f), { force: true })));
      return stale.length;
    },
    /** Writes this version and deletes the song's charts from older generator versions. */
    async put(id, version, entry) {
      await ready;
      await writeAtomic(file(id, version), `${JSON.stringify(entry)}\n`);
      const prefix = `${safeName(id)}.v`;
      for (const f of await readdir(dir)) {
        if (f.startsWith(prefix) && f.endsWith('.json') && f !== `${prefix}${version}.json` && /^\d+$/.test(f.slice(prefix.length, -5))) await rm(join(dir, f), { force: true });
      }
    },
  };
}
