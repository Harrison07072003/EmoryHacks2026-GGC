// Adaptive capture of calibration points. Driven purely by feature frames (no DOM, no
// timers), so the simulator and recorded sessions run through exactly the same code.
//
// Each target is held until the last `minSamples` frames are steady enough (`steadyBar`).
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
//   hops    - dots jump between the bands, `hopMs` each; frames from HOP_SETTLE_MS on are
//             samples. (Held-out band switches on target: 60% -> 70%.)
// Neither phase is scored or dropped; they only add training data.
import { steadinessOf } from './scoring.js';

export const PURSUIT_LAG_MS = 100;   // how far the eyes trail a smoothly moving dot
const PURSUIT_LEAD_MS = 800;         // dot holds still first so the eyes can find it
export const HOP_SETTLE_MS = 400;    // eyes need this long to land after a jump

/** The calibration pursuit path: one sweep across, two passes through both bands. */
export function pursuitPath(ms, movingMs) {
  const s = Math.max(0, ms - PURSUIT_LEAD_MS) / movingMs;
  return { x: 0.5 - 0.4 * Math.cos(2 * Math.PI * s), y: 0.5 - 0.36 * Math.cos(4 * Math.PI * s) };
}

export class CalibrationSession {
  constructor({ targets, settleMs = 500, minSamples = 24, steadyBar = 0.6, maxCaptureMs = 3500, lockMs = 300, pursuitMs = 0, hops = [], hopMs = 1200, onTarget, onProgress, onDone } = {}) {
    Object.assign(this, { targets, settleMs, minSamples, steadyBar, maxCaptureMs, lockMs, pursuitMs, hops, hopMs, onTarget, onProgress, onDone });
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
    this.shownAt = null; this.buf = []; this.best = null;
    if (this.index < this.targets.length) return this.onTarget?.(this.target, this.index, { phase: 'dots' });
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
    if (fill >= 0.5 && (!this.best || steadiness * fill > this.best.rank)) this.best = { samples: [...this.buf], steadiness, rank: steadiness * fill };
    if (fill >= 1 && steadiness >= this.steadyBar) return this.finish({ samples: [...this.buf], steadiness, weak: false }, frame.t);
    this.onProgress?.(Math.min(0.95, fill * Math.min(1, steadiness / this.steadyBar)), { stage: 'capturing', steadiness });
    if (elapsed > this.maxCaptureMs) {
      const b = this.best;
      this.finish(b ? { samples: b.samples, steadiness: b.steadiness, weak: true } : { samples: [], steadiness: 0, weak: true }, frame.t);
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
    if (h.t0 === null) h.t0 = frame.t;
    const ms = frame.t - h.t0;
    if (ms >= HOP_SETTLE_MS && frame.face && !frame.blink && frame.f) h.samples.push(frame.f);
    this.onProgress?.(Math.min(1, ms / this.hopMs));
    if (ms < this.hopMs) return;
    if (h.samples.length) this.points.push({ kind: 'hop', target, samples: h.samples, targets: h.samples.map(() => target), steadiness: 1, weak: false });
    if (h.i + 1 >= this.hops.length) return this.nextPhase();
    this.hop = { i: h.i + 1, t0: null, samples: [] };
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
