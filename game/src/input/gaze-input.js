// The game's single source of gaze. Wraps the eye-controller (eye-controller/src/index.js,
// its public interface only) and exposes one normalized point per frame:
//   gaze = { x, y, valid }   0-1 of the window, valid = face visible and a gaze model exists
//
// Sources (pick with ?input=... in the URL):
//   live  (default) real webcam tracking: MediaPipe Face Landmarker + the per-player model
//   sim   DEVELOPMENT ONLY: the eye-controller mock; the mouse drives simulated eyes through
//         the real smoothing / lane pipeline (realistic noise and lag)
//   mouse DEVELOPMENT ONLY: the mouse pointer is the gaze, no tracking pipeline at all
// Shift+M toggles a mouse override at runtime for testing; it is always labelled on screen.
import { createEyeController, createMockEyeController } from '../../../eye-controller/src/index.js';
import { CALIBRATION, LAYOUT } from '../config/game-config.js';

export const SOURCES = {
  live: { label: 'LIVE EYE TRACKING', dev: false },
  sim: { label: 'DEV: SIMULATED GAZE (mouse drives fake eyes)', dev: true },
  mouse: { label: 'DEV: MOUSE AS GAZE', dev: true },
};

export function createGazeInput(source = 'live') {
  const layout = { lanes: LAYOUT.lanes, bandSplit: LAYOUT.bandSplit };
  const eyes = source === 'live' ? createEyeController({ layout, minScore: CALIBRATION.minScore })
    : source === 'sim' ? createMockEyeController({ layout, minScore: CALIBRATION.minScore, autoCalibrate: false })
      : null;
  const gaze = { x: 0.5, y: 0.5, valid: false };
  const mouse = { x: 0.5, y: 0.5, seen: false };
  let override = source === 'mouse';
  const listeners = new Set();
  let lastFrame = null;
  eyes?.onSample(sample => { lastFrame = sample.frame; });

  addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; mouse.seen = true; });
  addEventListener('keydown', e => {
    if (e.key === 'M' && e.shiftKey && source !== 'mouse') { override = !override; listeners.forEach(f => f()); }
  });

  const api = {
    source, eyes, gaze, layout,
    get sourceInfo() { return override && source !== 'mouse' ? { label: 'DEV: MOUSE OVERRIDE (Shift+M)', dev: true } : SOURCES[source]; },
    get latencyKey() { return override ? 'mouse' : source; },
    get mouseOverride() { return override; },
    onSourceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** @param videoEl  the page's camera <video> (live only): the face check shows it */
    async init(videoEl) { if (eyes) await eyes.init(source === 'live' ? videoEl : undefined); },
    /** Latest eye-controller frame (face box, eye glare / brightness, exposure), or null. */
    get frame() { return lastFrame; },
    /** True when a real camera image exists to show (live webcam only). */
    get hasCamera() { return source === 'live'; },

    /** A calibration exists this page load (score may still be below the play threshold). */
    get calibrated() { return override || !eyes ? true : eyes.state.calibrationScore !== null; },
    get calibrationScore() { return eyes?.state.calibrationScore ?? null; },
    get calibrationOk() { return override || !eyes ? true : eyes.state.ready; },
    get faceVisible() { return override || !eyes ? true : eyes.state.faceVisible; },
    get quality() { return override || !eyes ? 100 : eyes.state.quality; },

    /** Call once per animation frame before reading `gaze`. */
    update() {
      if (override || !eyes) { gaze.x = mouse.x; gaze.y = mouse.y; gaze.valid = mouse.seen; return gaze; }
      const s = eyes.state;
      gaze.x = s.gaze.x; gaze.y = s.gaze.y;
      gaze.valid = s.faceVisible && s.calibrationScore !== null;
      return gaze;
    },

    async loadProfile() { return eyes ? eyes.loadProfile() : false; },
    async saveProfile() { return eyes ? eyes.saveProfile() : false; },
    /** Telemetry label: where the player should be looking right now (null to clear). */
    setTarget(point, id) { eyes?.setTarget(point, id); },
    confirmOnTarget(point) { if (eyes && !override) eyes.confirmOnTarget(point); },
  };
  return api;
}
