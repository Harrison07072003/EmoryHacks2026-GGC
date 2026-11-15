import { describe, expect, it } from 'vitest';
import { createJudge } from '../src/gameplay/judge.js';
import { parseChart, pathX } from '../src/gameplay/chart.js';
import { MODES, LAYOUT } from '../src/config/game-config.js';
import { laneCenter } from '../src/gameplay/zones.js';

const FPS = 60;
const top = lane => ({ x: laneCenter(lane), y: 0.3, valid: true });

/** Run the judge from t0 to t1 at 60 fps with gaze = gazeAt(t); return all judgments. */
function run(chart, mode, gazeAt, t0 = 0, t1 = chart.duration + 1) {
  const judge = createJudge(chart, mode), out = [];
  for (let t = t0; t <= t1; t += 1 / FPS) out.push(...judge.update(t, gazeAt(t)));
  return { out, judge };
}
const straight = notes => parseChart({ format: 1, notes: notes.map(([t, lane]) => ({ type: 'straight', t, lane })) });

describe('straight notes', () => {
  const mode = MODES.normal;

  it('holding the gaze on one column hits every consecutive note there as Perfect', () => {
    const chart = straight([[1, 2], [1.25, 2], [1.5, 2], [1.75, 2]]);
    const { out } = run(chart, mode, () => top(2));
    expect(out.map(j => j.judgment)).toEqual(['perfect', 'perfect', 'perfect', 'perfect']);
    // each resolves as it reaches the line, not all at once
    out.forEach((j, i) => expect(j.t).toBeGreaterThanOrEqual(chart.notes[i].t - 1e-9));
  });

  it('wrong column is a Miss, decided after the good window', () => {
    const { out } = run(straight([[1, 0]]), mode, () => top(3));
    expect(out).toHaveLength(1);
    expect(out[0].judgment).toBe('miss');
    expect(out[0].t).toBeGreaterThan(1 + mode.windows.good);
  });

  it('arriving late but inside the good window is Good', () => {
    const late = 1 + (mode.windows.perfect + mode.windows.good) / 2;
    const { out } = run(straight([[1, 1]]), mode, t => (t >= late ? top(1) : top(3)));
    expect(out[0].judgment).toBe('good');
  });

  it('arriving after the good window is a Miss', () => {
    const { out } = run(straight([[1, 1]]), mode, t => (t >= 1 + mode.windows.good + 0.05 ? top(1) : top(3)));
    expect(out[0].judgment).toBe('miss');
  });

  it('jumping between columns hits alternating notes', () => {
    const chart = straight([[1, 0], [1.8, 3], [2.6, 0], [3.4, 3]]);
    const lanes = [0, 3, 0, 3];
    const { out } = run(chart, mode, t => top(lanes[Math.min(3, Math.max(0, Math.floor((t - 0.6) / 0.8)))]));
    expect(out.map(j => j.judgment)).toEqual(['perfect', 'perfect', 'perfect', 'perfect']);
  });

  it('a passing glance shorter than minDwellMs does not count', () => {
    const glance = t => (t > 0.98 && t < 0.98 + mode.minDwellMs / 2000 ? top(1) : top(3));
    const { out } = run(straight([[1, 1]]), mode, glance);
    expect(out[0].judgment).toBe('miss');
  });

  it('the bottom band does not count for straight notes', () => {
    const { out } = run(straight([[1, 1]]), mode, () => ({ x: laneCenter(1), y: 0.85, valid: true }));
    expect(out[0].judgment).toBe('miss');
  });

  it('no face (invalid gaze) misses', () => {
    const { out } = run(straight([[1, 1]]), mode, () => ({ x: laneCenter(1), y: 0.3, valid: false }));
    expect(out[0].judgment).toBe('miss');
  });

  it('every note is judged exactly once', () => {
    const chart = straight(Array.from({ length: 40 }, (_, i) => [1 + i * 0.3, i % 4]));
    const { out, judge } = run(chart, mode, t => top(Math.floor(t * 3) % 4));
    expect(out).toHaveLength(40);
    expect(new Set(out.map(j => j.note.id)).size).toBe(40);
    expect(judge.isDone()).toBe(true);
  });
});

describe('curved notes', () => {
  const mode = MODES.normal;
  const chart = parseChart({ format: 1, notes: [{ type: 'curve', t: 1, end: 4, path: [{ t: 1, x: 0.2 }, { t: 2.5, x: 0.8 }, { t: 4, x: 0.3 }] }] });
  const path = chart.notes[0].path;
  const follow = (lagSec = 0.1, noise = 0) => t => ({ x: pathX(path, t - lagSec) + noise * Math.sin(t * 37), y: LAYOUT.lowerLineY, valid: true });

  it('following the path (with a human lag) is Perfect on every segment', () => {
    const { out } = run(chart, mode, follow(0.1));
    expect(out).toHaveLength(3);
    expect(out.every(j => j.judgment === 'perfect')).toBe(true);
  });

  it('staring at one spot misses most segments', () => {
    const { out } = run(chart, mode, () => ({ x: 0.5, y: LAYOUT.lowerLineY, valid: true }));
    expect(out.filter(j => j.judgment === 'miss').length).toBeGreaterThanOrEqual(2);
  });

  it('following in the wrong band does not count', () => {
    const { out } = run(chart, mode, t => ({ x: pathX(path, t), y: 0.2, valid: true }));
    expect(out.every(j => j.judgment === 'miss')).toBe(true);
  });

  it('losing the path halfway gives a worse judgment for that segment only', () => {
    const { out } = run(chart, mode, t => (t > 2.5 && t < 3 ? { x: 0.05, y: 0.8, valid: true } : follow(0.05)(t)));
    expect(out[0].judgment).toBe('perfect');
    expect(out[1].judgment).not.toBe('perfect');
    expect(out[2].judgment).toBe('perfect');
  });

  it('noisy but close tracking still scores', () => {
    const { out } = run(chart, mode, follow(0.1, 0.05));
    expect(out.every(j => j.judgment !== 'miss')).toBe(true);
  });
});
