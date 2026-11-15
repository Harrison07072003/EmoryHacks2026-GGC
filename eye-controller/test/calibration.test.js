import { describe, expect, it } from 'vitest';
import { CalibrationSession } from '../src/calibration/session.js';
import { fitCalibration, pointGram } from '../src/calibration/fit.js';
import { overallScore, pointScore, residualScore, steadinessOf } from '../src/calibration/scoring.js';
import { defaultTargets, topUpTargets } from '../src/calibration/targets.js';
import { predictGaze } from '../src/model/gaze-model.js';
import { createSimEye } from '../src/simulator/sim-eye.js';
import { SyntheticSource } from '../src/simulator/synthetic-source.js';
import { addGram, createGram } from '../src/model/ridge.js';
import { FEATURE_COUNT } from '../src/cv/features.js';
import { mean } from '../src/util/math.js';

const DT = 1000 / 30;
const pointsFor = (seed, targets = defaultTargets(), noise = 'realistic') => new SyntheticSource({ seed, noise, clock: 'manual' }).instantPoints(targets);
/** Mean error of a model on fresh frames from the same simulated person. */
function testError(model, seed, noise = 'realistic') {
  const eye = createSimEye({ seed, noise }), errs = [];
  for (let i = 0; i < 60; i++) {
    const target = { x: 0.1 + 0.8 * ((i * 0.37) % 1), y: 0.1 + 0.8 * ((i * 0.61) % 1) };
    const fr = eye(50000 + i * 400 + 200, target);
    const p = predictGaze(model, fr.f);
    errs.push(Math.hypot(p.x - target.x, p.y - target.y));
  }
  return mean(errs);
}

describe('point scoring', () => {
  const still = Array.from({ length: 18 }, () => Array(FEATURE_COUNT).fill(0.5));
  const shaky = still.map((f, i) => f.map(v => v + (i % 2 ? 0.02 : -0.02)));
  it('steadiness is 1 for still eyes and 0 for shaky ones', () => {
    expect(steadinessOf(still)).toBe(1);
    expect(steadinessOf(shaky)).toBe(0);
    expect(steadinessOf(still.slice(0, 2))).toBe(0);
  });
  it('residual and point scores are monotonic', () => {
    expect(residualScore(0.02)).toBe(1);
    expect(residualScore(0.3)).toBe(0);
    expect(residualScore(Infinity)).toBe(0);
    expect(pointScore(1, 0.02)).toBe(100);
    expect(pointScore(1, 0.11)).toBeLessThan(pointScore(1, 0.05));
    expect(pointScore(0.2, 0.05)).toBeLessThan(pointScore(0.9, 0.05));
  });
  it('overall score falls with dropped points and uncovered cells', () => {
    const pts = n => Array.from({ length: 10 }, (_, i) => ({ score: 80, kept: i >= n }));
    expect(overallScore(pts(0))).toBe(80);
    expect(overallScore(pts(2))).toBe(72);
    expect(overallScore(pts(0), 2)).toBe(64);
    expect(overallScore(pts(10))).toBe(0);
  });
});

describe('targets', () => {
  it('covers every cell, stays on screen', () => {
    const t = defaultTargets();
    expect(t).toHaveLength(16);
    expect(t.every(p => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)).toBe(true);
    expect(topUpTargets([{ lane: 3, band: 'bottom' }])).toEqual([{ x: 0.875, y: 0.75 }, { x: 0.875, y: 0.875 }]);
  });
});

