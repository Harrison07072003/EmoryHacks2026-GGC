import { describe, expect, it } from 'vitest';
import { cellScores } from '../src/ui/score-reveal.js';

describe('per-cell calibration scores', () => {
  it('averages kept dots per cell, ignores dropped and play-like points, marks weak cells', () => {
    const result = {
      points: [
        { target: { x: 0.125, y: 0.25 }, score: 90, kept: true },
        { target: { x: 0.04, y: 0.04 }, score: 70, kept: true },       // corner: same cell (lane 0, top)
        { target: { x: 0.125, y: 0.25 }, score: 10, kept: false },     // dropped
        { target: { x: 0.875, y: 0.75 }, score: 40, kept: true },
        { target: { x: 0.375, y: 0.5 }, score: 99, kept: true },       // on the band border: no cell
        { kind: 'hop', target: { x: 0.625, y: 0.25 }, score: null, kept: true },
      ],
      weakCells: [{ lane: 3, band: 'bottom' }],
    };
    const cells = cellScores(result);
    expect(cells).toHaveLength(8);
    expect(cells.find(c => c.lane === 0 && c.band === 'top')).toMatchObject({ score: 80, weak: false });
    expect(cells.find(c => c.lane === 3 && c.band === 'bottom')).toMatchObject({ score: 40, weak: true });
    expect(cells.find(c => c.lane === 2 && c.band === 'top').score).toBeNull();
  });
});
