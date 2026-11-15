// Face view: the player's mirrored camera image with everything the tracker sees drawn on
// top: oval guide, MediaPipe face mesh, face box, head direction, eye close-ups with our
// pupil (red) and MediaPipe's iris (cyan), tracking quality, and a mini lane map.
// Works on the mock too (no camera image or mesh: it draws a stylised face from the box).
//
//   const view = createFaceView(eyes, canvasElement, { checks: true });
//   ...  view.destroy();
import { positionChecks, positionOk } from '../signals/position.js';

const C = { ok: '#39ffb0', info: '#4de1ff', warn: '#ffd34d', bad: '#ff4d6d', dim: 'rgba(255,255,255,0.18)', text: '#e8ecff' };

/**
 * @param eyes     an eye-controller (live or mock)
 * @param canvas   the <canvas> to draw into. Its pixel size follows its CSS size every frame, so give
 *                 it a definite CSS size (e.g. position:absolute; inset:0 inside a sized box)
 * @param options  video   draw the camera image (default true; false if your page shows the <video> behind)
 *                 image   'raw' camera (default) or 'processed': what the tracker analyses, after
 *                         auto-exposure and the face-following crop (shows the auto-adjust working)
 *                 mesh    'full' (whole mesh), 'contours' (default), or false
 *                 eyes    eye close-ups (default true)    checks  checklist (default false)
 *                 lanes   mini lane map (default true)    auto    redraw every frame by itself (default true)
 */
export function createFaceView(eyes, canvas, options = {}) {
  const opt = { video: true, image: 'raw', mesh: 'contours', eyes: true, checks: false, lanes: true, auto: true, ...options };
  const g = canvas.getContext('2d');
  let raf = 0, dead = false;

  function draw(now = performance.now()) {
    const W = (canvas.width = Math.max(1, canvas.clientWidth * devicePixelRatio));
    const H = (canvas.height = Math.max(1, canvas.clientHeight * devicePixelRatio));
    const s = devicePixelRatio, data = eyes.faceData(), fr = data.frame;
    const checks = positionChecks(fr), ok = positionOk(checks);
    const processed = opt.image === 'processed' && data.processed && data.roi;
    const src = processed ? data.processed : data.video, roi = processed ? data.roi : { x: 0, y: 0, w: 1, h: 1 };
    const vw = (processed ? src.width : src?.videoWidth) || 16, vh = (processed ? src.height : src?.videoHeight) || 9;
    const fit = contain(W, H, vw / vh);
    // camera coordinates (0-1 of the full frame) -> canvas pixels, through the crop, mirrored like a selfie
    const P = (x, y) => [fit.x + (1 - (x - roi.x) / roi.w) * fit.w, fit.y + ((y - roi.y) / roi.h) * fit.h];

    g.clearRect(0, 0, W, H);
    g.fillStyle = '#07070d'; g.fillRect(fit.x, fit.y, fit.w, fit.h);
    if (opt.video && (processed || data.video?.videoWidth)) {
      g.save(); g.translate(fit.x + fit.w, fit.y); g.scale(-1, 1);
      g.globalAlpha = 0.85; g.drawImage(src, 0, 0, fit.w, fit.h); g.restore();
      if (processed) label(g, autoLabel(data), fit.x + 12 * s, fit.y + 22 * s, 11 * s, C.text);
    } else if (!data.video) label(g, 'SIMULATED EYES: no camera image', fit.x + 12 * s, fit.y + 22 * s, 12 * s, C.dim);

    // oval guide where the face should sit
    g.setLineDash([12 * s, 10 * s]); g.lineWidth = 3 * s; g.strokeStyle = ok ? C.ok : 'rgba(255,255,255,0.6)';
    g.beginPath(); g.ellipse(fit.x + fit.w / 2, fit.y + fit.h / 2, fit.w * 0.16, fit.h * 0.36, 0, 0, 7); g.stroke(); g.setLineDash([]);

    if (fr?.face) {
      if (data.landmarks && data.mesh && opt.mesh) drawMesh(g, data, P, s, opt.mesh);
      else stylisedFace(g, fr, P, s);
      drawBox(g, fr, P, s, ok, data.conditions, eyes.state.calibrationScore);
      if (data.landmarks) drawHeadDirection(g, fr, data.landmarks, P, s);
    } else label(g, 'NO FACE', fit.x + fit.w / 2, fit.y + fit.h / 2, 28 * s, C.bad, 'center');

    if (opt.eyes && data.eyeImages && fr?.face) drawEyeCloseUps(g, data, fr, fit, s);
    if (opt.lanes) drawLaneMap(g, eyes, fit, s);
    if (opt.checks) drawChecks(g, checks, fit, s);
  }

  function loop(now) { if (dead) return; draw(now); raf = requestAnimationFrame(loop); }
  if (opt.auto) raf = requestAnimationFrame(loop);
  return { draw, destroy() { dead = true; cancelAnimationFrame(raf); } };
}

