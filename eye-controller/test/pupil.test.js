import { describe, expect, it } from 'vitest';
import { findPupil } from '../src/cv/pupil.js';
import { drawEye } from '../src/simulator/eye-image.js';
import { applyLut, toneLut } from '../src/capture/preprocess.js';

const errorPx = (img, pupil, opts) => {
  const p = findPupil(img, opts);
  return Math.hypot(p.u * img.width - pupil.x, p.v * img.height - pupil.y);
};
const POSITIONS = [{ x: 32, y: 16 }, { x: 24, y: 15 }, { x: 41, y: 17 }, { x: 30, y: 13.5 }, { x: 36.5, y: 18 }];

describe('pupil finder', () => {
  it('finds the pupil centre across gaze directions', () => {
    for (const pupil of POSITIONS) expect(errorPx(drawEye({ pupil }), pupil)).toBeLessThan(1);
  });

  it('follows the pupil as it moves', () => {
    const u = x => findPupil(drawEye({ pupil: { x, y: 16 } })).u * 64;
    expect(u(38) - u(26)).toBeGreaterThan(11);
    expect(u(38) - u(26)).toBeLessThan(13);
  });

  it('is unaffected by brightness, contrast and gamma (percentile thresholds)', () => {
    const pupil = { x: 28, y: 15 }, base = findPupil(drawEye({ pupil }));
    const toned = drawEye({ pupil });
    applyLut(toned.data, toneLut({ gamma: 1.8, contrast: 1.3, brightness: -0.05 }));
    const p = findPupil(toned);
    expect(Math.abs(p.u - base.u) * 64).toBeLessThan(0.4);
    expect(Math.abs(p.v - base.v) * 32).toBeLessThan(0.4);
  });

  it('still works in low light', () => {
    for (const pupil of POSITIONS) expect(errorPx(drawEye({ pupil, gain: 0.3, noise: 2 }), pupil)).toBeLessThan(1.5);
  });

  it('fills a glint on the pupil instead of being pushed away from it', () => {
    let filled = 0, unfilled = 0;
    for (const pupil of POSITIONS) {
      const img = drawEye({ pupil, glint: { dx: 2, dy: -1.5, r: 2.2 } });
      filled += errorPx(img, pupil); unfilled += errorPx(img, pupil, { fillGlints: false });
    }
    expect(filled).toBeLessThan(unfilled);
    expect(filled / POSITIONS.length).toBeLessThan(1);
  });

  it('reports glare and contrast', () => {
    const clean = findPupil(drawEye({ pupil: { x: 32, y: 16 } }));
    const glary = findPupil(drawEye({ pupil: { x: 32, y: 16 }, glint: { dx: 6, dy: 0, r: 5 } }));
    expect(clean.glare).toBeLessThan(0.005);
    expect(glary.glare).toBeGreaterThan(0.05);
    expect(clean.conf).toBeGreaterThan(0.5);
    const flat = { data: new Uint8ClampedArray(64 * 32 * 4).fill(128), width: 64, height: 32 };
    expect(findPupil(flat).conf).toBeLessThan(0.05);
  });
});
