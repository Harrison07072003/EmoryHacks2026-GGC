// Record real sessions as feature frames (not video) and play them back through the
// exact same pipeline. This is how accuracy gets tuned against real, messy data.
import { FEATURE_VERSION } from '../cv/features.js';
import { round } from '../util/math.js';

const slim = (frame, target) => frame.face
  ? { t: round(frame.t, 1), face: true, blink: !!frame.blink, f: frame.f.map(v => round(v)), eyes: frame.eyes, head: frame.head, box: frame.box, target: target ?? null }
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

/** Offer a recording as a .json download (browser only). */
export function downloadRecording(recording, name = 'session') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(recording)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: `${name}.json` }).click();
  URL.revokeObjectURL(url);
}

/**
 * Save a recording into the project's recordings/ folder through the dev server.
 * Falls back to a browser download when that is not available (e.g. a production build).
 * @returns where it went, e.g. 'recordings/jon-dim_2026-11-14-17-02-11.json' or 'Downloads'
 */
export async function saveRecording(recording, name = 'session') {
  try {
    const res = await fetch(`/__recordings?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(recording) });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('json')) return (await res.json()).file;
  } catch { /* no dev server: fall through */ }
  downloadRecording(recording, name);
  return 'Downloads';
}

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
