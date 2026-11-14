import { describe, expect, it } from 'vitest';
import { bandOf, cellCenter, cellOf, createLaneMapper, laneOf } from '../src/signals/lanes.js';
import { FacePresence } from '../src/signals/presence.js';
import { QualityTracker, liveQuality } from '../src/signals/quality.js';

describe('lane and band mapping', () => {
  it('maps x to four lanes and clamps the edges', () => {
    expect([0.01, 0.3, 0.6, 0.99, -0.2, 1.3].map(x => laneOf(x, 4))).toEqual([0, 1, 2, 3, 0, 3]);
  });
  it('holds the current lane near a border (hysteresis)', () => {
    expect(laneOf(0.26, 4, 0)).toBe(0);   // just over the line: stay
    expect(laneOf(0.29, 4, 0)).toBe(1);   // clearly over: switch
    expect(laneOf(0.24, 4, 1)).toBe(1);
  });
  it('maps y to bands with hysteresis', () => {
    expect(bandOf(0.2)).toBe('top');
    expect(bandOf(0.8)).toBe('bottom');
    expect(bandOf(0.52, 0.5, 'top')).toBe('top');
    expect(bandOf(0.56, 0.5, 'top')).toBe('bottom');
  });
  it('does not chatter on a border', () => {
    const m = createLaneMapper({ lanes: 4, bandSplit: 0.5 });
    m.update({ x: 0.2, y: 0.3 });
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(m.update({ x: 0.25 + (i % 2 ? 0.01 : -0.01), y: 0.5 + (i % 2 ? 0.02 : -0.02) }).lane);
    expect([...seen]).toEqual([0]);
  });
  it('knows cells', () => {
    expect(cellOf({ x: 0.9, y: 0.75 })).toEqual({ lane: 3, band: 'bottom' });
    expect(cellOf({ x: 0.9, y: 0.5 })).toBeNull();
    expect(cellCenter({ lane: 1, band: 'top' })).toEqual({ x: 0.375, y: 0.25 });
  });
});

describe('face presence', () => {
  it('debounces lost, reports found at once', () => {
    const p = new FacePresence({ lostAfterMs: 250 });
    expect(p.update(true, 0)).toBe('found');
    expect(p.update(false, 100)).toBeNull();
    expect(p.update(true, 150)).toBeNull();
    expect(p.update(false, 300)).toBeNull();
    expect(p.update(false, 450)).toBe('lost');
    expect(p.update(false, 500)).toBeNull();
    expect(p.update(true, 600)).toBe('found');
  });
});

describe('quality score', () => {
  const eye = (o = {}) => ({ open: 0.3, glare: 0.003, conf: 0.5, lum: 120, ...o });
  const frame = (o = {}) => ({ t: 0, face: true, blink: false, eyes: { R: eye(o.R), L: eye(o.L) }, head: [0, 0, 0.5, 0.5, 0.3], box: { x: 0.35, y: 0.25, w: 0.3, h: 0.5 }, ...o.frame });
  const live = o => liveQuality(frame(o)).live;

  it('is full in good conditions and zero without a face', () => {
    expect(live()).toBeCloseTo(1, 5);
    expect(liveQuality({ face: false }).live).toBe(0);
  });
  it('drops in low light', () => {
    expect(live({ R: { lum: 45 }, L: { lum: 45 } })).toBeLessThan(0.4);
  });
  it('drops with glare, less when one eye is still clean', () => {
    const both = live({ R: { glare: 0.08 }, L: { glare: 0.08 } }), one = live({ R: { glare: 0.08 } });
    expect(both).toBeLessThan(0.5);
    expect(one).toBeGreaterThan(both);
    expect(one).toBeLessThan(1);
  });
  it('drops when the face is leaving the frame or the head moved since calibration', () => {
    expect(live({ frame: { box: { x: 0, y: 0.25, w: 0.3, h: 0.5 } } })).toBeLessThan(0.8);
    expect(liveQuality(frame({ frame: { head: [0.4, 0, 0.5, 0.5, 0.3] } }), [0, 0, 0.5, 0.5, 0.3]).live).toBeLessThan(0.7);
  });
  it('does not punish blinks', () => {
    expect(liveQuality(frame({ frame: { blink: true } }))).toBeNull();
  });
  it('scales by the calibration score and reports changes only', () => {
    const q = new QualityTracker();
    expect(q.update(frame(), { calibrationScore: 90 })).toBe(90);
    expect(q.update(frame(), { calibrationScore: 90 })).toBeNull();
    expect(q.update({ t: 1, face: false }, { calibrationScore: 90 })).toBe(0);
  });
});
