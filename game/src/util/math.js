export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = t => { t = clamp(t); return t * t * (3 - 2 * t); };
export const round = (v, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
