// DRUM DUEL v2 - the rival drums a 4-beat pattern, you answer it in the next bar.
// Three zones: LEFT pad | MIDDLE (rest) | RIGHT pad.
// A hit = your eyes ARRIVE on a pad (a "strike"). Staring at one pad scores once, then nothing:
// you must go back to the middle (or across) to strike again. Strikes with no note due = "extra" (breaks streak).
const BPM = 80, ROUNDS = 8, LAG = 0.08, EARLY = 0.3, LATE = 0.35;
const SND = ['tom', 'snare'], COL = ['#ff8c42', '#4da3ff'];
let c, s, zone = 1, flash = [0, 0], bad = 0;
const time = () => c.actx.currentTime - s.start - (c.actx.outputLatency || 0);
// zone edges: left pad < 33%, middle 33-67%, right pad > 67%, with hysteresis so the border doesn't chatter
function zoneOf(x, cur) {
  const W = c.W, m = W * 0.04, a = W * 0.33, b = W * 0.67;
  if (cur === 0 && x < a + m) return 0;
  if (cur === 2 && x > b - m) return 2;
  if (cur === 1 && x > a - m && x < b + m) return 1;
  return x < a ? 0 : x > b ? 2 : 1;
}

export default {
  name: 'Drum Duel',
  start(ctx) {
    c = ctx; zone = 1; bad = 0;
    const spb = 60 / BPM, start = c.actx.currentTime + 1.5, notes = [], rounds = [];
    for (let r = 0; r < ROUNDS; r++) {
      const rest = r < 3 ? 0.5 : r < 6 ? 0.3 : 0.15; let pat;   // early rounds: fewer hits, more time to move
      do pat = [0, 1, 2, 3].map(() => (Math.random() < rest ? -1 : Math.random() < 0.5 ? 0 : 1)); while (pat.filter(p => p >= 0).length < 2);
      const rival = 4 + r * 8, you = rival + 4; rounds.push({ pat, rival, you });
      pat.forEach((p, k) => { if (p < 0) return; c.perc(start + (rival + k) * spb, SND[p]); notes.push({ t: (you + k) * spb, side: p, r, k, res: null }); });
    }
    const total = 4 + ROUNDS * 8 + 2;
    for (let i = 0; i < total; i++) { c.perc(start + i * spb, 'hat'); if (i % 2 === 0) c.perc(start + i * spb, 'kick'); }
    s = { spb, start, notes, rounds, end: total * spb, hits: 0, extra: 0, streak: 0, best: 0, done: false };
  },
  update() {
    const st = time(), prev = zone;
    zone = zoneOf(c.P().x, zone);
    if (zone !== prev && zone !== 1) {                               // STRIKE: arrived on a pad
      const side = zone === 0 ? 0 : 1;
      const T = s.notes.filter(n => !n.res && n.side === side && st > n.t + LAG - EARLY && st < n.t + LAG + LATE)
                       .sort((p, q) => Math.abs(p.t - st) - Math.abs(q.t - st))[0];
      if (T) {
        T.res = 'hit'; s.hits++; s.streak++; s.best = Math.max(s.best, s.streak); flash[side] = performance.now();
        c.perc(Math.max(c.actx.currentTime, s.start + T.t), SND[side]);   // early strike still sounds on the beat
        c.E.addHit((side === 0 ? 0.165 : 0.835) * c.W, c.E.out.y);
      } else {
        const beat = st / s.spb, r = Math.floor((beat - 4) / 8), yourBar = beat - 4 - r * 8 >= 4;
        if (yourBar) { s.extra++; s.streak = 0; bad = performance.now(); }   // only punish extras on YOUR bar
      }
    }
    for (const T of s.notes) if (!T.res && st > T.t + LAG + LATE) { T.res = 'miss'; s.streak = 0; }
    if (st > s.end && !s.done) { s.done = true; c.finish(`${s.hits}/${s.notes.length} hits, best streak ${s.best}, ${s.extra} extra`); }
  },
  draw() {
    const { g, W, H } = c, st = time(), beat = st / s.spb, now = performance.now();
    const r = Math.floor((beat - 4) / 8), R = s.rounds[r], yourTurn = R && beat - 4 - r * 8 >= 4;
    // pads + rest zone
    [[0, 0.02, 0.29], [1, 0.71, 0.27]].forEach(([i, fx, fw]) => {
      const x = W * fx, y = H * 0.42, w = W * fw, h = H * 0.5, f = Math.max(0, 1 - (now - flash[i]) / 200);
      g.globalAlpha = 0.3 + 0.35 * ((zone === 0 && i === 0) || (zone === 2 && i === 1)) + 0.3 * f;
      g.fillStyle = COL[i]; g.beginPath(); g.roundRect(x, y, w, h, 40); g.fill(); g.globalAlpha = 1;
      c.text(i ? 'SNARE' : 'TOM', x + w / 2, y + h / 2 + 15, 44, '#fff');
    });
    g.fillStyle = zone === 1 ? '#2a2a40' : '#16161f'; g.beginPath(); g.roundRect(W * 0.35, H * 0.5, W * 0.3, H * 0.34, 30); g.fill();
    c.text('REST', W / 2, H * 0.67 + 10, 30, zone === 1 ? '#ccd' : '#556');
    if (now - bad < 250) { g.fillStyle = 'rgba(231,76,60,0.25)'; g.fillRect(0, 0, W, H); }
    if (!R) { c.text(beat < 4 ? 'Look at a pad to hit it. Come back to REST between hits.' : '', W / 2, H * 0.2, 30); return; }
    c.text(yourTurn ? 'YOUR TURN' : 'LISTEN', W / 2, H * 0.1, 44, yourTurn ? '#2ecc71' : '#ffd34d');
    [['RIVAL', 0.2, R.rival], ['YOU', 0.31, R.you]].forEach(([label, fy, bar], row) => {
      c.text(label, W * 0.25, H * fy + 10, 24, '#9ab', 'right');
      R.pat.forEach((p, k) => {
        const x = W * 0.32 + k * W * 0.1, y = H * fy, cur = Math.floor(beat) === bar + k;
        const res = row ? s.notes.find(n => n.r === r && n.k === k) : null;
        g.fillStyle = p < 0 ? '#222' : res?.res === 'hit' ? '#2ecc71' : res?.res === 'miss' ? '#e74c3c' : COL[p];
        g.globalAlpha = p < 0 ? 1 : row && !res?.res ? 0.45 : 1;
        g.beginPath(); g.arc(x, y, cur ? 26 : 20, 0, 7); g.fill(); g.globalAlpha = 1;
      });
    });
    const due = s.notes.find(n => !n.res && n.t - st < s.spb && n.t - st > -0.3);   // cue 1 beat ahead
    if (due) { g.strokeStyle = '#fff'; g.lineWidth = 8; g.beginPath(); g.roundRect(due.side ? W * 0.71 : W * 0.02, H * 0.42, due.side ? W * 0.27 : W * 0.29, H * 0.5, 40); g.stroke(); }
    if (s.streak >= 3) c.text(`${s.streak} streak`, W / 2, H * 0.42, 30, '#ffd34d');
    c.text('Drum Duel v2 - 3 zones', 20, c.H - 40, 14, '#556', 'left');
  },
  stop() {},
};
