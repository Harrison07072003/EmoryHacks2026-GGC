// Tiny offline synthesizer for composing the game's original music at development time.
// Renders mono float buffers; build-songs.mjs writes them to WAV. Nothing here ships to the
// browser. All instruments are plain oscillators, noise and filters (no samples), so the
// output is entirely our own work.

export const SR = 32000;

const TAU = Math.PI * 2;
export const midiHz = m => 440 * 2 ** ((m - 69) / 12);

/** Deterministic noise, so every build produces byte-identical audio. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const noiseRand = rng(7);
const noise = () => noiseRand() * 2 - 1;

// ---- filters -------------------------------------------------------------------------
class Biquad {
  constructor(type = 'lp', freq = 1000, q = 0.707) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(freq, q); }
  set(freq, q = this.q ?? 0.707) {
    this.q = q;
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR, c = Math.cos(w), a = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (this.type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (this.type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; } // band-pass
    const a0 = 1 + a;
    Object.assign(this, { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 });
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ---- oscillators ----------------------------------------------------------------------
// PolyBLEP saw / square: cheap and without the harsh aliasing of naive waveforms.
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function osc(shape) {
  let ph = Math.random() * 0; // phase starts at 0 for determinism
  return f => {
    const dt = f / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    if (shape === 'sine') return Math.sin(TAU * ph);
    if (shape === 'tri') return 1 - 4 * Math.abs(ph - 0.5);
    if (shape === 'saw') return 2 * ph - 1 - blep(ph, dt);
    let sq = ph < 0.5 ? 1 : -1; sq += blep(ph, dt); sq -= blep((ph + 0.5) % 1, dt);
    return sq;
  };
}

/** ADSR (seconds) sampled at time t for a note held `dur` seconds. */
function adsr(t, dur, a, d, s, r) {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur) return s;
  const rel = (t - dur) / r;
  return rel >= 1 ? 0 : s * (1 - rel);
}

// ---- instruments: each returns a Float32Array starting at the note onset ---------------
export function kick({ punch = 1, decay = 0.38 } = {}) {
  const n = Math.round(SR * (decay + 0.05)), out = new Float32Array(n), o = osc('sine');
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 45 + 110 * punch * Math.exp(-t * 28);
    out[i] = Math.tanh(1.6 * o(f) * Math.exp(-t / decay * 2.2)) + (t < 0.004 ? noise() * 0.4 : 0);
  }
  return out;
}

export function snare({ tone = 190, decay = 0.17, bright = 1 } = {}) {
  const n = Math.round(SR * (decay + 0.05)), out = new Float32Array(n), o = osc('tri'), hp = new Biquad('hp', 900 * bright), bp = new Biquad('bp', 3200, 0.8);
  for (let i = 0; i < n; i++) {
    const t = i / SR, nz = noise();
    out[i] = 0.55 * o(tone * (1 + 0.5 * Math.exp(-t * 40))) * Math.exp(-t * 30) + 0.75 * (hp.run(nz) + 0.6 * bp.run(nz)) * Math.exp(-t / decay * 3);
  }
  return out;
}

export function clap() {
  const n = Math.round(SR * 0.25), out = new Float32Array(n), bp = new Biquad('bp', 1500, 1.2);
  for (let i = 0; i < n; i++) {
    const t = i / SR, burst = [0, 0.011, 0.022].reduce((e, s) => e + (t >= s ? Math.exp(-(t - s) * 120) : 0), 0);
    out[i] = bp.run(noise()) * (burst * 0.8 + Math.exp(-t * 14) * 0.6) * 1.6;
  }
  return out;
}

export function hat({ open = false } = {}) {
  const decay = open ? 0.22 : 0.045, n = Math.round(SR * (decay + 0.03)), out = new Float32Array(n), hp = new Biquad('hp', 7000, 0.9);
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] = hp.run(noise()) * Math.exp(-t / decay * 3) * 0.7; }
  return out;
}

/** Riser: filtered noise sweeping up over `dur`. */
export function riser(dur) {
  const n = Math.round(SR * dur), out = new Float32Array(n), bp = new Biquad('bp', 400, 2);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    if (i % 64 === 0) bp.set(400 + 7000 * p * p, 2);
    out[i] = bp.run(noise()) * p * p * 0.9;
  }
  return out;
}

/**
 * Generic subtractive voice: `voices` detuned oscillators -> resonant low-pass with its own
 * envelope -> amp envelope. Used for leads, bass, pads, plucks and bells.
 */
