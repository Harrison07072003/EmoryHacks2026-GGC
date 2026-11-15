// Server configuration from the environment (game/.env locally, the host's env vars in production).
import { fileURLToPath } from 'node:url';
import { typesenseConfig } from '../../src/services/search/typesense.js';

export const GAME_DIR = fileURLToPath(new URL('../../', import.meta.url));

const flag = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

export function serverConfig(env = process.env) {
  return {
    port: num(env.PORT ?? env.SERVER_PORT, 8787),   // PORT: set by Render / Railway / Fly
    host: env.SERVER_HOST || '0.0.0.0',
    // browser origins allowed to call the server directly (comma separated). The dev game uses
    // the Vite proxy (same origin), so this is for deployments, e.g. https://<user>.github.io
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5190').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
    trustProxy: flag(env.TRUST_PROXY),             // behind a hosting proxy: client IP from X-Forwarded-For
    dataDir: env.ONLINE_LIBRARY_DIR || `${GAME_DIR}online-library/`,
    audioCacheBytes: num(env.AUDIO_CACHE_MB, 200) * 1024 * 1024,
    levelSec: 30,
    allowNonCommercial: flag(env.ALLOW_NONCOMMERCIAL),
    typesense: typesenseConfig(env),                 // admin key: write-back of bpm/difficulty/chart_status
    limits: {
      requestsPerMin: num(env.RATE_LIMIT_PER_MIN, 120),      // any endpoint, per client IP
      generationsPerMin: num(env.GENERATION_LIMIT_PER_MIN, 6), // new charts (cache misses), per client IP
      audioPerMin: num(env.AUDIO_LIMIT_PER_MIN, 30),
      concurrentJobs: num(env.MAX_CONCURRENT_JOBS, 2),
      queuedJobs: num(env.MAX_QUEUED_JOBS, 10),
      jobTimeoutMs: num(env.JOB_TIMEOUT_MS, 60000),
    },
  };
}
