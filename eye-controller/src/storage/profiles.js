// Per-player profile: that player's calibration points (the training data) and scores.
// The model itself is not stored; it is refit from the points on load, so it always
// benefits from the latest pooled baseline.
import { FEATURE_VERSION } from '../cv/features.js';
import { round } from '../util/math.js';

const key = id => `profile:${id}`;

export function toProfile(id, calibration) {
  return {
    id, featureVersion: FEATURE_VERSION, savedAt: new Date().toISOString(), score: calibration.score,
    points: calibration.points.map(p => ({
      target: p.target, steadiness: round(p.steadiness ?? 0, 3), weak: !!p.weak, kept: p.kept, score: p.score,
      samples: p.samples.map(f => f.map(v => round(v))),
      ...(p.kind ? { kind: p.kind, targets: p.targets.map(t => ({ x: round(t.x, 4), y: round(t.y, 4) })) } : {}),
    })),
  };
}

export function profileStore(kv) {
  return {
    /** @returns the profile, or null if missing or recorded with another feature layout */
    async load(id) {
      const p = await kv.get(key(id));
      return p && p.featureVersion === FEATURE_VERSION && Array.isArray(p.points) ? p : null;
    },
    save: profile => kv.set(key(profile.id), profile),
    remove: id => kv.delete(key(id)),
    async list() { return (await kv.keys('profile:')).map(k => k.slice('profile:'.length)); },
  };
}
