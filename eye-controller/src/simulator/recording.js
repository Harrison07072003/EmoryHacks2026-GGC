// Record real sessions as feature frames (not video) and play them back through the
// exact same pipeline. This is how accuracy gets tuned against real, messy data.
import { FEATURE_VERSION } from '../cv/features.js';
import { round } from '../util/math.js';
import { saveJson } from '../ui/save-file.js';

const slim = (frame, target) => frame.face
  ? { t: round(frame.t, 1), face: true, blink: !!frame.blink, f: frame.f.map(v => round(v)), eyes: frame.eyes, head: frame.head, box: frame.box, ms: frame.ms === undefined ? undefined : round(frame.ms, 1), target: target ?? null }
  : { t: round(frame.t, 1), face: false, target: target ?? null };

/**
 * Start recording a controller. While a calibration is running each frame is labelled with
 * the dot that was on screen, which is the ground truth used when replaying.
 */
export function createRecorder(controller, meta = {}) {
  const frames = [];
  const off = controller.debug.on('frame', frame => frames.push(slim(frame, controller.debug.calibrationTarget())));
  return {
    get length() { return frames.length; },
    stop() {
      off();
      return { featureVersion: FEATURE_VERSION, recordedAt: new Date().toISOString(), meta, frames };
    },
  };
}

/** Save a recording into recordings/ (or the Downloads folder without the dev server). */
export const saveRecording = (recording, name = 'session') => saveJson('recordings', recording, name);

/** Frame source that plays a recording. Same shape as CameraSource / SyntheticSource. */
export class ReplaySource {
  constructor(recording, { speed = 1, loop = false } = {}) {
    if (recording.featureVersion !== FEATURE_VERSION) throw new Error(`Recording has feature version ${recording.featureVersion}, expected ${FEATURE_VERSION}`);
    Object.assign(this, { frames: recording.frames, speed, loop });
  }
  async start(_videoEl, onFrame) {
    this.onFrame = onFrame;
    let i = 0, offset = performance.now() - this.frames[0].t / this.speed;
    const tick = () => {
      if (!this.onFrame) return;
      const now = performance.now();
      while (i < this.frames.length && offset + this.frames[i].t / this.speed <= now) this.onFrame({ ...this.frames[i], t: offset + this.frames[i++].t / this.speed });
      if (i >= this.frames.length) {
        if (!this.loop) return;
        i = 0; offset = now - this.frames[0].t / this.speed;
      }
      this.timer = setTimeout(tick, 10);
    };
    tick();
  }
  stop() { clearTimeout(this.timer); this.onFrame = null; }
  /** Push every frame through `onFrame` immediately (headless). */
  runAll(onFrame) { for (const f of this.frames) onFrame(f); }
}
