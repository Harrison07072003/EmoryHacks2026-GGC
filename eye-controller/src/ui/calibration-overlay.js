// Default calibration screen, used when startCalibration() gets no onTarget of its own.
// Shows the game's lane grid and a glowing dot that visibly tracks the player's eyes:
// a spinning dashed ring while the eyes travel to it, then a reticle that tightens as the
// eyes steady (and loosens, with a "hold steady" hint, when they wobble) while the ring
// fills, then a green lock with a burst. Also a comet trail while following, the three
// phases, and a live mini face view so the player sees at once if tracking drops. During the
// band hops, the band the tracker thinks you look at lights up (green = right band). Escape cancels.
import { createFaceView } from './face-view.js';
import { DEFAULT_LAYOUT } from '../signals/lanes.js';

const PHASES = [['dots', 'Hold your gaze'], ['pursuit', 'Follow the dot'], ['hops', 'Jump between bands']];
const COLORS = { dot: '#ffffff', core: '#ff4d6d', ring: '#ffd34d', glow: '77,225,255', ok: '#39ffb0' };

/**
 * @param area      element to cover (default: the whole page)
 * @param onCancel  called on Escape
 * @param options   eyes (shows a live mini face view), layout
 */
export function createCalibrationOverlay(area = document.body, onCancel = () => {}, { eyes = null, layout = DEFAULT_LAYOUT } = {}) {
  const root = document.createElement('div');
  root.style.cssText = `position:${area === document.body ? 'fixed' : 'absolute'};inset:0;z-index:9999;background:#07070d;cursor:none`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  root.append(canvas);
  let face = null, mini = null;
  if (eyes) {
    mini = document.createElement('canvas');
    mini.style.cssText = 'position:absolute;inset:auto 16px 16px auto;width:240px;height:135px;border-radius:10px;border:1px solid rgba(77,225,255,.35);transition:opacity .25s';
    root.append(mini);
    face = createFaceView(eyes, mini, { eyes: false, lanes: false, oval: false, labels: false });
  }
  area.append(root);
  const g = canvas.getContext('2d');

  const st = { target: null, shown: { x: 0.5, y: 0.5 }, index: 0, total: 1, phase: 'dots', progress: 0, ring: 0, stage: 'seeking', steady: 0, steadyShown: 0, stageSince: 0, trail: [], bursts: [], flashes: [], phaseDone: {} };
  const onKey = e => { if (e.key === 'Escape') onCancel(); };
  addEventListener('keydown', onKey);
  let raf = requestAnimationFrame(function loop(now) { render(now); raf = requestAnimationFrame(loop); });

  function render(now) {
    const s = devicePixelRatio, W = (canvas.width = root.clientWidth * s), H = (canvas.height = root.clientHeight * s);
    g.clearRect(0, 0, W, H);
    drawGrid(g, W, H, layout, st, now);
    // ease toward a jumped-to target; a moving target is drawn exactly where it is
    if (st.target) {
      const k = st.phase === 'pursuit' ? 1 : 0.25;
      st.shown.x += (st.target.x - st.shown.x) * k; st.shown.y += (st.target.y - st.shown.y) * k;
    }
    const x = st.shown.x * W, y = st.shown.y * H;
    if (st.phase === 'pursuit' && st.target) {
      st.trail.push({ x, y }); if (st.trail.length > 28) st.trail.shift();
      st.trail.forEach((p, i) => { g.fillStyle = `rgba(${COLORS.glow},${(i / st.trail.length) * 0.45})`; g.beginPath(); g.arc(p.x, p.y, (6 + i * 0.5) * s, 0, 7); g.fill(); });
    } else st.trail.length = 0;
    if (st.phase === 'hops' && st.gaze && st.stage === 'capturing') drawGazeBand(g, W, H, layout, st);
    if (st.target) drawDot(g, x, y, s, st, now);
    if (mini) fadeMiniNear(mini, root, [st.target && { x: st.target.x * root.clientWidth, y: st.target.y * root.clientHeight }, ...st.trail.map(p => ({ x: p.x / s, y: p.y / s }))]);
    drawBursts(g, st, now, s);
    drawHeader(g, W, s, st);
    if (eyes && !eyes.faceData().frame?.face) text(g, 'Face lost – look at the screen', W / 2, H - 40 * s, 22 * s, '#ff4d6d');
  }

  return {
    show(target, index, total, info) {
      if (!target) return;
      const phase = info?.phase ?? (info?.moving ? 'pursuit' : info?.hop ? 'hops' : 'dots');
      if (phase !== st.phase) st.phaseDone[st.phase] = true;
      const jumped = !st.target || phase !== 'pursuit';
      Object.assign(st, { target, index, total, phase });
      if (jumped) Object.assign(st, { progress: 0, ring: 0, stage: 'seeking', steady: 0, stageSince: performance.now() });
    },
    progress(p, info) {
      if (info?.stage && info.stage !== st.stage) { st.stage = info.stage; st.stageSince = performance.now(); }
      if (info) st.steady = info.steadiness ?? st.steady;
      st.gaze = info?.gaze ?? null;                    // hops: where the tracker thinks the player looks
      if (info?.onTarget !== undefined && info.onTarget !== st.onTarget) { st.onTarget = info.onTarget; st.onTargetSince = performance.now(); }
      if (p >= 1 && st.progress < 1 && st.phase !== 'pursuit' && st.target) {
        st.bursts.push({ x: st.shown.x, y: st.shown.y, t: performance.now() });     // captured!
        st.flashes.push({ x: st.target.x, y: st.target.y, t: performance.now() });
      }
      st.progress = p;
    },
    destroy() { cancelAnimationFrame(raf); face?.destroy(); root.remove(); removeEventListener('keydown', onKey); },
  };
}

