// Score recordings offline: calibrate on half of the labelled dots, test on the other half.
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
    const tg = fr.src === 'game' ? null : fr.target; // older clips have no src: all calibration
    if (!tg) { cur = null; continue; }
    if (!cur || cur.target.x !== tg.x || cur.target.y !== tg.y) points.push((cur = { target: tg, t0: fr.t, samples: [] }));
    if (fr.face && !fr.blink && fr.t - cur.t0 >= settleMs) cur.samples.push(fr.f);
  }
  return points.filter(p => p.samples.length >= 3).map(p => {
    const samples = p.samples.slice(-maxSamples);
    return { target: p.target, samples, steadiness: steadinessOf(samples) };
  });
}

/** Average capture conditions over the frames with a face: frame rate, light, contrast, glare. */
export function conditionsOf(recording) {
  const frames = recording.frames, face = frames.filter(f => f.face);
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b);
  const eyeMean = key => mean(face.map(f => (f.eyes.R[key] + f.eyes.L[key]) / 2));
  return {
    fps: gaps.length ? 1000 / gaps[gaps.length >> 1] : NaN,
    faceVisible: frames.length ? face.length / frames.length : 0,
    light: eyeMean('lum'), pupilContrast: eyeMean('conf'), glare: eyeMean('glare'),
  };
}

/**
 * Score a recording. Accuracy numbers are measured on held-out dots (calibrate on every
 * second dot, test on the others), so they are an honest and slightly pessimistic estimate:
 * the live game calibrates on all of them.
 * @returns { dots, fullScore, calibrationScore, meanError, errorX, errorY, laneAccuracy,
 *            bandAccuracy, perPoint }   fullScore = score of a calibration on all dots
 */
export function evaluateRecording(recording, { layout = DEFAULT_LAYOUT, prior = null } = {}) {
  const points = labelledPoints(recording);
  const train = points.filter((_, i) => i % 2 === 0), test = points.filter((_, i) => i % 2 === 1);
  const fit = fitCalibration(train, { layout, prior });
  const summary = { dots: points.length, fullScore: points.length ? fitCalibration(points, { layout, prior }).score : 0, calibrationScore: fit.score };
  if (!fit.model || !test.length) return { ...summary, meanError: NaN, errorX: NaN, errorY: NaN, laneAccuracy: NaN, bandAccuracy: NaN, perPoint: [] };
  let laneHits = 0, bandHits = 0, cellFrames = 0;
  const perPoint = test.map(p => {
    const preds = p.samples.map(f => predictGaze(fit.model, f));
    const cell = cellOf(p.target, layout);
    if (cell) for (const g of preds) {
      cellFrames++;
      if (laneOf(g.x, layout.lanes) === cell.lane) laneHits++;
      if (bandOf(g.y, layout.bandSplit) === cell.band) bandHits++;
    }
    return {
      target: p.target, steadiness: p.steadiness,
      error: mean(preds.map(g => Math.hypot(g.x - p.target.x, g.y - p.target.y))),
      errorX: mean(preds.map(g => Math.abs(g.x - p.target.x))), errorY: mean(preds.map(g => Math.abs(g.y - p.target.y))),
    };
  });
  return {
    ...summary,
    meanError: mean(perPoint.map(p => p.error)),
    errorX: mean(perPoint.map(p => p.errorX)), errorY: mean(perPoint.map(p => p.errorY)),
    laneAccuracy: cellFrames ? laneHits / cellFrames : NaN,
    bandAccuracy: cellFrames ? bandHits / cellFrames : NaN,
    perPoint,
  };
}
