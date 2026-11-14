// shell.js - shared by every page: startup, face check, calibration, dwell UI, camera preview, debug.
// A page = boot({ title, game }). No game = the hub menu (index.html).
import { GazeEngine, EW, EH } from './gaze-engine.js?v=6';
export const VERSION = 'build 6';
const PROFILE = 'v6';                                          // bump to invalidate old calibrations
const GAMES = [['Eye Piano', 'piano.html'], ['Echo', 'echo.html'], ['Drum Duel', 'drums.html'], ['Horn', 'horn.html']];

export function boot({ title = 'Hub', game = null } = {}) {
  window.__eyezBooted = true;
  const cv = Object.assign(document.createElement('canvas'), {}); document.body.appendChild(cv);
  Object.assign(cv.style, { position: 'fixed', inset: '0' });
  const g = cv.getContext('2d');
  let W, H; const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; }; resize(); addEventListener('resize', resize);
  const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
  video.setAttribute('playsinline', '');
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
  document.body.appendChild(video);                           // must be in the page or Chrome may not deliver frames

  // settings shared across pages
  const S0 = JSON.parse(localStorage.getItem('eyez.settings') || '{}');
  const set = { pointer: 'eye', blowMode: 'mouth', hornSide: false, smooth: 1.4, headPen: 6, headGain: 1, preview: true, ...S0 };
  const saveSet = () => localStorage.setItem('eyez.settings', JSON.stringify(set));
  const E = new GazeEngine(video, { smooth: set.smooth, fixFrac: 0.06, headPen: set.headPen, headGain: set.headGain });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hz = semi => 261.63 * 2 ** (semi / 12), SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
  let scene = 'start', ac = null, note = '', mouse = { x: 0, y: 0 }, dot = null, valPts = [];
  const pointerMode = () => (set.pointer === 'eye' && !E.models ? 'head' : set.pointer);
  const P = () => pointerMode() === 'eye' ? { x: E.out.x, y: E.out.y } : pointerMode() === 'head' ? { x: E.out.headX, y: E.out.headY } : mouse;

  // ---------- sound ----------
  function tone(freq, t, dur = 0.5, vol = 0.15) {
    if (!ac) return; t = t ?? ac.currentTime;
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(vol, t + 0.005); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + dur);
  }
  let noise = null;
  function perc(t, kind) {                                    // kick | hat | tom | snare | buzz
    if (!ac) return;
    const gn = ac.createGain(); gn.connect(ac.destination);
    const env = (v, d) => { gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(0.001, t + d); };
    if (kind === 'snare' || kind === 'hat') {
      if (!noise) { noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const n = ac.createBufferSource(), f = ac.createBiquadFilter(); n.buffer = noise;
      f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
      n.connect(f).connect(gn); kind === 'hat' ? env(0.08, 0.05) : env(0.5, 0.18); n.start(t); n.stop(t + 0.25);
      if (kind === 'hat') return;
    }
    const o = ac.createOscillator(); o.connect(gn);
    if (kind === 'kick') { o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); env(0.35, 0.18); }
    else if (kind === 'tom') { o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.2); env(0.5, 0.25); }
    else if (kind === 'snare') o.frequency.setValueAtTime(220, t);
    else { o.type = 'sawtooth'; o.frequency.value = 90; env(0.25, 0.4); }
    o.start(t); o.stop(t + 0.45);
  }

  // ---------- dwell buttons with magnetic snapping ----------
  const DWELL = 0.9;
  let buttons = [];
  const btn = (label, x, y, w, h, fn) => ({ label, x, y, w, h, fn, t: 0 });
  function uiUpdate(dt) {
    const p = P(); let best = null, bd = 1e9;
    for (const b of buttons) { const d = Math.hypot(p.x - (b.x + b.w / 2), p.y - (b.y + b.h / 2)); if (d < bd) { bd = d; best = b; } }
    const hot = best && bd < Math.max(best.w, best.h) * 0.9 ? best : null;
    for (const b of buttons) {
      if (b === hot) { b.t += dt; if (b.t >= DWELL) { b.t = 0; tone(880, undefined, 0.15); b.fn(); return; } }
      else b.t = Math.max(0, b.t - dt * 2);
    }
  }
  function drawButtons() {
    for (const b of buttons) {
      g.fillStyle = b.t > 0 ? '#1f3550' : '#1a1a2a'; g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 18); g.fill();
      g.strokeStyle = '#4de1ff'; g.lineWidth = 3; g.stroke();
      if (b.t > 0) { g.strokeStyle = '#ffd34d'; g.lineWidth = 8; g.beginPath(); g.arc(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.42, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * b.t / DWELL); g.stroke(); }
      text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 10, 24, '#fff');
    }
  }
  function text(s, x, y, size = 24, col = '#eee', align = 'center') { g.font = `bold ${size}px system-ui`; g.fillStyle = col; g.textAlign = align; g.fillText(s, x, y); }
  function row(labels, y, bh = 170) {
    const n = labels.length, bw = Math.min(320, W / n - 36);
    return labels.map(([l, fn], i) => btn(l, W / 2 + (i - (n - 1) / 2) * (bw + 36) - bw / 2, y, bw, bh, fn));
  }
  const grid = labels => { buttons = row(labels, H * 0.45, 180); };
  const go = url => { location.href = url; };

  // ---------- startup ----------
  async function begin() {
    if (scene !== 'start') return;
    if (!ac) ac = new AudioContext();
    ac.resume();
    if (!window.isSecureContext || !navigator.mediaDevices) { note = 'Camera blocked: open the http://localhost link, not the Network/IP one'; return; }
    scene = 'loading';
    try { await E.start(); }
    catch (e) {
      note = e.name === 'NotAllowedError' ? 'Camera permission denied - allow it in the address bar, reload'
           : e.name === 'NotReadableError' ? 'Camera busy - close FaceTime/Zoom/other tabs, reload'
           : e.name === 'NotFoundError' ? 'No camera found' : 'Error: ' + e.message;
      scene = 'start'; console.error(e); return;
    }
    scene = 'position';
  }
  async function afterPosition() {
    if (E.load(PROFILE)) { valPts = E.profile.val || []; note = 'Look at the dot'; await reanchor(); note = ''; enter(); }
    else calibrate();
  }
  let running = false;
  function enter() { if (!game) toMenu(); else if (running) restart(); else startGame(); }
  let posOkFor = 0;
  function positionChecks() {
    const o = E.out, b = o.box || { x: 0, y: 0, w: 0, h: 0 }, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return [
      ['Face found', o.face],
      ['Centered in the oval', o.face && Math.abs(cx - 0.5) < 0.15 && Math.abs(cy - 0.5) < 0.2],
      ['Distance', o.face && b.w > 0.2 && b.w < 0.5, b.w <= 0.2 ? 'move closer' : 'move back'],
      ['Lighting', o.face && o.lum > 60, 'add light in front of you'],
      ['Glasses glare', o.face && Math.max(o.eyes.R.glare, o.eyes.L.glare) < 0.03, 'tilt glasses / move light', true],
    ];
  }
  async function calibrate() {
    scene = 'calib'; buttons = []; const was = set.pointer; set.pointer = 'head';
    const pts = [[.08,.12],[.5,.12],[.92,.12],[.08,.5],[.5,.5],[.92,.5],[.08,.88],[.5,.88],[.92,.88],[.3,.3],[.7,.3],[.3,.7],[.7,.7]];
    note = 'Look at each dot as it plays. Keep your head still.';
    const S = [];
    for (let i = 0; i < pts.length; i++) {
      dot = { x: pts[i][0] * W, y: pts[i][1] * H, t0: performance.now() }; tone(hz(SCALE[i % 8]), undefined, 0.8);
      await sleep(650); E.startCollect(() => ({ x: dot.x, y: dot.y })); await sleep(850); S.push(...E.stopCollect());
    }
    note = 'Follow the dot with your eyes. SMALL head movements only.';
    dot = { moving: true, t0: performance.now(), hist: [] };
    // eyes trail a moving target by ~100 ms -> label each sample with where the dot was 100 ms ago
    const lagged = () => { const t = performance.now() - 100, h = dot.hist; let p = h[h.length - 1]; for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) { p = h[i]; break; } return { x: p.x, y: p.y }; };
    await sleep(1000); E.startCollect(lagged); await sleep(10000); S.push(...E.stopCollect()); dot = null;
    if (S.length < 120) { note = `Only ${S.length} samples - check lighting`; set.pointer = was; scene = 'position'; return; }
    E.train(S); set.pointer = 'eye';
    // validation on 9 NEW points -> error report + correction map for leftover systematic error
    note = 'Accuracy check: look at each dot.';
    valPts = [];
    for (const [x, y] of [[.2,.2],[.5,.25],[.8,.2],[.25,.5],[.75,.5],[.2,.8],[.5,.75],[.8,.8],[.5,.5]]) {
      dot = { x: x * W, y: y * H, t0: performance.now() }; await sleep(750);
      const m = []; const t1 = performance.now();
      while (performance.now() - t1 < 650) { if (!E.out.blink && E.out.face) m.push([E.out.x, E.out.y]); await sleep(25); }
      if (m.length > 5) { m.sort((a, b) => a[0] - b[0]); const mx = m[m.length >> 1][0]; m.sort((a, b) => a[1] - b[1]); const my = m[m.length >> 1][1];
        valPts.push({ x: dot.x, y: dot.y, mx, my, dx: dot.x - mx, dy: dot.y - my }); }
    }
    dot = null;
    const pct = valPts.reduce((a, p) => a + Math.hypot(p.dx, p.dy), 0) / Math.max(1, valPts.length) / W * 100;
    E.setCorrection(valPts.map(p => ({ x: p.mx, y: p.my, dx: p.dx, dy: p.dy })));
    E.save(PROFILE, { val: valPts });
    if (pct < 12) { note = `Calibrated. Error ~${pct.toFixed(1)}% of width (correction map applied)`; enter(); }
    else {
      note = `Error ~${pct.toFixed(1)}% of width - not great.`; scene = 'valfail'; set.pointer = 'head';
      grid([['Redo', calibrate], ['Use head', () => { set.pointer = 'head'; saveSet(); enter(); }], ['Keep eyes', () => { set.pointer = 'eye'; saveSet(); enter(); }]]);
    }
    saveSet();
  }
  async function reanchor(x = W / 2, y = H / 2) {
    if (!E.models) return;
    const prev = scene; scene = 'anchor'; dot = { x, y, t0: performance.now() };
    await sleep(500); E.anchorStart(); await sleep(800); E.anchorEnd(x, y); dot = null; scene = prev === 'anchor' ? 'menu' : prev;
  }

  // ---------- hub menu (index.html) ----------
  function toMenu() {
    if (game) return go('index.html');
    scene = 'menu';
    const cyc = () => { set.pointer = set.pointer === 'eye' ? 'head' : set.pointer === 'head' ? 'mouse' : 'eye'; E.recenterHead(); saveSet(); toMenu(); };
    buttons = [
      ...row(GAMES.map(([l, url]) => [l, () => go(url)]), H * 0.3, 190),
      ...row([['Eye debug', () => { scene = 'debug'; buttons = [btn('Back', 30, 30, 200, 110, toMenu)]; }], ['Recalibrate', calibrate],
              [`Pointer: ${pointerMode()}`, cyc], [`Blow: ${set.blowMode}`, () => { set.blowMode = set.blowMode === 'mouth' ? 'auto' : 'mouth'; saveSet(); toMenu(); }],
              [`Horn: ${set.hornSide ? 'side' : 'up'}`, () => { set.hornSide = !set.hornSide; saveSet(); toMenu(); }],
              ['Forget me', () => { localStorage.removeItem('eyez.' + PROFILE); E.models = null; note = 'Profile deleted'; scene = 'position'; }]], H * 0.68, 130)];
  }

  // ---------- game page ----------
  function lane(x, size, n, cur) {
    const cell = size / n, i = clamp(Math.floor(x / cell), 0, n - 1), m = cell * 0.12;
    return cur < 0 || cur >= n || i === cur || !(x > cur * cell - m && x < (cur + 1) * cell + m) ? i : cur;
  }
  // fresh ctx per run: old runs get live=false so their leftover timers can't touch the new run
  let ctx = null;
  const makeCtx = () => ({
    get g() { return g; }, get W() { return W; }, get H() { return H; }, actx: ac, live: true,
    get pointer() { return pointerMode(); }, get blowMode() { return set.blowMode; }, get hornSide() { return set.hornSide; },
    E, P, text, clamp, hz, lane, out: () => ac.destination,
    sleep: ms => sleep(ms).then(() => { if (!ctx?.live) throw new Error('game ended'); }),
    perc: (t, k) => perc(t, k), note: (f, t, d, v) => tone(f, t, d, v),
    setNote: s => { note = s; },
    finish: msg => { note = msg; game.finished = true; grid([['Again', restart], ['Hub', () => go('index.html')]]); },
  });
  addEventListener('unhandledrejection', e => { if (e.reason?.message === 'game ended') e.preventDefault(); });
  async function restart() {                                   // closing the AudioContext kills every scheduled sound
    running = false; if (ctx) ctx.live = false; try { game.stop?.(); } catch {}
    try { await ac.close(); } catch {}
    ac = new AudioContext(); noise = null; await ac.resume();
    startGame();
  }
  async function startGame() {
    note = ''; buttons = []; if (ctx) ctx.live = false; ctx = makeCtx();
    if (pointerMode() === 'eye') { scene = 'game'; await reanchor(W / 2, H * 0.6); }
    buttons = [btn('Hub', 30, 30, 160, 100, () => go('index.html'))];
    game.finished = false; scene = 'game';
    try { game.start(ctx); running = true; } catch (e) { console.error(e); note = 'Game error: ' + e.message; }
  }

  // ---------- camera preview: face box, eye boxes, eye crops with pupil/iris dots ----------
  function drawPreview(x, y, w, big) {
    const o = E.out, h = w * 9 / 16, mx = v => (1 - v) * w;  // mirrored
    g.save(); g.translate(x + w, y); g.scale(-1, 1); g.drawImage(video, 0, 0, w, h); g.restore();
    if (o.face && o.box) {
      g.strokeStyle = '#4de1ff'; g.lineWidth = 2; g.strokeRect(x + mx(o.box.x + o.box.w), y + o.box.y * h, o.box.w * w, o.box.h * h);
      g.strokeStyle = '#ffd34d';
      for (const k of ['R', 'L']) { const b = o.eyeBox[k]; g.strokeRect(x + mx(b.x + b.w), y + b.y * h, b.w * w, b.h * h); }
    }
    g.strokeStyle = o.face ? '#2ecc71' : '#e74c3c'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    if (!o.eyes || !o.face) return h;
    const sc = big ? 6 : 2;
    ['L', 'R'].forEach((k, i) => {
      const e = o.eyes[k], ex = big ? 40 + i * (EW * sc + 30) : x + i * (EW * sc + 6), ey = big ? 200 : y + h + 6;
      g.imageSmoothingEnabled = false; g.drawImage(E.eyeCanvas[k], ex, ey, EW * sc, EH * sc); g.imageSmoothingEnabled = true;
      g.strokeStyle = '#ffd34d'; g.lineWidth = 2; g.strokeRect(ex, ey, EW * sc, EH * sc);
      g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(ex + e.dbg.px * sc, ey + e.dbg.py * sc, big ? 7 : 3, 0, 7); g.fill();
      g.strokeStyle = '#4de1ff'; g.lineWidth = 2; g.beginPath(); g.arc(ex + e.dbg.ix * sc, ey + e.dbg.iy * sc, big ? 10 : 5, 0, 7); g.stroke();
      if (big) text(`${k === 'R' ? 'right' : 'left'} eye  pupil conf ${e.conf.toFixed(2)}  glare ${(e.glare * 100).toFixed(1)}%  open ${e.open.toFixed(2)}`, ex, ey + EH * sc + 28, 16, '#ccd', 'left');
    });
    return h;
  }
  function debugDraw() {
    const o = E.out;
    for (const p of valPts) {                                 // calibration accuracy: arrow from target to where gaze landed
      g.strokeStyle = '#ffffff33'; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.mx, p.my); g.stroke();
      g.fillStyle = '#2ecc71'; g.beginPath(); g.arc(p.x, p.y, 6, 0, 7); g.fill(); g.fillStyle = '#e74c3c'; g.beginPath(); g.arc(p.mx, p.my, 5, 0, 7); g.fill();
    }
    drawPreview(W - W * 0.42 - 20, 140, W * 0.42, true);
    [`${VERSION}  pointer ${pointerMode()}  eye mix ${o.model || '-'}  fixation ${o.fixation ? 'LOCK' : '-'}  blink ${o.blink ? 'Y' : '-'}`,
     `tracker ${o.ms?.toFixed(1)} ms  refits ${E.refits} (rejected ${E.rejected})  outliers dropped ${E.dropped}  bias ${E.bias.x.toFixed(0)},${E.bias.y.toFixed(0)}`,
     `breath ${o.breath.toFixed(2)}  light ${o.lum?.toFixed(0)}  face width ${(o.box?.w || 0).toFixed(2)}  correction pts ${E.corr?.length || 0}`,
     `smoothing ${E.o.smooth} (S)  head penalty ${E.o.headPen} (H)  head gain ${E.o.headGain} (G)`,
     'green dot = target, red = where your gaze landed in the accuracy check. Look at the green dots now to test.',
     'red/blue dots in eye boxes = our pupil / MediaPipe iris.  R re-anchor, space recenter head, V preview'
    ].forEach((l, i) => text(l, 40, 480 + i * 28, 17, '#ccd', 'left'));
  }

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    E.update(now);
    if (E.out.cameBack && pointerMode() === 'eye' && scene === 'menu') { E.out.cameBack = false; reanchor(); }
    if (dot?.moving) { const t = (now - dot.t0) / 1000; dot.x = (0.5 + 0.4 * Math.sin(t * 0.9)) * W; dot.y = (0.5 + 0.33 * Math.sin(t * 1.3)) * H; dot.hist.push({ t: now, x: dot.x, y: dot.y }); if (dot.hist.length > 60) dot.hist.shift(); }
    g.fillStyle = '#0b0b12'; g.fillRect(0, 0, W, H);
    if (scene === 'start') {
      text(title, W / 2, H * 0.33, 72, '#ffd34d');
      text('Click or press any key to start', W / 2, H * 0.5, 28);
      text('(a helper can do this - everything after works with eyes or head)', W / 2, H * 0.56, 20, '#9ab');
    } else if (scene === 'loading') text('Loading camera + face model...', W / 2, H / 2, 30);
    else if (scene === 'position') {
      const vw = Math.min(W * 0.55, 860), vx = (W - vw) / 2, vy = 70, vh = drawPreview(vx, vy, vw, false);
      g.strokeStyle = '#ffffff88'; g.lineWidth = 4; g.beginPath(); g.ellipse(W / 2, vy + vh / 2, vw * 0.16, vh * 0.36, 0, 0, 7); g.stroke();
      text('Face check', W / 2, 50, 32, '#ffd34d');
      const C = positionChecks(); let ok = true;
      C.forEach(([name, pass, hint, warnOnly], i) => {
        if (!pass && !warnOnly) ok = false;
        text(`${pass ? 'OK ' : warnOnly ? '!  ' : 'X  '} ${name}${!pass && hint ? ' - ' + hint : ''}`, vx, vy + vh + 100 + i * 32, 22, pass ? '#2ecc71' : warnOnly ? '#ffd34d' : '#e74c3c', 'left');
      });
      posOkFor = ok ? posOkFor + dt : 0;
      text(ok ? `Hold still... ${Math.max(0, 1.5 - posOkFor).toFixed(1)}` : 'Press C to skip', W / 2, H - 40, 26, ok ? '#2ecc71' : '#667');
      if (posOkFor > 1.5) { posOkFor = 0; scene = 'positioned'; afterPosition(); }
    } else if (scene === 'menu' || scene === 'valfail') { text('RhythmEyez', W / 2, H * 0.2, 60, '#ffd34d'); uiUpdate(dt); drawButtons(); }
    else if (scene === 'debug') { debugDraw(); uiUpdate(dt); drawButtons(); }
    else if (scene === 'game' && game && running) {
      try { if (!game.finished) game.update(dt); game.draw(); } catch (e) { console.error(e); }
      uiUpdate(dt); drawButtons();
    }
    if (set.preview && ['menu', 'game', 'valfail'].includes(scene)) drawPreview(W - 220, H - 210, 200, false);
    if (dot) { const k = Math.min(1, (now - dot.t0) / 1200); g.fillStyle = '#fff'; g.beginPath(); g.arc(dot.x, dot.y, dot.moving ? 14 : 24 - 14 * k, 0, 7); g.fill(); g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(dot.x, dot.y, 4, 0, 7); g.fill(); }
    if (note) text(note, W / 2, H * 0.12, 26, '#fff');
    if (!['start', 'loading', 'position'].includes(scene)) { const p = P(); g.strokeStyle = '#4de1ff'; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, 14, 0, 7); g.stroke(); }
    if (E.lm && !E.out.face && scene !== 'start') text('FACE LOST - look at the screen', W / 2, H - 30, 26, '#e74c3c');
    text(`${title} - ${VERSION}`, 10, H - 10, 13, '#556', 'left');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // if this browser already allows sound (e.g. Chrome started with --autoplay-policy=no-user-gesture-required), skip the click
  try { ac = new AudioContext(); if (ac.state === 'running') begin(); } catch {}

  addEventListener('pointerdown', e => {
    if (scene === 'start') return begin();
    for (const b of buttons) if (e.clientX > b.x && e.clientX < b.x + b.w && e.clientY > b.y && e.clientY < b.y + b.h) return b.fn();
  });
  addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; });
  addEventListener('keydown', e => {
    if (scene === 'start') return begin();
    const k = e.key;
    if (k === 'r') reanchor();
    if (k === ' ') { e.preventDefault(); E.recenterHead(); }
    if (k === 'v') { set.preview = !set.preview; saveSet(); }
    if (k === 'm') go('index.html');
    if (k === 'c' && scene === 'position') { scene = 'positioned'; calibrate(); }
    if (k === 'k' && E.lm) calibrate();
    if (k === 'h' && E.models) { const v = [1, 3, 6, 12, 24], i = (v.indexOf(E.o.headPen) + 1) % v.length; E.setHeadPenalty(v[i]); set.headPen = v[i]; saveSet(); note = `Head penalty ${v[i]} (higher = head turns move pointer less)`; }
    if (k === 'g') { const v = [0.5, 0.75, 1, 1.5, 2], i = (v.indexOf(E.o.headGain) + 1) % v.length; E.o.headGain = set.headGain = v[i]; saveSet(); note = `Head pointer gain ${v[i]}`; }
    if (k === 's') { const v = [0.7, 1, 1.4, 2, 3], i = (v.indexOf(E.o.smooth) + 1) % v.length; E.o.smooth = set.smooth = v[i]; E.resetFilters(); saveSet(); note = `Smoothing ${v[i]} (higher = steadier, more lag)`; }
  });
}
