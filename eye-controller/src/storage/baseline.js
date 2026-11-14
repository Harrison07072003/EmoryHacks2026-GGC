// Pooled baseline: training data aggregated across players, used to warm-start a new
// player's model. It stores only summed statistics (a gram), never anyone's raw samples,
// so it stays small, merges by addition, and gets better with every player added.
import { addGram, createGram, gramFromJSON, gramToJSON, gramWeight } from '../model/ridge.js';
import { FEATURE_COUNT, FEATURE_VERSION } from '../cv/features.js';

const KEY = 'baseline';

export const emptyBaseline = () => ({ featureVersion: FEATURE_VERSION, players: 0, samples: 0, gram: gramToJSON(createGram(FEATURE_COUNT)) });

export function isValidBaseline(b) {
  const D = FEATURE_COUNT + 1;
  return !!b && b.featureVersion === FEATURE_VERSION && b.gram?.d === FEATURE_COUNT
    && b.gram.A?.length === D * D && b.gram.bx?.length === D && b.gram.by?.length === D;
}

/** Add (sign = 1) or remove (sign = -1) one player's gram. Returns a new baseline. */
export function contribute(baseline, playerGram, sign = 1) {
  const gram = addGram(gramFromJSON(baseline.gram), playerGram, sign);
  return { ...baseline, players: Math.max(0, baseline.players + sign), samples: Math.max(0, gramWeight(gram)), gram: gramToJSON(gram) };
}

export function mergeBaselines(a, b) {
  const merged = contribute(a, gramFromJSON(b.gram));
  return { ...merged, players: a.players + b.players };
}

export function baselineStore(kv) {
  return {
    async load() { const b = await kv.get(KEY); return isValidBaseline(b) ? b : emptyBaseline(); },
    save: baseline => kv.set(KEY, baseline),
  };
}
