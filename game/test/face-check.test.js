import { describe, expect, it } from 'vitest';
import { faceChecks, facePositionOk } from '../src/input/face-check.js';

const frame = (box, { light = 120, glare = 0.005, face = true } = {}) => ({
  face, box, exposure: { mean: light },
  eyes: { R: { glare, lum: light }, L: { glare, lum: light } },
});
const byId = checks => Object.fromEntries(checks.map(c => [c.id, c]));
const good = { x: 0.37, y: 0.25, w: 0.26, h: 0.45 };

describe('face check', () => {
  it('a centred face at a normal distance in good light passes', () => {
    const c = faceChecks(frame(good));
    expect(facePositionOk(c)).toBe(true);
  });

  it('no face fails everything required', () => {
    const c = byId(faceChecks({ face: false }));
    expect(c.face.pass).toBe(false);
    expect(facePositionOk(Object.values(c))).toBe(false);
  });

  it('off-centre, too far, too close and too dark each fail with a hint', () => {
    expect(byId(faceChecks(frame({ ...good, x: 0.02 }))).center.pass).toBe(false);
    const far = byId(faceChecks(frame({ ...good, x: 0.45, w: 0.1 })));
    expect(far.distance.pass).toBe(false);
    expect(far.distance.hint).toBe('move closer');
    expect(byId(faceChecks(frame({ ...good, x: 0.2, w: 0.6 }))).distance.hint).toBe('move back');
    expect(byId(faceChecks(frame(good, { light: 20 }))).light.pass).toBe(false);
  });

  it('glasses glare is only a warning', () => {
    const c = faceChecks(frame(good, { glare: 0.2 }));
    expect(byId(c).glare.pass).toBe(false);
    expect(facePositionOk(c)).toBe(true);
  });
});
