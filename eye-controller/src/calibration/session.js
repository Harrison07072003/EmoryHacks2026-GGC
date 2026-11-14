// Adaptive capture of calibration points. Driven purely by feature frames (no DOM, no
// timers), so the simulator and recorded sessions run through exactly the same code.
//
// Each target is held until the last `minSamples` frames are steady enough (`steadyBar`).
// There is no fixed duration: a calm player finishes a dot in about a second, a shaky one
// keeps it up to `maxCaptureMs`, after which the best window seen is kept and marked weak.
import { steadinessOf } from './scoring.js';

export class CalibrationSession {
  constructor({ targets, settleMs = 500, minSamples = 18, steadyBar = 0.6, maxCaptureMs = 3500, onTarget, onProgress, onDone } = {}) {
    Object.assign(this, { targets, settleMs, minSamples, steadyBar, maxCaptureMs, onTarget, onProgress, onDone });
    this.points = []; this.index = -1; this.done = false;
  }
  get target() { return this.done ? null : this.targets[this.index] ?? null; }

  start() { this.next(); return this; }

  next() {
    this.index++;
    this.shownAt = null; this.buf = []; this.best = null;
    if (this.index >= this.targets.length) {
      this.done = true;
      this.onTarget?.(null, this.index);
      this.onDone?.(this.points);
    } else this.onTarget?.(this.target, this.index);
  }

  push(frame) {
    if (this.done || this.index < 0) return;
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
