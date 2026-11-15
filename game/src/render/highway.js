// Canvas renderer for the play screen: perspective highway, the two shiny hit lines,
// target pads, straight notes, curve ribbons, hit bursts and judgment pop-ups.
// It only draws: all decisions come from the judge/scoring modules.
import { LAYOUT, MISSED_NOTE_TRAIL_SEC } from '../config/game-config.js';
import { pathX } from '../gameplay/chart.js';
import { laneCenter } from '../gameplay/zones.js';

const JUDGE_COLOR = { perfect: '#5dfcff', good: '#b6ff5d', miss: '#ff4d6d' };
const JUDGE_TEXT = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' };

export function createHighway(canvas, { geometry, palette, lanes = LAYOUT.lanes, bpm }) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const bursts = [], popups = [];
  const beatSec = 60 / bpm;

  function resize() {
    dpr = Math.min(1.5, devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  const P = (p) => ({ x: p.x * W, y: p.y * H, s: p.s });
  const colors = frenzy => frenzy
    ? { lane: `hsl(${(performance.now() / 6) % 360} 100% 65%)`, accent: `hsl(${(performance.now() / 6 + 120) % 360} 100% 65%)` }
    : { lane: palette.lane, accent: palette.accent };

  // ---- static-ish parts ----
  function drawTrack(now, c, frenzy) {
    const { horizonY, upperLineY, lowerLineY } = LAYOUT;
    const top = P(geometry.project(geometry.approachSec, 0)), topR = P(geometry.project(geometry.approachSec, 1));
    // semi-transparent highway surface
    const grad = g.createLinearGradient(0, top.y, 0, upperLineY * H);
    grad.addColorStop(0, 'rgba(255,255,255,0.0)');
    grad.addColorStop(1, hexA(palette.lane, frenzy ? 0.2 : 0.11));
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(topR.x, topR.y); g.lineTo(W, upperLineY * H); g.lineTo(0, upperLineY * H); g.closePath(); g.fill();
    // flat deck (curve zone)
    const deck = g.createLinearGradient(0, upperLineY * H, 0, H);
    deck.addColorStop(0, hexA(palette.lane, 0.08)); deck.addColorStop(1, hexA(palette.accent, 0.03));
    g.fillStyle = deck; g.fillRect(0, upperLineY * H, W, H - upperLineY * H);

    // scrolling beat lines (the floor moves with the music)
    g.lineWidth = 1;
    const first = Math.ceil((now - geometry.gapSec * 2) / beatSec);
    for (let b = first; b * beatSec < now + geometry.approachSec; b++) {
      const p = geometry.project(b * beatSec - now, 0), q = geometry.project(b * beatSec - now, 1);
      if (p.y > 1) continue;
      const strong = b % 4 === 0;
      g.strokeStyle = hexA(palette.lane, (strong ? 0.28 : 0.12) * Math.min(1, p.s * 3));
      g.beginPath(); g.moveTo(p.x * W, p.y * H); g.lineTo(q.x * W, q.y * H); g.stroke();
    }

    // lane dividers: perspective to the upper line, then straight down
    for (let i = 0; i <= lanes; i++) {
      const x = i / lanes, a = P(geometry.project(geometry.approachSec, x)), b = P(geometry.project(0, x));
      g.strokeStyle = hexA(palette.lane, i === 0 || i === lanes ? 0.55 : 0.3); g.lineWidth = i === 0 || i === lanes ? 2 : 1.2;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = hexA(palette.lane, 0.12); g.lineWidth = 1;
      g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x, H); g.stroke();
    }
    // horizon glow
    const hg = g.createRadialGradient(W / 2, Math.max(0, horizonY * H), 0, W / 2, Math.max(0, horizonY * H), W * 0.3);
    hg.addColorStop(0, hexA(c.accent, 0.35)); hg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hg; g.fillRect(0, 0, W, H * 0.3);

    shinyLine(upperLineY * H, c.lane, 3);
    shinyLine(lowerLineY * H, c.accent, 3);
  }

  function shinyLine(y, color, w) {
    g.save();
    g.shadowColor = color; g.shadowBlur = 18;
    g.strokeStyle = color; g.lineWidth = w;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    g.restore();
  }

  function drawPads(activeLanes, gaze, c, beatPulse) {
    const y = LAYOUT.upperLineY * H, w = W / lanes, h = Math.max(26, H * 0.05);
    for (let i = 0; i < lanes; i++) {
      const on = activeLanes.includes(i), x = i * w + w * 0.12;
      g.save();
      roundRect(x, y - h / 2, w * 0.76, h, 12);
      g.fillStyle = on ? hexA(c.lane, 0.32) : hexA(c.lane, 0.06 + beatPulse * 0.05);
      g.fill();
      g.lineWidth = on ? 3 : 1.5; g.strokeStyle = on ? '#fff' : hexA(c.lane, 0.6);
      if (on) { g.shadowColor = c.lane; g.shadowBlur = 22; }
      g.stroke();
      g.restore();
    }
    // where the eyes are on the curve rail
    if (gaze.valid && gaze.y > LAYOUT.bandSplit) {
      const gx = gaze.x * W, gy = LAYOUT.lowerLineY * H;
      g.save(); g.fillStyle = hexA(c.accent, 0.25); g.strokeStyle = hexA('#ffffff', 0.7); g.lineWidth = 2;
      g.beginPath(); g.ellipse(gx, gy, 26, 14, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
    }
  }

  // ---- notes ----
  function drawStraight(note, state, now) {
    const judged = state?.judgment;
    if (judged && judged !== 'miss') return;                     // hit notes vanish into a burst
    const age = judged === 'miss' ? now - state.at : 0;
    if (age > MISSED_NOTE_TRAIL_SEC) return;
    const d = note.t - now;
    if (d > geometry.approachSec) return;
    const p = P(geometry.straight(note.t, now, laneCenter(note.lane, lanes)));
    const w = (W / lanes) * 0.62 * p.s, h = Math.max(6, H * 0.034 * p.s);
    const alpha = judged === 'miss' ? 0.55 * (1 - age / MISSED_NOTE_TRAIL_SEC) : Math.min(1, 0.25 + p.s * 1.2);
    g.save();
    g.globalAlpha = alpha;
    const col = judged === 'miss' ? '#ff4d6d' : palette.straight;
    g.shadowColor = col; g.shadowBlur = 16 * p.s;
    roundRect(p.x - w / 2, p.y - h / 2, w, h, h / 2);
    const fill = g.createLinearGradient(0, p.y - h / 2, 0, p.y + h / 2);
    fill.addColorStop(0, '#ffffff'); fill.addColorStop(0.35, col); fill.addColorStop(1, hexA(col, 0.6));
    g.fillStyle = fill; g.fill();
    g.restore();
  }

  function drawCurve(note, now, onPath, done) {
    const start = Math.max(note.t, now), end = Math.min(note.end, now + geometry.lookAheadSec);
    if (end <= start || done) {
      return;
    }
    const pts = [];
    for (let tau = start; tau <= end + 1e-6; tau += 1 / 40) pts.push({ ...P(geometry.curve(tau, now, pathX(note.path, tau))), tau });
    if (pts.length < 2) return;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    // wide translucent ribbon, width shrinking with distance
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      g.strokeStyle = hexA(palette.curve, onPath && a.tau - now < 0.25 ? 0.75 : 0.42);
      g.lineWidth = Math.max(3, 30 * b.s);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // bright core line
    g.shadowColor = palette.curve; g.shadowBlur = 14;
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.5;
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
    // the head on the lower line: this is what the eyes follow
    if (now >= note.t - 0.05) {
      const h = P(geometry.curve(now, now, pathX(note.path, now)));
      g.shadowBlur = onPath ? 34 : 12; g.shadowColor = onPath ? '#ffffff' : palette.curve;
      g.fillStyle = onPath ? '#ffffff' : palette.curve;
      g.beginPath(); g.arc(h.x, h.y, onPath ? 17 : 13, 0, Math.PI * 2); g.fill();
      g.lineWidth = 3; g.strokeStyle = palette.curve;
      g.beginPath(); g.arc(h.x, h.y, 24 + 4 * Math.sin(now * 12), 0, Math.PI * 2); g.stroke();
    } else if (note.t - now < geometry.lookAheadSec) {
      // cue: where the curve will start on the lower line
      const x = pathX(note.path, note.t) * W, y = LAYOUT.lowerLineY * H, k = 1 - (note.t - now) / geometry.lookAheadSec;
      g.strokeStyle = hexA(palette.curve, 0.3 + 0.5 * k); g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 30 - 12 * k, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  // ---- effects ----
  function addJudgment(j, frenzy) {
    const x = j.note.type === 'straight' ? laneCenter(j.note.lane, lanes) : j.x;
    const y = j.note.type === 'straight' ? LAYOUT.upperLineY : LAYOUT.lowerLineY;
    popups.push({ x, y, text: JUDGE_TEXT[j.judgment] + (frenzy && j.judgment !== 'miss' ? ' x2' : ''), color: JUDGE_COLOR[j.judgment], at: performance.now() });
    if (j.judgment !== 'miss') {
      const n = j.judgment === 'perfect' ? 18 : 10;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.3, v = 0.25 + Math.random() * 0.45;
        bursts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, at: performance.now(), color: frenzy ? `hsl(${Math.random() * 360} 100% 65%)` : JUDGE_COLOR[j.judgment] });
      }
      bursts.push({ ring: true, x, y, at: performance.now(), color: JUDGE_COLOR[j.judgment] });
    }
  }

  function drawEffects() {
    const t = performance.now();
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], age = (t - b.at) / 1000;
      if (age > 0.5) { bursts.splice(i, 1); continue; }
      g.save(); g.globalAlpha = 1 - age / 0.5;
      if (b.ring) { g.strokeStyle = b.color; g.lineWidth = 4; g.beginPath(); g.ellipse(b.x * W, b.y * H, 30 + age * 260, 12 + age * 90, 0, 0, Math.PI * 2); g.stroke(); }
      else { g.fillStyle = b.color; g.beginPath(); g.arc((b.x + b.vx * age) * W, (b.y + b.vy * age) * H, 4, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i], age = (t - p.at) / 1000;
      if (age > 0.7) { popups.splice(i, 1); continue; }
      g.save(); g.globalAlpha = 1 - age / 0.7;
      g.font = `900 ${Math.round(Math.max(22, H * 0.035) * (1 + 0.2 * Math.max(0, 0.15 - age) / 0.15))}px Orbitron, sans-serif`;
      g.textAlign = 'center'; g.fillStyle = p.color; g.shadowColor = p.color; g.shadowBlur = 16;
      g.fillText(p.text, p.x * W, p.y * H - H * 0.05 - age * 50);
      g.restore();
    }
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  return {
    /**
     * @param f { now, notes, noteState: Map(id -> {judgment, at}), curveOnPath: Map, curveDone: Set,
     *            gaze, activeLanes, frenzy }
     */
    draw(f) {
      g.clearRect(0, 0, W, H);
      const c = colors(f.frenzy);
      const beatPulse = Math.max(0, 1 - (((f.now % beatSec) + beatSec) % beatSec) / (beatSec * 0.5));
      drawTrack(f.now, c, f.frenzy);
      drawPads(f.activeLanes, f.gaze, c, beatPulse);
      // far notes first so near ones draw on top
      const visible = f.notes.filter(n => n.t - f.now < geometry.lookAheadSec + 0.1 && (n.end ?? n.t) > f.now - 1);
      for (const n of visible) if (n.type === 'curve') drawCurve(n, f.now, f.curveOnPath.get(n.id), f.curveDone.has(n.id));
      for (let i = visible.length - 1; i >= 0; i--) if (visible[i].type === 'straight') drawStraight(visible[i], f.noteState.get(visible[i].id), f.now);
      drawEffects();
    },
    addJudgment,
    destroy() { ro.disconnect(); },
  };
}

function hexA(color, a) {
  if (!color.startsWith('#')) return color.replace(/\)$/, ` / ${a})`).replace('hsl(', 'hsl(');
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
