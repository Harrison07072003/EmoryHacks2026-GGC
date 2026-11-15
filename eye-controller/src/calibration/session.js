// Adaptive capture of calibration points. Driven purely by feature frames (no DOM, no
// timers), so the simulator and recorded sessions run through exactly the same code.
//
// Each target is held until the last `minSamples` frames are steady enough (`steadyBar`).
// There is no fixed duration: a calm player finishes a dot in about a second, a shaky one
// keeps it up to `maxCaptureMs`, after which the best window seen is kept and marked weak.
//
// After the dots, an optional pursuit phase: one dot glides through both bands for
// `pursuitMs` and every frame becomes a sample labelled with where the dot was
// PURSUIT_LAG_MS earlier. Real clips showed calibrating on still dots alone mispredicts
// the vertical during play; adding a moving dot cut band-switch errors measurably.
import { steadinessOf } from './scoring.js';

export const PURSUIT_LAG_MS = 100;   // how far the eyes trail a smoothly moving dot
const PURSUIT_LEAD_MS = 800;         // dot holds still first so the eyes can find it

/** The calibration pursuit path: one sweep across, two passes through both bands. */
export function pursuitPath(ms, movingMs) {
  const s = Math.max(0, ms - PURSUIT_LEAD_MS) / movingMs;
  return { x: 0.5 - 0.4 * Math.cos(2 * Math.PI * s), y: 0.5 - 0.36 * Math.cos(4 * Math.PI * s) };
}

export class CalibrationSession {
  constructor({ targets, settleMs = 500, minSamples = 18, steadyBar = 0.6, maxCaptureMs = 3500, pursuitMs = 0, onTarget, onProgress, onDone } = {}) {
    Object.assign(this, { targets, settleMs, minSamples, steadyBar, maxCaptureMs, pursuitMs, onTarget, onProgress, onDone });
    this.points = []; this.index = -1; this.done = false; this.pursuit = null;
  }
  get target() { return this.done ? null : this.pursuit ? this.pursuit.now : this.targets[this.index] ?? null; }
  /** 'pursuit' while the moving dot is shown, else null (recordings use it to tell the phases apart). */
  get targetId() { return this.pursuit && !this.done ? 'pursuit' : null; }

  start() { this.next(); return this; }

  next() {
    this.index++;
    this.shownAt = null; this.buf = []; this.best = null;
    if (this.index >= this.targets.length && this.pursuitMs > 0 && !this.pursuit) {
      this.pursuit = { t0: null, now: pursuitPath(0, this.pursuitMs), samples: [], targets: [], trail: [] };
      this.onTarget?.(this.pursuit.now, this.index, { moving: true });
    } else if (this.index >= this.targets.length) {
      this.done = true;
      this.onTarget?.(null, this.index);
      this.onDone?.(this.points);
    } else this.onTarget?.(this.target, this.index);
  }

  push(frame) {
    if (this.done || this.index < 0) return;
    if (this.pursuit) return this.pushPursuit(frame);
    if (this.shownAt === null) this.shownAt = frame.t;
    const elapsed = frame.t - this.shownAt - this.settleMs;
    if (elapsed < 0) return; // eyes are still travelling to the dot

    if (frame.face && !frame.blink && frame.f) {
      this.buf.push(frame.f);
      if (this.buf.length > this.minSamples) this.buf.shift();
    }
    const fill = this.buf.length / this.minSamples;
    if (fill >= 0.5) {
      const steadiness = steadinessOf(this.buf);
      if (!this.best || steadiness * fill > this.best.rank) this.best = { samples: [...this.buf], steadiness, rank: steadiness * fill };
      if (fill >= 1 && steadiness >= this.steadyBar) return this.finish({ samples: [...this.buf], steadiness, weak: false });
      this.onProgress?.(Math.min(0.95, fill * (steadiness / this.steadyBar)));
    }
    if (elapsed > this.maxCaptureMs) {
      const b = this.best;
      this.finish(b ? { samples: b.samples, steadiness: b.steadiness, weak: true } : { samples: [], steadiness: 0, weak: true });
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
      this.pursuit = { ...p, now: null };
      this.done = true;
      this.onTarget?.(null, this.index);
      this.onDone?.(this.points);
      return;
    }
    p.now = pursuitPath(ms, this.pursuitMs);
    this.onTarget?.(p.now, this.index, { moving: true });
  }

  finish(capture) {
    this.onProgress?.(1);
    this.points.push({ target: this.target, ...capture });
    this.next();
  }

  /** Stop early; points captured so far are kept. */
  abort() {
    if (this.done) return;
    this.done = true;
    this.onTarget?.(null, this.index);
    this.onDone?.(this.points, { aborted: true });
  }
}
