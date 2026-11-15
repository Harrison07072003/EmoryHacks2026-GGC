// "Is this track a song?" for ingestion: download the first 30 s (reusing the server's audio
// cache), decode, analyze like the level generator, and return { isSong, score, reasons }.
import { fetchStart, segmentByteBudget } from '../../src/online/audio-segment.js';
import { checkMusic } from '../../src/services/chartgen/generate.js';
import { decodeStart } from './decode.js';

/**
 * @param o { audioCache (stores.createAudioCache), fetchFn (throttled), verdicts: optional
 *            { get(id), set(id, verdict) } cache, levelSec }
 */
export function createAudioChecker({ audioCache, fetchFn, verdicts = null, levelSec = 30 }) {
  return async doc => {
    const known = verdicts?.get(doc.id);
    if (known) return known;
    const key = `${doc.id}.${levelSec}s`;
    let bytes = await audioCache.get(key);
    if (!bytes) {
      ({ bytes } = await fetchStart(doc.audio_url, segmentByteBudget(levelSec, doc.bitrate_kbps), { fetchFn }));
      await audioCache.put(key, bytes);
    }
    const audio = await decodeStart(bytes, { name: doc.audio_url, maxSec: levelSec });
    const { isSong, score, reasons } = checkMusic({ channels: audio.channels, sampleRate: audio.sampleRate, levelSec });
    const verdict = { isSong, score, reasons };
    verdicts?.set(doc.id, verdict);
    return verdict;
  };
}
