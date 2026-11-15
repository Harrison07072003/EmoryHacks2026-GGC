// Abuse protection: per-client token buckets and a bounded job queue for chart generation.

/** Token bucket per key: `perMin` requests per minute, bursts up to `burst`. */
export function createRateLimiter({ perMin, burst = Math.max(1, Math.ceil(perMin / 4)), now = () => Date.now() }) {
  const buckets = new Map();
  const rate = perMin / 60000;
  return {
    /** @returns { ok, retryAfterSec } */
    take(key) {
      const t = now();
      const b = buckets.get(key) ?? { tokens: burst, at: t };
      b.tokens = Math.min(burst, b.tokens + (t - b.at) * rate);
      b.at = t;
      buckets.set(key, b);
      if (buckets.size > 10000) for (const [k, v] of buckets) if (t - v.at > 600000) buckets.delete(k);   // forget idle clients
      if (b.tokens >= 1) { b.tokens -= 1; return { ok: true, retryAfterSec: 0 }; }
      return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / rate / 1000) };
    },
  };
}

export class BusyError extends Error {}

/** Runs at most `concurrent` jobs; at most `queued` wait; the rest are refused (BusyError). */
export function createJobQueue({ concurrent, queued }) {
  let running = 0;
  const waiting = [];
  const next = () => { if (running < concurrent && waiting.length) { running++; waiting.shift()(); } };
  return {
    get running() { return running; },
    get waiting() { return waiting.length; },
    async run(job) {
      if (running >= concurrent && waiting.length >= queued) throw new BusyError('the server is busy generating levels; try again in a minute');
      await new Promise(resolve => { waiting.push(resolve); next(); });
      try { return await job(); } finally { running--; next(); }
    },
  };
}

/** Reject after `ms`. */
export function withTimeout(promise, ms, message = 'timed out') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}
