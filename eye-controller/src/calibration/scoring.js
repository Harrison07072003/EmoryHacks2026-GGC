// Scoring of calibration data. Each point gets 0-100 from two things:
//   steadiness - how still the eyes were while it was captured
//   residual   - how far off the model is on that point when the point is held out
// The constants are first guesses in normalized units; tune them on recorded sessions.
import { mean, ramp, std } from '../util/math.js';
import { STEADY_IDX } from '../cv/features.js';

const STEADY = { best: 0.004, worst: 0.02 };   // iris jitter (eye-width units)
const RESIDUAL = { best: 0.04, worst: 0.18 };  // screen error (a lane is 0.25 wide)

/** 0-1: 1 = eyes rock steady across the samples. */
export function steadinessOf(samples) {
  if (samples.length < 3) return 0;
  const jitter = Math.sqrt(mean(STEADY_IDX.map(i => std(samples.map(f => f[i])) ** 2)));
  return 1 - ramp(jitter, STEADY.best, STEADY.worst);
}

export const residualScore = err => (Number.isFinite(err) ? 1 - ramp(err, RESIDUAL.best, RESIDUAL.worst) : 0);

export const pointScore = (steadiness, residual) => Math.round(100 * (0.35 * steadiness + 0.65 * residualScore(residual)));

/** Overall 0-100: mean score of kept points, cut for dropped points and for cells nobody covers. */
export function overallScore(points, uncoveredCells = 0) {
  const kept = points.filter(p => p.kept);
  if (!kept.length) return 0;
  const base = mean(kept.map(p => p.score)) * (0.5 + (0.5 * kept.length) / points.length);
  return Math.max(0, Math.round(base - 8 * uncoveredCells));
}
