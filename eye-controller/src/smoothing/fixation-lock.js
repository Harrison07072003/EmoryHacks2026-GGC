/**
 * Steady-gaze lock: while the last `windowMs` of samples stay inside a small box, output
 * their mean (rock steady). Releasing needs a bigger move than locking (hysteresis).
 */
export class FixationLock {
  constructor({ radius = 0.05, windowMs = 160, release = 1.6 } = {}) {
    Object.assign(this, { radius, windowMs, release });
    this.reset();
  }
  reset() { this.win = []; this.locked = false; }
  /** @returns the locked point {x, y}, or null when the eyes are moving */
  push(p, tMs) {
    this.win.push({ t: tMs, x: p.x, y: p.y });
    while (tMs - this.win[0].t > this.windowMs) this.win.shift();
    const xs = this.win.map(s => s.x), ys = this.win.map(s => s.y);
    const spread = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
    this.locked = this.win.length >= 3 && spread < (this.locked ? this.release : 1) * this.radius;
    if (!this.locked) return null;
    return { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length };
  }
}
