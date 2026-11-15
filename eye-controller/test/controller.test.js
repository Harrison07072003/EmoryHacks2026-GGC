// End-to-end: the whole pipeline behind the public contract, driven by the gaze simulator.
import { describe, expect, it } from 'vitest';
import { createMockEyeController } from '../src/mock.js';
import { memoryStore } from '../src/storage/kv.js';
import { createRecorder, ReplaySource } from '../src/simulator/recording.js';
import { conditionsOf, evaluateRecording, labelledPoints } from '../src/simulator/evaluate.js';
import { buildController } from '../src/controller.js';
import { cellCenter, allCells } from '../src/signals/lanes.js';

const mock = (o = {}) => createMockEyeController({ clock: 'manual', drive: 'script', ...o });
async function ready(o) { const eyes = mock(o); await eyes.init(); return eyes; }
function look(eyes, target, ms = 900) { eyes.mock.lookAt(target); eyes.mock.step(ms); }

describe('contract shape', () => {
  it('exposes the agreed state, events and lifecycle', async () => {
    const eyes = mock();
    expect(Object.keys(eyes.state)).toEqual(expect.arrayContaining(['gaze', 'lane', 'band', 'quality', 'faceVisible']));
    for (const m of ['onLaneChange', 'onPathSample', 'onFaceLost', 'onFaceFound', 'onQualityChange', 'onCalibrationComplete',
      'init', 'startCalibration', 'stop', 'loadProfile', 'saveProfile', 'exportBaseline', 'importBaseline']) expect(typeof eyes[m]).toBe('function');
    expect(eyes.state).toMatchObject({ lane: null, band: null, faceVisible: false, quality: 0 });
    const off = eyes.onLaneChange(() => {});
    expect(typeof off).toBe('function');
  });
});

describe('mock controller, ideal eyes (pipeline logic)', () => {
  it('is ready to play right after init', async () => {
    const scores = [], eyes = mock({ noise: 'ideal' });
    eyes.onCalibrationComplete(s => scores.push(s));
    await eyes.init();
    expect(eyes.state.ready).toBe(true);
    expect(scores).toEqual([eyes.state.calibrationScore]);
    expect(scores[0]).toBeGreaterThanOrEqual(95);
  });
  it('reports the right lane and band for every cell, and gaze within 2% of truth', async () => {
    const eyes = await ready({ noise: 'ideal' });
    for (const cell of allCells()) {
      const c = cellCenter(cell);
      look(eyes, c);
      expect({ lane: eyes.state.lane, band: eyes.state.band }).toEqual(cell);
      expect(Math.hypot(eyes.state.gaze.x - c.x, eyes.state.gaze.y - c.y)).toBeLessThan(0.02);
    }
  });
});

describe('mock controller, realistic eyes', () => {
  it('reports the right lane and band for every cell', async () => {
    const eyes = await ready({ seed: 5 });
    for (const cell of allCells()) { look(eyes, cellCenter(cell)); expect({ lane: eyes.state.lane, band: eyes.state.band }).toEqual(cell); }
  });
  it('fires one lane change per move, with no chatter while fixating', async () => {
    const eyes = await ready({ seed: 6 }), changes = [];
    look(eyes, { x: 0.125, y: 0.25 });
    eyes.onLaneChange((lane, band) => changes.push([lane, band]));
    look(eyes, { x: 0.875, y: 0.25 }, 3000);
    look(eyes, { x: 0.875, y: 0.75 }, 3000);
    expect(changes).toEqual([[3, 'top'], [3, 'bottom']]);
  });
  it('streams path samples that track a smooth pursuit in the lower band', async () => {
    const path = t => ({ x: 0.5 + 0.35 * Math.sin(t / 900), y: 0.75 });
    const eyes = await ready({ seed: 7, drive: path }), errs = [];
    let t = 0, last = -1;
    eyes.onPathSample((p, ts) => { expect(ts).toBeGreaterThan(last); last = ts; errs.push(Math.abs(p.x - path(ts).x)); });
    eyes.mock.step(6000);
    expect(errs.length).toBeGreaterThan(150);
    expect(errs.slice(30).reduce((a, b) => a + b) / (errs.length - 30)).toBeLessThan(0.05);
    expect(eyes.state.band).toBe('bottom');
  });
  it('face lost: fires once, lane goes null, quality 0; face found restores', async () => {
    const eyes = await ready({ seed: 8 }), ev = [];
    look(eyes, { x: 0.375, y: 0.25 });
    eyes.onFaceLost(() => ev.push('lost')); eyes.onFaceFound(() => ev.push('found')); eyes.onLaneChange(l => ev.push(`lane ${l}`));
    eyes.mock.setConditions({ faceLost: true }); eyes.mock.step(1000);
    expect(ev).toEqual(['lane null', 'lost']);
    expect(eyes.state).toMatchObject({ faceVisible: false, lane: null, band: null, quality: 0 });
    eyes.mock.setConditions({ faceLost: false }); eyes.mock.step(1000);
    expect(ev).toEqual(['lane null', 'lost', 'found', 'lane 1']);
    expect(eyes.state.faceVisible).toBe(true);
  });
  it('quality tracks the calibration score, and falls in bad light and glare', async () => {
    const eyes = await ready({ seed: 9 }), seen = [];
    eyes.onQualityChange(q => seen.push(q));
    eyes.mock.step(2000);
    const good = eyes.state.quality;
    expect(good).toBeGreaterThan(80);
    eyes.mock.setConditions({ light: 'bad', glare: true }); eyes.mock.step(3000);
    expect(eyes.state.quality).toBeLessThan(good * 0.4);
    expect(seen.length).toBeGreaterThan(2);
  });
  it('holds the lane through blinks', async () => {
    const eyes = await ready({ seed: 10 }), changes = [];
    look(eyes, { x: 0.625, y: 0.75 });
    eyes.onLaneChange(l => changes.push(l));
    eyes.mock.step(15000); // several blinks
    expect(changes).toEqual([]);
  });
});

