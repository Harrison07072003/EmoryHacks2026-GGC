import { describe, expect, it } from 'vitest';
import { createGeometry } from '../src/render/geometry.js';
import { LAYOUT } from '../src/config/game-config.js';
import { laneCenter } from '../src/gameplay/zones.js';

describe('highway geometry', () => {
  const g = createGeometry(1.9);

  it('a straight note sits on the upper line, in its own gaze column, exactly at its time', () => {
    for (let lane = 0; lane < 4; lane++) {
      const p = g.straight(10, 10, laneCenter(lane));
      expect(p.y).toBeCloseTo(LAYOUT.upperLineY);
      expect(p.x).toBeCloseTo(laneCenter(lane));
      expect(Math.floor(p.x * 4)).toBe(lane);
    }
  });

  it('a curve point sits on the lower line at its time, at the x to look at', () => {
    const p = g.curve(10, 10, 0.31);
    expect(p.y).toBeCloseTo(LAYOUT.lowerLineY);
    expect(p.x).toBeCloseTo(0.31);
  });

  it('notes start near the horizon and move monotonically down', () => {
    let lastY = -1;
    for (let now = 10 - g.lookAheadSec; now <= 10.5; now += 0.05) {
      const y = g.curve(10, now, 0.5).y;
      expect(y).toBeGreaterThan(lastY);
      lastY = y;
    }
    expect(g.straight(10, 10 - 1.9, 0.5).y).toBeCloseTo(LAYOUT.horizonY + (LAYOUT.upperLineY - LAYOUT.horizonY) * LAYOUT.horizonWidth);
  });

  it('speed is continuous across the upper line (no visual jump)', () => {
    const eps = 1e-3;
    const above = (g.project(eps).y - g.project(2 * eps).y) / eps;
    const below = (g.project(-2 * eps).y - g.project(-eps).y) / eps;
    expect(below / above).toBeCloseTo(1, 1);
  });
});
