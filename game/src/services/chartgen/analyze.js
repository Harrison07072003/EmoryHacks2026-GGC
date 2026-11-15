// Audio analysis for chart generation: tempo, beat grid + offset, onsets (spectral flux) with
// the band and pitch of each hit, loudness per section, and sustained (legato) passages.
import { hzToMidi, smooth, stft } from './dsp.js';

export const ANALYSIS_RATE = 22050;
const BANDS = [[30, 200], [200, 2000], [2000, 8000]];   // low (kick/bass), mid (snare/voice), high (hats)
const BPM_MIN = 70, BPM_MAX = 180;

/**
 * @param samples  mono Float32Array at ANALYSIS_RATE (dsp.toMono)
 * @returns {{ bpm, period, offset, beats: number[], onsets: object[], energyAt(t), sustained: {start,end}[], duration, pitchAt(t) }}
 */
export function analyze(samples, rate = ANALYSIS_RATE) {
  const { frames, frameRate, size } = stft(samples, rate);
  const duration = samples.length / rate;
  const binHz = rate / size;
  const nFrames = frames.length;
  const centre = size / 2 / rate;   // a frame's time is the centre of its window

  // log-compressed spectra -> positive spectral flux, per band and total
  const logF = frames.map(m => m.map(v => Math.log1p(100 * v)));
  const bandFlux = BANDS.map(() => new Float32Array(nFrames));
  const flux = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let e = 0;
    for (let k = 0; k < frames[f].length; k++) e += frames[f][k] ** 2;
    rms[f] = Math.sqrt(e / frames[f].length);
    if (!f) continue;
    // mean flux per bin in each band, so the 8 bins of the low band (kick) weigh as much as
    // the ~1100 bins of the high band (hats); a plain sum locks the beat onto hi-hats
    BANDS.forEach(([lo, hi], b) => {
      let s = 0, k0 = Math.ceil(lo / binHz), k1 = Math.min(frames[f].length - 1, Math.floor(hi / binHz));
      for (let k = k0; k <= k1; k++) s += Math.max(0, logF[f][k] - logF[f - 1][k]);
      bandFlux[b][f] = s / (k1 - k0 + 1);
      flux[f] += bandFlux[b][f];
    });
  }
  const env = normalize(subtractLocalMean(flux, Math.round(frameRate * 0.5)));

  // tempo from the autocorrelation of the onset envelope, weighted toward ~120 BPM
  const { bpm, lag } = estimateTempo(env, frameRate);
  const tracked = trackBeats(env, lag).map(f => f / frameRate + centre);

  // onsets: local maxima above an adaptive threshold
  const mean = smooth(env, Math.round(frameRate * 0.2));
  const std = Math.sqrt(env.reduce((s, v) => s + v * v, 0) / Math.max(1, env.length));
  const minGap = Math.round(frameRate * 0.07);
  const energy = normalize(smooth(rms, Math.round(frameRate * 1.5)));   // section loudness (~3 s window)
  const onsets = [];
  let last = -Infinity;
  for (let f = 3; f < nFrames - 3; f++) {
    const v = env[f];
    if (v <= mean[f] + 0.35 * std || v < 0.08) continue;
    let isMax = true;
    for (let j = f - 3; j <= f + 3; j++) if (env[j] > v) { isMax = false; break; }
    if (!isMax) continue;
    if (f - last < minGap) { if (v > onsets.at(-1).strength) onsets.pop(); else continue; }
    const band = argmax(bandFlux.map(b => b[f]));
    // column pitch: the melody (dominant note 100-2000 Hz) just after the hit, nudged by the band
    // that hit (kick a little left, hats a little right). Using the drum's own pitch would put
    // every beat of drum-led music in one column.
    const melodic = dominantMidi(frames[Math.min(nFrames - 1, f + 2)], binHz, [100, 2000]);
    onsets.push({ t: f / frameRate + centre, strength: v, band, midi: melodic + (band - 1) * 4, energy: energy[f] });
    last = f;
  }

  const pitchAt = t => dominantMidi(frames[clampFrame(t)], binHz, [100, 2000]);
  const energyAt = t => energy[clampFrame(t)];
  function clampFrame(t) { return Math.max(0, Math.min(nFrames - 1, Math.round((t - centre) * frameRate))); }

  const beats = settleStart(tracked, onsets, 60 / bpm);
  // song offset: the first beat on a real hit
  const offset = beats.find(b => onsets.some(o => Math.abs(o.t - b) < 0.035 && o.strength > 0.3)) ?? beats[0] ?? 0;
  return {
    bpm, period: 60 / bpm, offset, beats, onsets, duration, energyAt, pitchAt,
    sustained: findSustained(beats, onsets, energyAt, duration),
  };
}

