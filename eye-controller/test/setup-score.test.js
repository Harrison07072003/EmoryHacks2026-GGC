import { describe, expect, it } from 'vitest';
import { measureSetup, rangeAdvice, rangeFromHolds, setupChecks, setupScore } from '../src/setup/setup-score.js';
import { createSimEye } from '../src/simulator/sim-eye.js';

const eye = (lum = 66, glare = 0.002) => ({ open: 0.3, glare, conf: 0.2, lum });
const frame = ({ w = 0.25, cx = 0.5, cy = 0.6, pitch = -0.03, yaw = 0.02, lum = 66 } = {}) => ({
  face: true, box: { x: cx - w / 2, y: cy - 0.15, w, h: 0.3 }, head: [yaw, pitch, 0.5, 0.5, w], eyes: { R: eye(lum), L: eye(lum) },
});
const status = (g, id) => setupChecks(g).find(c => c.id === id)?.status;

describe('setup checks (thresholds from recorded clips)', () => {
  it('a round-3 style seat is good', () => {
    expect(setupChecks(measureSetup(frame())).every(c => c.status === 'good')).toBe(true);
  });
  it('the "far" clips (face 13% of the image) say sit closer', () => {
    const c = setupChecks(measureSetup(frame({ w: 0.13 }))).find(x => x.id === 'distance');
    expect(c.status).toBe('bad');
    expect(c.advice).toMatch(/closer/);
  });
  it('the backlit clips (face low in the image) say tilt the screen', () => {
    expect(status(measureSetup(frame({ cy: 0.84 })), 'camera')).toBe('bad');
    expect(setupChecks(measureSetup(frame({ cy: 0.84 }))).find(x => x.id === 'camera').advice).toMatch(/tilt the screen forward/);
  });
  it('glare on glasses is flagged and costs score', () => {
    const glary = measureSetup({ ...frame(), eyes: { R: eye(66, 0.05), L: eye(66, 0.002) } });
    expect(setupChecks(glary).find(c => c.id === 'glare')).toMatchObject({ status: 'bad' });
    expect(setupScore(setupChecks(glary), null)).toBeLessThan(setupScore(setupChecks(measureSetup(frame())), null));
  });
  it("looking up at the screen (Harrison's clips) is flagged", () => {
    expect(setupChecks(measureSetup(frame({ pitch: 0.17 }))).find(x => x.id === 'head').advice).toMatch(/eye level/);
  });
  it('measures eye width in pixels from the eye-corner landmarks', () => {
    const L = []; L[33] = { x: 0.40, y: 0.4 }; L[133] = { x: 0.45, y: 0.4 }; L[362] = { x: 0.55, y: 0.4 }; L[263] = { x: 0.60, y: 0.4 };
    expect(measureSetup(frame(), L, { width: 1280, height: 720 }).eyePx).toBeCloseTo(64, 5);
    expect(measureSetup({ face: false })).toBeNull();
    expect(setupChecks(null)[0].status).toBe('bad');
  });
});

describe('range test', () => {
  const targets = [{ x: 0.06, y: 0.5 }, { x: 0.94, y: 0.5 }, { x: 0.5, y: 0.08 }, { x: 0.5, y: 0.92 }];
  const holds = (gain = 1) => {
    const sim = createSimEye({ seed: 2, noise: 'realistic' });
    return targets.map((target, i) => ({ target, samples: Array.from({ length: 20 }, (_, k) => sim(i * 2000 + k * 33, { x: 0.5 + (target.x - 0.5) * gain, y: 0.5 + (target.y - 0.5) * gain }).f) }));
  };
  it('a full eye swing scores high, a small one low, and the score drives the advice', () => {
    const big = rangeFromHolds(holds(1)), small = rangeFromHolds(holds(0.35));
    expect(big.h).toBeGreaterThan(0.15);
    expect(small.h).toBeLessThan(big.h * 0.5);
    const checks = setupChecks(measureSetup(frame()));
    expect(setupScore(checks, big)).toBeGreaterThan(setupScore(checks, small) + 30);
    expect(rangeAdvice(small).join(' ')).toMatch(/Sit closer/);
    expect(rangeAdvice(big).some(a => /across the screen/.test(a))).toBe(false);
  });
  it('without a range test the score comes from the checks alone', () => {
    expect(setupScore(setupChecks(measureSetup(frame())), null)).toBe(60);
    expect(rangeFromHolds([]).h).toBeNull();
  });
});
