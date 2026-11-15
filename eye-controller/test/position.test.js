import { describe, expect, it } from 'vitest';
import { positionChecks, positionOk } from '../src/signals/position.js';

const eye = lum => ({ open: 0.3, glare: 0.002, conf: 0.2, lum });
const frame = ({ w = 0.22, cx = 0.5, cy = 0.62, lum = 66, yaw = 0.03, glare = 0.002 } = {}) => ({
  face: true, box: { x: cx - w / 2, y: cy - 0.15, w, h: 0.3 }, head: [yaw, 0, 0.5, 0.5, w],
  eyes: { R: { ...eye(lum), glare }, L: eye(lum) },
});
const failing = f => positionChecks(f).filter(c => !c.pass).map(c => c.id);

// Each case mirrors a recorded condition (see the thresholds' comment in position.js).
describe('position checks', () => {
  it('your normal baseline setup passes everything', () => {
    expect(failing(frame())).toEqual([]);
    expect(positionOk(positionChecks(frame()))).toBe(true);
  });
  it('fails without a face', () => {
    expect(positionOk(positionChecks({ face: false }))).toBe(false);
    expect(positionChecks(null)[0]).toMatchObject({ id: 'face', pass: false });
  });
  it('sitting far back fails distance, leaning very close fails too', () => {
    expect(failing(frame({ w: 0.135 }))).toContain('distance');
    expect(positionChecks(frame({ w: 0.135 })).find(c => c.id === 'distance').hint).toBe('move closer');
    expect(failing(frame({ w: 0.5 }))).toContain('distance');
    expect(failing(frame({ w: 0.42 }))).not.toContain('distance');   // the "close" clips still tracked
  });
  it('a dark room fails, dim light only warns', () => {
    expect(failing(frame({ lum: 3 }))).toEqual(expect.arrayContaining(['light', 'light-good']));
    const dim = positionChecks(frame({ lum: 53 }));
    expect(positionOk(dim)).toBe(true);
    expect(dim.find(c => c.id === 'light-good').pass).toBe(false);
  });
  it('a face low in the frame (the backlit clips) is not centred', () => {
    expect(failing(frame({ cy: 0.84 }))).toContain('center');
    expect(positionChecks(frame({ cy: 0.84 })).find(c => c.id === 'center').hint).toMatch(/camera/);
  });
  it('glare and a turned head only warn', () => {
    const c = positionChecks(frame({ glare: 0.08, yaw: 0.5 }));
    expect(c.filter(x => !x.pass).map(x => x.id)).toEqual(['glare', 'head']);
    expect(positionOk(c)).toBe(true);
  });
});
