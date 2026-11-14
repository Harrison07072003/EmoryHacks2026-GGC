// gaze-engine.js - RhythmEyez gaze engine v3. 100% on-device (browser). No API calls.
// Pipeline per camera frame:
//   MediaPipe face landmarks (+3D head pose, blendshapes)
//   -> per-eye crop aligned to the eye (handles head roll)
//   -> OUR pupil finder (darkest-blob centroid, 2 passes) + glare/contrast scores
//   -> features: iris + pupil (each eye) + head pose + nonlinear terms
//   -> 3 ridge models (both eyes / right only / left only), picks the cleaner eye per frame
//   -> bias (re-anchor) -> median-3 -> fixation lock or One Euro smoothing
export const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
export const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export class OneEuro {
  constructor(minCut = 1, beta = 0.004, dCut = 1) { Object.assign(this, { minCut, beta, dCut, x: null, dx: 0, t: 0 }); }
  alpha(cut, dt) { const r = 2 * Math.PI * cut * dt; return r / (r + 1); }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max((t - this.t) / 1000, 1e-3); this.t = t;
    const aD = this.alpha(this.dCut, dt);
    this.dx = aD * ((x - this.x) / dt) + (1 - aD) * this.dx;
    const a = this.alpha(this.minCut + this.beta * Math.abs(this.dx), dt);
    return this.x = a * x + (1 - a) * this.x;
  }
}

// ---------- ridge regression ----------
function gauss(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) { const m = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= m * A[i][c]; b[r] -= m * b[i]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
// headPen: extra regularization on head-pose features (8-12). Higher = trust the eyes more and
// head turns move the pointer less. Too high = head movement causes drift instead.
function fitRidge(S, idx, headPen = 6) {
  const pen = idx.map(fi => (fi >= 8 && fi <= 12 ? headPen : 1));
  const d = idx.length, n = S.length, mu = Array(d).fill(0), sd = Array(d).fill(0);
  S.forEach(s => idx.forEach((fi, k) => mu[k] += s.f[fi] / n));
  S.forEach(s => idx.forEach((fi, k) => sd[k] += (s.f[fi] - mu[k]) ** 2 / n));
  for (let k = 0; k < d; k++) sd[k] = Math.max(Math.sqrt(sd[k]), 0.005);   // floor: no blow-ups on unseen motion
  const Z = S.map(s => [1, ...idx.map((fi, k) => (s.f[fi] - mu[k]) / sd[k])]), D = d + 1, lam = 0.02 * n;
  const solve = key => {
    const A = [...Array(D)].map(() => Array(D).fill(0)), b = Array(D).fill(0);
    Z.forEach((z, j) => { for (let i = 0; i < D; i++) { b[i] += z[i] * S[j][key]; for (let k = 0; k < D; k++) A[i][k] += z[i] * z[k]; } });
    for (let i = 1; i < D; i++) A[i][i] += lam * pen[i - 1];
    return gauss(A, b);
  };
  return { idx, mu, sd, wx: solve('x'), wy: solve('y') };
}
function predictM(m, f) {
  const z = [1, ...m.idx.map((fi, k) => (f[fi] - m.mu[k]) / m.sd[k])];
  let x = 0, y = 0; for (let i = 0; i < z.length; i++) { x += z[i] * m.wx[i]; y += z[i] * m.wy[i]; }
  return { x, y };
}
// feature layout: 0-3 right eye [iris u,v, pupil u,v] | 4-7 left eye | 8-12 head [yaw,pitch,tx,ty,tz] | 13-15 nonlinear
// 16-18 right-eye curvature [u2, v2, uv] | 19-21 left-eye curvature
const IDX = { both: [...Array(22).keys()], R: [0, 1, 2, 3, 8, 9, 10, 11, 12, 16, 17, 18], L: [4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 21] };
const fitAll = (S, hp) => ({ both: fitRidge(S, IDX.both, hp), R: fitRidge(S, IDX.R, hp), L: fitRidge(S, IDX.L, hp) });
export const meanErr = (S, ms) => S.reduce((a, s) => { const p = predictM(ms.both, s.f); return a + Math.hypot(p.x - s.x, p.y - s.y); }, 0) / S.length;
const clampX = v => Math.max(4, Math.min(innerWidth - 4, v)), clampY = v => Math.max(4, Math.min(innerHeight - 4, v));
const med3 = a => a.length < 3 ? a[a.length - 1] : [...a].sort((p, q) => p - q)[1];

// ---------- our pupil finder ----------
export const EW = 64, EH = 32;      // eye crop size (px)
const SPAN = 1.4;                   // crop width = 1.4 x eye-corner distance
function findPupil(img) {
  const { data: d, width: w, height: h } = img, lum = new Float32Array(w * h), inMask = new Uint8Array(w * h), vals = [];
  let bright = 0, sum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w * 0.4), dy = (y + 0.5 - h / 2) / (h * 0.3);
    if (dx * dx + dy * dy > 1) continue;                     // elliptical mask = the eye opening, skips brow/cheek
    const i = y * w + x, L = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    lum[i] = L; inMask[i] = 1; vals.push(L); sum += L; if (L > 235) bright++;
  }
  if (vals.length < 20) return { u: 0.5, v: 0.5, conf: 0, glare: 0, mean: 0 };
  vals.sort((a, b) => a - b);
  const mean = sum / vals.length;
  const centroid = (thr, cx0, cy0, r) => {
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inMask[i] || lum[i] > thr || (r && (x - cx0) ** 2 + (y - cy0) ** 2 > r * r)) continue;
      const wt = thr - lum[i] + 1; sx += wt * (x + 0.5); sy += wt * (y + 0.5); sw += wt;   // darker = heavier
    }
    return sw ? [sx / sw, sy / sw] : [cx0, cy0];
  };
  const t1 = vals[Math.floor(vals.length * 0.12)], [x1, y1] = centroid(t1, w / 2, h / 2, 0);        // pass 1: darkest 12%
  const t2 = vals[Math.floor(vals.length * 0.06)], [x2, y2] = centroid(t2, x1, y1, h * 0.4);        // pass 2: darkest 6% near it
  return { u: x2 / w, v: y2 / h, conf: Math.max(0, Math.min(1, (mean - t2) / (mean + 1))), glare: bright / vals.length, mean };
}

