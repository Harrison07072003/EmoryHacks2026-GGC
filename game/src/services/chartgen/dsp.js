// Small DSP helpers for chart generation: downmix/resample, FFT, STFT magnitudes.
// Pure JS (no Web Audio), so the same code runs in Node (server) and the browser (fallback).

/** Mono, resampled to `rate` (box-filtered so decimation does not alias badly), peak-normalized. */
export function toMono(channels, inRate, rate = 22050, maxSec = Infinity) {
  const n = Math.min(channels[0].length, Math.floor(maxSec * inRate));
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
  const ratio = inRate / rate;
  const out = new Float32Array(Math.floor(n / ratio));
  const half = Math.max(0, Math.floor(ratio / 2));
  for (let i = 0; i < out.length; i++) {
    const c = Math.floor(i * ratio);
    let s = 0, k = 0;
    for (let j = c - half; j <= c + half; j++) if (j >= 0 && j < n) { s += mono[j]; k++; }
    out[i] = k ? s / k : 0;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

/** In-place radix-2 FFT. re/im length must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/**
 * Magnitude spectrogram. Returns { frames: Float32Array[] (size/2 bins each), hop, size, frameRate }.
 */
export function stft(samples, rate, { size = 1024, hop = 256 } = {}) {
  const win = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const count = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  const frames = new Array(count), re = new Float32Array(size), im = new Float32Array(size);
  for (let f = 0; f < count; f++) {
    const at = f * hop;
    for (let i = 0; i < size; i++) { re[i] = samples[at + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    frames[f] = mag;
  }
  return { frames, hop, size, frameRate: rate / hop };
}

/** Moving average over ±radius frames. */
export function smooth(x, radius) {
  const out = new Float32Array(x.length);
  let s = 0, k = 0;
  for (let i = 0; i < Math.min(radius, x.length); i++) { s += x[i]; k++; }
  for (let i = 0; i < x.length; i++) {
    if (i + radius < x.length) { s += x[i + radius]; k++; }
    if (i - radius - 1 >= 0) { s -= x[i - radius - 1]; k--; }
    out[i] = s / k;
  }
  return out;
}

export const hzToMidi = hz => 69 + 12 * Math.log2(hz / 440);

/** Deterministic PRNG (mulberry32) seeded from a string: same song -> same choices. */
export function seededRandom(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
