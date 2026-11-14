export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** 0 at `lo`, 1 at `hi`, linear between. Works with lo > hi for a falling ramp. */
export const ramp = (v, lo, hi) => clamp((v - lo) / (hi - lo));

export const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export function median(a) {
  const s = [...a].sort((p, q) => p - q), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function std(a) {
  const m = mean(a);
  return Math.sqrt(mean(a.map(v => (v - m) ** 2)));
}

/** Seeded PRNG (mulberry32) so simulated data is deterministic. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.gauss = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
  return next;
}

export const round = (v, digits = 5) => Math.round(v * 10 ** digits) / 10 ** digits;
