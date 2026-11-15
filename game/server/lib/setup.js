// Build the generation pipeline from the environment: shared by the server and by
// `npm run ingest -- --pregenerate N`, so both write the same caches and Typesense fields.
import { readFile } from 'node:fs/promises';
import { createTypesenseClient } from '../../src/services/search/typesense.js';
import { serverConfig } from './config.js';
import { createAudioCache, createChartStore } from './stores.js';
import { createJobQueue } from './limits.js';
import { createPipeline } from './pipeline.js';

export async function pipelineFromEnv(env, { log = () => {}, concurrent } = {}) {
  const cfg = serverConfig(env);
  const blocklist = JSON.parse(await readFile(new URL('../../src/config/content-blocklist.json', import.meta.url), 'utf8'));
  const typesense = cfg.typesense ? createTypesenseClient(cfg.typesense) : null;
  const pipeline = createPipeline({
    cfg, log, blocklist, typesense,
    audioCache: createAudioCache(`${cfg.dataDir}audio`, cfg.audioCacheBytes),
    chartStore: createChartStore(`${cfg.dataDir}charts`),
    queue: createJobQueue({ concurrent: concurrent ?? cfg.limits.concurrentJobs, queued: concurrent ? 1e6 : cfg.limits.queuedJobs }),
  });
  return { cfg, pipeline, typesense };
}
