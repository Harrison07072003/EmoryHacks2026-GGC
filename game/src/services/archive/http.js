// Polite HTTP for public archives: one request at a time with a minimum gap, a descriptive
// User-Agent, and retries with exponential backoff (honouring Retry-After) on 429/5xx and
// network errors. Works in Node 20+ and the browser (fetch is injected for tests).

export const DEFAULT_USER_AGENT = 'RhythmEyez-ingest/1.0 (open-source eye-tracked rhythm game; indexes openly licensed music)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} for ${url}`); this.status = status; this.url = url; }
}

/**
 * @param opts { fetch, userAgent, minIntervalMs, retries, baseDelayMs, log }
 * @returns {{ json(url): Promise<any>, fetch(url, init): Promise<Response> }}
 */
export function createPoliteFetch({ fetch = globalThis.fetch, userAgent = DEFAULT_USER_AGENT, minIntervalMs = 1000, retries = 4, baseDelayMs = 1000, log = () => {} } = {}) {
  let queue = Promise.resolve(), nextAt = 0;

  // serialize calls and keep `minIntervalMs` between request starts
  const slot = () => {
    const turn = queue.then(async () => {
      const wait = nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextAt = Date.now() + minIntervalMs;
    });
    queue = turn.catch(() => {});
    return turn;
  };

  /** A successful Response (2xx), after throttling and retries. */
  async function politeFetch(url, init = {}) {
    for (let attempt = 0; ; attempt++) {
      await slot();
      let res, retryAfterMs = 0;
      try {
        res = await fetch(url, { ...init, headers: { 'User-Agent': userAgent, ...init.headers } });
        if (res.ok) return res;
        if (res.status !== 429 && res.status < 500) throw new HttpError(res.status, url);   // not retryable
        retryAfterMs = (Number(res.headers?.get?.('retry-after')) || 0) * 1000;
      } catch (e) {
        if (e instanceof HttpError || attempt >= retries) throw e;
        log(`  network error (${e.message}), retrying`);
      }
      if (attempt >= retries) throw new HttpError(res.status, url);
      const delay = Math.max(retryAfterMs, baseDelayMs * 2 ** attempt);
      log(`  ${res ? `HTTP ${res.status}` : 'error'} for ${url}; retry ${attempt + 1}/${retries} in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }

  return {
    fetch: politeFetch,
    json: async url => (await politeFetch(url, { headers: { Accept: 'application/json' } })).json(),
  };
}