describe('adaptive capture session', () => {
  function run({ noise = 'realistic', cond = {}, targets = defaultTargets().slice(0, 4), frames = 2000 } = {}) {
    const eye = createSimEye({ seed: 3, noise });
    const session = new CalibrationSession({ targets }).start();
    let t = 0;
    for (let i = 0; i < frames && !session.done; i++) session.push(eye((t += DT), session.target, cond));
    return { session, ms: t };
  }
  it('finishes a calm player quickly, with steady points', () => {
    const { session, ms } = run();
    expect(session.done).toBe(true);
    expect(session.points).toHaveLength(4);
    expect(session.points.every(p => !p.weak && p.samples.length === 24 && p.steadiness >= 0.6)).toBe(true);
    expect(ms / 4).toBeLessThan(2000);   // settle 0.5 s + 24 frames + a 0.3 s lock per dot
  });
  it('reports seeking, then capturing with live steadiness, then locked, holding the dot briefly', () => {
    const eye = createSimEye({ seed: 3 }), stages = [], shown = [];
    const session = new CalibrationSession({ targets: defaultTargets().slice(0, 2), onTarget: t => shown.push(t), onProgress: (p, info) => stages.push(info.stage) }).start();
    let t = 0, lockedAt = null, nextAt = null;
    for (let i = 0; i < 400 && !session.done; i++) {
      t += DT; session.push(eye(t, session.target));
      if (lockedAt === null && stages.at(-1) === 'locked') lockedAt = t;
      if (lockedAt !== null && nextAt === null && shown.length === 2) nextAt = t;
    }
    const order = stages.filter((s, i) => s !== stages[i - 1]);
    expect(order.slice(0, 3)).toEqual(['seeking', 'capturing', 'locked']);
    expect(nextAt - lockedAt).toBeGreaterThanOrEqual(300);
  });
  it('keeps sampling a shaky target, then keeps its best window and marks it weak', () => {
    const calm = run(), shaky = run({ cond: { light: 'bad' } });
    expect(shaky.ms).toBeGreaterThan(calm.ms * 2);
    expect(shaky.session.points.every(p => p.weak && p.samples.length > 0)).toBe(true);
  });
  it('yields empty weak points when there is no face, and still ends', () => {
    const { session } = run({ cond: { faceLost: true } });
    expect(session.done).toBe(true);
    expect(session.points.every(p => p.weak && p.samples.length === 0)).toBe(true);
  });
  it('ignores frames while the eyes travel to the dot and during blinks', () => {
    const session = new CalibrationSession({ targets: [{ x: 0.5, y: 0.5 }], settleMs: 500 }).start();
    const f = Array(FEATURE_COUNT).fill(0.5);
    for (let t = 0; t < 400; t += DT) session.push({ t, face: true, blink: false, f });
    session.push({ t: 600, face: true, blink: true, f });
    expect(session.buf).toHaveLength(0);
  });
  it('reports targets, progress and completion, and can be aborted', () => {
    const seen = [], progress = [];
    let done = null;
    const session = new CalibrationSession({ targets: defaultTargets().slice(0, 2), onTarget: t => seen.push(t), onProgress: p => progress.push(p), onDone: (pts, info) => (done = { pts, info }) }).start();
    const eye = createSimEye({ seed: 4 });
    for (let t = 0; !session.done; t += DT) session.push(eye(t, session.target));
    expect(seen).toHaveLength(3);
    expect(seen[2]).toBeNull();
    expect(Math.max(...progress)).toBe(1);
    expect(done.pts).toHaveLength(2);
    const second = new CalibrationSession({ targets: defaultTargets(), onDone: (pts, info) => (done = { pts, info }) }).start();
    second.abort();
    expect(done.info.aborted).toBe(true);
  });
});

describe('moving-dot (pursuit) phase', () => {
  it('runs after the dots, labels samples with the delayed target, and is never scored', () => {
    const eye = createSimEye({ seed: 3, noise: 'ideal' }), ids = [];
    const session = new CalibrationSession({ targets: defaultTargets().slice(0, 2), pursuitMs: 3000 }).start();
    let t = 0;
    for (let i = 0; i < 2000 && !session.done; i++) { ids.push(session.targetId); session.push(eye((t += DT), session.target)); }
    const p = session.points.at(-1);
    expect(session.points).toHaveLength(3);
    expect(p.kind).toBe('pursuit');
    expect(p.samples.length).toBe(p.targets.length);
    expect(p.samples.length).toBeGreaterThan(70);
    expect(ids).toContain('pursuit');
    const fit = fitCalibration(pointsFor(5).concat(p));
    expect(fit.points.at(-1)).toMatchObject({ kind: 'pursuit', kept: true, score: null, cell: null });
    expect(fit.score).toBeGreaterThanOrEqual(80);
  });
  // The gain on real clips comes from play looking different from still dots, which the
  // simulator does not model; here we only check the moving dot is good training data.
  it('moving-dot samples are accurate training data and do not hurt a dot calibration', () => {
    const seeds = [31, 32, 33, 34], few = defaultTargets().filter((_, i) => i % 3 === 0);
    const withPursuit = seed => {
      const eye = createSimEye({ seed }), session = new CalibrationSession({ targets: [], pursuitMs: 10000 }).start();
      for (let t = 0; !session.done; t += DT) session.push(eye(t, session.target ?? { x: 0.5, y: 0.5 }));
      return session.points[0];
    };
    const plain = mean(seeds.map(s => testError(fitCalibration(pointsFor(s, few)).model, s)));
    const moving = mean(seeds.map(s => testError(fitCalibration([...pointsFor(s, few), withPursuit(s)]).model, s)));
    const movingOnly = mean(seeds.map(s => testError(fitCalibration([withPursuit(s)]).model, s)));
    expect(moving).toBeLessThan(plain * 1.15);
    expect(movingOnly).toBeLessThan(0.06);
  });
});

