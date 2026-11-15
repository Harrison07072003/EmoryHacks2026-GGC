// Adaptive capture of calibration points. Driven purely by feature frames (no DOM, no
// timers), so the simulator and recorded sessions run through exactly the same code.
//
// Each target is held until the last `minSamples` frames are steady enough (`steadyBar`)
// AND, from the 3rd dot on, the eyes are actually on it: a left/right fit from the dots so
// far (3rd-5th dot), then a provisional model of both axes (6th dot on). Tolerances come
// from 518 recorded dots: 94-97% of real attempts pass at once; looking 0.35+ away is
// caught ~87% of the time. Looking away only delays a dot (it goes weak after maxCaptureMs).
// There is no fixed duration: a calm player finishes a dot in about 1.5 s, a shaky one
// keeps it up to `maxCaptureMs`, after which the best window seen is kept and marked weak.
// onProgress(p, { stage, steadiness }) reports it live so the screen can show the eyes being
// tracked: stage 'seeking' (eyes travelling), 'capturing' (p rises with steadiness and falls
// when the eyes wobble), 'locked' (captured; held `lockMs` so the player sees it, then next).
//
// After the dots, two optional phases that look like play, because still dots alone
// mispredict the vertical during play (measured on real clips):
//   pursuit - one dot glides through both bands for `pursuitMs`; each frame is a sample
//             labelled with where the dot was PURSUIT_LAG_MS earlier. (Path in the bottom
//             band: 74% -> 98% of the time.)
//   hops    - dots jump between the bands. A provisional model fitted on the dots so far
//             checks where the player looks: a hop only fills while the gaze is in the
//             dot's band (and roughly its lane), only those frames become samples, and it
//             gives up after `hopMaxMs`. Before v0.5 hops were timed and passed even when
//             the player looked elsewhere, which also fed wrong samples into the model.
// Neither phase is scored or dropped; they only add training data.
import { steadinessOf } from './scoring.js';
import { addGram, addSample, createGram } from '../model/ridge.js';
import { fitGazeModel, predictGaze } from '../model/gaze-model.js';
import { FEATURE_COUNT } from '../cv/features.js';

export const PURSUIT_LAG_MS = 100;   // how far the eyes trail a smoothly moving dot
const PURSUIT_LEAD_MS = 800;         // dot holds still first so the eyes can find it
export const HOP_SETTLE_MS = 400;    // eyes need this long to land after a jump

/** The calibration pursuit path: one sweep across, two passes through both bands. */
export function pursuitPath(ms, movingMs) {
  const s = Math.max(0, ms - PURSUIT_LEAD_MS) / movingMs;
  return { x: 0.5 - 0.4 * Math.cos(2 * Math.PI * s), y: 0.5 - 0.36 * Math.cos(4 * Math.PI * s) };
}

export class CalibrationSession {
  constructor({ targets, settleMs = 500, minSamples = 24, steadyBar = 0.6, maxCaptureMs = 3500, lockMs = 300, pursuitMs = 0, hops = [], hopFrames = 15, hopMaxMs = 4000, hopLaneTolerance = 0.3, bandSplit = 0.5, dotTolerance = { x: 0.25, y: 0.35 }, onTarget, onProgress, onDone } = {}) {
    Object.assign(this, { targets, settleMs, minSamples, steadyBar, maxCaptureMs, lockMs, pursuitMs, hops, hopFrames, hopMaxMs, hopLaneTolerance, bandSplit, dotTolerance, onTarget, onProgress, onDone });
    this.points = []; this.index = -1; this.done = false;
    this.phase = 'dots'; this.pursuit = null; this.hop = null;
  }
  get target() {
    if (this.done) return null;
    if (this.phase === 'pursuit') return this.pursuit.now;
    if (this.phase === 'hops') return this.hops[this.hop.i];
    return this.targets[this.index] ?? null;
  }
  /** Which phase a frame belongs to: 'pursuit', 'hop:<n>', or null for the dots (used by recordings). */
  get targetId() {
    if (this.done) return null;
    return this.phase === 'pursuit' ? 'pursuit' : this.phase === 'hops' ? `hop:${this.hop.i}` : null;
  }

  start() { this.next(); return this; }

  /** Next dot, or the next phase once the dots are done. */
  next() {
    this.index++;
    this.shownAt = null; this.buf = []; this.best = null; this.bestOnTarget = null;
    if (this.index < this.targets.length) {
      this.checker = dotChecker(this.points);
      return this.onTarget?.(this.target, this.index, { phase: 'dots' });
    }
    this.nextPhase();
  }

