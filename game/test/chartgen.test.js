import { describe, expect, it } from 'vitest';
import { beatGrid, gridAccent, snapToGrid } from '../src/services/chartgen/events.js';
import { DIFFICULTIES, GENERATOR_VERSION, generateCharts } from '../src/services/chartgen/generate.js';
import { MIN_MOVE_SEC, enforceRules, validateChart } from '../src/services/chartgen/validate.js';
import { settleStart } from '../src/services/chartgen/analyze.js';
import { fft } from '../src/services/chartgen/dsp.js';
import { parseChart } from '../src/gameplay/chart.js';

// ---- synthetic music with known answers ----
const RATE = 44100;
function synth({ bpm = 120, offset = 0.37, sec = 30, drumsUntil = 20, pad = true } = {}) {
  const x = new Float32Array(RATE * sec);
  const add = (t0, dur, f, amp, decay) => {
    for (let i = 0; i < dur * RATE; i++) { const j = Math.round(t0 * RATE) + i; if (j < x.length) x[j] += amp * Math.sin((2 * Math.PI * f * i) / RATE) * Math.exp((-decay * i) / RATE); }
  };
  const melody = [60, 64, 67, 72, 67, 64];
  for (let b = 0; offset + (b * 60) / bpm < drumsUntil; b++) {
    const t = offset + (b * 60) / bpm;
    add(t, 0.15, 55, 0.9, 30);                         // kick on every beat
    add(t + 30 / bpm, 0.05, 7000, 0.25, 80);           // hi-hat on the off-beats
    if (b % 2 === 0) add(t, 0.25, 440 * 2 ** ((melody[(b / 2) % 6] - 69) / 12), 0.4, 8);
  }
  if (pad) { add(drumsUntil + 0.5, sec - drumsUntil - 1, 330, 0.5, 0.05); add(drumsUntil + 0.5, sec - drumsUntil - 1, 495, 0.3, 0.05); }
  return x;
}
const gen = (opts, id = 'test') => generateCharts({ channels: [synth(opts)], sampleRate: RATE, songId: id });

describe('beat grid snapping', () => {
  const grid = beatGrid([1, 1.5, 2, 2.5]);
  it('makes quarter-beat (1/16 note) grid points', () => {
    expect(grid.slice(0, 5).map(g => [g.t, g.sub])).toEqual([[1, 0], [1.125, 1], [1.25, 2], [1.375, 3], [1.5, 0]]);
    expect(grid.at(-1).t).toBeCloseTo(2.875);   // the last beat extends by the previous interval
  });
  it('snaps to the nearest point within the tolerance, else drops', () => {
    expect(snapToGrid(grid, 1.26)).toMatchObject({ t: 1.25, sub: 2 });
    expect(snapToGrid(grid, 1.49)).toMatchObject({ t: 1.5, sub: 0, beatIndex: 1 });
    expect(snapToGrid(grid, 0.5)).toBeNull();
    expect(snapToGrid(grid, 1.06, 0.03)).toBeNull();
  });
  it('accents: bar downbeat 1, beat 2, eighth 3, sixteenth 4 (practice keeps 1-2, normal 1-3, hard 1-4)', () => {
    expect(gridAccent({ beatIndex: 4, sub: 0 })).toBe(1);
    expect(gridAccent({ beatIndex: 5, sub: 0 })).toBe(2);
    expect(gridAccent({ beatIndex: 5, sub: 2 })).toBe(3);
    expect(gridAccent({ beatIndex: 5, sub: 1 })).toBe(4);
    expect(gridAccent({ beatIndex: 5, sub: 0 }, 1)).toBe(1);   // bar phase shifted by one beat
  });
  it('settles the unsettled first tracked beats by extrapolating from the first aligned run', () => {
    const onsets = [0.5, 1, 1.5, 2, 2.5].map(t => ({ t, strength: 0.9 }));
    const beats = settleStart([0.2, 0.75, 1, 1.5, 2, 2.5], onsets, 0.5);
    expect(beats.map(b => Math.round(b * 100) / 100)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });
  it('FFT finds a pure tone', () => {
    const n = 64, re = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 5 * i) / n)), im = new Float32Array(n);
    fft(re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(5);
  });
});