function estimateTempo(env, frameRate) {
  const minLag = Math.floor((60 / BPM_MAX) * frameRate), maxLag = Math.ceil((60 / BPM_MIN) * frameRate);
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = minLag; lag < ac.length; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (env.length - lag);
  }
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = (ac[lag] + 0.5 * (ac[lag * 2] ?? 0)) * prior;   // periodicity that repeats at 2x counts more
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  // parabolic refinement for a fractional lag (at most half a frame, so it stays in range)
  const a = ac[best - 1], b = ac[best], c = ac[best + 1];
  const d = a - 2 * b + c;
  const shift = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
  const lag = Math.max(minLag, Math.min(maxLag, best + shift));
  return { lag, bpm: Math.round(((60 * frameRate) / lag) * 10) / 10 };
}

/** Dynamic-programming beat tracker (Ellis 2007): beats that follow onsets AND keep the tempo. */
function trackBeats(env, period, tightness = 100) {
  const n = env.length, score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0, from = -1;
    for (let p = t - Math.round(2 * period); p <= t - Math.round(period / 2); p++) {
      if (p < 0) continue;
      const s = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (from < 0 || s > best) { best = s; from = p; }
    }
    score[t] = env[t] + (from >= 0 ? best : 0);
    back[t] = from;
  }
  let t = n - 1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats = [];
  for (; t >= 0; t = back[t]) beats.push(t);
  return beats.reverse();
}

/**
 * The tracker's first beats are unsettled (it has no history yet). Find the first 4 beats in a
 * row that sit on real hits and extrapolate the grid back to the start from there.
 */
export function settleStart(beats, onsets, period) {
  const onHit = b => onsets.some(o => Math.abs(o.t - b) < 0.035 && o.strength > 0.2);
  const i = beats.findIndex((_, k) => k + 3 < beats.length && [0, 1, 2, 3].every(j => onHit(beats[k + j])));
  if (i <= 0) return beats;
  const before = [];
  for (let t = beats[i] - period; t >= -0.02; t -= period) before.unshift(Math.max(0, t));
  return [...before, ...beats.slice(i)];
}

/** Spans of 2+ beats with sound but no clear hits: legato material, used for curves. */
function findSustained(beats, onsets, energyAt, duration) {
  const spans = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    const a = beats[i], b = beats[i + 1];
    const hit = onsets.some(o => o.t >= a && o.t < b && o.strength > 0.3);
    const loud = energyAt((a + b) / 2) > 0.25;
    if (hit || !loud) continue;
    const prev = spans.at(-1);
    if (prev && Math.abs(prev.end - a) < 1e-6) prev.end = b; else spans.push({ start: a, end: b });
  }
  const minSpan = Math.max(1.2, 2 * ((beats.at(-1) - beats[0]) / Math.max(1, beats.length - 1)));
  return spans.filter(s => s.end - s.start >= minSpan && s.end <= duration);
}

function dominantMidi(mag, binHz, [lo, hi]) {
  let best = -1, bestV = -1;
  for (let k = Math.max(1, Math.ceil(lo / binHz)); k <= Math.min(mag.length - 1, Math.floor(hi / binHz)); k++) if (mag[k] > bestV) { bestV = mag[k]; best = k; }
  return best > 0 ? Math.round(hzToMidi(best * binHz)) : 60;
}

function subtractLocalMean(x, radius) {
  const m = smooth(x, radius);
  return x.map((v, i) => Math.max(0, v - m[i]));
}
function normalize(x) {
  let max = 0;
  for (const v of x) max = Math.max(max, v);
  return max > 0 ? x.map(v => v / max) : x;
}
const argmax = xs => xs.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
