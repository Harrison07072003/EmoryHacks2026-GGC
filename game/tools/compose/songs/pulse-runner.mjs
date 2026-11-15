// Song 2 - "Pulse Runner": upbeat EDM. 124 BPM, C minor. Four-on-the-floor, pumping bass,
// a plucky riff (straight notes) and two legato lead breaks (curves).
export const meta = {
  id: 'pulse-runner',
  title: 'Pulse Runner',
  subtitle: 'Upbeat EDM',
  bpm: 124,
  bars: 16,
  previewStart: 15.5,
  palette: { bg1: '#04121c', bg2: '#062c3a', lane: '#39f3ff', accent: '#ff3fd2', straight: '#3dffb8', curve: '#ff5bd6', glow: '#39f3ff' },
};

const CM = [60, 63, 67], AB = [56, 60, 63], EB = [55, 58, 63], BB = [58, 62, 65];
const PROG = [CM, AB, EB, BB];
const ROOT = [36, 32, 39, 34];

// riff per chord: [beat, midi]
const RIFF = [
  [[0, 72], [0.75, 75], [1.5, 79], [2, 77], [2.5, 75], [3, 72], [3.5, 74]],
  [[0, 72], [0.75, 75], [1.5, 80], [2, 79], [2.5, 75], [3, 72], [3.5, 70]],
  [[0, 70], [0.75, 75], [1.5, 79], [2, 82], [2.5, 79], [3, 75], [3.5, 74]],
  [[0, 74], [0.75, 77], [1.5, 82], [2, 77], [2.5, 74], [3, 70], [3.25, 72], [3.5, 74]],
];
const SIMPLE = [[[0, 72], [1, 75], [2, 79], [3, 75]], [[0, 72], [1, 75], [2, 80], [3, 75]]];

export function compose(c) {
  const pluck = { shape: 'saw', voices: 2, detune: 0.008, cutoff: 700, envCut: 5200, res: 1.4, a: 0.002, d: 0.16, s: 0.1, r: 0.12 };
  const bass = { shape: 'saw', sub: 0.6, cutoff: 260, envCut: 900, res: 1.1, a: 0.003, d: 0.12, s: 0.6, r: 0.06 };
  const stab = { shape: 'saw', voices: 5, detune: 0.018, cutoff: 1500, envCut: 3000, a: 0.005, d: 0.25, s: 0.3, r: 0.2 };
  const pad = { shape: 'saw', voices: 4, detune: 0.014, cutoff: 1100, a: 0.25, d: 0.3, s: 0.8, r: 0.5 };
  const lead = { shape: 'saw', voices: 3, detune: 0.01, cutoff: 2600, envCut: 1500, res: 1.1, a: 0.01, d: 0.2, s: 0.85, r: 0.25, vibrato: 0.008 };

  for (let bar = 0; bar < 16; bar++) {
    const k = bar % 4, chord = PROG[k], breakBar = bar === 6 || bar === 7;
    // drums
    for (let b = 0; b < 4; b++) if (!(breakBar && bar === 7 && b >= 2)) c.drums.kick(bar, b, { gain: breakBar ? 0.6 : 0.95 });
    if (bar >= 2) { c.drums.clap(bar, 1); c.drums.clap(bar, 3); }
    for (let b = 0; b < 4; b++) c.drums.hat(bar, b + 0.5, { open: true, gain: 0.12 });
    if (bar >= 8) for (let b = 0; b < 4; b += 0.25) c.drums.hat(bar, b, { gain: b % 0.5 ? 0.06 : 0.1 });
    // bass on the off-beats, pumped
    for (let b = 0; b < 4; b++) c.play(bar, b + 0.5, 0.4, ROOT[k], bass, { gain: 0.5, pump: true });
    // chords
    if (bar >= 8 && !breakBar) [0, 1.5, 3].forEach(b => c.play(bar, b, 0.35, chord.map(m => m + 12), stab, { gain: 0.07, pump: true, verb: 0.2 }));
    else c.play(bar, 0, 4, chord, pad, { gain: 0.1, pump: true, verb: 0.4 });
  }
  // build-up into the drop
  for (let b = 0; b < 4; b += 0.5) c.drums.snare(7, b, { gain: 0.15 + b * 0.06 });
  for (let b = 2; b < 4; b += 0.25) c.drums.snare(7, b, { gain: 0.2 + (b - 2) * 0.12 });
  c.drums.riser(6, 0, 8);
  c.drums.riser(13, 0, 4, { gain: 0.25 });
  c.drums.kick(16, 0, { gain: 1, duck: 0 });
  c.play(16, 0, 2, [...CM, 72], stab, { gain: 0.12, verb: 0.6 });

  // riff -> straight notes
  const riffBar = (bar, pattern) => pattern.map(([beat, midi]) => [bar, beat, 0.4, midi]);
  const riff = [];
  [0, 1].forEach(bar => riff.push(...riffBar(bar, SIMPLE[bar])));
  [2, 3, 4, 5, 8, 9, 10, 11, 14, 15].forEach(bar => riff.push(...riffBar(bar, RIFF[bar % 4])));
  c.melody('tap', riff, pluck, { gain: 0.3, echo: 0.22, verb: 0.15 });

  // legato breaks -> curves
  c.melody('flow', [
    [6, 0, 1, 75], [6, 1, 1, 79], [6, 2, 2, 82],
    [7, 0, 1.5, 77], [7, 1.5, 0.5, 79], [7, 2, 1.5, 74],
  ], lead, { gain: 0.22, verb: 0.4, echo: 0.2 });
  c.melody('flow', [
    [12, 0, 0.5, 79], [12, 0.5, 1.5, 84], [12, 2, 1, 82], [12, 3, 1, 79],
    [13, 0, 1, 80], [13, 1, 1, 79], [13, 2, 1, 75], [13, 3, 0.75, 72],
  ], lead, { gain: 0.22, verb: 0.4, echo: 0.2 });
}
