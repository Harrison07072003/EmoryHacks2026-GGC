// Song 1 - "Neon Lullaby": slow, dreamy cyber ballad. 84 BPM, A minor.
// Mostly legato lead phrases (curves) with two short bell passages (straight notes).
export const meta = {
  id: 'neon-lullaby',
  title: 'Neon Lullaby',
  subtitle: 'Slow cyber ballad',
  bpm: 84,
  bars: 12,
  previewStart: 5.7,
  palette: { bg1: '#0b0820', bg2: '#1c1340', lane: '#8fb8ff', accent: '#c7a6ff', straight: '#9be7ff', curve: '#d9a6ff', glow: '#b48cff' },
};

const AM = [57, 60, 64], F = [53, 57, 60], C = [52, 55, 60], G = [50, 55, 59];
const PROG = [AM, F, C, G, AM, F, C, G, F, G, AM, AM];
const ROOT = [45, 41, 48, 43, 45, 41, 48, 43, 41, 43, 45, 45];

export function compose(c) {
  const pad = { shape: 'saw', voices: 3, detune: 0.012, cutoff: 900, res: 0.6, a: 0.6, d: 0.5, s: 0.8, r: 1.2 };
  const lead = { shape: 'saw', voices: 2, detune: 0.006, cutoff: 1800, envCut: 900, res: 1.2, a: 0.04, d: 0.3, s: 0.75, r: 0.35, vibrato: 0.006 };
  const pluck = { shape: 'square', cutoff: 900, envCut: 2400, a: 0.002, d: 0.18, s: 0, r: 0.2 };
  const bass = { shape: 'tri', sub: 0.4, cutoff: 600, a: 0.01, d: 0.4, s: 0.7, r: 0.3 };

  PROG.forEach((chord, bar) => {
    c.play(bar, 0, 4, chord, pad, { gain: 0.16, verb: 0.6 });
    if (bar >= 2) {
      c.play(bar, 0, 2.5, ROOT[bar], bass, { gain: 0.42 });
      c.play(bar, 2.5, 1.5, ROOT[bar], bass, { gain: 0.32 });
      // soft background arpeggio (not charted)
      [0, 1, 2, 1, 0, 1, 2, 1].forEach((k, i) => c.play(bar, i * 0.5, 0.4, chord[k] + 12, pluck, { gain: 0.06, echo: 0.4, verb: 0.3 }));
    }
    if (bar >= 2 && bar < 11) {
      c.drums.kick(bar, 0, { gain: 0.7, duck: 0.25 });
      c.drums.kick(bar, 2.5, { gain: 0.55, duck: 0.2 });
      for (let b = 0; b < 4; b += 0.5) c.drums.hat(bar, b, { gain: b % 1 ? 0.07 : 0.11 });
    }
    if (bar >= 4 && bar < 11) { c.drums.snare(bar, 1, { gain: 0.25, verb: 0.5 }); c.drums.snare(bar, 3, { gain: 0.25, verb: 0.5 }); }
  });
  c.play(11, 0, 6, [...AM, 69], pad, { gain: 0.18, verb: 0.8 });

  // bell passages -> straight notes
  c.melody('tap', [
    [0, 0, 1, 76], [0, 1, 1, 72], [0, 2, 0.5, 74], [0, 2.5, 0.5, 76], [0, 3, 1, 79],
    [1, 0, 1, 77], [1, 1, 1, 76], [1, 2, 1, 72], [1, 3, 0.5, 69], [1, 3.5, 0.5, 72],
    [6, 0, 0.5, 79], [6, 0.5, 0.5, 76], [6, 1, 1, 74], [6, 2, 1, 76], [6, 3, 0.5, 72], [6, 3.5, 0.5, 74],
    [7, 0, 1, 74], [7, 1, 0.5, 79], [7, 1.5, 0.5, 81], [7, 2, 1, 79], [7, 3, 1, 76],
  ], 'bell', { gain: 0.32, verb: 0.5, echo: 0.25 });

  // legato lead -> curves
  c.melody('flow', [
    [2, 0, 1.5, 72], [2, 1.5, 0.5, 74], [2, 2, 2, 76],
    [3, 0, 1, 74], [3, 1, 1, 71], [3, 2, 2, 67],
    [4, 0, 1.5, 69], [4, 1.5, 0.5, 72], [4, 2, 1, 76], [4, 3, 1, 79],
    [5, 0, 2, 77], [5, 2, 1, 76],
  ], lead, { gain: 0.26, verb: 0.45, echo: 0.2 });
  c.melody('flow', [
    [8, 0, 1, 81], [8, 1, 1, 79], [8, 2, 1.5, 77], [8, 3.5, 0.5, 76],
    [9, 0, 1, 74], [9, 1, 1, 76], [9, 2, 2, 79],
    [10, 0, 1, 76], [10, 1, 1, 72], [10, 2, 2, 69],
  ], lead, { gain: 0.26, verb: 0.45, echo: 0.2 });
}