describe('calibration through the contract', () => {
  it('runs the adaptive flow, reports targets and resolves with a score', async () => {
    const eyes = mock({ seed: 11, autoCalibrate: false });
    await eyes.init();
    eyes.mock.step(500);
    expect(eyes.state).toMatchObject({ ready: false, lane: null, calibrationScore: null });
    const shown = [];
    let moving = 0;
    const done = eyes.startCalibration({ onTarget: (t, _i, _n, info) => (info?.moving || info?.hop ? moving++ : shown.push(t)) });
    eyes.mock.step(60000);
    const result = await done;
    expect(shown.filter(Boolean)).toHaveLength(16);
    expect(moving).toBeGreaterThan(250);                         // ~11 s moving dot (one call per frame) + band hops
    expect(result.ok).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.points.filter(p => p.score !== null)).toHaveLength(16);
    expect(result.points.filter(p => p.kind === 'hop')).toHaveLength(8);
    expect(result.points.filter(p => p.kind).every(p => p.score === null && p.kept)).toBe(true); // play-like phases are never scored
    look(eyes, { x: 0.875, y: 0.75 });
    expect(eyes.state).toMatchObject({ lane: 3, band: 'bottom', ready: true });
  });
  it('refuses play after a bad calibration, then a top-up of the weak cells fixes it', async () => {
    const eyes = mock({ seed: 12, autoCalibrate: false });
    await eyes.init();
    const first = eyes.startCalibration({ pursuitMs: 0, hops: 0, onTarget: t => eyes.mock.setConditions(t && t.x > 0.5 ? { light: 'bad', glare: true } : { light: 'good', glare: false }) });
    eyes.mock.step(120000);
    const bad = await first;
    expect(bad.ok).toBe(false);
    expect(bad.weakCells.length).toBeGreaterThan(0);
    expect(bad.weakCells.every(c => c.lane >= 2)).toBe(true);
    look(eyes, { x: 0.125, y: 0.25 });
    expect(eyes.state.lane).toBeNull(); // not ready: no lane reported

    eyes.mock.setConditions({ light: 'good', glare: false });
    const shown = [];
    const second = eyes.startCalibration({ topUp: true, onTarget: t => t && shown.push(t) });
    eyes.mock.step(60000);
    const fixed = await second;
    expect(shown).toHaveLength(bad.weakCells.length * 2);
    expect(shown.length).toBeLessThan(16);
    expect(fixed.ok).toBe(true);
    expect(fixed.score).toBeGreaterThan(bad.score);
    look(eyes, { x: 0.875, y: 0.25 });
    expect(eyes.state).toMatchObject({ lane: 3, band: 'top' });
  });
  it('refuses to calibrate before init, instead of hanging', async () => {
    await expect(mock().startCalibration()).rejects.toThrow(/init/);
  });
  it('stop() aborts a running calibration cleanly', async () => {
    const eyes = mock({ autoCalibrate: false });
    await eyes.init();
    const pending = eyes.startCalibration({ onTarget() {} });
    eyes.mock.step(2000);
    eyes.stop();
    expect((await pending).aborted).toBe(true);
  });
});

