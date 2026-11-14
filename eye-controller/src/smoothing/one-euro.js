/** One Euro filter (Casiez et al.): heavy smoothing when slow, light smoothing when fast. */
export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 4, dCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.reset();
  }
  reset() { this.x = null; this.dx = 0; this.t = 0; }
  filter(x, tMs) {
    if (this.x === null) { this.x = x; this.t = tMs; return x; }
    const dt = Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    const aD = alpha(this.dCutoff, dt);
    this.dx = aD * ((x - this.x) / dt) + (1 - aD) * this.dx;
    const a = alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    return (this.x = a * x + (1 - a) * this.x);
  }
}
const alpha = (cutoff, dt) => { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); };