/** The corner camera must never hide a dot: fade it out while a dot (or the trail) is near it. */
function fadeMiniNear(mini, root, points, margin = 70) {
  const m = mini.getBoundingClientRect(), r = root.getBoundingClientRect();
  const near = points.some(p => p && p.x > m.left - r.left - margin && p.x < m.right - r.left + margin && p.y > m.top - r.top - margin && p.y < m.bottom - r.top + margin);
  const want = near ? '0.06' : '1';
  if (mini.style.opacity !== want) mini.style.opacity = want;
}

/**
 * Hops: light up the band the tracker thinks the player is looking at, green when it is the
 * dot's band, amber when not, so the player can see the up/down check working.
 */
function drawGazeBand(g, W, H, { bandSplit }, st) {
  const top = st.gaze.y < bandSplit, right = (st.target.y < bandSplit) === top;
  g.fillStyle = right ? 'rgba(57,255,176,0.08)' : 'rgba(255,211,77,0.08)';
  g.fillRect(0, top ? 0 : bandSplit * H, W, (top ? bandSplit : 1 - bandSplit) * H);
}

function drawGrid(g, W, H, { lanes, bandSplit }, st, now) {
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1.5;
  for (let i = 1; i < lanes; i++) { g.beginPath(); g.moveTo((i * W) / lanes, 0); g.lineTo((i * W) / lanes, H); g.stroke(); }
  g.beginPath(); g.moveTo(0, bandSplit * H); g.lineTo(W, bandSplit * H); g.stroke();
  st.flashes = st.flashes.filter(f => now - f.t < 500);
  for (const f of st.flashes) { // the cell that was just captured glows briefly
    const lane = Math.min(lanes - 1, Math.floor(f.x * lanes)), top = f.y < bandSplit;
    g.fillStyle = `rgba(57,255,176,${0.18 * (1 - (now - f.t) / 500)})`;
    g.fillRect((lane * W) / lanes, top ? 0 : bandSplit * H, W / lanes, (top ? bandSplit : 1 - bandSplit) * H);
  }
}