describe('profiles and the pooled baseline through the contract', () => {
  it('saves a player and loads them back in a new session', async () => {
    const storage = memoryStore(), a = await ready({ seed: 13, storage });
    expect(await a.saveProfile('ann')).toBe(true);
    const b = mock({ seed: 13, storage, autoCalibrate: false });
    await b.init();
    expect(await b.loadProfile('nobody')).toBe(false);
    expect(await b.loadProfile('ann')).toBe(true);
    expect(b.state.ready).toBe(true);
    look(b, { x: 0.375, y: 0.75 });
    expect(b.state).toMatchObject({ lane: 1, band: 'bottom' });
  });
  it('pools saved players, without double counting a re-save', async () => {
    const storage = memoryStore();
    for (const [seed, id] of [[14, 'ann'], [15, 'bob'], [14, 'ann']]) { const e = await ready({ seed, storage }); await e.saveProfile(id); }
    const baseline = await (await ready({ storage })).exportBaseline();
    expect(baseline.players).toBe(2);
    expect(baseline.samples).toBe(2 * 16 * 18);
  });
  it('exports a baseline another machine can import, enabling a quick calibration there', async () => {
    const home = memoryStore();
    for (const seed of [16, 17, 18, 19]) { const e = await ready({ seed, storage: home }); await e.saveProfile(`p${seed}`); }
    const exported = JSON.parse(JSON.stringify(await (await ready({ storage: home })).exportBaseline()));

    const away = mock({ seed: 20, autoCalibrate: false });
    await away.init();
    await expect(away.importBaseline({ nonsense: 1 })).rejects.toThrow();
    await away.importBaseline(exported);
    expect((await away.exportBaseline()).players).toBe(4);
    const shown = [];
    const done = away.startCalibration({ quick: true, onTarget: (t, _i, _n, info) => t && !info?.moving && !info?.hop && shown.push(t) });
    away.mock.step(60000);
    const result = await done;
    expect(shown).toHaveLength(8);
    expect(result.ok).toBe(true);
    for (const cell of allCells()) { look(away, cellCenter(cell)); expect({ lane: away.state.lane, band: away.state.band }).toEqual(cell); }
  });
});

describe('online refinement', () => {
  it('pulls a drifted model back gently, without jumps', async () => {
    const eyes = await ready({ seed: 21, noise: 'ideal' });
    // simulate drift: the player shifted, every prediction is now off to the right
    const m = eyes.debug.engine.model;
    for (const k of ['both', 'R', 'L']) m[k].bx += 0.08;
    const target = { x: 0.375, y: 0.75 };
    look(eyes, target);
    const before = Math.abs(eyes.state.gaze.x - target.x);
    let biggestStep = 0, prev = eyes.state.gaze.x;
    for (let i = 0; i < 80; i++) {
      expect(eyes.confirmOnTarget(target)).toBe(true);
      eyes.mock.step(100);
      biggestStep = Math.max(biggestStep, Math.abs(eyes.state.gaze.x - prev)); prev = eyes.state.gaze.x;
    }
    expect(before).toBeGreaterThan(0.06);
    expect(Math.abs(eyes.state.gaze.x - target.x)).toBeLessThan(before * 0.6);
    expect(biggestStep).toBeLessThan(0.03);   // no visible jump (a lane is 0.25 wide)
  });
  it('rejects a confirmation when the player is clearly looking elsewhere', async () => {
    const eyes = await ready({ seed: 22 });
    look(eyes, { x: 0.125, y: 0.25 });
    expect(eyes.confirmOnTarget({ x: 0.875, y: 0.75 })).toBe(false);
  });
});

describe('record and replay', () => {
  async function record(cond = {}) {
    const eyes = mock({ seed: 23, autoCalibrate: false });
    await eyes.init();
    eyes.mock.setConditions(cond);
    const rec = createRecorder(eyes, { note: 'synthetic' });
    const done = eyes.startCalibration({ onTarget() {} });
    eyes.mock.step(120000);
    await done;
    return JSON.parse(JSON.stringify(rec.stop()));
  }
  it('records labelled frames and scores them offline on held-out dots', async () => {
    const recording = await record();
    expect(recording.frames.length).toBeGreaterThan(300);
    expect(labelledPoints(recording)).toHaveLength(16);
    const r = evaluateRecording(recording);
    expect(r.meanError).toBeLessThan(0.06);
    expect(r.dots).toBe(16);
    expect(r.fullScore).toBeGreaterThanOrEqual(80);
    expect(r.errorX).toBeLessThan(r.meanError);
    expect(conditionsOf(recording)).toMatchObject({ faceVisible: 1 });
    expect(conditionsOf(recording).fps).toBeCloseTo(30, 0);
    expect(r.laneAccuracy).toBeGreaterThan(0.95);
    expect(r.bandAccuracy).toBeGreaterThan(0.95);
  });
  it('a bad-light recording scores measurably worse', async () => {
    const good = evaluateRecording(await record()), bad = evaluateRecording(await record({ light: 'bad', glare: true }));
    expect(bad.meanError).toBeGreaterThan(good.meanError * 1.5);
  });
  it('replays through the same controller pipeline as live frames', async () => {
    const recording = await record(), source = new ReplaySource(recording);
    let push;
    const eyes = buildController({ start: async (_v, onFrame) => { push = onFrame; }, stop() {} }, { storage: memoryStore() });
    await eyes.init();
    const found = [];
    eyes.onFaceFound(() => found.push(1));
    source.runAll(push);
    expect(found).toHaveLength(1);
    expect(eyes.state.faceVisible).toBe(true);
    expect(() => new ReplaySource({ featureVersion: -1, frames: [] })).toThrow();
  });
});
