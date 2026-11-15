// Song 3 - "Overdrive Protocol": fast, intense EDM. 150 BPM, D minor. Rolling 16th bass,
// a driving arp riff (dense straight notes) and fast zig-zag lead runs (hard curves).
export const meta = {
  id: 'overdrive-protocol',
  title: 'Overdrive Protocol',
  subtitle: 'Fast, intense EDM',
  bpm: 150,
  bars: 20,
  previewStart: 12.8,
  palette: { bg1: '#14030a', bg2: '#2c0718', lane: '#ff3864', accent: '#ffd23f', straight: '#ffd23f', curve: '#ff3864', glow: '#ff2e63' },
};

const DM = [62, 65, 69], BB = [58, 62, 65], C = [60, 64, 67], A = [57, 61, 64];
const PROG = [DM, BB, C, A];
const ROOT = [38, 34, 36, 33];
const RIFF_BEATS = [0, 0.5, 0.75, 1.5, 2, 2.5, 3, 3.25, 3.5];
const WALK = [0, 2, 1, 3, 2, 4, 3, 1, 2];

export function compose(c) {
  const arp = { shape: 'square', cutoff: 1200, envCut: 4200, res: 1.3, a: 0.002, d: 0.1, s: 0.25, r: 0.08 };
  const bass = { shape: 'saw', sub: 0.5, cutoff: 320, envCut: 1300, res: 1.3, a: 0.002, d: 0.07, s: 0.5, r: 0.04 };
  const lead = { shape: 'saw', voices: 3, detune: 0.012, cutoff: 3200, envCut: 1200, res: 1.2, a: 0.005, d: 0.1, s: 0.85, r: 0.12 };
  const pad = { shape: 'saw', voices: 4, detune: 0.016, cutoff: 1400, a: 0.15, d: 0.2, s: 0.8, r: 0.3 };

  const riffNotes = [];
  for (let bar = 0; bar < 20; bar++) {
    const k = bar % 4, chord = PROG[k], tones = [...chord, chord[0] + 12, chord[1] + 12];
    const intro = bar < 2, flow = [6, 7, 12, 13, 18, 19].includes(bar);
    for (let b = 0; b < 4; b++) c.drums.kick(bar, b, { gain: 1, duck: 0.65, punch: 1.2 });
    if (!intro) { c.drums.snare(bar, 1, { gain: 0.5 }); c.drums.snare(bar, 3, { gain: 0.5 }); }
    for (let b = 0; b < 4; b += bar >= 8 ? 0.25 : 0.5) c.drums.hat(bar, b, { gain: b % 1 ? 0.08 : 0.13 });
    for (let b = 0; b < 4; b += 0.25) if (b % 1) c.play(bar, b, 0.2, ROOT[k] + (b % 0.5 ? 12 : 0), bass, { gain: 0.42, pump: true });
    c.play(bar, 0, 4, chord, pad, { gain: flow ? 0.12 : 0.07, pump: true, verb: 0.3 });
    if (!flow) RIFF_BEATS.forEach((beat, i) => riffNotes.push([bar, beat, 0.22, tones[WALK[i]] + 12]));
    if (bar === 5 || bar === 11 || bar === 17) for (let b = 2; b < 4; b += 0.25) c.drums.snare(bar, b, { gain: 0.25 + (b - 2) * 0.15 });
  }
  c.drums.riser(4, 0, 8, { gain: 0.3 });
  c.drums.riser(16, 0, 8, { gain: 0.3 });
  c.drums.kick(20, 0, { gain: 1, duck: 0 });
  c.play(20, 0, 2.5, [...DM, 74], lead, { gain: 0.12, verb: 0.6 });

  c.melody('tap', riffNotes, arp, { gain: 0.2, echo: 0.15 });

  // zig-zag lead runs -> curves
  const run = (bar, notes) => notes.map(([beat, beats, midi]) => [bar, beat, beats, midi]);
  c.melody('flow', [
    ...run(6, [[0, 1, 74], [1, 0.5, 62], [1.5, 0.5, 65], [2, 1, 77], [3, 1, 69]]),
    ...run(7, [[0, 1, 70], [1, 1, 82], [2, 0.5, 77], [2.5, 0.5, 74], [3, 1, 65]]),
  ], lead, { gain: 0.2, verb: 0.3, echo: 0.15 });
  c.melody('flow', [
    ...run(12, [[0, 0.5, 62], [0.5, 0.5, 74], [1, 1, 81], [2, 0.5, 69], [2.5, 0.5, 65], [3, 1, 77]]),
    ...run(13, [[0, 1, 70], [1, 0.5, 82], [1.5, 0.5, 77], [2, 1, 64], [3, 1, 73]]),
  ], lead, { gain: 0.2, verb: 0.3, echo: 0.15 });
  c.melody('flow', [
    ...run(18, [[0, 0.5, 86], [0.5, 0.5, 74], [1, 0.5, 62], [1.5, 0.5, 69], [2, 1, 81], [3, 1, 65]]),
    ...run(19, [[0, 0.5, 70], [0.5, 0.5, 82], [1, 1, 77], [2, 0.5, 64], [2.5, 0.5, 73], [3, 1, 74]]),
  ], lead, { gain: 0.2, verb: 0.3, echo: 0.15 });
}
