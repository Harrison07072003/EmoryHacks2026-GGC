// Turn captured calibration points into a scored gaze model.
import { addGram, addSample, cloneGram, createGram, gramWeight, scaleGram } from '../model/ridge.js';
import { fitGazeModel, predictGaze } from '../model/gaze-model.js';
import { FEATURE_COUNT, HEAD_IDX } from '../cv/features.js';
import { allCells, cellOf, DEFAULT_LAYOUT } from '../signals/lanes.js';
import { overallScore, pointScore } from './scoring.js';
import { sameCell } from './targets.js';
import { mean, median } from '../util/math.js';

const WEAK_CELL_SCORE = 55;
const MIN_POINTS = 6;
const OUTLIER_FACTOR = 3;

export function pointGram(point) {
  const g = createGram(FEATURE_COUNT);
  for (const f of point.samples) addSample(g, f, point.target.x, point.target.y);
  return g;
}

const sumGrams = grams => grams.reduce((acc, g) => addGram(acc, g), createGram(FEATURE_COUNT));

/** Rescale the pooled baseline so it counts as `pseudoSamples` samples of prior knowledge. */
export function scalePrior(baselineGram, pseudoSamples) {
  const w = baselineGram ? gramWeight(baselineGram) : 0;
  return w > 0 ? scaleGram(cloneGram(baselineGram), pseudoSamples / w) : null;
}

/**
 * @param points  [{ target: {x, y}, samples: [features], steadiness }]
 * @param options.prior         pooled baseline gram (warm start), or null
 * @param options.priorSamples  how many samples the baseline is worth
 * @returns { model, gram, fitGram, score, points, weakCells, headRef }
 *          points gain { residual, score, kept, cell }. `gram` is this player's data only
 *          (what gets pooled); `fitGram` also contains the prior (what refinement builds on).
 */
export function fitCalibration(points, { prior = null, priorSamples = 30, headPenalty = 6, layout = DEFAULT_LAYOUT, dropBelow = 45, maxDropFrac = 0.25 } = {}) {
  const scaledPrior = scalePrior(prior, priorSamples);
  const usable = points.map(p => p.samples.length >= 3);
  const grams = points.map((p, i) => (usable[i] ? pointGram(p) : null));
  let kept = usable.slice();

  const totalOf = () => {
    const g = sumGrams(grams.filter((_, i) => kept[i]));
    return scaledPrior ? addGram(g, scaledPrior) : g;
  };
  // Leave-one-point-out error: fit without the point, then see how far off it lands.
  const residuals = () => {
    const total = totalOf(), count = kept.filter(Boolean).length;
    return points.map((p, i) => {
      if (!usable[i]) return Infinity;
      const others = kept[i] ? addGram(cloneGram(total), grams[i], -1) : total;
      if (count - (kept[i] ? 1 : 0) < 3 && !scaledPrior) return Infinity;
      const m = fitGazeModel(others, { headPenalty, only: 'both' });
      return mean(p.samples.map(f => { const g = predictGaze(m, f); return Math.hypot(g.x - p.target.x, g.y - p.target.y); }));
    });
  };
  const scoresOf = res => points.map((p, i) => (usable[i] ? pointScore(p.steadiness ?? 0, res[i]) : 0));

  // Drop the worst point, rescore, repeat: one bad point also drags its neighbours down,
  // so they must be judged again once it is gone.
  let res = residuals(), scores = scoresOf(res);
  for (let dropped = 0; dropped < Math.floor(points.length * maxDropFrac); dropped++) {
    const worst = scores.reduce((w, s, i) => (kept[i] && (w < 0 || s < scores[w]) ? i : w), -1);
    if (worst < 0 || scores[worst] >= dropBelow) break;
    // only an outlier is dropped: with few points every held-out error is large, and
    // throwing data away then makes things worse
    if (res[worst] < OUTLIER_FACTOR * median(res.filter((r, i) => kept[i] && Number.isFinite(r)))) break;
    kept[worst] = false;
    res = residuals(); scores = scoresOf(res);
  }

  const scored = points.map((p, i) => ({
    ...p, residual: res[i], score: scores[i], kept: kept[i], cell: cellOf(p.target, layout),
  }));
  const keptPoints = scored.filter(p => p.kept);
  const weakCells = allCells(layout).filter(cell => {
    const mine = keptPoints.filter(p => sameCell(p.cell, cell));
    return !mine.length || mean(mine.map(p => p.score)) < WEAK_CELL_SCORE;
  });
  const uncovered = allCells(layout).filter(cell => !keptPoints.some(p => sameCell(p.cell, cell))).length;

  const gram = sumGrams(grams.filter((_, i) => kept[i]));
  const fitGram = totalOf();
  const enough = keptPoints.length >= MIN_POINTS || (scaledPrior && keptPoints.length >= 2);
  const samples = keptPoints.flatMap(p => p.samples);
  return {
    model: gramWeight(fitGram) > 0 ? fitGazeModel(fitGram, { headPenalty }) : null,
    gram, fitGram,
    score: enough ? overallScore(scored, uncovered) : 0,
    points: scored,
    weakCells,
    headRef: samples.length ? HEAD_IDX.map(i => mean(samples.map(f => f[i]))) : null,
  };
}
