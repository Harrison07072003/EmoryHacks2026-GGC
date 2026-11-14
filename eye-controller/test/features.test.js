import { describe, expect, it } from 'vitest';
import { CROP, EYE_IDS, FEATURE_COUNT, IDX, SD_FLOOR, assembleFeatures, cropToEye, eyeGeometry, headFeatures, penalties, pupilFeature } from '../src/cv/features.js';

/** Landmarks for one eye: corners 100 px apart at `angle`, iris at (along, across) eye-widths from the first corner. */
function eyeLandmarks({ angle = 0, along = 0.5, across = 0, vw = 1280, vh = 720, open = 0.3 }) {
  const ids = EYE_IDS.R, L = [], c = Math.cos(angle), s = Math.sin(angle), len = 100, ax = 600, ay = 300;
  const at = (u, v) => ({ x: (ax + len * (u * c - v * s)) / vw, y: (ay + len * (u * s + v * c)) / vh });
  L[ids.a] = at(0, 0); L[ids.b] = at(1, 0); L[ids.iris] = at(along, across);
  L[ids.up] = at(0.5, -open / 2); L[ids.lo] = at(0.5, open / 2);
  return { L, ids, vw, vh };
}
const geo = o => { const e = eyeLandmarks(o); return eyeGeometry(e.L, e.ids, e.vw, e.vh); };

describe('eye geometry', () => {
  it('measures iris position in eye-width units', () => {
    const g = geo({ along: 0.6, across: 0.05 });
    expect(g.u).toBeCloseTo(0.6, 5); expect(g.v).toBeCloseTo(0.05, 5); expect(g.open).toBeCloseTo(0.3, 5);
    expect(g.len).toBeCloseTo(100, 5);
  });
  it('u is unchanged by head roll', () => {
    expect(geo({ along: 0.42, angle: 0.3 }).u).toBeCloseTo(geo({ along: 0.42 }).u, 5);
  });
  it('places the iris correctly inside the eye-aligned crop, at any roll', () => {
    for (const angle of [0, 0.3, -0.2]) {
      const g = geo({ along: 0.6, across: 0.05, angle });
      expect(g.cu).toBeCloseTo(0.5 + 0.1 / CROP.span, 5);
      expect(g.cv).toBeCloseTo(0.5 + (0.05 * CROP.w) / (CROP.span * CROP.h), 5);
    }
  });
  it('pupil feature equals the iris when the pupil finder is not trusted, and never jumps', () => {
    const g = geo({ along: 0.6, across: 0.05 }), pupil = { u: g.cu + 0.05, v: g.cv };
    const iris = pupilFeature(g, pupil, 0), mid = pupilFeature(g, pupil, 0.5), full = pupilFeature(g, pupil, 1);
    expect(iris.pu).toBeCloseTo(0.6, 5); expect(iris.pv).toBeCloseTo(0.05, 5);
    expect(mid.pu).toBeCloseTo((iris.pu + full.pu) / 2, 9);
    expect(full).toEqual(cropToEye(pupil.u, pupil.v));
  });
});

describe('feature vector', () => {
  const R = { u: 0.6, v: 0.1, pu: 0.7, pv: 0.2 }, L = { u: 0.4, v: -0.1, pu: 0.3, pv: -0.2 };
  it('has the documented layout', () => {
    const f = assembleFeatures(R, L, [1, 2, 3, 4, 5]);
    expect(f).toHaveLength(FEATURE_COUNT);
    expect(f.slice(0, 13)).toEqual([0.6, 0.1, 0.7, 0.2, 0.4, -0.1, 0.3, -0.2, 1, 2, 3, 4, 5]);
    expect(f[13]).toBeCloseTo(0.04, 9); expect(f[14]).toBeCloseTo(0.04, 9); expect(f[15]).toBeCloseTo(0.04, 9);
    expect(f[18]).toBeCloseTo(0.04, 9);
  });
  it('single-eye models never read the other eye', () => {
    expect(IDX.R.some(i => (i >= 4 && i <= 7) || i >= 16)).toBe(false);
    expect(IDX.L.some(i => i <= 3 || (i >= 13 && i <= 15))).toBe(false);
    expect(SD_FLOOR).toHaveLength(FEATURE_COUNT);
    expect(penalties(6).slice(8, 13)).toEqual([6, 6, 6, 6, 6]);
  });
  it('reads head rotation from the face matrix and position from landmarks', () => {
    const L = []; L[1] = { x: 0.5, y: 0.5 }; L[234] = { x: 0.4, y: 0.5 }; L[454] = { x: 0.7, y: 0.5 }; L[10] = { x: 0.55, y: 0.3 }; L[152] = { x: 0.55, y: 0.7 };
    const m = new Array(16).fill(0); m[8] = Math.sin(0.2); m[10] = Math.cos(0.2);
    const h = headFeatures(L, m);
    expect(h[0]).toBeCloseTo(0.2, 6); expect(h[1]).toBeCloseTo(0, 6);
    expect(h.slice(2)).toEqual([0.55, 0.5, expect.closeTo(0.3, 6)]);
    expect(headFeatures(L, null)[0]).toBeCloseTo(-0.05 / 0.3, 6); // fallback: nose offset
  });
});
