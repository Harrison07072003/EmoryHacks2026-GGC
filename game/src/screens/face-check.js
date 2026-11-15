// Face check, shown before every calibration (ported from the prototype's face check in
// app/core/shell.js). The player sees themselves in a mirrored camera view with an oval
// guide and adjusts their head, distance and light until every check is green; after
// FACE_CHECK.holdSec of all-green it continues by itself, so no hands are needed.
//
// params: next / nextParams - where to go afterwards (normally the calibration screen)
import { FACE_CHECK } from '../config/game-config.js';
import { faceChecks, facePositionOk } from '../input/face-check.js';
import { esc, gazeButton, html } from './ui.js';

export default function faceCheck(root, app, { next = 'calibration', nextParams = {} }) {
  const { gaze } = app;
  const proceed = () => app.go(next, nextParams);
  const video = document.getElementById('camera');
  const live = gaze.hasCamera && video?.srcObject;

  const el = html(`
    <section class="screen face-check">
      <h2>Face check</h2>
      <p class="hint">Sit how you will play. Line your face up with the oval and keep every line green.</p>
      <div class="fc-stage">
        ${live ? '' : '<div class="fc-sim">Simulated eyes: no camera image</div>'}
        <canvas class="fc-overlay"></canvas>
      </div>
      <ul class="fc-checks"></ul>
      <div class="fc-foot"><div class="auto-ring small"><span data-count>–</span></div><div class="row" data-buttons></div></div>
    </section>`);
  root.appendChild(el);
  const stage = el.querySelector('.fc-stage'), canvas = el.querySelector('.fc-overlay'), g = canvas.getContext('2d');
  const list = el.querySelector('.fc-checks'), ring = el.querySelector('.auto-ring'), count = el.querySelector('[data-count]');
  el.querySelector('[data-buttons]').append(gazeButton('Skip check', proceed, { cls: 'purple small' }));
  if (live) document.body.classList.add('cam-show');

  let okSince = null, lastList = '';

  function placeVideo() {
    if (!live) return;
    if (video.videoWidth) stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    const r = stage.getBoundingClientRect();
    Object.assign(video.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  function drawOverlay(frame, ok) {
    const W = (canvas.width = canvas.clientWidth || 1), H = (canvas.height = canvas.clientHeight || 1);
    g.clearRect(0, 0, W, H);
    // oval guide where the face should be
    g.lineWidth = 4; g.setLineDash([12, 10]);
    g.strokeStyle = ok ? 'rgba(57,255,176,0.95)' : 'rgba(255,255,255,0.7)';
    g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.16, H * 0.36, 0, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    // detected face, mirrored like the video
    const b = frame?.face && frame.box;
    if (b) {
      g.strokeStyle = ok ? '#39ffb0' : '#4de1ff'; g.lineWidth = 3;
      g.strokeRect((1 - b.x - b.w) * W, b.y * H, b.w * W, b.h * H);
    }
  }

  return {
    frame(now) {
      placeVideo();
      const checks = faceChecks(gaze.frame), ok = facePositionOk(checks);
      drawOverlay(gaze.frame, ok);
      const markup = checks.map(c => `<li class="${c.pass ? 'pass' : c.warnOnly ? 'warn' : 'fail'}"><b>${c.pass ? '✓' : c.warnOnly ? '!' : '✗'}</b> ${esc(c.label)}${!c.pass && c.hint ? ` <span>${esc(c.hint)}</span>` : ''}</li>`).join('');
      if (markup !== lastList) { list.innerHTML = markup; lastList = markup; }
      okSince = ok ? (okSince ?? now) : null;
      const p = okSince === null ? 0 : (now - okSince) / (FACE_CHECK.holdSec * 1000);
      ring.style.setProperty('--p', Math.min(1, p).toFixed(3));
      count.textContent = okSince === null ? '–' : (Math.max(0, FACE_CHECK.holdSec * (1 - p))).toFixed(1);
      if (p >= 1) proceed();
    },
    onEscape: proceed,
    unmount() { document.body.classList.remove('cam-show'); if (video) video.removeAttribute('style'); },
  };
}