function drawDot(g, x, y, s, st, now) {
  const r = 26 * s, locked = st.stage === 'locked' || st.progress >= 1;
  // ease the ring and the steadiness so they glide (and visibly drain) instead of stepping
  st.ring += (st.progress - st.ring) * 0.2; st.steadyShown += (st.steady - st.steadyShown) * 0.15;
  const pop = locked ? 1 + 0.25 * Math.max(0, 1 - (now - st.stageSince) / 250) : 1, pulse = 1 + 0.1 * Math.sin(now / 180);
  const halo = g.createRadialGradient(x, y, 0, x, y, r * 2.6 * pulse);
  halo.addColorStop(0, locked ? 'rgba(57,255,176,0.45)' : `rgba(${COLORS.glow},0.4)`); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 2.6 * pulse, 0, 7); g.fill();

  if (st.phase === 'dots' && st.stage === 'seeking') {        // eyes still travelling: searching ring
    g.setLineDash([6 * s, 8 * s]); g.lineDashOffset = -now / 25;
    g.strokeStyle = 'rgba(232,236,255,0.55)'; g.lineWidth = 3 * s; g.beginPath(); g.arc(x, y, r * 1.35, 0, 7); g.stroke();
    g.setLineDash([]);
  } else if (st.phase !== 'pursuit') {
    if (st.phase === 'dots' || st.phase === 'hops') drawReticle(g, x, y, r, s, locked ? 1 : st.steadyShown, now);
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 6 * s; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
    g.strokeStyle = locked ? COLORS.ok : COLORS.ring; g.lineCap = 'round';
    g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, locked ? 1 : st.ring)); g.stroke(); g.lineCap = 'butt';
    if (st.phase === 'dots' && !locked && st.steadyShown < 0.45 && now - st.stageSince > 500) text(g, 'hold steady', x, y + r * 2.4, 14 * s, 'rgba(255,211,77,0.9)');
    if (st.phase === 'hops' && !locked && st.stage === 'capturing' && st.onTarget === false && now - st.onTargetSince > 600) text(g, 'look at the dot', x, y + r * 2.4, 14 * s, 'rgba(255,211,77,0.9)');
  }
  g.fillStyle = COLORS.dot; g.beginPath(); g.arc(x, y, r * 0.5 * pop, 0, 7); g.fill();
  g.fillStyle = locked ? COLORS.ok : COLORS.core; g.beginPath(); g.arc(x, y, r * 0.16 * pop, 0, 7); g.fill();
}

/** Four ticks around the dot: wide and shaky while the eyes wander, closing in as they steady. */
function drawReticle(g, x, y, r, s, steady, now) {
  const k = Math.max(0, Math.min(1, steady)), gap = r * (1.3 + 1.1 * (1 - k)), jitter = (1 - k) * 5 * s, len = 9 * s;
  const red = Math.round(255 - 198 * k), green = Math.round(211 + 44 * k), blue = Math.round(77 + 99 * k);
  g.strokeStyle = `rgba(${red},${green},${blue},0.9)`; g.lineWidth = 2.5 * s;
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, jx = Math.sin(now / 60 + i * 2) * jitter, jy = Math.cos(now / 70 + i * 3) * jitter;
    const cx = x + Math.cos(a) * gap + jx, cy = y + Math.sin(a) * gap + jy;
    g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
  }
  g.stroke();
}

function drawBursts(g, st, now, s) {
  const W = g.canvas.width, H = g.canvas.height;
  st.bursts = st.bursts.filter(b => now - b.t < 700);
  for (const b of st.bursts) {
    const k = (now - b.t) / 700;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + i, d = (40 + 90 * k) * s * (0.6 + (i % 3) * 0.25);
      g.fillStyle = i % 2 ? `rgba(57,255,176,${1 - k})` : `rgba(255,211,77,${1 - k})`;
      g.beginPath(); g.arc(b.x * W + Math.cos(a) * d, b.y * H + Math.sin(a) * d, (3.5 - 2.5 * k) * s, 0, 7); g.fill();
    }
  }
}

function drawHeader(g, W, s, st) {
  const y = 34 * s, w = 190 * s, x0 = W / 2 - (PHASES.length * w) / 2;
  PHASES.forEach(([id, name], i) => {
    const cur = st.phase === id, done = st.phaseDone[id];
    text(g, `${done ? '✓' : i + 1}  ${name}`, x0 + i * w + w / 2, y, (cur ? 17 : 14) * s, cur ? '#ffd34d' : done ? '#39ffb0' : 'rgba(232,236,255,0.4)');
  });
  const counter = st.phase === 'pursuit' ? '' : `${Math.min(st.index + 1, st.total)} / ${st.total}`;
  text(g, counter, W / 2, y + 26 * s, 13 * s, 'rgba(232,236,255,0.7)');
}

function text(g, s, x, y, size, color) {
  g.font = `600 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.fillStyle = color; g.fillText(s, x, y);
}