  nextPhase() {
    if (this.phase === 'dots' && this.pursuitMs > 0) {
      this.phase = 'pursuit';
      this.pursuit = { t0: null, now: pursuitPath(0, this.pursuitMs), samples: [], targets: [], trail: [] };
      return this.onTarget?.(this.pursuit.now, this.index, { moving: true, phase: 'pursuit' });
    }
    if ((this.phase === 'dots' || this.phase === 'pursuit') && this.hops.length) {
      this.phase = 'hops';
      this.provisional = provisionalModel(this.points);
      this.hop = { i: 0, t0: null, samples: [] };
      return this.onTarget?.(this.target, 0, { hop: true, phase: 'hops' });
    }
    this.done = true;
    this.onTarget?.(null, this.index);
    this.onDone?.(this.points);
  }

  push(frame) {
    if (this.done || this.index < 0) return;
    if (this.phase === 'pursuit') return this.pushPursuit(frame);
    if (this.phase === 'hops') return this.pushHop(frame);
    if (this.lockedUntil !== undefined) { // captured: hold the dot briefly so the player sees it lock
      if (frame.t >= this.lockedUntil) { this.lockedUntil = undefined; this.next(); }
      return;
    }
    if (this.shownAt === null) this.shownAt = frame.t;
    const elapsed = frame.t - this.shownAt - this.settleMs;
    if (elapsed < 0) return void this.onProgress?.(0, { stage: 'seeking', steadiness: 0 }); // eyes travelling

    if (frame.face && !frame.blink && frame.f) {
      this.buf.push(frame.f);
      if (this.buf.length > this.minSamples) this.buf.shift();
    }
    const fill = this.buf.length / this.minSamples;
    const steadiness = this.buf.length >= 3 ? steadinessOf(this.buf) : 0;
    const look = this.checker && this.buf.length >= 3 ? this.checker(this.buf.slice(-6), this.target, this.dotTolerance) : null;
    const onTarget = look ? look.ok : true;   // no check possible yet (first dots): steadiness only
    if (fill >= 0.5) {
      const window = { samples: [...this.buf], steadiness, rank: steadiness * fill };
      if (!this.best || window.rank > this.best.rank) this.best = window;
      if (onTarget && (!this.bestOnTarget || window.rank > this.bestOnTarget.rank)) this.bestOnTarget = window;
    }
    if (fill >= 1 && steadiness >= this.steadyBar && onTarget) return this.finish({ samples: [...this.buf], steadiness, weak: false }, frame.t);
    const p = Math.min(0.95, fill * Math.min(1, steadiness / this.steadyBar)) * (onTarget ? 1 : 0.3);
    this.onProgress?.(p, { stage: 'capturing', steadiness: onTarget ? steadiness : steadiness * 0.3, onTarget, gaze: look?.gaze ?? null });
    if (elapsed > this.maxCaptureMs) {
      // the eyes were checked and never on the dot: keep no samples (wrong labels would hurt the model)
      const b = this.bestOnTarget ?? (this.checker ? null : this.best);
      this.finish(b ? { samples: b.samples, steadiness: b.steadiness, weak: true } : { samples: [], steadiness: 0, weak: true, offTarget: !!this.checker }, frame.t);
    }
  }

  pushPursuit(frame) {
    const p = this.pursuit;
    if (p.t0 === null) p.t0 = frame.t;
    const ms = frame.t - p.t0, total = PURSUIT_LEAD_MS + this.pursuitMs;
    p.trail.push({ t: frame.t, ...p.now });
    while (p.trail.length > 2 && frame.t - p.trail[1].t >= PURSUIT_LAG_MS) p.trail.shift();
    if (ms >= PURSUIT_LEAD_MS + PURSUIT_LAG_MS && frame.face && !frame.blink && frame.f) {
      p.samples.push(frame.f);
      p.targets.push({ x: p.trail[0].x, y: p.trail[0].y }); // where the dot was ~PURSUIT_LAG_MS ago
    }
    this.onProgress?.(Math.min(1, ms / total));
    if (ms >= total) {
      this.points.push({ kind: 'pursuit', target: { x: 0.5, y: 0.5 }, samples: p.samples, targets: p.targets, steadiness: 1, weak: false });
      return this.nextPhase();
    }
    p.now = pursuitPath(ms, this.pursuitMs);
    this.onTarget?.(p.now, this.index, { moving: true, phase: 'pursuit' });
  }