export function voice(freq, dur, {
  shape = 'saw', voices = 1, detune = 0.01, sub = 0, cutoff = 2000, envCut = 0, res = 0.9,
  a = 0.005, d = 0.15, s = 0.7, r = 0.15, vibrato = 0, vibratoRate = 5.5, glideFrom = null, glideSec = 0.06,
} = {}) {
  const n = Math.round(SR * (dur + r + 0.01)), out = new Float32Array(n);
  const oscs = Array.from({ length: voices }, () => osc(shape)), subOsc = osc('sine'), lp = new Biquad('lp', cutoff, res);
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = adsr(t, dur, a, d, s, r);
    const g = glideFrom ? glideFrom + (freq - glideFrom) * Math.min(1, t / glideSec) : freq;
    const f = g * (1 + vibrato * Math.sin(TAU * vibratoRate * t) * Math.min(1, t / 0.3));
    let x = 0;
    oscs.forEach((o, k) => { x += o(f * (1 + detune * (k - (voices - 1) / 2))); });
    x /= Math.sqrt(voices);
    if (sub) x += sub * subOsc(f / 2);
    if (i % 32 === 0) lp.set(cutoff + envCut * adsr(t, dur, 0.002, d * 1.5, 0, 0.05), res);
    out[i] = lp.run(x) * env;
  }
  return out;
}

export const bell = (freq, dur) => {
  const a = voice(freq, dur, { shape: 'sine', a: 0.002, d: 1.2, s: 0, r: 0.6 });
  const b = voice(freq * 2.76, dur, { shape: 'sine', a: 0.002, d: 0.4, s: 0, r: 0.3 });
  const c = voice(freq * 5.4, dur, { shape: 'sine', a: 0.001, d: 0.12, s: 0, r: 0.1 });
  return a.map((v, i) => v + 0.4 * (b[i] ?? 0) + 0.15 * (c[i] ?? 0));
};

// ---- mixer ----------------------------------------------------------------------------
/**
 * A song-length mix with three buses: dry, reverb send and echo send, plus a sidechain
 * "pump" applied to anything added with pump: true (classic EDM ducking under the kick).
 */
export function createMix(seconds) {
  const n = Math.round(SR * seconds);
  const bus = { dry: new Float32Array(n), pumped: new Float32Array(n), verb: new Float32Array(n), echo: new Float32Array(n) };
  const duck = new Float32Array(n).fill(1);
  return {
    n,
    add(buf, atSec, { gain = 1, verb = 0, echo = 0, pump = false } = {}) {
      const start = Math.round(atSec * SR);
      const target = pump ? bus.pumped : bus.dry;
      for (let i = 0; i < buf.length && start + i < n; i++) {
        if (start + i < 0) continue;
        const v = buf[i] * gain;
        target[start + i] += v;
        if (verb) bus.verb[start + i] += v * verb;
        if (echo) bus.echo[start + i] += v * echo;
      }
    },
    /** Register a kick at `atSec` for the sidechain. depth 0-1. */
    duckAt(atSec, depth = 0.6, recover = 0.22) {
      const start = Math.round(atSec * SR), len = Math.round(recover * SR);
      for (let i = 0; i < len && start + i < n; i++) {
        const p = i / len, g = 1 - depth * (1 - p) ** 2;
        duck[start + i] = Math.min(duck[start + i], g);
      }
    },
    render({ echoSec = 0.36, echoFeedback = 0.38, verbSize = 1, verbDamp = 0.3, master = 1 } = {}) {
      const out = new Float32Array(n);
      const wet = reverb(bus.verb, verbSize, verbDamp), echoed = echo(bus.echo, echoSec, echoFeedback);
      for (let i = 0; i < n; i++) out[i] = bus.dry[i] + bus.pumped[i] * duck[i] + wet[i] + echoed[i] * duck[i];
      // gentle glue: soft clip, then normalise to -1 dBFS
      let peak = 0;
      for (let i = 0; i < n; i++) { out[i] = Math.tanh(out[i] * master); peak = Math.max(peak, Math.abs(out[i])); }
      const k = 0.89 / (peak || 1);
      for (let i = 0; i < n; i++) out[i] *= k;
      // short fades so the loop never clicks
      const f = Math.round(SR * 0.01);
      for (let i = 0; i < f; i++) { out[i] *= i / f; out[n - 1 - i] *= i / f; }
      return out;
    },
  };
}

function echo(input, sec, fb) {
  const d = Math.round(sec * SR), out = new Float32Array(input.length), lp = new Biquad('lp', 3500);
  for (let i = 0; i < input.length; i++) {
    const back = i >= d ? out[i - d] : 0;
    out[i] = lp.run(input[i] + back * fb);
  }
  return out.map((v, i) => v - input[i]); // wet only
}

/** Freeverb-style mono reverb: 4 damped combs + 2 all-passes. */
function reverb(input, size = 1, damp = 0.3) {
  const scale = SR / 44100, out = new Float32Array(input.length);
  const combs = [1116, 1188, 1277, 1356, 1422].map(len => ({ buf: new Float32Array(Math.round(len * scale * size)), i: 0, store: 0 }));
  const aps = [556, 441, 341].map(len => ({ buf: new Float32Array(Math.round(len * scale)), i: 0 }));
  const fb = 0.84;
  for (let n = 0; n < input.length; n++) {
    const x = input[n] * 0.18;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.store = o * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * fb;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const a of aps) {
      const o = a.buf[a.i];
      a.buf[a.i] = y + o * 0.5;
      y = o - y;
      a.i = (a.i + 1) % a.buf.length;
    }
    out[n] = y;
  }
  return out;
}

/** 16-bit PCM mono WAV. */
export function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