/** Largest rectangle of aspect `ar` centred inside W x H. */
function contain(W, H, ar) {
  const w = Math.min(W, H * ar), h = w / ar;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function line(g, L, P, pairs) {
  g.beginPath();
  for (const [a, b] of pairs) { const [x1, y1] = P(L[a].x, L[a].y), [x2, y2] = P(L[b].x, L[b].y); g.moveTo(x1, y1); g.lineTo(x2, y2); }
  g.stroke();
}

// Restrained on purpose: thin lines, one accent colour, the lips barely there. The eyes and
// irises are what the tracker uses, so they stay the clearest.
function drawMesh(g, { landmarks: L, mesh }, P, s, mode) {
  if (mode === 'full') { g.strokeStyle = 'rgba(77,225,255,0.07)'; g.lineWidth = 0.75 * s; line(g, L, P, mesh.tesselation); }
  g.lineWidth = 1 * s;
  g.strokeStyle = 'rgba(77,225,255,0.4)'; line(g, L, P, mesh.oval);
  g.strokeStyle = 'rgba(232,236,255,0.22)'; line(g, L, P, mesh.brows);
  g.strokeStyle = 'rgba(232,236,255,0.1)'; line(g, L, P, mesh.lips);
  g.strokeStyle = 'rgba(232,236,255,0.65)'; line(g, L, P, mesh.eyes);
  g.strokeStyle = C.info; g.lineWidth = 1.5 * s; line(g, L, P, mesh.irises);
}

/** No landmarks (mock): an outline from the face box, eyes where they usually are. */
function stylisedFace(g, fr, P, s) {
  const b = fr.box, [x0, y0] = P(b.x + b.w, b.y), [x1, y1] = P(b.x, b.y + b.h), w = x1 - x0, h = y1 - y0;
  g.strokeStyle = 'rgba(77,225,255,0.4)'; g.lineWidth = 1 * s;
  g.beginPath(); g.ellipse(x0 + w / 2, y0 + h / 2, w * 0.42, h * 0.48, 0, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(232,236,255,0.65)';
  for (const ex of [0.32, 0.68]) { g.beginPath(); g.ellipse(x0 + w * ex, y0 + h * 0.42, w * 0.1, h * 0.04, 0, 0, 7); g.stroke(); }
}

const FACTOR_NAMES = { light: 'light', glare: 'glare', pupil: 'eye contrast', framing: 'framing', head: 'head moved' };

/**
 * HUD corners around the face. The label is the CONDITIONS score (light, glare, eye
 * contrast, framing, head position right now; the weakest one is named when it drags the
 * score down). Calibration accuracy is separate: it is shown on the lane map.
 */
function drawBox(g, fr, P, s, ok, conditions, calibrationScore) {
  const b = fr.box, [x0, y0] = P(b.x + b.w, b.y), [x1, y1] = P(b.x, b.y + b.h), k = Math.min(x1 - x0, y1 - y0) * 0.18;
  g.strokeStyle = ok ? C.ok : C.info; g.lineWidth = 2 * s;
  g.beginPath();
  for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    g.moveTo(x, y + dy * k); g.lineTo(x, y); g.lineTo(x + dx * k, y);
  }
  g.stroke();
  const pct = Math.round((conditions?.score ?? 0) * 100), col = pct >= 75 ? C.ok : pct >= 45 ? C.warn : C.bad;
  const worst = Object.entries(conditions?.factors ?? {}).sort((a, b) => a[1] - b[1])[0];
  const why = pct < 75 && worst && worst[1] < 0.9 ? ` · ${FACTOR_NAMES[worst[0]] ?? worst[0]}` : '';
  label(g, `CONDITIONS ${pct}%${why}`, x0, y0 - 8 * s, 12 * s, col);
  g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x0, y1 + 6 * s, x1 - x0, 4 * s);
  g.fillStyle = col; g.fillRect(x0, y1 + 6 * s, ((x1 - x0) * pct) / 100, 4 * s);
}

/** What the auto-adjust is doing right now, for the processed view. */
function autoLabel({ roi, tone }) {
  const zoom = roi ? `crop ${Math.round(roi.w * 100)}%` : '';
  const exp = tone ? `exposure: gamma ${tone.gamma.toFixed(2)} contrast ${tone.contrast.toFixed(2)}` : 'exposure: manual';
  return `PROCESSED (what the tracker sees) · ${exp} · ${zoom}`;
}

