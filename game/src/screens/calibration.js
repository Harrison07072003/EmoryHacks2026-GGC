// Calibration, built on the eye-controller's own calibration (startCalibration): we only
// draw the dots in the game's style. Three phases: intro (auto-continues once the face is
// steady), the dots + follow-the-dot run, and the result.
//
// params: kind  'full' | 'quick' (between songs) | 'auto' (quick if a pooled baseline exists)
//         next / nextParams  where to go afterwards
import { CALIBRATION } from '../config/game-config.js';
import { VERSIONS } from '../../../eye-controller/src/index.js';
import { gazeButton, html } from './ui.js';

const INTRO_MS = 1800;
const INTRO_MS_WITH_SKIP = 4500;   // long enough to dwell 2 s on Skip before the dots start
const AUTO_CONTINUE_MS = 4000;

export default function calibration(root, app, { kind = 'full', next = 'modes', nextParams = {}, positioned = false }) {
  const { gaze, dwell, store } = app;
  const proceed = () => app.go(next, nextParams);

  // mouse-as-gaze has nothing to calibrate
  if (!gaze.eyes || gaze.mouseOverride) { app.session.calibratedThisSession = true; queueMicrotask(proceed); return {}; }
  // the face check (camera view, adjust your head) always comes first
  if (!positioned) { queueMicrotask(() => app.go('faceCheck', { next: 'calibration', nextParams: { kind, next, nextParams, positioned: true } })); return {}; }

  const quick = kind !== 'full';
  const previousScore = gaze.calibrationScore;
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
  const canSkip = quick && (app.session.calibratedThisSession || gaze.calibrationOk);
  if (canSkip) buttons.append(gazeButton(app.session.calibratedThisSession ? 'Skip' : 'Use saved calibration', () => { app.session.calibratedThisSession = true; proceed(); }, { cls: 'purple small' }));
  const introMs = canSkip ? INTRO_MS_WITH_SKIP : INTRO_MS;

  let phase = 'intro', faceSince = null, overlay = null, resultAt = 0, okResult = false;

  async function run() {
    phase = 'running';
    dwell.setEnabled(false);
    overlay = html('<div class="calib"><div class="msg">Look at the dot</div><div class="dot"></div></div>');
    document.getElementById('overlay-layer').appendChild(overlay);
    const dot = overlay.querySelector('.dot'), msg = overlay.querySelector('.msg');
    const result = await gaze.eyes.startCalibration({
      quick, pursuitMs: quick ? CALIBRATION.quickPursuitMs : CALIBRATION.fullPursuitMs,
      onTarget(target, index, total, info) {
        if (!target) return;
        dot.classList.toggle('moving', !!info?.moving);
        dot.style.left = `${target.x * 100}%`; dot.style.top = `${target.y * 100}%`;
        if (info?.moving) msg.textContent = 'Follow the dot with your eyes';
        else { dot.style.setProperty('--p', 0); msg.textContent = `${index + 1} / ${total}`; app.sfx.play('tick', { gain: 0.5 }); }
      },
      onProgress(p) { dot.style.setProperty('--p', p.toFixed(3)); },
    });
    overlay.remove(); overlay = null;
    dwell.setEnabled(true);
    if (result.aborted) { phase = 'intro'; faceSince = null; return; }
    await finish(result);
  }

  async function finish(result) {
    // a between-song recalibration that came out clearly worse is thrown away
    const worse = quick && previousScore !== null && result.score < previousScore - CALIBRATION.keepWorseBy;
    if (worse) await gaze.loadProfile();
    else if (result.ok) await gaze.saveProfile();
    store.saveCalibration({
      player_id: app.settings.playerId, kind: quick ? 'quick' : 'full', score: result.score, ok: result.ok, kept: !worse,
      weak_cells: result.weakCells, input_source: gaze.source, engine_version: VERSIONS.app, feature_version: VERSIONS.features,
      points: result.points.map(p => ({ x: p.target.x, y: p.target.y, score: p.score, kept: p.kept, steadiness: p.steadiness, residual: Number.isFinite(p.residual) ? p.residual : null })),
    }).catch(() => {});

    okResult = worse || result.ok;
    if (okResult) app.session.calibratedThisSession = true;
    phase = 'result'; resultAt = performance.now();
    el.querySelector('h2').textContent = okResult ? 'Calibrated' : 'Calibration too weak';
    el.querySelector('.hint').innerHTML = worse
      ? `This run scored ${result.score}; kept your previous calibration (${previousScore}).`
      : okResult ? `Score <b>${result.score}</b>/100. Look at a button for 2 seconds to press it.`
        : `Score <b>${result.score}</b>/100 (needs ${CALIBRATION.minScore}). Try more light on your face, less glare on glasses, and keep your head still.`;
    ring.style.display = okResult ? '' : 'none';
    buttons.replaceChildren(
      gazeButton(okResult ? 'Continue' : 'Try again', okResult ? proceed : () => app.go('calibration', { kind, next, nextParams })),   // back through the face check
      ...(okResult ? [gazeButton('Recalibrate', () => app.go('calibration', { kind: 'full', next, nextParams, positioned: true }), { cls: 'purple small' })]
        : [gazeButton('Continue anyway', () => { app.session.calibratedThisSession = true; proceed(); }, { cls: 'danger small' })]),
    );
  }

  return {
    frame(now) {
      faceDot.classList.toggle('ok', gaze.faceVisible);
      if (phase === 'intro') {
        faceText.textContent = gaze.faceVisible ? 'Face found. Hold still…' : 'No face yet: sit in front of the camera, with light on your face';
        faceSince = gaze.faceVisible ? (faceSince ?? now) : null;
        const p = faceSince === null ? 0 : (now - faceSince) / introMs;
        ring.style.setProperty('--p', Math.min(1, p).toFixed(3));
        count.textContent = faceSince === null ? '…' : 'GO';
        if (p >= 1) run();
      } else if (phase === 'result' && okResult) {
        const p = (now - resultAt) / AUTO_CONTINUE_MS;
        ring.style.setProperty('--p', Math.min(1, p).toFixed(3));
        count.textContent = Math.max(1, Math.ceil(AUTO_CONTINUE_MS / 1000 * (1 - p)));
        if (p >= 1) { phase = 'done'; proceed(); }
      }
    },
    /** Escape (testing): cancel a running calibration. */
    onEscape() { if (phase === 'running') gaze.eyes.debug.engine.session?.abort(); else if (app.session.calibratedThisSession) proceed(); },
    unmount() { overlay?.remove(); if (phase === 'running') gaze.eyes.debug.engine.session?.abort(); dwell.setEnabled(true); },
  };
}
