// EYE PIANO - notes fall onto 5 keys; look at the key when the note lands. Ode to Joy (public domain).
const ODE = [[2,1],[2,1],[3,1],[4,1],[4,1],[3,1],[2,1],[1,1],[0,1],[0,1],[1,1],[2,1],[2,1.5],[1,.5],[1,2],
             [2,1],[2,1],[3,1],[4,1],[4,1],[3,1],[2,1],[1,1],[0,1],[0,1],[1,1],[2,1],[1,1.5],[0,.5],[0,2]];
const SEMI = [0, 2, 4, 5, 7], N = 5, ASSIST = 0.3, LAG = 0.08;
let c, s, lane = -1, aimX = 0, combo = 0, best = 0;
const lw = () => c.W / N, center = i => (i + 0.5) * lw();
const time = () => c.actx.currentTime - s.start - (c.actx.outputLatency || 0);

export default {
  name: 'Eye Piano',
  start(ctx) {
    c = ctx; combo = 0; best = 0; lane = -1;
    const spb = 60 / 80, start = c.actx.currentTime + 1.5, notes = []; let b = 4;
    for (const [p, d] of ODE) { notes.push({ t: b * spb, dur: d * spb, lane: p, semi: SEMI[p], held: 0, res: null }); b += d; }
    for (let i = 0; i < b + 2; i++) c.perc(start + i * spb, 'kick');
    s = { spb, start, notes, end: b * spb, hits: 0, done: false };
  },
  update(dt) {
    const st = time(), x0 = c.P().x, raw = c.clamp(Math.floor(x0 / lw()), 0, N - 1);
    let x = x0;                                                     // aim assist toward the note that's due
    const due = s.notes.find(q => !q.res && q.t - st < 0.6 && q.t - st > -0.4);
    if (due && Math.abs(x - center(due.lane)) < lw()) x += ASSIST * (center(due.lane) - x);
    aimX = x; lane = c.lane(x, c.W, N, lane);
    for (const T of s.notes) {
      if (T.res) continue;
      const a = T.t - 0.2 + LAG, b = T.t + 0.3 + LAG;
      if (st >= a && st <= b && lane === T.lane) T.held += dt;
      if (T.held >= 0.06) {
        T.res = 'hit'; s.hits++; combo++; best = Math.max(best, combo);
        c.note(c.hz(T.semi), Math.max(c.actx.currentTime, s.start + T.t), Math.max(0.45, T.dur));   // sounds on the beat
        if (raw === T.lane) c.E.addHit(center(T.lane), c.E.out.y);   // learn only from unassisted hits
      } else if (st > b) { T.res = 'miss'; combo = 0; }
    }
    if (st > s.end && !s.done) { s.done = true; c.finish(`${s.hits}/${s.notes.length} notes - best combo ${best}`); }
  },
  draw() {
    const { g, W, H } = c, st = time(), hitY = H * 0.78, pps = H * 0.42;
    for (let i = 0; i < N; i++) { g.fillStyle = i === lane ? 'rgba(77,225,255,0.13)' : i % 2 ? '#11111d' : '#0e0e18'; g.fillRect(i * lw(), 0, lw(), hitY); }
    for (const T of s.notes) {
      const y = hitY - (T.t - st) * pps, h = Math.max(22, T.dur * pps * 0.9);
      if (y < -10 || y - h > H || (T.res && st > T.t + T.dur)) continue;
      g.fillStyle = T.res === 'hit' ? '#2ecc71' : T.res === 'miss' ? '#e74c3c66' : '#ffb000';
      g.beginPath(); g.roundRect(T.lane * lw() + lw() * 0.15, y - h, lw() * 0.7, h, 10); g.fill();
    }
    g.fillStyle = '#ffffff55'; g.fillRect(0, hitY - 2, W, 4);
    for (let i = 0; i < N; i++) {
      g.fillStyle = i === lane ? '#bff4ff' : '#e9e9f0'; g.beginPath(); g.roundRect(i * lw() + 4, hitY + 6, lw() - 8, H - hitY - 12, 10); g.fill();
      c.text('CDEFG'[i], center(i), H - 30, 28, '#222');
    }
    g.fillStyle = '#4de1ff'; g.beginPath(); g.moveTo(aimX, hitY - 4); g.lineTo(aimX - 14, hitY - 30); g.lineTo(aimX + 14, hitY - 30); g.fill();
    if (combo >= 5) c.text(`${combo} COMBO`, W / 2, H * 0.2, 48, '#ffd34d');
    c.text('Eye Piano v2', 20, c.H - 40, 14, '#556', 'left');
  },
  stop() {},
};
