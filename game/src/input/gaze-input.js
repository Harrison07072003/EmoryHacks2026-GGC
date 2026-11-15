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
//
// Mouse next to the eyes (settings.mouseMode, see MOUSE in game-config.js):
//   off        (default) the mouse never drives (except the dev sources above)
//   assist     eyes first; the mouse drives only while it is moving or the face is lost
// Emergency mouse is not a setting: after two failed calibrations in a row the game offers it
// (enableEmergencyMouse); eye input then stays off until the next successful calibration.
import { createEyeController, createMockEyeController } from '../../../eye-controller/src/index.js';
import { CALIBRATION, LAYOUT, MOUSE } from '../config/game-config.js';

export const SOURCES = {
  live: { label: 'LIVE EYE TRACKING', dev: false },
  sim: { label: 'DEV: SIMULATED GAZE (mouse drives fake eyes)', dev: true },
  mouse: { label: 'DEV: MOUSE AS GAZE', dev: true },
};

/**
 * @param options  mouseMode: () => 'off' | 'assist' (read live, so Settings apply at once)
 *                 pool: warm-start calibrations from the shared pooled baseline (default false)
 */
export function createGazeInput(source = 'live', { mouseMode = () => MOUSE.defaultMode, pool = false } = {}) {
  const layout = { lanes: LAYOUT.lanes, bandSplit: LAYOUT.bandSplit };
  const eyes = source === 'live' ? createEyeController({ layout, minScore: CALIBRATION.minScore, pool })
    : source === 'sim' ? createMockEyeController({ layout, minScore: CALIBRATION.minScore, autoCalibrate: false, pool })
      : null;
  const gaze = { x: 0.5, y: 0.5, valid: false };
  const mouse = { x: 0.5, y: 0.5, seen: false, activeAt: -Infinity, travel: [] };
  let override = source === 'mouse';   // dev: Shift+M or ?input=mouse
  let mouseLock = false;               // emergency mouse (chosen after failed calibrations), until the next good one
  let watching = true, driver = override ? 'mouse' : 'eyes';
  const listeners = new Set(), notify = () => listeners.forEach(f => f());
  let lastFrame = null;
  eyes?.onSample(sample => { lastFrame = sample.frame; });

  addEventListener('pointermove', e => {
    const x = e.clientX / innerWidth, y = e.clientY / innerHeight, now = performance.now();
    if (mouse.seen) {
      // add up recent travel: a nudge of the desk is not deliberate use, a real move is
      mouse.travel.push({ t: now, d: Math.hypot(e.clientX - mouse.x * innerWidth, e.clientY - mouse.y * innerHeight) });
      while (mouse.travel.length && now - mouse.travel[0].t > MOUSE.takeoverWindowMs) mouse.travel.shift();
    }
    Object.assign(mouse, { x, y, seen: true });
    // assist mode, live webcam only (on simulated eyes the mouse is how you look)
    if (!watching || source !== 'live' || override || e.pointerType === 'touch') return;
    if (mouse.travel.reduce((a, s) => a + s.d, 0) >= MOUSE.assistTravelPx) mouse.activeAt = now;
  });
  addEventListener('keydown', e => {
    if (e.key === 'M' && e.shiftKey && source !== 'mouse') { override = !override; notify(); }
  });

  const eyesUsable = () => !!eyes && eyes.state.faceVisible && eyes.state.calibrationScore !== null;
  /** Who drives the gaze right now: 'eyes' or 'mouse'. */
  function pickDriver(now) {
    if (override || mouseLock || !eyes) return 'mouse';
    if (mouseMode() === 'assist' && mouse.seen && (now - mouse.activeAt < MOUSE.assistHoldMs || !eyesUsable())) return 'mouse';
    return 'eyes';
  }

  const api = {
    source, eyes, gaze, layout,
    get sourceInfo() {
      if (override && source !== 'mouse') return { label: 'DEV: MOUSE OVERRIDE (Shift+M)', dev: true };
      if (mouseLock) return { label: 'MOUSE: eye input off until a calibration passes', dev: false, warn: true };
      if (driver === 'mouse' && source !== 'mouse') return { label: 'MOUSE ASSIST', dev: false, warn: true };
      return SOURCES[source];
    },
    get latencyKey() { return driver === 'mouse' ? 'mouse' : source; },
    /** The mouse is driving right now (dev override, emergency takeover, or assist). */
    get mouseOverride() { return driver === 'mouse'; },
    /** Dev override only (Shift+M / ?input=mouse): nothing to calibrate. */
    get manualMouse() { return override; },
    /** Emergency mouse is on: eye input stays off until a calibration succeeds. */
    get mouseLocked() { return mouseLock; },
    onSourceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** @param videoEl  the page's camera <video> (live only) */
    async init(videoEl) { if (eyes) await eyes.init(source === 'live' ? videoEl : undefined); },
    /** Latest eye-controller frame (face box, eye glare / brightness, exposure), or null. */
    get frame() { return lastFrame; },
    /** True when a real camera image exists to show (live webcam only). */
    get hasCamera() { return source === 'live'; },

    /** A calibration exists this page load (score may still be below the play threshold). */
    get calibrated() { return driver === 'mouse' ? true : eyes.state.calibrationScore !== null; },
    get calibrationScore() { return eyes?.state.calibrationScore ?? null; },
    get calibrationOk() { return driver === 'mouse' ? true : eyes.state.ready; },
    get faceVisible() { return driver === 'mouse' ? true : eyes.state.faceVisible; },
    get quality() { return driver === 'mouse' ? 100 : eyes.state.quality; },
    /** 1 = head where it was at calibration, down to 0.5 = turned / moved far (engine's head factor). */
    get headSteadiness() { return driver === 'mouse' ? 1 : eyes.faceData().conditions.factors.head ?? 1; },

    /** The tracker's reported lane / band (null while the mouse drives): for tracking stats. */
    get cell() { return driver === 'eyes' && eyes ? { lane: eyes.state.lane, band: eyes.state.band } : null; },

    /** Call once per animation frame before reading `gaze`. */
    update() {
      const next = pickDriver(performance.now());
      if (next !== driver) { driver = next; notify(); }
      if (driver === 'mouse') { gaze.x = mouse.x; gaze.y = mouse.y; gaze.valid = mouse.seen; return gaze; }
      const s = eyes.state;
      gaze.x = s.gaze.x; gaze.y = s.gaze.y;
      gaze.valid = s.faceVisible && s.calibrationScore !== null;
      return gaze;
    },

    /** Pause / resume the mouse watch (calibration turns it off: moving the mouse there is fine). */
    watchMouse(on) { watching = on; mouse.travel = []; },
    /** Emergency mouse: the player chose it after calibration kept failing. */
    enableEmergencyMouse() { if (!mouseLock) { mouseLock = true; notify(); } },
    /** A successful calibration hands control back to the eyes. */
    clearMouseLock() { if (mouseLock) { mouseLock = false; mouse.activeAt = -Infinity; notify(); } },

    async loadProfile() { return eyes ? eyes.loadProfile() : false; },
    async saveProfile() { return eyes ? eyes.saveProfile() : false; },
    /** Telemetry label: where the player should be looking right now (null to clear). */
    setTarget(point, id) { eyes?.setTarget(point, id); },
    /** Teach the tracker from a hit, only when the eyes produced it. */
    confirmOnTarget(point) { if (eyes && driver === 'eyes') eyes.confirmOnTarget(point); },
  };
  return api;
}
