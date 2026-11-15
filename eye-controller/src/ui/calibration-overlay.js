// Default calibration screen, used when startCalibration() gets no onTarget of its own.
// Shows the game's lane grid, a glowing dot with a filling ring, a burst when a dot is
// captured, a comet trail while following, the three phases with overall progress, and a
// live mini face view so the player sees at once if tracking drops. Escape cancels.
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
  let face = null;
  if (eyes) {
    const mini = document.createElement('canvas');
    mini.style.cssText = 'position:absolute;inset:auto 16px 16px auto;width:240px;height:135px;border-radius:10px;border:1px solid rgba(77,225,255,.35)';
    root.append(mini);
    face = createFaceView(eyes, mini, { eyes: false, lanes: false });
  }
  area.append(root);
  const g = canvas.getContext('2d');

  const st = { target: null, shown: { x: 0.5, y: 0.5 }, index: 0, total: 1, phase: 'dots', progress: 0, trail: [], bursts: [], flashes: [], phaseDone: {} };
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
    if (st.target) drawDot(g, x, y, s, st, now);
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
      if (jumped) st.progress = 0;
    },
    progress(p) {
      if (p >= 1 && st.progress < 1 && st.phase !== 'pursuit' && st.target) {
        st.bursts.push({ x: st.shown.x, y: st.shown.y, t: performance.now() });     // captured!
        st.flashes.push({ x: st.target.x, y: st.target.y, t: performance.now() });
      }
      st.progress = p;
    },
    destroy() { cancelAnimationFrame(raf); face?.destroy(); root.remove(); removeEventListener('keydown', onKey); },
  };
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
  const pulse = 1 + 0.12 * Math.sin(now / 180), r = 26 * s;
  const halo = g.createRadialGradient(x, y, 0, x, y, r * 2.6 * pulse);
  halo.addColorStop(0, `rgba(${COLORS.glow},0.45)`); halo.addColorStop(1, `rgba(${COLORS.glow},0)`);
  g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 2.6 * pulse, 0, 7); g.fill();
  if (st.phase !== 'pursuit') { // capture ring
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 6 * s; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
    g.strokeStyle = st.progress >= 1 ? COLORS.ok : COLORS.ring; g.lineCap = 'round';
    g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, st.progress)); g.stroke(); g.lineCap = 'butt';
  }
  g.fillStyle = COLORS.dot; g.beginPath(); g.arc(x, y, r * 0.5, 0, 7); g.fill();
  g.fillStyle = COLORS.core; g.beginPath(); g.arc(x, y, r * 0.16, 0, 7); g.fill();
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