  pushHop(frame) {
    const h = this.hop, target = this.target;
    if (h.lockedUntil !== undefined) { if (frame.t >= h.lockedUntil) this.nextHop(); return; }
    if (h.t0 === null) h.t0 = frame.t;
    const ms = frame.t - h.t0;
    if (ms < HOP_SETTLE_MS) return void this.onProgress?.(0, { stage: 'seeking', steadiness: 0, gaze: null });
    const usable = frame.face && !frame.blink && frame.f;
    const gaze = usable && this.provisional ? predictGaze(this.provisional, frame.f) : null;
    // no provisional model (too few dots): fall back to counting every usable frame
    const onTarget = usable && (!gaze || this.lookingAt(gaze, target));
    if (onTarget) h.samples.push(frame.f);
    const p = Math.min(1, h.samples.length / this.hopFrames);
    if (p >= 1 || ms >= this.hopMaxMs) return this.finishHop(frame.t, p >= 1);
    this.onProgress?.(p, { stage: 'capturing', steadiness: onTarget ? 1 : 0, gaze, onTarget: !!onTarget });
  }

  /** Same band as the target, and within about a lane of it. */
  lookingAt(gaze, target) {
    const band = y => (y < this.bandSplit ? 'top' : 'bottom');
    return band(gaze.y) === band(target.y) && Math.abs(gaze.x - target.x) < this.hopLaneTolerance;
  }

  finishHop(t, captured) {
    const h = this.hop, target = this.target;
    if (captured) this.points.push({ kind: 'hop', target, samples: h.samples, targets: h.samples.map(() => target), steadiness: 1, weak: false });
    this.onProgress?.(1, { stage: captured ? 'locked' : 'skipped', steadiness: captured ? 1 : 0 });
    h.lockedUntil = t + (captured ? this.lockMs : 0);
  }

  nextHop() {
    if (this.hop.i + 1 >= this.hops.length) return this.nextPhase();
    this.hop = { i: this.hop.i + 1, t0: null, samples: [] };
    this.onTarget?.(this.target, this.hop.i, { hop: true, phase: 'hops' });
  }

  finish(capture, t) {
    this.onProgress?.(1, { stage: 'locked', steadiness: capture.steadiness });
    this.points.push({ target: this.target, ...capture });
    if (this.lockMs > 0 && t !== undefined) this.lockedUntil = t + this.lockMs;
    else this.next();
  }

  /** Stop early; points captured so far are kept. */
  abort() {
    if (this.done) return;
    this.done = true;
    this.onTarget?.(null, this.index);
    this.onDone?.(this.points, { aborted: true });
  }
}

/** A quick both-eyes model from the points captured so far (dots, moving dot), or null. */
function provisionalModel(points) {
  const usable = points.filter(p => p.samples.length >= 3);
  if (usable.filter(p => !p.kind).length < 6) return null;
  const gram = usable.reduce((g, p) => {
    const one = createGram(FEATURE_COUNT);
    p.samples.forEach((f, i) => { const t = p.targets?.[i] ?? p.target; addSample(one, f, t.x, t.y); });
    return addGram(g, one);
  }, createGram(FEATURE_COUNT));
  return fitGazeModel(gram, { only: 'both' });
}

const meanOf = (xs, fn) => xs.reduce((a, x) => a + fn(x), 0) / xs.length;
/** Horizontal eye signal: iris and pupil position along the eye, both eyes. */
const horizontal = f => (f[0] + f[2] + f[4] + f[6]) / 4;

/**
 * How to tell, before calibration is finished, whether the eyes are on the current dot.
 * Returns (recentFrames, target, tolerance) => { ok, gaze }, or null when no check is possible yet.
 */
function dotChecker(points) {
  // only dots that passed: a dot that timed out may hold samples of the player looking elsewhere
  const trusted = points.filter(p => !p.weak), dots = trusted.filter(p => !p.kind && p.samples.length >= 3);
  const model = provisionalModel(trusted);
  if (model) return (frames, target, tol) => {
    const g = frames.map(f => predictGaze(model, f)), gaze = { x: meanOf(g, p => p.x), y: meanOf(g, p => p.y) };
    return { ok: Math.abs(gaze.x - target.x) < tol.x && Math.abs(gaze.y - target.y) < tol.y, gaze };
  };
  if (dots.length < 2) return null;
  // left/right only: x = a + b * horizontal signal, fitted on the dots so far
  const hs = dots.map(p => meanOf(p.samples, horizontal)), xs = dots.map(p => p.target.x), mh = meanOf(hs, v => v), mx = meanOf(xs, v => v);
  let sxx = 0, sxy = 0;
  hs.forEach((h, i) => { sxx += (h - mh) ** 2; sxy += (h - mh) * (xs[i] - mx); });
  if (sxx < 1e-10) return null;
  const b = sxy / sxx, a = mx - b * mh;
  return (frames, target, tol) => {
    const x = a + b * meanOf(frames, horizontal);
    return { ok: Math.abs(x - target.x) < tol.x, gaze: null };
  };
}
