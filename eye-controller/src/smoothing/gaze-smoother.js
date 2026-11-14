// The smoothing stack, in normalized 0-1 screen units:
//   median (spikes) -> saccade snap (big jumps skip the lag) -> One Euro (jitter)
//   -> steady-gaze lock (hold still while fixating)
import { OneEuro } from './one-euro.js';
import { MedianFilter } from './median.js';
import { FixationLock } from './fixation-lock.js';
import { SaccadeDetector } from './saccade.js';
import { clamp } from '../util/math.js';

export class GazeSmoother {
  constructor({ minCutoff = 1.5, beta = 4, medianSize = 3, fixRadius = 0.05, fixWindowMs = 160, snapDistance = 0.12 } = {}) {
    this.mx = new MedianFilter(medianSize); this.my = new MedianFilter(medianSize);
    this.fx = new OneEuro({ minCutoff, beta }); this.fy = new OneEuro({ minCutoff, beta });
    this.lock = new FixationLock({ radius: fixRadius, windowMs: fixWindowMs });
    this.saccade = new SaccadeDetector({ distance: snapDistance });
    this.last = null;
  }
  reset() {
    for (const part of [this.mx, this.my, this.fx, this.fy, this.lock, this.saccade]) part.reset();
    this.last = null;
  }
  /** @returns { x, y, fixed, snapped } */
  push(raw, tMs) {
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return this.last ?? { x: 0.5, y: 0.5, fixed: false, snapped: false };
    const m = { x: this.mx.push(raw.x), y: this.my.push(raw.y) };
    const jump = this.saccade.update(m, this.last), snapped = jump === 'snap';
    // Hold position until the jump is confirmed, so the output never glides through the
    // lanes in between, then land on the new spot in one step.
    if (jump === 'pending') return (this.last = { ...this.last, snapped: false });
    if (snapped) { this.fx.reset(); this.fy.reset(); this.lock.reset(); }
    const smooth = { x: this.fx.filter(m.x, tMs), y: this.fy.filter(m.y, tMs) };
    const held = this.lock.push(m, tMs);
    const p = held ?? smooth;
    this.last = { x: clamp(p.x), y: clamp(p.y), fixed: !!held, snapped };
    return this.last;
  }
}
