// Calibration: a short intro (auto-continues once the face is steady), then the
// eye-controller's own calibration and result screens in the game's look
// (input/calibration-flow.js): dots that check you are looking, a moving dot, band hops,
// the mini camera, and a per-area result you can press with your eyes.
//
// params: kind  'full' | 'quick' (between songs) | 'auto' (quick if a pooled baseline exists)
//         next / nextParams  where to go afterwards
import { CALIBRATION } from '../config/game-config.js';
import { runEngineCalibration, cancelEngineCalibration } from '../input/calibration-flow.js';
import { gazeButton, html } from './ui.js';

const INTRO_MS = 1800;
const INTRO_MS_WITH_SKIP = 4500;   // long enough to dwell 2 s on Skip before the dots start

export default function calibration(root, app, { kind = 'full', next = 'modes', nextParams = {}, positioned = false }) {
  const { gaze } = app;
  const proceed = () => app.go(next, nextParams);

  // dev mouse-as-gaze has nothing to calibrate (an emergency mouse takeover does: calibrating ends it)
  if (!gaze.eyes || gaze.manualMouse) { app.session.calibratedThisSession = true; queueMicrotask(proceed); return {}; }
  // the face check (camera view, adjust your head) always comes first
  if (!positioned) { queueMicrotask(() => app.go('faceCheck', { next: 'calibration', nextParams: { kind, next, nextParams, positioned: true } })); return {}; }

  const quick = kind !== 'full';
  const el = html(`
    <section class="screen">
      <h2>${quick ? 'Quick recalibration' : 'Calibration'}</h2>
      <p class="hint">${quick
        ? 'A few dots, then follow one moving dot. This keeps tracking sharp between songs.'
        : 'Look at each dot until its ring fills, then follow the moving dot with your eyes. Keep your head still and sit how you will play.'}</p>
      <div class="face-box"><span class="face-dot"></span><span data-face>looking for your face…</span></div>
      <div class="auto-ring"><span data-count>…</span></div>
      <div class="row" data-buttons></div>
    </section>`);
  root.appendChild(el);
  const faceDot = el.querySelector('.face-dot'), faceText = el.querySelector('[data-face]');
  const ring = el.querySelector('.auto-ring'), count = el.querySelector('[data-count]'), buttons = el.querySelector('[data-buttons]');
  // returning players with a good saved calibration may skip the quick check
  const canSkip = quick && !gaze.mouseLocked && (app.session.calibratedThisSession || gaze.calibrationOk);
  if (canSkip) buttons.append(gazeButton(app.session.calibratedThisSession ? 'Skip' : 'Use saved calibration', () => { app.session.calibratedThisSession = true; proceed(); }, { cls: 'purple small' }));
  const introMs = canSkip ? INTRO_MS_WITH_SKIP : INTRO_MS;

  let phase = 'intro', faceSince = null;

  async function run() {
    phase = 'running';
    const r = await runEngineCalibration(app, { quick });
    if (phase === 'gone') return;
    if (r.aborted) { phase = 'intro'; faceSince = null; return; }
    // "Continue anyway" after a weak result also counts: the player chose to play
    app.session.calibratedThisSession = true;
    phase = 'done';
    proceed();
  }

  return {
    frame(now) {
      faceDot.classList.toggle('ok', gaze.faceVisible);
      if (phase !== 'intro') return;
      faceText.textContent = gaze.faceVisible ? 'Face found. Hold still…' : 'No face yet: sit in front of the camera, with light on your face';
      faceSince = gaze.faceVisible ? (faceSince ?? now) : null;
      const p = faceSince === null ? 0 : (now - faceSince) / introMs;
      ring.style.setProperty('--p', Math.min(1, p).toFixed(3));
      count.textContent = faceSince === null ? '…' : 'GO';
      if (p >= 1) run();
    },
    /** Escape (testing): cancel a running calibration, or leave once calibrated. */
    onEscape() { if (phase === 'running') cancelEngineCalibration(app); else if (app.session.calibratedThisSession) proceed(); },
    unmount() { if (phase === 'running') cancelEngineCalibration(app); phase = 'gone'; },
  };
}
