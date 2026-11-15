// npm run server — the Online Library server (see README "Online Library").
// Keeps the Typesense ADMIN key server-side, generates and caches levels, proxies audio.
import { createServer } from 'node:http';
import { loadEnv } from '../tools/env.mjs';
import { pipelineFromEnv } from './lib/setup.js';
import { createApp } from './app.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const { cfg, pipeline } = await pipelineFromEnv(loadEnv(), { log });
if (!cfg.typesense) log('! TYPESENSE_HOST / TYPESENSE_ADMIN_API_KEY not set: every level request will fail');

createServer(createApp({ cfg, pipeline, log })).listen(cfg.port, cfg.host, () => {
  log(`Online Library server on http://${cfg.host}:${cfg.port}  (data: ${cfg.dataDir}, CORS: ${cfg.corsOrigins.join(', ')})`);
});
