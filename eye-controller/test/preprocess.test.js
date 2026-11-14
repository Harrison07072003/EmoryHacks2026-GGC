import { describe, expect, it } from 'vitest';
import { RoiFollower, applyLut, autoTone, composeLuts, equalizeLut, estimateExposure, isIdentity, lumaHistogram, manualRoi, remapHistogram, toneLut } from '../src/capture/preprocess.js';
import { rng } from '../src/util/math.js';

/** Grey image with luma spread uniformly over [lo, hi]. */
function image(lo, hi, n = 4000) {
  const r = rng(1), data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const v = lo + r() * (hi - lo); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return data;
}
const exposureAfter = (data, lut) => estimateExposure(lumaHistogram(applyLut(data.slice(), lut)));

describe('tone curve', () => {
  it('default settings are the identity', () => expect(isIdentity(toneLut())).toBe(true));
  it('gamma above 1 lifts shadows, keeps black and white', () => {
    const lut = toneLut({ gamma: 2 });
    expect(lut[0]).toBe(0); expect(lut[255]).toBe(255); expect(lut[64]).toBeGreaterThan(110);
  });
  it('contrast pivots on mid grey, brightness shifts, values clamp', () => {
    const c = toneLut({ contrast: 2 });
    expect(c[128]).toBeCloseTo(128, -1); expect(c[200]).toBe(255); expect(c[40]).toBe(0);
    expect(toneLut({ brightness: 0.2 })[100]).toBe(151);
  });
  it('composes in order and leaves alpha alone', () => {
    const lut = composeLuts(toneLut({ gamma: 2 }), toneLut({ brightness: -0.1 }));
    expect(lut[64]).toBe(toneLut({ brightness: -0.1 })[toneLut({ gamma: 2 })[64]]);
    expect(applyLut(Uint8ClampedArray.of(10, 20, 30, 77), lut)[3]).toBe(77);
  });
});

describe('exposure and auto adjust', () => {
  it('measures mean, percentiles and clipping', () => {
    const e = estimateExposure(lumaHistogram(image(100, 200)));
    expect(e.mean).toBeGreaterThan(145); expect(e.mean).toBeLessThan(155);
    expect(e.p5).toBeLessThan(110); expect(e.p95).toBeGreaterThan(190);
    expect(estimateExposure(lumaHistogram(image(250, 255))).clipped).toBeGreaterThan(0.9);
    expect(estimateExposure(lumaHistogram(image(0, 20))).dark).toBeGreaterThan(0.9);
  });
  it('leaves a well-exposed image alone', () => {
    expect(isIdentity(toneLut(autoTone(lumaHistogram(image(40, 200)))))).toBe(true);
  });
  it('brightens a dark image toward mid grey', () => {
    const dark = image(10, 70), tone = autoTone(lumaHistogram(dark));
    expect(tone.gamma).toBeGreaterThan(1.3);
    const after = exposureAfter(dark, toneLut(tone));
    expect(after.mean).toBeGreaterThan(90); expect(after.mean).toBeLessThan(150);
  });
  it('darkens an overexposed image', () => {
    const hot = image(170, 250), tone = autoTone(lumaHistogram(hot));
    expect(tone.gamma).toBeLessThan(0.9);
    const after = exposureAfter(hot, toneLut(tone));
    expect(after.mean).toBeLessThan(185);
    expect(after.clipped).toBeLessThan(0.02);
  });
  it('eases toward the new setting instead of jumping', () => {
    const e = lumaHistogram(image(10, 70));
    const step = autoTone(e, { brightness: 0, contrast: 1, gamma: 1 });
    expect(step.gamma).toBeGreaterThan(1); expect(step.gamma).toBeLessThan(autoTone(e).gamma);
  });
});

describe('histogram equalization', () => {
  it('stretches a low-contrast image across the range', () => {
    const flat = image(90, 130), hist = lumaHistogram(flat);
    const after = exposureAfter(flat, equalizeLut(hist, 1));
    expect(after.p95 - after.p5).toBeGreaterThan(200);
  });
  it('strength 0 is the identity, and half strength is in between', () => {
    const hist = lumaHistogram(image(90, 130));
    expect(isIdentity(equalizeLut(hist, 0))).toBe(true);
    const half = exposureAfter(image(90, 130), equalizeLut(hist, 0.5));
    expect(half.p95 - half.p5).toBeGreaterThan(60); expect(half.p95 - half.p5).toBeLessThan(200);
  });
  it('remapHistogram predicts the histogram after a LUT', () => {
    const data = image(20, 120), lut = toneLut({ gamma: 1.7 });
    expect(Array.from(remapHistogram(lumaHistogram(data), lut))).toEqual(Array.from(lumaHistogram(applyLut(data.slice(), lut))));
  });
});

describe('virtual crop / pan', () => {
  it('manual zoom and pan stay inside the frame', () => {
    expect(manualRoi()).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const r = manualRoi({ zoom: 2, panX: 1, panY: -1 });
    expect(r).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(manualRoi({ zoom: 9, panX: 5 }).x + manualRoi({ zoom: 9, panX: 5 }).w).toBeLessThanOrEqual(1);
  });
  it('re-centres an off-centre face and then holds still', () => {
    const f = new RoiFollower(), face = { x: 0.62, y: 0.2, w: 0.2, h: 0.3 };
    let roi;
    for (let i = 0; i < 60; i++) roi = { ...f.update(face) };
    expect(roi.x + roi.w / 2).toBeCloseTo(0.72, 1);
    expect(roi.w).toBeCloseTo(0.5, 1);
    const nudged = { ...f.update({ ...face, x: 0.63 }) }; // small sway: no movement
    expect(nudged).toEqual(roi);
    expect(roi.x + roi.w).toBeLessThanOrEqual(1.0001);
  });
});
