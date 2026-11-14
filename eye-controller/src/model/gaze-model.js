// The per-player gaze model: three ridge fits (both eyes / right only / left only).
// At runtime we lean toward whichever eye is cleaner, e.g. when glare hits one lens.
import { solveRidge, predict } from './ridge.js';
import { IDX, SD_FLOOR, penalties } from '../cv/features.js';
import { clamp } from '../util/math.js';

export function fitGazeModel(gram, { headPenalty = 6, lambda = 0.02, only } = {}) {
  const opts = { lambda, penalties: penalties(headPenalty), sdFloor: SD_FLOOR };
  const fit = key => solveRidge(gram, { ...opts, idx: IDX[key] });
  if (only) return { [only]: fit(only) };
  return { both: fit('both'), R: fit('R'), L: fit('L') };
}

/** mix: -1 = left eye only, 0 = both eyes, +1 = right eye only. */
export function predictGaze(model, f, mix = 0) {
  const both = predict(model.both, f), a = Math.abs(mix);
  if (a < 0.01) return both;
  const single = predict(mix > 0 ? model.R : model.L, f);
  return { x: both.x + (single.x - both.x) * a, y: both.y + (single.y - both.y) * a };
}

const eyeQuality = e => e.open * (1 - Math.min(1, e.glare * 10)) * (0.5 + e.conf);

/** Slowly move the eye mix toward the cleaner eye. */
export function nextEyeMix(mix, eyes) {
  const qR = eyeQuality(eyes.R), qL = eyeQuality(eyes.L);
  const target = clamp((qR / (qR + qL + 1e-6) - 0.5) * 4, -1, 1);
  return mix * 0.9 + target * 0.1;
}

const lerpFit = (a, b, t) => ({
  bx: a.bx + (b.bx - a.bx) * t,
  by: a.by + (b.by - a.by) * t,
  wx: a.wx.map((v, i) => v + (b.wx[i] - v) * t),
  wy: a.wy.map((v, i) => v + (b.wy[i] - v) * t),
});

/** Blend model `a` a fraction `t` of the way toward `b` (used for gentle online refinement). */
export const lerpModel = (a, b, t) => ({ both: lerpFit(a.both, b.both, t), R: lerpFit(a.R, b.R, t), L: lerpFit(a.L, b.L, t) });
