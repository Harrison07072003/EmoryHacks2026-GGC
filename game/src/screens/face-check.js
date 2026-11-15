// Face check, shown before every calibration. The player sees themselves through the
// eye-controller's face view (mirrored camera, oval guide, face mesh, eye close-ups, live
// conditions) and adjusts head, distance and light until every check is green; after
// FACE_CHECK.holdSec of all-green it continues by itself, so no hands are needed.
// The checks are the engine's positionChecks(), tuned on recorded sessions.
//
// params: next / nextParams - where to go afterwards (normally the calibration screen)
import { createFaceView, positionChecks, positionOk } from '../../../eye-controller/src/index.js';
import { FACE_CHECK } from '../config/game-config.js';
import { esc, gazeButton, html } from './ui.js';

export default function faceCheck(root, app, { next = 'calibration', nextParams = {} }) {
  const { gaze } = app;
  const proceed = () => app.go(next, nextParams);

  const el = html(`
    <section class="screen face-check">
      <h2>Face check</h2>
      <p class="hint">Sit how you will play. Line your face up with the oval and keep every line green.</p>
      <div class="fc-stage"><canvas class="fc-overlay"></canvas></div>
      <ul class="fc-checks"></ul>
      <div class="fc-foot"><div class="auto-ring small"><span data-count>–</span></div><div class="row" data-buttons></div></div>
    </section>`);
  root.appendChild(el);
  // the face view draws the camera image itself (and a stylised face on simulated eyes)
  const view = createFaceView(gaze.eyes, el.querySelector('.fc-overlay'), { theme: 'neon', lanes: false });
  const list = el.querySelector('.fc-checks'), ring = el.querySelector('.auto-ring'), count = el.querySelector('[data-count]');
  el.querySelector('[data-buttons]').append(gazeButton('Skip check', proceed, { cls: 'purple small' }));

  let okSince = null, lastList = '';
  return {
    frame(now) {
      const checks = positionChecks(gaze.eyes.faceData().frame), ok = positionOk(checks);
      const markup = checks.map(c => `<li class="${c.pass ? 'pass' : c.warnOnly ? 'warn' : 'fail'}"><b>${c.pass ? '✓' : c.warnOnly ? '!' : '✗'}</b> ${esc(c.label)}${!c.pass && c.hint ? ` <span>${esc(c.hint)}</span>` : ''}</li>`).join('');
      if (markup !== lastList) { list.innerHTML = markup; lastList = markup; }
      okSince = ok ? (okSince ?? now) : null;
      const p = okSince === null ? 0 : (now - okSince) / (FACE_CHECK.holdSec * 1000);
      ring.style.setProperty('--p', Math.min(1, p).toFixed(3));
      count.textContent = okSince === null ? '–' : (Math.max(0, FACE_CHECK.holdSec * (1 - p))).toFixed(1);
      if (p >= 1) proceed();
    },
    onEscape: proceed,
    unmount() { view.destroy(); },
  };
}