/** Arrow from the nose in the direction the head points. */
function drawHeadDirection(g, fr, L, P, s) {
  const [yaw, pitch] = fr.head, [nx, ny] = P(L[1].x, L[1].y), len = 180 * s;
  const tx = nx + Math.sin(yaw) * len * 0.5, ty = ny - Math.sin(pitch) * len * 0.5; // sign checked on the mirrored view
  g.strokeStyle = 'rgba(255,211,77,0.55)'; g.lineWidth = 1.5 * s;
  g.beginPath(); g.moveTo(nx, ny); g.lineTo(tx, ty); g.stroke();
  g.fillStyle = 'rgba(255,211,77,0.8)'; g.beginPath(); g.arc(tx, ty, 3 * s, 0, 7); g.fill();
}

/** Both eye crops, enlarged, with our pupil (red) and MediaPipe's iris (cyan). */
function drawEyeCloseUps(g, { eyeImages, eyeMarks }, fr, fit, s) {
  const img = eyeImages.L, w = Math.min(fit.w * 0.22, 220 * s), h = (w * img.height) / img.width, pad = 10 * s;
  // the view is mirrored: the player's right eye (R) appears on the left of the screen
  ['R', 'L'].forEach((k, i) => {
    const x = fit.x + pad + i * (w + pad), y = fit.y + fit.h - h - pad - 16 * s, m = eyeMarks?.[k];
    g.save(); g.imageSmoothingEnabled = false;
    g.translate(x + w, y); g.scale(-1, 1); g.drawImage(eyeImages[k], 0, 0, w, h); g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1 * s; g.strokeRect(x, y, w, h);
    if (m) {
      g.fillStyle = C.bad; g.beginPath(); g.arc(x + (1 - m.pupil.u) * w, y + m.pupil.v * h, 4 * s, 0, 7); g.fill();
      g.strokeStyle = C.info; g.lineWidth = 2 * s; g.beginPath(); g.arc(x + (1 - m.iris.u) * w, y + m.iris.v * h, 7 * s, 0, 7); g.stroke();
    }
    const e = fr.eyes[k];
    label(g, `${k === 'R' ? 'RIGHT' : 'LEFT'} · pupil ${(e.conf * 100).toFixed(0)} · glare ${(e.glare * 100).toFixed(1)}%`, x, y + h + 13 * s, 10 * s, C.text);
  });
}

/** 4x2 mini map: the cell the tracker reports right now, and the gaze dot. */
function drawLaneMap(g, eyes, fit, s) {
  const { lanes, bandSplit } = eyes.layout, st = eyes.state;
  const w = Math.min(fit.w * 0.2, 170 * s), h = w * 0.6, x = fit.x + fit.w - w - 10 * s, y = fit.y + 10 * s;
  g.fillStyle = 'rgba(7,7,13,0.7)'; g.fillRect(x, y, w, h);
  for (let i = 0; i < lanes; i++) for (const band of ['top', 'bottom']) {
    const cy = band === 'top' ? y : y + h * bandSplit, ch = band === 'top' ? h * bandSplit : h * (1 - bandSplit);
    const on = st.lane === i && st.band === band;
    g.fillStyle = on ? 'rgba(57,255,176,0.55)' : 'rgba(255,255,255,0.05)';
    g.fillRect(x + (i * w) / lanes + 1, cy + 1, w / lanes - 2, ch - 2);
  }
  if (st.calibrationScore !== null) {
    g.fillStyle = C.warn; g.beginPath(); g.arc(x + st.gaze.x * w, y + st.gaze.y * h, 4 * s, 0, 7); g.fill();
  }
  label(g, st.calibrationScore === null ? 'GAZE: not calibrated yet' : `GAZE · calibration ${st.calibrationScore}/100 · tracking ${st.quality}`, x, y + h + 13 * s, 10 * s, C.text);
}

function drawChecks(g, checks, fit, s) {
  const lines = checks.map(c => ({ c, t: `${c.pass ? '✓' : c.warnOnly ? '!' : '✗'} ${c.label}${c.pass ? '' : ` – ${c.hint}`}` }));
  g.font = `600 ${12 * s}px system-ui, sans-serif`;
  const w = Math.min(fit.w * 0.6, Math.max(...lines.map(l => g.measureText(l.t).width)) + 16 * s), lh = 20 * s;
  const x = fit.x + fit.w - w - 10 * s, y0 = fit.y + fit.h - lines.length * lh - 4 * s;
  g.fillStyle = 'rgba(7,7,13,0.75)'; g.fillRect(x, y0 - 16 * s, w, lines.length * lh + 10 * s);
  lines.forEach(({ c, t }, i) => label(g, t, x + 8 * s, y0 + i * lh, 12 * s, c.pass ? C.ok : c.warnOnly ? C.warn : C.bad));
}

function label(g, text, x, y, size, color, align = 'left') {
  g.font = `600 ${size}px system-ui, sans-serif`; g.textAlign = align; g.fillStyle = color;
  g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 4; g.fillText(text, x, y); g.shadowBlur = 0;
}
