// Score a recording offline: calibrate on half of the labelled dots, test on the other half.
import { fitCalibration } from '../calibration/fit.js';
import { steadinessOf } from '../calibration/scoring.js';
import { predictGaze } from '../model/gaze-model.js';
import { cellOf, DEFAULT_LAYOUT, laneOf, bandOf } from '../signals/lanes.js';
import { mean } from '../util/math.js';

/** Split a recording into one point per stretch of frames that share a target. */
export function labelledPoints(recording, { settleMs = 500, maxSamples = 18 } = {}) {
  const points = [];
  let cur = null;
  for (const fr of recording.frames) {
    const tg = fr.target;
    if (!tg) { cur = null; continue; }
    if (!cur || cur.target.x !== tg.x || cur.target.y !== tg.y) points.push((cur = { target: tg, t0: fr.t, samples: [] }));
    if (fr.face && !fr.blink && fr.t - cur.t0 >= settleMs) cur.samples.push(fr.f);
  }
  return points.filter(p => p.samples.length >= 3).map(p => {
    const samples = p.samples.slice(-maxSamples);
    return { target: p.target, samples, steadiness: steadinessOf(samples) };
  });
}

/**
 * @returns { calibrationScore, meanError, laneAccuracy, bandAccuracy, perPoint }
 *          measured on held-out points (every second dot), so it is an honest estimate.
 */
export function evaluateRecording(recording, { layout = DEFAULT_LAYOUT, prior = null } = {}) {
  const points = labelledPoints(recording);
  const train = points.filter((_, i) => i % 2 === 0), test = points.filter((_, i) => i % 2 === 1);
  const fit = fitCalibration(train, { layout, prior });
  if (!fit.model || !test.length) return { calibrationScore: fit.score, meanError: NaN, laneAccuracy: NaN, bandAccuracy: NaN, perPoint: [] };
  let laneHits = 0, bandHits = 0, cellFrames = 0;
  const perPoint = test.map(p => {
    const preds = p.samples.map(f => predictGaze(fit.model, f));
    const cell = cellOf(p.target, layout);
    if (cell) for (const g of preds) {
      cellFrames++;
      if (laneOf(g.x, layout.lanes) === cell.lane) laneHits++;
      if (bandOf(g.y, layout.bandSplit) === cell.band) bandHits++;
    }
    return { target: p.target, steadiness: p.steadiness, error: mean(preds.map(g => Math.hypot(g.x - p.target.x, g.y - p.target.y))) };
  });
  return {
    calibrationScore: fit.score,
    meanError: mean(perPoint.map(p => p.error)),
    laneAccuracy: cellFrames ? laneHits / cellFrames : NaN,
    bandAccuracy: cellFrames ? bandHits / cellFrames : NaN,
    perPoint,
  };
}
