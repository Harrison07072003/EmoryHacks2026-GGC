import { describe, expect, it } from 'vitest';
import { OneEuro } from '../src/smoothing/one-euro.js';
import { MedianFilter } from '../src/smoothing/median.js';
import { FixationLock } from '../src/smoothing/fixation-lock.js';
import { SaccadeDetector } from '../src/smoothing/saccade.js';
import { GazeSmoother } from '../src/smoothing/gaze-smoother.js';
import { rng, std } from '../src/util/math.js';

const DT = 1000 / 30;

describe('One Euro filter', () => {
  it('passes a constant through', () => {
    const f = new OneEuro();
    for (let i = 0; i < 20; i++) expect(f.filter(0.4, i * DT)).toBeCloseTo(0.4, 9);
  });
  it('cuts jitter on a still signal', () => {
    const f = new OneEuro(), r = rng(1), raw = [], out = [];
    for (let i = 0; i < 200; i++) { const v = 0.5 + r.gauss() * 0.01; raw.push(v); out.push(f.filter(v, i * DT)); }
    expect(std(out.slice(50))).toBeLessThan(std(raw.slice(50)) * 0.5);
  });
  it('keeps up with fast movement', () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i < 30; i++) out = f.filter(i * 0.03, i * DT); // ~0.9 screens per second
    expect(29 * 0.03 - out).toBeLessThan(0.04);
  });
  it('reset forgets the past', () => {
    const f = new OneEuro();
    f.filter(0, 0); f.filter(0, DT); f.reset();
    expect(f.filter(1, 2 * DT)).toBe(1);
  });
});

describe('median filter', () => {
  it('removes a one-frame spike', () => {
    const m = new MedianFilter(3);
    expect([0.5, 0.5, 9, 0.5, 0.5].map(v => m.push(v))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });
  it('lets a real step through after one frame', () => {
    const m = new MedianFilter(3);
    expect([0, 0, 1, 1].map(v => m.push(v))).toEqual([0, 0, 0, 1]);
  });
});

describe('steady-gaze lock', () => {
  it('locks onto the mean while fixating, releases on a move', () => {
    const lock = new FixationLock({ radius: 0.05, windowMs: 160 }), r = rng(2);
    let held = null;
    for (let i = 0; i < 10; i++) held = lock.push({ x: 0.3 + r.gauss() * 0.003, y: 0.6 + r.gauss() * 0.003 }, i * DT);
    expect(held.x).toBeCloseTo(0.3, 2);
    expect(held.y).toBeCloseTo(0.6, 2);
    expect(lock.push({ x: 0.7, y: 0.6 }, 10 * DT)).toBeNull();
  });
  it('holds through slightly bigger wobble once locked (hysteresis)', () => {
    const lock = new FixationLock({ radius: 0.05, windowMs: 160 });
    for (let i = 0; i < 6; i++) lock.push({ x: 0.5, y: 0.5 }, i * DT);
    expect(lock.push({ x: 0.56, y: 0.5 }, 6 * DT)).not.toBeNull(); // 0.06 > radius, < 1.6 * radius
  });
});

describe('saccade detector', () => {
  it('needs consecutive far frames', () => {
    const s = new SaccadeDetector({ distance: 0.12, confirmFrames: 2 }), at = { x: 0.2, y: 0.5 };
    expect(s.update({ x: 0.8, y: 0.5 }, at)).toBe('pending');
    expect(s.update({ x: 0.21, y: 0.5 }, at)).toBeNull();
    expect(s.update({ x: 0.8, y: 0.5 }, at)).toBe('pending');
    expect(s.update({ x: 0.8, y: 0.5 }, at)).toBe('snap');
  });
});

describe('full smoothing stack', () => {
  const run = (fn, n) => { const s = new GazeSmoother(), out = []; for (let i = 0; i < n; i++) out.push(s.push(fn(i), i * DT)); return out; };

  it('is rock steady during a noisy fixation', () => {
    const r = rng(3), out = run(() => ({ x: 0.4 + r.gauss() * 0.006, y: 0.7 + r.gauss() * 0.006 }), 90).slice(30);
    expect(out.every(p => p.fixed)).toBe(true);
    expect(std(out.map(p => p.x))).toBeLessThan(0.003);
  });
  it('snaps to a new lane within ~100 ms instead of gliding', () => {
    const out = run(i => ({ x: i < 30 ? 0.125 : 0.875, y: 0.25 }), 40);
    expect(out[29].x).toBeCloseTo(0.125, 2);
    expect(out[33].x).toBeGreaterThan(0.85);
    expect(out.slice(30, 34).some(p => p.snapped)).toBe(true);
    expect(out.every(p => p.x < 0.13 || p.x > 0.87)).toBe(true); // never passes through the lanes in between
  });
  it('ignores a single-frame glitch', () => {
    const out = run(i => ({ x: i === 40 ? 0.95 : 0.3, y: 0.5 }), 60);
    expect(Math.max(...out.slice(35).map(p => p.x))).toBeLessThan(0.31);
  });
  it('follows smooth pursuit with small lag', () => {
    const path = i => ({ x: 0.5 + 0.4 * Math.sin(i / 25), y: 0.75 }), out = run(path, 200);
    const lag = out.slice(50).map((p, k) => Math.abs(p.x - path(k + 50).x));
    expect(Math.max(...lag)).toBeLessThan(0.05);
  });
  it('stays inside the screen and survives NaN', () => {
    const s = new GazeSmoother();
    expect(s.push({ x: 1.4, y: -0.3 }, 0)).toMatchObject({ x: 1, y: 0 });
    expect(Number.isFinite(s.push({ x: NaN, y: 0.5 }, DT).x)).toBe(true);
  });
});
