// The eye-controller's own calibration, run inside the game: our calibration screen (dots,
// moving dot, band hops, mini camera), then our result screen, both in the game's neon look
// and pressable with the eyes (their buttons carry data-gaze, so the game's dwell presses them).
// Used by the calibration screen and by the play screen's in-song quick recalibration.
import { showCalibrationResult, VERSIONS } from '../../../eye-controller/src/index.js';
import { CALIBRATION, MOUSE } from '../config/game-config.js';
import { popup } from '../screens/ui.js';

const layer = () => document.getElementById('overlay-layer');
const appEl = () => document.getElementById('app');

/**
 * Redo on the result screen always runs a full calibration. After MOUSE.offerAfterFailures
 * failed calibrations in a row (score below the pass mark) the game offers to play with the
 * mouse until a calibration passes.
 * @param options  quick: the short between-songs version (8 dots on top of the current calibration)
 * @returns { aborted } | { ok, score, kept }   kept: a worse quick run was thrown away and the
 *          previous calibration restored
 */
export async function runEngineCalibration(app, { quick: quickRun = false } = {}) {
  let quick = quickRun;
  const { gaze, dwell, store } = app;
  const eyes = gaze.eyes, previousScore = gaze.calibrationScore;
  gaze.watchMouse(false);            // moving the mouse during calibration must not take over
  appEl().inert = true;              // nothing behind our screens may take gaze
  let topUp = false;
  try {
    for (;;) {
      dwell.setEnabled(false);
      const result = await eyes.startCalibration({
        quick, topUp, area: layer(), theme: 'neon', keys: false,
        pursuitMs: quick ? CALIBRATION.quickPursuitMs : CALIBRATION.fullPursuitMs,
        hops: quick ? CALIBRATION.quickHops : CALIBRATION.fullHops,
      });
      if (result.aborted) return { aborted: true };

      // a between-song recalibration that came out clearly worse is thrown away
      const worse = quick && !topUp && previousScore !== null && result.score < previousScore - CALIBRATION.keepWorseBy;
      if (worse) await gaze.loadProfile();
      else if (result.ok) await gaze.saveProfile();
      if (result.ok || worse) gaze.clearMouseLock();
      saveRecord(app, result, { quick, topUp, kept: !worse });
      if (worse) { app.toast(`This run scored ${result.score}; kept your previous calibration (${previousScore}).`, 3500); return { ok: true, score: previousScore, kept: true }; }

      dwell.setEnabled(true);        // the result screen's buttons are pressed by looking at them
      const choice = await showCalibrationResult(result, {
        area: layer(), theme: 'neon', keys: false, buttonClass: 'gbtn small', layout: gaze.layout,
        minScore: CALIBRATION.minScore, autoMs: CALIBRATION.resultAutoMs,
      });
      if (!result.ok) app.session.failedCalibrations = (app.session.failedCalibrations ?? 0) + 1;
      else app.session.failedCalibrations = 0;
      if (choice === 'continue') {
        if (!result.ok && app.session.failedCalibrations >= MOUSE.offerAfterFailures && await offerMouse()) gaze.enableEmergencyMouse();
        return { ok: result.ok, score: result.score, kept: false };
      }
      topUp = choice === 'topup';
      if (choice === 'retry') quick = false;   // a redo is always the full calibration
    }
  } finally {
    dwell.setEnabled(true);
    appEl().inert = false;
    gaze.watchMouse(true);
  }
}

/** Calibration keeps failing: offer the mouse. Resolves true if the player takes it. */
function offerMouse() {
  return new Promise(resolve => popup({
    title: 'Eye tracking is struggling',
    text: 'Calibration did not pass twice in a row. You can play with the mouse for now: eye input comes back as soon as a calibration passes.',
    buttons: [
      { label: 'Use the mouse', onPress: () => resolve(true) },
      { label: 'Keep using my eyes', cls: 'purple', onPress: () => resolve(false) },
    ],
  }));
}

/** Cancel a running calibration (Escape, leaving the screen). */
export const cancelEngineCalibration = app => app.gaze.eyes?.cancelCalibration();

function saveRecord(app, result, { quick, topUp, kept }) {
  app.store.saveCalibration({
    player_id: app.settings.playerId, kind: topUp ? 'topup' : quick ? 'quick' : 'full', score: result.score, ok: result.ok, kept,
    weak_cells: result.weakCells, input_source: app.gaze.source, engine_version: VERSIONS.app, feature_version: VERSIONS.features,
    points: result.points.map(p => ({ x: p.target.x, y: p.target.y, kind: p.kind ?? 'dot', score: p.score, kept: p.kept, steadiness: p.steadiness, residual: Number.isFinite(p.residual) ? p.residual : null })),
  }).catch(() => {});
}
