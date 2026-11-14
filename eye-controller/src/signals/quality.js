// Live tracking quality, 0-100. It is the calibration score scaled down by whatever is
// currently going wrong: no face, low light, glare, weak pupil contrast, face leaving the
// frame, or the head having moved away from where it was during calibration.
import { clamp, ramp } from '../util/math.js';

/** Score used before a calibration exists: tracking works, but we cannot vouch for accuracy. */
const UNCALIBRATED = 40;

/** @returns { live: 0-1, factors } for one frame. Blinks are not punished (returns null). */
export function liveQuality(frame, headRef = null) {
  if (!frame.face) return { live: 0, factors: { face: 0 } };
  if (frame.blink) return null;
  const { R, L } = frame.eyes, best = (key, pick) => pick(R[key], L[key]);
  const lum = (R.lum + L.lum) / 2;
  const factors = {
    face: 1,
    light: Math.min(ramp(lum, 35, 80), 1 - 0.6 * ramp(lum, 215, 250)),
    // the model can lean on the cleaner eye, so the better eye counts most
    glare: 1 - 0.5 * ramp(best('glare', Math.min), 0.01, 0.06) - 0.2 * ramp(best('glare', Math.max), 0.01, 0.06),
    pupil: 0.5 + 0.5 * ramp(best('conf', Math.max), 0.1, 0.35),
    framing: framing(frame.box),
    head: headRef ? headDrift(frame.head, headRef) : 1,
  };
  return { live: Object.values(factors).reduce((a, b) => a * b, 1), factors };
}

function framing(box) {
  if (!box) return 1;
  const edge = Math.min(box.x, box.y, 1 - (box.x + box.w), 1 - (box.y + box.h));
  return (0.4 + 0.6 * ramp(edge, -0.02, 0.03)) * (0.5 + 0.5 * ramp(box.w, 0.08, 0.16));
}

function headDrift(head, ref) {
  const turn = Math.hypot(head[0] - ref[0], head[1] - ref[1]);
  const shift = Math.hypot(head[2] - ref[2], head[3] - ref[3]);
  return 1 - 0.5 * Math.max(ramp(turn, 0.15, 0.45), ramp(shift, 0.1, 0.3));
}

export class QualityTracker {
  constructor({ smoothing = 0.15 } = {}) { this.smoothing = smoothing; this.value = 0; this.factors = {}; this.ema = null; }
  /** @returns the new integer score when it changed, else null */
  update(frame, { calibrationScore = null, headRef = null } = {}) {
    const q = liveQuality(frame, headRef);
    if (!q) return null;
    this.factors = q.factors;
    const target = q.live * (calibrationScore ?? UNCALIBRATED);
    // drop fast on a lost face, otherwise ease so the number does not flicker
    this.ema = this.ema === null || !frame.face ? target : this.ema + this.smoothing * (target - this.ema);
    const next = Math.round(clamp(this.ema, 0, 100));
    if (next === this.value) return null;
    return (this.value = next);
  }
}