export class GazeEngine {
  constructor(video, opts = {}) {
    this.video = video;
    this.o = { mpBase: MP_BASE, model: FACE_MODEL, smooth: 1, fixFrac: 0.05, headGain: 1, headPen: 6, ...opts };
    const mk = () => { const c = document.createElement('canvas'); c.width = EW; c.height = EH; return c; };
    this.crop = mk(); this.cctx = this.crop.getContext('2d', { willReadFrequently: true });
    this.eyeCanvas = { R: mk(), L: mk() };
    this.models = null; this.cal = []; this.corr = []; this.dropped = 0; this.hits = []; this.sinceRefit = 0; this.refits = 0; this.rejected = 0;
    this.pk = { R: 0.5, L: 0.5 }; this.mix = 0; this.fixed = false;
    this.bias = { x: 0, y: 0 }; this.head0 = null; this.collect = null; this.anchor = null; this.lastVT = -1; this.lostAt = 0; this.f = null;
    this.resetFilters();
    this.out = { face: false, x: innerWidth / 2, y: innerHeight / 2, headX: innerWidth / 2, headY: innerHeight / 2, breath: 0, blink: false };
  }
  async start() {
    if (this.lm) return;
    const { FaceLandmarker, FilesetResolver } = await import(this.o.mpBase + '/vision_bundle.mjs');
    const fs = await FilesetResolver.forVisionTasks(this.o.mpBase + '/wasm');
    const opts = d => ({ baseOptions: { modelAssetPath: this.o.model, delegate: d }, runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
    try { this.lm = await FaceLandmarker.createFromOptions(fs, opts('GPU')); } catch { this.lm = await FaceLandmarker.createFromOptions(fs, opts('CPU')); }
    this.video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 }, facingMode: 'user' } });
    await this.video.play();
  }
  resetFilters() {
    const c = 1.5 / this.o.smooth;
    this.fx = new OneEuro(c); this.fy = new OneEuro(c); this.hfx = new OneEuro(1); this.hfy = new OneEuro(1);
    this.hist = []; this.win = [];
  }
  // one eye: geometry from landmarks + our pupil finder on an eye-aligned crop
  eye(L, ia, ib, iris, up, lo, key) {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    let A = L[ia], B = L[ib]; if (A.x > B.x) [A, B] = [B, A];             // always image-left -> image-right
    const ax = A.x * vw, ay = A.y * vh, bx = B.x * vw, by = B.y * vh, ex = bx - ax, ey = by - ay;
    const len = Math.hypot(ex, ey), ang = Math.atan2(ey, ex), cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const ix = L[iris].x * vw, iy = L[iris].y * vh;
    const u = ((ix - ax) * ex + (iy - ay) * ey) / (len * len);
    const v = (iy - (L[up].y + L[lo].y) / 2 * vh) / len;
    const open = Math.abs(L[up].y - L[lo].y) * vh / len;
    const s = EW / (len * SPAN), g = this.cctx;
    g.setTransform(1, 0, 0, 1, 0, 0); g.translate(EW / 2, EH / 2); g.scale(s, s); g.rotate(-ang); g.translate(-cx, -cy);
    g.drawImage(this.video, 0, 0, vw, vh);
    const P = findPupil(g.getImageData(0, 0, EW, EH));
    this.eyeCanvas[key].getContext('2d').drawImage(this.crop, 0, 0);
    const c = Math.cos(ang), sn = Math.sin(ang), dx = ix - cx, dy = iy - cy;
    const dbg = { px: P.u * EW, py: P.v * EH, ix: EW / 2 + (dx * c + dy * sn) * s, iy: EH / 2 + (-dx * sn + dy * c) * s };
    // blend pupil and iris by contrast confidence (a hard switch made features jump -> sudden jitter)
    const k = this.pk[key] = this.pk[key] * 0.8 + 0.2 * Math.max(0, Math.min(1, (P.conf - 0.15) / 0.25));
    return { u, v, pu: k * (0.5 + (P.u - 0.5) * SPAN) + (1 - k) * u, pv: k * ((P.v - 0.5) * EH * SPAN / EW) + (1 - k) * v,
             open, glare: P.glare, conf: P.conf, lum: P.mean, dbg };
  }
  // call every animation frame; returns true when a new camera frame was processed
  update(now) {
    const vid = this.video, O = this.out;
    if (!this.lm || vid.readyState < 2 || vid.currentTime === this.lastVT) return false;
    this.lastVT = vid.currentTime;
    const t0 = performance.now(), r = this.lm.detectForVideo(vid, t0);
    O.ms = performance.now() - t0;
    O.face = r.faceLandmarks.length > 0;
    if (!O.face) { if (!this.lostAt) this.lostAt = now; O.lostFor = now - this.lostAt; return true; }
    O.cameBack = !!this.lostAt && now - this.lostAt > 1500; this.lostAt = 0; O.lostFor = 0;
    const L = r.faceLandmarks[0], M = r.facialTransformationMatrixes?.[0];
    const eR = this.eye(L, 33, 133, 468, 159, 145, 'R'), eL = this.eye(L, 362, 263, 473, 386, 374, 'L');
    const n = L[1], lc = L[234], rc = L[454], tp = L[10], bt = L[152];
    const fw = Math.hypot(rc.x - lc.x, rc.y - lc.y), fh = Math.hypot(bt.x - tp.x, bt.y - tp.y);
    const hx = (n.x - (lc.x + rc.x) / 2) / fw, hy = (n.y - (tp.y + bt.y) / 2) / fh;
    let head = [hx, hy, (lc.x + rc.x) / 2, (tp.y + bt.y) / 2, fw];
    if (M) { const m = M.data; head = [Math.atan2(m[8], m[10]), Math.atan2(m[9], Math.hypot(m[8], m[10])), m[12], m[13], m[14]]; }
    const h = (eR.u + eL.u) / 2 - 0.5, vv = (eR.v + eL.v) / 2;
    const q2 = e => { const a = e.pu - 0.5, b = e.pv; return [a * a, b * b, a * b]; };
    const f = [eR.u, eR.v, eR.pu, eR.pv, eL.u, eL.v, eL.pu, eL.pv, ...head, h * h, vv * vv, h * vv, ...q2(eR), ...q2(eL)];
    this.f = f;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0; for (const p of L) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    O.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const ebox = (a, b) => { const l = Math.min(L[a].x, L[b].x), r = Math.max(L[a].x, L[b].x), w = r - l, cy = (L[a].y + L[b].y) / 2;
      return { x: l - w * 0.2, y: cy - w * 0.45, w: w * 1.4, h: w * 0.9 }; };
    O.eyeBox = { R: ebox(33, 133), L: ebox(362, 263) };
    const bs = {}; (r.faceBlendshapes?.[0]?.categories || []).forEach(c => bs[c.categoryName] = c.score);
    O.eyes = { R: eR, L: eL }; O.open = (eR.open + eL.open) / 2; O.lum = (eR.lum + eL.lum) / 2;
    O.blink = ((bs.eyeBlinkLeft || 0) + (bs.eyeBlinkRight || 0)) / 2 > 0.45 || O.open < 0.12;
    O.breath = Math.max(bs.jawOpen || 0, bs.cheekPuff || 0, (bs.mouthPucker || 0) * 0.8, bs.mouthFunnel || 0);   // "blow" for horn
    // head pointer (no calibration needed)
    if (!this.head0) this.head0 = { hx, hy };
    this.hx = hx; this.hy = hy;
    O.headX = this.hfx.filter(clampX(innerWidth / 2 - (hx - this.head0.hx) * innerWidth * 3 * this.o.headGain), now);
    O.headY = this.hfy.filter(clampY(innerHeight / 2 + (hy - this.head0.hy) * innerHeight * 4 * this.o.headGain), now);
    if (this.collect && !O.blink) this.collect.push({ f: f.slice(), ...this.collectTarget() });
    if (O.blink || !this.models) return true;                           // freeze gaze during blinks
    // pick the cleaner eye (glasses glare / squint usually hits one lens)
    const q = e => e.open * (1 - Math.min(1, e.glare * 10)) * (0.5 + e.conf);
    const qR = q(eR), qL = q(eL), target = Math.max(-1, Math.min(1, (qR / (qR + qL + 1e-6) - 0.5) * 4));
    this.mix = this.mix * 0.9 + target * 0.1;                          // -1 = left eye only, 0 = both, +1 = right only
    const pb = predictM(this.models.both, f), ps = predictM(this.models[this.mix > 0 ? 'R' : 'L'], f), a = Math.abs(this.mix);
    const p = { x: pb.x + (ps.x - pb.x) * a, y: pb.y + (ps.y - pb.y) * a };
    const which = a < 0.3 ? 'both' : (this.mix > 0 ? 'R' : 'L') + ` ${Math.round(a * 100)}%`;
    if (this.anchor) this.anchor.push(p);
    if (this.biasDecay) { this.bias.x *= 0.995; this.bias.y *= 0.995; if (Math.abs(this.bias.x) + Math.abs(this.bias.y) < 2) this.biasDecay = false; }
    const cm = this.correct(p.x + this.bias.x, p.y + this.bias.y);
    this.hist.push(cm); if (this.hist.length > 3) this.hist.shift();
    const rx = med3(this.hist.map(a => a.x)), ry = med3(this.hist.map(a => a.y));
    const sx = this.fx.filter(rx, now), sy = this.fy.filter(ry, now);
    // fixation lock: if the last 160 ms stay inside a small box, output their mean (rock steady)
    this.win.push({ t: now, x: rx, y: ry }); while (now - this.win[0].t > 160) this.win.shift();
    const xs = this.win.map(a => a.x), ys = this.win.map(a => a.y);
    const disp = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
    this.fixed = this.win.length >= 3 && disp < (this.fixed ? 1.6 : 1) * this.o.fixFrac * innerWidth;
    O.fixation = this.fixed;
    if (O.fixation) { O.x = xs.reduce((a, b) => a + b) / xs.length; O.y = ys.reduce((a, b) => a + b) / ys.length; }
    else { O.x = sx; O.y = sy; }
    O.x = clampX(O.x); O.y = clampY(O.y);                               // never let the dot leave the screen
    if (!Number.isFinite(O.x) || !Number.isFinite(O.y)) { O.x = innerWidth / 2; O.y = innerHeight / 2; this.resetFilters(); }
    O.rawX = rx; O.rawY = ry; O.model = which;
    return true;
  }
  // ---- calibration API ----
  startCollect(targetFn) { this.collect = []; this.collectTarget = targetFn; }
  stopCollect() { const s = this.collect || []; this.collect = null; return s; }
  train(samples) {
    let m = fitAll(samples, this.o.headPen);
    // robust pass: samples where you blinked/glanced away fit badly -> drop worst and refit
    const res = samples.map(s => { const p = predictM(m.both, s.f); return Math.hypot(p.x - s.x, p.y - s.y); });
    const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)];
    const keep = samples.filter((s, i) => res[i] < Math.max(2.5 * med, 40));
    if (keep.length > samples.length * 0.6) { samples = keep; m = fitAll(samples, this.o.headPen); }
    this.dropped = res.length - samples.length;
    this.cal = samples; this.hits = []; this.refits = 0; this.rejected = 0; this.corr = [];
    this.models = m; this.bias = { x: 0, y: 0 }; this.resetFilters();
    return meanErr(samples, this.models);
  }
  // correction map: measured offsets at known points (from validation), blended by inverse distance
  setCorrection(pts) { this.corr = pts.filter(p => Math.hypot(p.dx, p.dy) < innerWidth * 0.2); }
  correct(x, y) {
    const C = this.corr; if (!C || !C.length) return { x, y };
    let sx = 0, sy = 0, sw = 0;
    for (const p of C) { const w = 1 / ((x - p.x) ** 2 + (y - p.y) ** 2 + (innerWidth * 0.1) ** 2); sx += w * p.dx; sy += w * p.dy; sw += w; }
    return { x: x + sx / sw, y: y + sy / sw };
  }
  anchorStart() { this.anchor = []; }
  anchorEnd(x, y) {                                                    // look at (x,y) ~1 s -> fix offset
    const a = this.anchor; this.anchor = null;
    if (!a || a.length < 5) return false;
    this.bias = { x: x - a.reduce((s, p) => s + p.x, 0) / a.length, y: y - a.reduce((s, p) => s + p.y, 0) / a.length };
    this.biasDecay = false; this.resetFilters(); return true;
  }
  // learn while playing: (features now, where the target is). Refit only if it doesn't hurt calibration.
  addHit(x, y) {
    if (!this.models || !this.f) return;
    this.hits.push({ f: this.f.slice(), x, y }); if (this.hits.length > 80) this.hits.shift();
    if (++this.sinceRefit < 6) return;
    this.sinceRefit = 0;
    const cand = fitAll([...this.cal, ...this.hits], this.o.headPen);
    if (meanErr(this.cal, cand) <= meanErr(this.cal, this.models) * 1.1) {
      const o = predictM(this.models.both, this.f), n = predictM(cand.both, this.f);
      this.bias = { x: this.bias.x + o.x - n.x, y: this.bias.y + o.y - n.y };   // continuous: no jump at the swap
      this.models = cand; this.refits++; this.biasDecay = true;
    }
    else this.rejected++;
  }
  setHeadPenalty(v) { this.o.headPen = v; if (this.cal.length) { const b = this.bias, c = this.corr; this.train(this.cal); this.bias = b; this.corr = c; } }
  recenterHead() { if (this.hx !== undefined) this.head0 = { hx: this.hx, hy: this.hy }; this.hfx = new OneEuro(1); this.hfy = new OneEuro(1); }
  save(name, extra = {}) { try { localStorage.setItem('eyez.' + name, JSON.stringify({ cal: this.cal, corr: this.corr, w: innerWidth, h: innerHeight, ...extra })); } catch {} }
  load(name) {
    try {
      const d = JSON.parse(localStorage.getItem('eyez.' + name));
      if (d?.cal?.length && d.cal[0].f.length === 22) { this.train(d.cal); this.corr = d.corr || []; this.profile = d; return true; }
    } catch {}
    return false;
  }
}
