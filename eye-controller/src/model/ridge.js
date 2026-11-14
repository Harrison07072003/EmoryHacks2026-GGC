// Weighted ridge regression with two outputs (x, y), built on sufficient statistics.
//
// A "gram" holds sums over samples of z*z^T and z*target, where z = [1, ...features].
// Everything we need (fit, leave-one-out, pooling players, online refinement) is just
// adding and subtracting grams, so no sample list has to be kept around or re-walked.

export function createGram(d) {
  const D = d + 1;
  return { d, A: new Float64Array(D * D), bx: new Float64Array(D), by: new Float64Array(D) };
}

export function addSample(g, f, x, y, w = 1) {
  const D = g.d + 1;
  for (let i = 0; i < D; i++) {
    const wz = w * (i ? f[i - 1] : 1);
    g.bx[i] += wz * x;
    g.by[i] += wz * y;
    for (let k = 0; k < D; k++) g.A[i * D + k] += wz * (k ? f[k - 1] : 1);
  }
  return g;
}

/** target += scale * other (use scale = -1 to remove a contribution). */
export function addGram(target, other, scale = 1) {
  for (let i = 0; i < target.A.length; i++) target.A[i] += scale * other.A[i];
  for (let i = 0; i < target.bx.length; i++) {
    target.bx[i] += scale * other.bx[i];
    target.by[i] += scale * other.by[i];
  }
  return target;
}

export const cloneGram = g => addGram(createGram(g.d), g);
export const scaleGram = (g, s) => addGram(g, g, s - 1);
/** Total sample weight in the gram. */
export const gramWeight = g => g.A[0];

export const gramToJSON = g => ({ d: g.d, A: Array.from(g.A), bx: Array.from(g.bx), by: Array.from(g.by) });
export const gramFromJSON = j => ({ d: j.d, A: Float64Array.from(j.A), bx: Float64Array.from(j.bx), by: Float64Array.from(j.by) });

/**
 * Solve the ridge problem on a subset of features (`idx`).
 * Features are standardized internally (so one lambda fits all scales) and the intercept
 * is not penalized. `sdFloor` stops a feature that barely moved during calibration from
 * getting a huge weight. Returns raw-space weights: x = bx + sum(wx[i] * f[i]).
 */
export function solveRidge(g, { idx, lambda = 0.02, penalties, sdFloor } = {}) {
  const D = g.d + 1, W = g.A[0];
  if (!(W > 0)) return null;
  idx = idx ?? Array.from({ length: g.d }, (_, i) => i);
  const k = idx.length;
  const mu = idx.map(i => g.A[i + 1] / W), mx = g.bx[0] / W, my = g.by[0] / W;
  const cov = (a, b) => g.A[(idx[a] + 1) * D + idx[b] + 1] / W - mu[a] * mu[b];
  const sd = idx.map((i, a) => Math.max(Math.sqrt(Math.max(cov(a, a), 0)), sdFloor?.[i] ?? 1e-6));

  const M = [], rx = [], ry = [];
  for (let a = 0; a < k; a++) {
    M.push(idx.map((_, b) => cov(a, b) / (sd[a] * sd[b])));
    M[a][a] += lambda * (penalties?.[idx[a]] ?? 1);
    rx.push((g.bx[idx[a] + 1] / W - mu[a] * mx) / sd[a]);
    ry.push((g.by[idx[a] + 1] / W - mu[a] * my) / sd[a]);
  }
  const [betaX, betaY] = solveLinear(M, [rx, ry]);

  const wx = new Array(g.d).fill(0), wy = new Array(g.d).fill(0);
  let bx = mx, by = my;
  idx.forEach((i, a) => {
    wx[i] = betaX[a] / sd[a];
    wy[i] = betaY[a] / sd[a];
    bx -= wx[i] * mu[a];
    by -= wy[i] * mu[a];
  });
  return { bx, by, wx, wy };
}

export function predict(m, f) {
  let x = m.bx, y = m.by;
  for (let i = 0; i < f.length; i++) { x += m.wx[i] * f[i]; y += m.wy[i] * f[i]; }
  return { x, y };
}

/** Gaussian elimination with partial pivoting; solves M*b = r for several right-hand sides. */
function solveLinear(M, rhs) {
  const n = M.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (const b of rhs) [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const m = M[r][i] / M[i][i];
      if (!m) continue;
      for (let c = i; c < n; c++) M[r][c] -= m * M[i][c];
      for (const b of rhs) b[r] -= m * b[i];
    }
  }
  return rhs.map(b => {
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
      x[i] = s / M[i][i];
    }
    return x;
  });
}
