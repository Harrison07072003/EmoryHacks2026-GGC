// Score recordings offline: calibrate on half of the labelled dots, test on the other half.
import { fitCalibration } from '../calibration/fit.js';
import { steadinessOf } from '../calibration/scoring.js';
import { predictGaze } from '../model/gaze-model.js';
import { cellOf, DEFAULT_LAYOUT, laneOf, bandOf } from '../signals/lanes.js';
import { mean } from '../util/math.js';
import { HOP_SETTLE_MS, PURSUIT_LAG_MS } from '../calibration/session.js';

/** Split a recording into one point per stretch of frames that share a target. */
export function labelledPoints(recording, { settleMs = 500, maxSamples = 24 } = {}) {
  const points = [];
  let cur = null;
  for (const fr of recording.frames) {
    // older clips have no src: all calibration. The moving dot and band hops are not dots.
    const tg = fr.src === 'game' || fr.tid === 'pursuit' || fr.tid?.startsWith('hop:') ? null : fr.target;
    if (!tg) { cur = null; continue; }
    if (!cur || cur.target.x !== tg.x || cur.target.y !== tg.y) points.push((cur = { target: tg, t0: fr.t, samples: [] }));
    if (fr.face && !fr.blink && fr.t - cur.t0 >= settleMs) cur.samples.push(fr.f);
  }
  return points.filter(p => p.samples.length >= 3).map(p => {
    const samples = p.samples.slice(-maxSamples);
    return { target: p.target, samples, steadiness: steadinessOf(samples) };
  });
}

/** The calibration moving-dot phase as one point, labelled with the delayed target like live. */
export function pursuitPoint(recording) {
  const frames = recording.frames.filter(f => f.src !== 'game' && f.tid === 'pursuit');
  if (frames.length < 10) return null;
  const t0 = frames[0].t, samples = [], targets = [];
  let j = 0;
  for (const fr of frames) {
    while (j < frames.length - 1 && frames[j + 1].t <= fr.t - PURSUIT_LAG_MS) j++;
    if (fr.t - t0 < 800 + PURSUIT_LAG_MS || !fr.face || fr.blink) continue;
    samples.push(fr.f); targets.push(frames[j].target);
  }
  return samples.length ? { kind: 'pursuit', target: { x: 0.5, y: 0.5 }, samples, targets, steadiness: 1 } : null;
}

/** The calibration band hops as points, labelled like live (frames from HOP_SETTLE_MS on). */
export function hopPoints(recording) {
  const hops = new Map();
  for (const fr of recording.frames) if (fr.src !== 'game' && fr.tid?.startsWith('hop:')) (hops.get(fr.tid) ?? hops.set(fr.tid, []).get(fr.tid)).push(fr);
  return [...hops.values()].flatMap(fs => {
    const samples = fs.filter(f => f.t - fs[0].t >= HOP_SETTLE_MS && f.face && !f.blink).map(f => f.f);
    return samples.length ? [{ kind: 'hop', target: fs[0].target, samples, targets: samples.map(() => fs[0].target), steadiness: 1 }] : [];
  });
}

/** Every play-like calibration point in a clip (moving dot + band hops). */
export const playLikePoints = recording => [pursuitPoint(recording), ...hopPoints(recording)].filter(Boolean);

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
  const extra = playLikePoints(recording), withPursuit = list => [...list, ...extra];
  const fit = fitCalibration(withPursuit(train), { layout, prior });
  const summary = { dots: points.length, playLike: extra.length, fullScore: points.length ? fitCalibration(withPursuit(points), { layout, prior }).score : 0, calibrationScore: fit.score };
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
