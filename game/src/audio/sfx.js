// Sound effects, separate from music. Each effect is rendered once into an AudioBuffer at
// startup (synthesized here, so there are no files to license), then played with no
// decoding delay. To use a recorded sound instead: await sfx.loadFile('perfect', url).

const SR = 44100;

/** name -> (t seconds) => sample, plus length in seconds. Arcade-style and short. */
const RECIPES = {
  perfect: [0.32, t => chime(t, [1318.5, 1975.5, 2637], 9) * 0.55],
  good: [0.22, t => chime(t, [987.8, 1480], 14) * 0.45],
  miss: [0.28, t => (Math.sin(2 * Math.PI * (140 - 220 * t) * t) * 0.6 + noiseAt(t) * 0.25) * Math.exp(-t * 14) * 0.6],
  select: [0.32, t => arp(t, [783.99, 1046.5, 1567.98], 0.07) * 0.5],
  tick: [0.06, t => Math.sin(2 * Math.PI * 1760 * t) * Math.exp(-t * 70) * 0.35],
  back: [0.24, t => arp(t, [1046.5, 659.25], 0.08) * 0.45],
  frenzy: [1.2, t => (sweep(t, 220, 1760, 1.0) * 0.4 + chime(Math.max(0, t - 0.55), [1760, 2217, 2637], 4) * 0.4 * (t > 0.55)) * Math.min(1, t * 20)],
  fail: [1.4, t => sweep(t, 660, 70, 1.3) * 0.55 * Math.exp(-t * 1.4)],
  complete: [1.5, t => arp(t, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.12, 3) * 0.5],
  count: [0.18, t => Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 22) * 0.5],
  go: [0.4, t => chime(t, [1760, 2637], 7) * 0.5],
};

let seed = 1;
function noiseAt() { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; }
function chime(t, freqs, decay) {
  return freqs.reduce((s, f, i) => s + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * decay * (1 + i * 0.4)), 0) / freqs.length * Math.min(1, t * 400);
}
function arp(t, freqs, step, decay = 10) {
  let s = 0;
  freqs.forEach((f, i) => { const u = t - i * step; if (u >= 0) s += (Math.sin(2 * Math.PI * f * u) + 0.3 * Math.sin(4 * Math.PI * f * u)) * Math.exp(-u * decay) * Math.min(1, u * 300); });
  return s * 0.6;
}
function sweep(t, f0, f1, dur) {
  const k = Math.log(f1 / f0) / dur, phase = (2 * Math.PI * f0 * (Math.exp(k * Math.min(t, dur)) - 1)) / k;
  return Math.sign(Math.sin(phase)) * 0.35 + Math.sin(phase) * 0.4;
}

export function createSfx(audio) {
  const { ctx, buses } = audio;
  const buffers = new Map();
  for (const [name, [len, fn]] of Object.entries(RECIPES)) {
    const n = Math.round(len * SR), buf = ctx.createBuffer(1, n, SR), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = fn(i / SR);
    const f = Math.min(200, n); for (let i = 0; i < f; i++) data[n - 1 - i] *= i / f; // no click at the end
    buffers.set(name, buf);
  }
  const lastPlayed = new Map();

  return {
    names: () => [...buffers.keys()],
    /** Play an effect now. Very fast repeats of the same sound are thinned so stacks of hits don't clip. */
    play(name, { gain = 1, rate = 1 } = {}) {
      const buf = buffers.get(name);
      if (!buf || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now - (lastPlayed.get(name) ?? -1) < 0.03) return;
      lastPlayed.set(name, now);
      try {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf; src.playbackRate.value = rate; g.gain.value = gain;
        src.connect(g).connect(buses.sfx);
        src.start();
      } catch { /* a sound must never break gameplay or calibration */ }
    },
    /** Replace a synthesized effect with an audio file. */
    async loadFile(name, url) {
      const res = await fetch(url);
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    },
  };
}
