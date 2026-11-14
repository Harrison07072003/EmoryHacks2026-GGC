// HORN - follow the melody path with your gaze, blow (mouth open / puff cheeks) to toot.
// dir 'up': path falls top->bottom, pitch = left/right (most accurate axis)
// dir 'side': path scrolls right->left, pitch = up/down (classic toot style, a bit harder)
// When the Saints Go Marching In (public domain). [degree 0-4 = C D E F G, beats]
const SAINTS = [[0,1],[2,1],[3,1],[4,4],[0,1],[2,1],[3,1],[4,4],[0,1],[2,1],[3,1],[4,2],[2,2],[0,2],[2,2],[1,4],
                [2,1],[2,1],[1,1],[0,3],[0,1],[2,2],[4,2],[4,1],[3,3],[2,1],[3,1],[4,2],[2,2],[0,2],[1,2],[0,4]];
const SEMI = [0, 2, 4, 5, 7], LV = 5;
let c, s, synth;

const span = () => (c.hornSide ? c.H : c.W);
const posOf = d => (c.hornSide ? c.H - (d + 0.5) / LV * c.H : (d + 0.5) / LV * c.W);       // high notes at top / right
const degOf = p => c.clamp((c.hornSide ? (c.H - p) / c.H : p / c.W) * LV - 0.5, 0, LV - 1);
const semiAt = p => { const d = degOf(p), i = Math.min(LV - 2, Math.floor(d)); return SEMI[i] + (SEMI[i + 1] - SEMI[i]) * (d - i); };
function pathPos(t) {
  const N = s.notes; if (t <= N[0].t) return posOf(N[0].d);
  for (let i = 0; i < N.length; i++) {
    const n = N[i], end = n.t + n.dur; if (t >= end) continue;
    const gl = Math.min(0.3 * s.spb, n.dur * 0.4), nx = N[i + 1];
    if (nx && t > end - gl) { const k = (t - (end - gl)) / gl, e = k * k * (3 - 2 * k); return posOf(n.d) + (posOf(nx.d) - posOf(n.d)) * e; }
    return posOf(n.d);
  }
  return posOf(N[N.length - 1].d);
}
function makeHorn(a) {
  const o1 = a.createOscillator(), o2 = a.createOscillator(), vib = a.createOscillator(), vg = a.createGain();
  const mix = a.createGain(), lp = a.createBiquadFilter(), gn = a.createGain();
  o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 8; vib.frequency.value = 5.5; vg.gain.value = 3;
  lp.type = 'lowpass'; lp.Q.value = 4; mix.gain.value = 0.5; gn.gain.value = 0;
  vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
  o1.connect(mix); o2.connect(mix); mix.connect(lp).connect(gn).connect(c.out());
  [o1, o2, vib].forEach(o => o.start());
  return { set(f, amt) { const t = a.currentTime; o1.frequency.setTargetAtTime(f, t, 0.03); o2.frequency.setTargetAtTime(f, t, 0.03);
      gn.gain.setTargetAtTime(amt * 0.2, t, 0.04); lp.frequency.setTargetAtTime(400 + amt * 2600, t, 0.05); },
    stop() { [o1, o2, vib].forEach(o => o.stop()); } };
}
const blowAmt = () => (c.blowMode === 'auto' ? 1 : c.clamp((c.E.out.breath - 0.2) / 0.3, 0, 1));
const me = () => (c.hornSide ? c.P().y : c.P().x);
const time = () => c.actx.currentTime - s.start - (c.actx.outputLatency || 0);

export default {
  name: 'Horn',
  start(ctx) {
    c = ctx; const a = c.actx, spb = 60 / 100, start = a.currentTime + 1.5, notes = []; let b = 4;
    for (const [d, du] of SAINTS) { notes.push({ d, t: b * spb, dur: du * spb }); b += du; }
    for (let i = 0; i < b + 2; i++) { c.perc(start + i * spb, 'kick'); c.perc(start + (i + 0.5) * spb, 'hat'); }
    s = { spb, start, notes, end: b * spb, on: 0, total: 0, score: 0, streak: 0, done: false };
    synth = makeHorn(a);
  },
  update(dt) {
    const st = time(), pp = pathPos(st), tol = span() / LV * 0.45, live = st > 4 * s.spb && st < s.end;
    const blow = live ? blowAmt() : 0, on = Math.abs(me() - pp) < tol;
    synth.set(c.hz(on ? semiAt(pp) : semiAt(me())), blow);      // on the path = auto-tuned to the melody
    if (live && blow > 0.2) {
      s.total += dt;
      if (on) {
        s.on += dt; s.streak += dt; s.score += dt * 100 * (1 + Math.floor(s.streak / 4));
        if (c.pointer === 'eye' && Math.random() < 0.05) c.hornSide ? c.E.addHit(c.E.out.x, pp) : c.E.addHit(pp, c.E.out.y);
      } else s.streak = 0;
    }
    if (st > s.end + 1 && !s.done) { s.done = true; synth.set(200, 0); c.finish(`Score ${Math.round(s.score)} - on path ${s.total ? Math.round(100 * s.on / s.total) : 0}%`); }
  },
  draw() {
    const { g, W, H } = c, st = time(), tol = span() / LV * 0.45, on = Math.abs(me() - pathPos(st)) < tol, side = c.hornSide;
    for (let d = 0; d < LV; d++) {                                // pitch lanes
      g.fillStyle = d % 2 ? '#10101b' : '#0d0d16';
      const p = posOf(d), half = span() / LV / 2;
      side ? g.fillRect(0, p - half, W, half * 2) : g.fillRect(p - half, 0, half * 2, H);
      side ? c.text('CDEFG'[d], 30, p + 8, 22, '#556') : c.text('CDEFG'[d], p, H - 20, 22, '#556');
    }
    const head = side ? W * 0.2 : H * 0.8, pps = side ? W * 0.16 : H * 0.22;
    const pt = t => (side ? [head + (t - st) * pps, pathPos(t)] : [pathPos(t), head - (t - st) * pps]);
    const ribbon = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath();
      for (let t = st - 0.3, f = true; t < st + 5; t += 0.04, f = false) { const [x, y] = pt(t); f ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
    ribbon(tol * 2, 'rgba(255,176,0,0.12)'); ribbon(8, on ? '#2ecc71' : '#ffb000');
    g.fillStyle = '#ffffff44'; side ? g.fillRect(head - 2, 0, 4, H) : g.fillRect(0, head - 2, W, 4);
    const blow = blowAmt(), [bx, by] = side ? [head, me()] : [me(), head];
    g.fillStyle = on ? '#2ecc71' : '#e74c3c'; g.beginPath(); g.arc(bx, by, 18 + blow * 22, 0, 7); g.fill();   // horn bell
    g.fillStyle = '#333'; g.fillRect(W - 50, H * 0.3, 24, H * 0.4); g.fillStyle = '#4de1ff'; g.fillRect(W - 50, H * 0.7 - H * 0.4 * blow, 24, H * 0.4 * blow);
    c.text(c.blowMode === 'mouth' ? 'open mouth / puff cheeks' : 'auto-blow', W - 40, H * 0.27, 16, '#9ab', 'right');
    c.text(`${Math.round(s.score)}`, W / 2, 70, 48, '#ffd34d');
    if (s.streak > 4) c.text(`x${1 + Math.floor(s.streak / 4)} streak!`, W / 2, 115, 28, '#2ecc71');
    c.text('Horn v2', 20, c.H - 40, 14, '#556', 'left');
  },
  stop() { synth?.stop(); synth = null; },
};
