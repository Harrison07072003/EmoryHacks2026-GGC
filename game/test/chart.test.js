import { describe, expect, it } from 'vitest';
import { curveSegments, judgmentCount, parseChart, pathX } from '../src/gameplay/chart.js';

const raw = {
  format: 1, song: 'x', difficulty: 'normal',
  notes: [
    { type: 'curve', t: 5, end: 8, path: [{ t: 5, x: 0.2 }, { t: 6.5, x: 0.8 }, { t: 8, x: 0.4 }] },
    { type: 'straight', t: 1, lane: 0 },
    { type: 'straight', t: 2, lane: 3 },
  ],
};

describe('parseChart', () => {
  it('sorts notes, gives ids and a duration', () => {
    const c = parseChart(raw);
    expect(c.notes.map(n => n.t)).toEqual([1, 2, 5]);
    expect(new Set(c.notes.map(n => n.id)).size).toBe(3);
    expect(c.duration).toBe(8);
  });
  it('rejects bad lanes, curves and formats', () => {
    expect(() => parseChart({ ...raw, format: 2 })).toThrow();
    expect(() => parseChart({ format: 1, notes: [{ type: 'straight', t: 1, lane: 4 }] })).toThrow();
    expect(() => parseChart({ format: 1, notes: [{ type: 'curve', t: 2, end: 1, path: [] }] })).toThrow();
  });
});

describe('pathX', () => {
  const path = raw.notes[0].path;
  it('passes through the control points and holds at the ends', () => {
    expect(pathX(path, 5)).toBeCloseTo(0.2);
    expect(pathX(path, 6.5)).toBeCloseTo(0.8);
    expect(pathX(path, 4)).toBeCloseTo(0.2);
    expect(pathX(path, 9)).toBeCloseTo(0.4);
  });
  it('is continuous', () => {
    for (let t = 5; t < 8; t += 0.01) expect(Math.abs(pathX(path, t + 0.01) - pathX(path, t))).toBeLessThan(0.02);
  });
});

describe('segments', () => {
  it('splits curves into about one-second segments and counts judgments', () => {
    expect(curveSegments({ t: 5, end: 8 }, 1)).toHaveLength(3);
    expect(curveSegments({ t: 5, end: 5.3 }, 1)).toHaveLength(1);
    expect(judgmentCount(parseChart(raw), 1)).toBe(5);
  });
});