describe('chart generator on synthetic music', () => {
  const result = gen();

  it('estimates tempo and offset', () => {
    expect(Math.abs(result.meta.bpm - 120)).toBeLessThan(1.5);
    expect(Math.abs(result.meta.offset - 0.37)).toBeLessThan(0.035);
    expect(result.meta.generatorVersion).toBe(GENERATOR_VERSION);
    expect(result.meta.difficulty).toBeGreaterThanOrEqual(1);
    expect(result.meta.difficulty).toBeLessThanOrEqual(5);
  });

  for (const tempo of [90, 140]) {
    it(`tracks ${tempo} BPM too`, () => {
      expect(Math.abs(gen({ bpm: tempo, pad: false, drumsUntil: 30 }).meta.bpm - tempo)).toBeLessThan(tempo * 0.02);
    });
  }

  it('keeps the tempo inside 70-180 BPM even for very slow or very fast music', () => {
    for (const tempo of [50, 200]) {
      const bpm = gen({ bpm: tempo, pad: false, drumsUntil: 30 }).meta.bpm;
      expect(bpm).toBeGreaterThanOrEqual(70);
      expect(bpm).toBeLessThanOrEqual(180);
    }
  });

  it('produces valid charts in the existing format for every difficulty', () => {
    for (const d of DIFFICULTIES) {
      const chart = result.charts[d];
      expect(chart).toMatchObject({ format: 1, song: 'test', difficulty: d });
      expect(() => parseChart(chart)).not.toThrow();
      expect(validateChart(chart, { durationSec: 30 })).toEqual([]);
      expect(chart.notes.every(n => (n.end ?? n.t) <= 29)).toBe(true);   // nothing in the fade-out
    }
  });

  it('puts notes on the beat grid', () => {
    const beatAt = t => ((t - 0.37) / 0.5) * 4;   // in 1/16 steps
    const straight = result.charts.normal.notes.filter(n => n.type === 'straight' && n.t < 20);
    expect(straight.length).toBeGreaterThan(10);
    for (const n of straight) expect(Math.abs(beatAt(n.t) - Math.round(beatAt(n.t)))).toBeLessThan(0.35);
  });

  it('scales density with difficulty and uses several columns', () => {
    const count = d => result.charts[d].notes.length;
    expect(count('practice')).toBeLessThan(count('normal'));
    expect(count('normal')).toBeLessThanOrEqual(count('hard'));
    const lanes = new Set(result.charts.hard.notes.filter(n => n.type === 'straight').map(n => n.lane));
    expect(lanes.size).toBeGreaterThanOrEqual(3);
  });

  it('turns the sustained pad into curves of at most 5 s', () => {
    const curves = result.charts.normal.notes.filter(n => n.type === 'curve');
    expect(curves.length).toBeGreaterThan(0);
    expect(curves.every(c => c.t >= 19 && c.end - c.t <= 5.5)).toBe(true);
  });

  it('is deterministic: the same audio always gives the same charts', () => {
    expect(JSON.stringify(gen().charts)).toBe(JSON.stringify(result.charts));
  });

  it('only uses the first 30 s and refuses audio that is too short', () => {
    const long = generateCharts({ channels: [synth({ sec: 45, drumsUntil: 44, pad: false })], sampleRate: RATE, songId: 'x' });
    expect(long.meta.levelSec).toBeLessThanOrEqual(30);
    expect(() => generateCharts({ channels: [new Float32Array(RATE * 5)], sampleRate: RATE, songId: 'x' })).toThrow(/too short/);
  });

  it('still makes a playable chart from near-silence (beat-grid fallback, never crashes)', () => {
    const quiet = synth({ drumsUntil: 0, pad: true });
    const r = generateCharts({ channels: [quiet], sampleRate: RATE, songId: 'q' });
    for (const d of DIFFICULTIES) expect(validateChart(r.charts[d], { durationSec: 30 })).toEqual([]);
  });
});

describe('chart rules', () => {
  const chart = { format: 1, song: 's', difficulty: 'normal', notes: [
    { type: 'straight', t: 2, lane: 0 }, { type: 'straight', t: 2.1, lane: 3 },   // jump too fast
    { type: 'straight', t: 3, lane: 1 },
    { type: 'curve', t: 4, end: 6, path: [{ t: 4, x: 0.3 }, { t: 6, x: 0.7 }] }, { type: 'straight', t: 5, lane: 2 },   // inside a curve
    { type: 'straight', t: 31, lane: 1 },   // after the audio
  ] };
  it('validateChart reports the same problems as npm run check-charts', () => {
    const problems = validateChart(chart, { durationSec: 30 });
    expect(problems.some(p => /past the audio/.test(p))).toBe(true);
    expect(problems.some(p => /overlaps a curve/.test(p))).toBe(true);
    expect(problems.some(p => /column jump/.test(p))).toBe(true);
    expect(validateChart({ format: 2, notes: [] })).toEqual(['Not a format-1 chart']);
  });
  it('enforceRules repairs a chart so it validates', () => {
    const fixed = enforceRules(chart, { durationSec: 30 });
    expect(validateChart(fixed, { durationSec: 30 })).toEqual([]);
    expect(fixed.notes.map(n => n.t)).toEqual([2, 3, 4]);
  });
  it('uses the same eye-movement limits as tools/check-charts.mjs', () => {
    expect(MIN_MOVE_SEC).toEqual({ practice: 0.7, normal: 0.35, hard: 0.24 });
  });
});
