// ECHO v2 - musical Simon Says. Watch + listen, then repeat by looking at each pad.
// Fair picking: a pad only fills while your gaze is SETTLED on it (not while sweeping across),
// gaps between pads count as "nowhere", and the dwell is long enough that passing through never picks.
const PADS = [{ col: '#e74c3c', semi: 0 }, { col: '#f1c40f', semi: 4 }, { col: '#2ecc71', semi: 7 }, { col: '#3498db', semi: 12 }];
const N = PADS.length, PICK = 0.7, SETTLE_MS = 250, SETTLE_FRAC = 0.05, GAP = 0.06;
let c, seq, phase, step, lit, litUntil, dwell, pad, lastPad, lockUntil, best, trail;
const padRect = i => { const W = c.W, pw = W / N; return [i * pw + pw * GAP, c.H * 0.3, pw * (1 - 2 * GAP), c.H * 0.45]; };
function padAt(x) {                                       // -1 when in a gap between pads
  const pw = c.W / N, i = Math.floor(x / pw), f = x / pw - i;
  return i < 0 || i >= N || f < GAP || f > 1 - GAP ? -1 : i;
}
function settled(now) {                                    // gaze stayed within a small box for the last 250 ms
  const r = trail.filter(p => now - p.t < SETTLE_MS);
  if (r.length < 4) return false;
  const xs = r.map(p => p.x);
  return Math.max(...xs) - Math.min(...xs) < SETTLE_FRAC * c.W;
}
async function playback(mine) {
  phase = 'show'; c.setNote(`Round ${seq.length}: watch and listen`);
  await c.sleep(700);
  for (const p of seq) {
    if (c !== mine) return;
    lit = p; c.note(c.hz(PADS[p].semi), c.actx.currentTime, 0.5); await c.sleep(600); lit = -1; await c.sleep(200);
  }
  phase = 'input'; step = 0; dwell = 0; lockUntil = 0; c.setNote('Your turn - settle your eyes on each pad');
}
function next() { seq.push(Math.floor(Math.random() * N)); playback(c); }

export default {
  name: 'Echo',
  start(ctx) { c = ctx; seq = []; lit = -1; pad = -1; lastPad = -1; best = 0; trail = []; next(); },
  update(dt) {
    const now = performance.now(), p = c.P();
    trail.push({ t: now, x: p.x }); while (trail.length && now - trail[0].t > 600) trail.shift();
    pad = padAt(p.x);
    if (phase !== 'input' || now < lockUntil) return;
    if (pad !== lastPad) { dwell = 0; lastPad = pad; }
    if (pad < 0) return;
    if (settled(now)) dwell += dt;                          // only fills while settled
    if (dwell < PICK) return;
    dwell = 0; lockUntil = now + 600;                      // must re-dwell to pick the same pad again
    if (pad === seq[step]) {
      lit = pad; litUntil = now + 300; c.note(c.hz(PADS[pad].semi), c.actx.currentTime, 0.4);
      const [x, y, w, h] = padRect(pad); c.E.addHit(x + w / 2, y + h / 2);   // perfect training data
      if (++step === seq.length) {
        best = seq.length; phase = 'wait';
        if (seq.length >= 12) { c.finish(`Perfect! Remembered all ${best}`); return; }
        const mine = c; c.setNote('Nice!');
        setTimeout(() => { if (c === mine && mine.live && phase === 'wait') next(); }, 900);
      }
    } else {
      phase = 'over'; c.perc(c.actx.currentTime, 'buzz');
      c.finish(`Remembered ${best} in a row`);
    }
  },
  draw() {
    const { g, H } = c, now = performance.now();
    if (lit >= 0 && phase === 'input' && now > litUntil) lit = -1;
    for (let i = 0; i < N; i++) {
      const [x, y, w, h] = padRect(i);
      g.globalAlpha = i === lit ? 1 : 0.35; g.fillStyle = PADS[i].col; g.beginPath(); g.roundRect(x, y, w, h, 30); g.fill(); g.globalAlpha = 1;
      if (i === pad && phase === 'input') {
        g.strokeStyle = '#fff'; g.lineWidth = 6; g.stroke();
        g.strokeStyle = settled(now) ? '#ffd34d' : '#ffffff44'; g.lineWidth = 12; g.beginPath();
        g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.25, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, dwell / PICK)); g.stroke();
      }
    }
    if (phase === 'input') c.text(`${step} / ${seq.length}`, c.W / 2, H * 0.88, 36, '#fff');
    c.text('Echo v2', 20, 30, 14, '#556', 'left');
  },
  stop() { phase = 'over'; },
};
