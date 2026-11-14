// Frame source backed by the fake eye instead of a camera. Same shape as CameraSource.
//
// drive: 'auto'  - follows the mouse once it moves, plays a scripted demo until then
//        'mouse' - follows the mouse only
//        'script'- scripted demo only
//        (t) => ({ x, y })  - your own gaze path
// clock: 'auto' runs in real time; 'manual' only advances when you call step(ms) (tests).
import { createSimEye } from './sim-eye.js';
import { steadinessOf } from '../calibration/scoring.js';
import { clamp } from '../util/math.js';

const SACCADE_LATENCY_MS = 220;

/** Demo path: hop across the top band lane by lane, then sweep smoothly along the bottom band. */
export function demoPath(t, lanes = 4) {
  const hop = 1100, top = lanes * hop, cycle = top + 6000, p = t % cycle;
  if (p < top) return { x: (Math.floor(p / hop) + 0.5) / lanes, y: 0.25 };
  const s = (p - top) / 6000;
  return { x: 0.5 - 0.42 * Math.cos(2 * Math.PI * s), y: 0.75 + 0.08 * Math.sin(6 * Math.PI * s) };
}

export class SyntheticSource {
  constructor({ drive = 'auto', noise = 'realistic', seed = 1, fps = 30, clock = 'auto', area = null } = {}) {
    Object.assign(this, { drive, fps, clock, area });
    this.eye = createSimEye({ seed, noise });
    this.conditions = {};
    this.gaze = { x: 0.5, y: 0.5 };
    this.mouse = null; this.attention = null; this.t = 0;
  }

  async start(_videoEl, onFrame) {
    this.onFrame = onFrame;
    if (this.clock === 'manual') return;
    if (typeof window !== 'undefined' && (this.drive === 'auto' || this.drive === 'mouse')) {
      this.onMove = e => {
        const r = this.area?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
        this.mouse = { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
      };
      window.addEventListener('pointermove', this.onMove);
    }
    this.timer = setInterval(() => { this.t = performance.now(); this.emit(); }, 1000 / this.fps);
  }

  stop() {
    clearInterval(this.timer);
    if (this.onMove) window.removeEventListener('pointermove', this.onMove);
    this.onFrame = null;
  }

  /** Manual clock: advance simulated time and emit the frames that fall inside it. */
  step(ms) {
    const dt = 1000 / this.fps;
    for (let n = Math.round(ms / dt); n > 0; n--) { this.t += dt; this.emit(); }
  }

  /** Make the fake player look at a point (after a human-like reaction delay). null = back to `drive`. */
  lookAt(target) { this.attention = target ? { target, at: this.t + SACCADE_LATENCY_MS } : null; }

  setConditions(cond) { Object.assign(this.conditions, cond); }

  intent() {
    if (this.attention) return this.t >= this.attention.at ? this.attention.target : this.gaze;
    if (typeof this.drive === 'function') return this.drive(this.t);
    if (this.drive !== 'script' && this.mouse) return this.mouse;
    return this.drive === 'mouse' ? this.gaze : demoPath(this.t);
  }

  emit() {
    this.gaze = this.intent();
    this.onFrame?.(this.eye(this.t, this.gaze, this.conditions));
  }

  /** Calibration points as if the player had looked at each target perfectly attentively. */
  instantPoints(targets, samplesPerPoint = 18) {
    return targets.map((target, i) => {
      const samples = [];
      for (let k = 0; samples.length < samplesPerPoint; k++) {
        const fr = this.eye(i * 1500 + k * 33, target, {});
        if (!fr.blink) samples.push(fr.f);
      }
      return { target, samples, steadiness: steadinessOf(samples), weak: false };
    });
  }
}
