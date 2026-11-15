// Record real sessions as feature frames (not video) and play them back through the
// exact same pipeline. This is how accuracy gets tuned against real, messy data.
import { FEATURE_VERSION } from '../cv/features.js';
import { round } from '../util/math.js';
import { saveJson } from '../ui/save-file.js';

/**
 * One recorded frame: the measurements, where the player should have been looking
 * (`target`, with `src` 'calibration' or 'game' and the game's id in `tid`), and what the
 * tracker reported live (`out`).
 */
function slim(sample) {
  const fr = sample.frame, base = { t: round(fr.t, 1), face: !!fr.face };
  if (sample.target) Object.assign(base, { target: sample.target, src: sample.targetSource, tid: sample.targetId ?? undefined });
  if (sample.gaze || sample.lane !== null) base.out = { x: sample.gaze ? round(sample.gaze.x, 4) : null, y: sample.gaze ? round(sample.gaze.y, 4) : null, lane: sample.lane, band: sample.band };
  if (!fr.face) return base;
  return { ...base, blink: !!fr.blink, f: fr.f.map(v => round(v)), eyes: fr.eyes, head: fr.head, box: fr.box, shapes: fr.shapes, res: fr.res, ms: fr.ms === undefined ? undefined : round(fr.ms, 1) };
}

/**
 * Start recording a controller. Calibration frames are labelled with the dot on screen and
 * game frames with whatever the game passed to setTarget; that is the ground truth used when
 * scoring. The calibration in use when recording starts is stored in `meta.calibrationPoints`,
 * so a clip without its own calibration (e.g. a drift check) can still be replayed.
 */
export function createRecorder(controller, meta = {}) {
  const frames = [], cal = controller.debug.engine.calibration;
  const calibrationPoints = cal ? cal.points.filter(p => p.kept).map(p => ({
    target: p.target, steadiness: round(p.steadiness ?? 0, 3), samples: p.samples.map(f => f.map(v => round(v))),
    ...(p.kind ? { kind: p.kind, targets: p.targets } : {}),
  })) : null;
  const off = controller.onSample(sample => frames.push(slim(sample)));
  return {
    get length() { return frames.length; },
    stop() {
      off();
      return { featureVersion: FEATURE_VERSION, recordedAt: new Date().toISOString(), meta: { ...meta, calibrationPoints }, frames };
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
