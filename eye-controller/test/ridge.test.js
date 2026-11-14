import { describe, expect, it } from 'vitest';
import { addGram, addSample, cloneGram, createGram, gramFromJSON, gramToJSON, gramWeight, predict, scaleGram, solveRidge } from '../src/model/ridge.js';
import { rng } from '../src/util/math.js';

const truth = f => ({ x: 0.3 + 2 * f[0] - 1 * f[1], y: -0.1 + 0.5 * f[1] + 3 * f[2] });
function data(n, seed = 1, noise = 0) {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const f = [r(), r(), r()], t = truth(f);
    return { f, x: t.x + r.gauss() * noise, y: t.y + r.gauss() * noise };
  });
}
const gramOf = rows => rows.reduce((g, s) => addSample(g, s.f, s.x, s.y), createGram(3));

describe('ridge regression', () => {
  it('recovers a linear map, including the intercept', () => {
    const m = solveRidge(gramOf(data(200)), { lambda: 1e-9 });
    const p = predict(m, [0.2, 0.7, 0.4]), t = truth([0.2, 0.7, 0.4]);
    expect(p.x).toBeCloseTo(t.x, 6);
    expect(p.y).toBeCloseTo(t.y, 6);
    expect(m.bx).toBeCloseTo(0.3, 6);
  });

  it('shrinks weights as lambda grows', () => {
    const g = gramOf(data(50, 2, 0.05));
    const norm = m => Math.hypot(...m.wx);
    expect(norm(solveRidge(g, { lambda: 5 }))).toBeLessThan(norm(solveRidge(g, { lambda: 0.001 })));
  });

  it('penalizes chosen features harder', () => {
    const g = gramOf(data(50, 3, 0.05));
    const plain = solveRidge(g, { lambda: 0.1 }), pen = solveRidge(g, { lambda: 0.1, penalties: [1, 50, 1] });
    expect(Math.abs(pen.wx[1])).toBeLessThan(Math.abs(plain.wx[1]) * 0.5);
  });

  it('fits a feature subset and leaves the others at zero', () => {
    const m = solveRidge(gramOf(data(100)), { idx: [0, 2] });
    expect(m.wx[1]).toBe(0);
    expect(m.wy[1]).toBe(0);
  });

  it('floors the spread of a feature that never moved', () => {
    const rows = data(40, 4).map(s => ({ ...s, f: [s.f[0], s.f[1], 0.5 + s.f[2] * 1e-6] }));
    const m = solveRidge(gramOf(rows), { sdFloor: [0, 0, 0.05] });
    expect(Math.abs(m.wy[2])).toBeLessThan(5);
  });

  it('grams add, subtract, scale and survive JSON', () => {
    const a = data(30, 5), b = data(20, 6);
    const whole = gramOf([...a, ...b]), sum = addGram(gramOf(a), gramOf(b));
    sum.A.forEach((v, i) => expect(v).toBeCloseTo(whole.A[i], 9));
    const back = addGram(cloneGram(whole), gramOf(b), -1);
    expect(back.A[0]).toBeCloseTo(30, 9);
    expect(gramWeight(scaleGram(cloneGram(whole), 0.5))).toBeCloseTo(25, 9);
    expect(gramFromJSON(JSON.parse(JSON.stringify(gramToJSON(whole)))).bx[1]).toBeCloseTo(whole.bx[1], 12);
  });

  it('weights samples', () => {
    const g = createGram(1);
    addSample(g, [0], 0, 0, 1); addSample(g, [0], 1, 1, 3);
    expect(solveRidge(g).bx).toBeCloseTo(0.75, 6);
  });

  it('a prior gram warm-starts a fit that has too little data', () => {
    const prior = scaleGram(gramOf(data(500, 7)), 20 / 500);
    const few = data(3, 8, 0.02), probe = [0.9, 0.1, 0.8], t = truth(probe);
    const err = m => Math.abs(predict(m, probe).x - t.x) + Math.abs(predict(m, probe).y - t.y);
    const cold = solveRidge(gramOf(few)), warm = solveRidge(addGram(gramOf(few), prior));
    expect(err(warm)).toBeLessThan(err(cold) * 0.5);
  });
});