describe('fitting and scoring a calibration', () => {
  it('gives a high score and an accurate model on clean data', () => {
    const fit = fitCalibration(pointsFor(5));
    expect(fit.score).toBeGreaterThanOrEqual(80);
    expect(fit.weakCells).toEqual([]);
    expect(fit.points.every(p => p.kept)).toBe(true);
    expect(testError(fit.model, 5)).toBeLessThan(0.05);
    expect(fit.headRef).toHaveLength(5);
  });
  it('is near perfect with an ideal eye', () => {
    const fit = fitCalibration(pointsFor(5, defaultTargets(), 'ideal'));
    expect(fit.score).toBeGreaterThanOrEqual(95);
    expect(testError(fit.model, 5, 'ideal')).toBeLessThan(0.02);
  });
  it('drops a point where the player looked somewhere else, and stays accurate', () => {
    const points = pointsFor(6), wrong = pointsFor(6, [{ x: 0.9, y: 0.9 }])[0];
    points[5] = { ...points[5], samples: wrong.samples }; // dot was top-left-ish, eyes were bottom-right
    const fit = fitCalibration(points);
    expect(fit.points[5].kept).toBe(false);
    expect(fit.points.filter(p => !p.kept)).toHaveLength(1);
    expect(testError(fit.model, 6)).toBeLessThan(0.05);
    expect(fit.score).toBeLessThan(fitCalibration(pointsFor(6)).score);
  });
  it('scores shaky data lower and flags the weak cells', () => {
    const points = pointsFor(7);
    const eye = createSimEye({ seed: 7 });
    for (const i of [3, 14]) { // both dots in the top-right cell were captured in bad light
      points[i].samples = points[i].samples.map((_, k) => eye(k * 33, points[i].target, { light: 'bad', glare: true }).f);
      points[i].steadiness = steadinessOf(points[i].samples);
    }
    const fit = fitCalibration(points);
    expect(fit.score).toBeLessThan(fitCalibration(pointsFor(7)).score);
    expect(fit.points[3].score).toBeLessThan(fit.points[0].score);
    expect(fit.weakCells).toContainEqual({ lane: 3, band: 'top' });
  });
  it('scores zero with too few points', () => {
    expect(fitCalibration(pointsFor(8).slice(0, 3)).score).toBe(0);
    expect(fitCalibration([]).model).toBeNull();
  });
  it('never drops more than a quarter of the points, and fails a calibration that makes no sense', () => {
    const points = pointsFor(9).map((p, i) => ({ ...p, target: { x: (i * 0.37) % 1, y: (i * 0.71) % 1 } })); // labels are nonsense
    const fit = fitCalibration(points);
    expect(fit.points.filter(p => !p.kept).length).toBeLessThanOrEqual(4);
    expect(fit.score).toBeLessThan(40);
  });
  it('keeps every point when the data is merely sparse (large held-out errors are not outliers)', () => {
    const fit = fitCalibration(pointsFor(9, defaultTargets().filter((_, i) => i % 2 === 0)));
    expect(fit.points.every(p => p.kept)).toBe(true);
    expect(testError(fit.model, 9)).toBeLessThan(0.06);
  });
  it('a pooled baseline warm-starts a short calibration', () => {
    const pool = createGram(FEATURE_COUNT);
    for (const seed of [11, 12, 13, 14, 15, 16]) for (const p of pointsFor(seed)) addGram(pool, pointGram(p));
    const two = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 }];
    const players = [21, 22, 23, 24, 25, 26];
    const avg = fn => mean(players.map(fn));
    const cold = avg(s => testError(fitCalibration(pointsFor(s, two)).model, s));
    const warm = avg(s => testError(fitCalibration(pointsFor(s, two), { prior: pool }).model, s));
    expect(warm).toBeLessThan(cold * 0.5);
    expect(warm).toBeLessThan(0.06);
    expect(fitCalibration(pointsFor(21, two)).score).toBe(0);                        // too little data alone
    expect(fitCalibration(pointsFor(21, two), { prior: pool }).score).toBeGreaterThan(0);
    // and it must not cost a full calibration much
    const full = avg(s => testError(fitCalibration(pointsFor(s)).model, s));
    const fullWarm = avg(s => testError(fitCalibration(pointsFor(s), { prior: pool }).model, s));
    expect(fullWarm).toBeLessThan(full * 1.25);
  });
});
