import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMockEyeController } from '../src/mock.js';
import { createTelemetry, toRow } from '../src/telemetry/telemetry.js';
import { VERSIONS } from '../src/version.js';
import { FEATURE_VERSION } from '../src/cv/features.js';

async function setup(options = {}, mockOptions = {}) {
  const eyes = createMockEyeController({ clock: 'manual', drive: 'script', seed: 3, ...mockOptions });
  const sent = [];
  let failing = false;
  const telemetry = createTelemetry(eyes, { flushMs: 0, send: async m => { if (failing) throw new Error('offline'); sent.push(structuredClone(m)); }, ...options });
  await eyes.init();
  return { eyes, telemetry, sent, fail: on => { failing = on; } };
}
const rows = sent => sent.filter(m => m.type === 'samples').flatMap(m => m.samples);

describe('sample event', () => {
  it('carries the frame and the model output for that same frame', async () => {
    const eyes = createMockEyeController({ clock: 'manual', noise: 'ideal' });
    await eyes.init();
    const seen = [];
    eyes.onSample(s => seen.push({ ...s, state: { ...eyes.state.gaze } }));
    eyes.mock.lookAt({ x: 0.875, y: 0.75 }); eyes.mock.step(1000);
    const last = seen.at(-1);
    expect(last.gaze).toEqual(last.state);          // same frame, not the previous one
    expect(last).toMatchObject({ lane: 3, band: 'bottom', ready: true, target: null, targetSource: null });
    expect(last.frame.f).toHaveLength(19);
    expect(seen).toHaveLength(30);
  });
  it('labels samples with the game target until it is cleared', async () => {
    const eyes = createMockEyeController({ clock: 'manual' });
    await eyes.init();
    const seen = [];
    eyes.onSample(s => seen.push(s));
    eyes.setTarget({ x: 0.375, y: 0.25 }, 'note-7'); eyes.mock.step(100);
    eyes.setTarget(null); eyes.mock.step(100);
    expect(seen[0]).toMatchObject({ target: { x: 0.375, y: 0.25 }, targetId: 'note-7', targetSource: 'game' });
    expect(seen.at(-1)).toMatchObject({ target: null, targetId: null, targetSource: null });
  });
  it('labels calibration frames with the dot, and reports the full result', async () => {
    const eyes = createMockEyeController({ clock: 'manual', autoCalibrate: false });
    await eyes.init();
    const sources = new Set(), results = [];
    eyes.onSample(s => sources.add(s.targetSource));
    eyes.onCalibrationResult(r => results.push(r));
    const done = eyes.startCalibration({ onTarget() {} });
    eyes.mock.step(60000); await done;
    expect([...sources]).toEqual(['calibration', null]);
    expect(results[0].points).toHaveLength(16);
  });
  it('reports no gaze when there is no face', async () => {
    const eyes = createMockEyeController({ clock: 'manual' });
    await eyes.init();
    let last;
    eyes.onSample(s => (last = s));
    eyes.mock.setConditions({ faceLost: true }); eyes.mock.step(1000);
    expect(last).toMatchObject({ gaze: null, lane: null, band: null, quality: 0 });
    expect(toRow(last)).toMatchObject({ face: false, features: null, gaze_x: null, r_open: null });
  });
});

describe('telemetry uploader', () => {
  it('sends the session first, with versions, then calibration and sample batches', async () => {
    const { eyes, telemetry, sent } = await setup({ session: { player: 'ann' } });
    eyes.mock.step(1000);
    expect(await telemetry.flush()).toBe(true);
    expect(sent.map(m => m.type)).toEqual(['session', 'calibration', 'samples']);
    expect(sent[0]).toMatchObject({ id: telemetry.sessionId, player: 'ann', app_version: VERSIONS.app, feature_version: FEATURE_VERSION, layout: { lanes: 4, bandSplit: 0.5 } });
    expect(sent[1]).toMatchObject({ session_id: telemetry.sessionId, ok: true });
    expect(sent[2]).toMatchObject({ session_id: telemetry.sessionId, seq: 0, id: `${telemetry.sessionId}:0` });
    expect(sent[2].samples).toHaveLength(30);
    expect(Object.keys(sent[2].samples[0])).toEqual(expect.arrayContaining(['t', 'features', 'gaze_x', 'gaze_y', 'lane', 'band', 'quality', 'target_x', 'process_ms']));
  });
  it('batches: one message per flush, never one per frame', async () => {
    const { eyes, telemetry, sent } = await setup();
    for (let i = 0; i < 3; i++) { eyes.mock.step(1500); await telemetry.flush(); }
    const batches = sent.filter(m => m.type === 'samples');
    expect(batches.map(b => b.seq)).toEqual([0, 1, 2]);
    expect(batches.every(b => b.samples.length === 45)).toBe(true);
    expect(telemetry.stats).toMatchObject({ sent: 135, queued: 0, dropped: 0 });
  });
  it('keeps failed batches and retries them with the same id, in order, without duplicates', async () => {
    const { eyes, telemetry, sent, fail } = await setup();
    await telemetry.flush();
    fail(true);
    const errors = [];
    eyes.mock.step(1000); expect(await telemetry.flush()).toBe(false);
    eyes.mock.step(1000); expect(await telemetry.flush()).toBe(false);
    expect(telemetry.stats).toMatchObject({ queued: 60, failures: 2, lastError: 'offline' });
    fail(false);
    eyes.mock.step(1000); expect(await telemetry.flush()).toBe(true);
    const batches = sent.filter(m => m.type === 'samples');
    expect(batches.map(b => b.seq)).toEqual([0, 1, 2]);
    expect(new Set(batches.map(b => b.id)).size).toBe(3);
    const ts = rows(sent).map(r => r.t);
    expect(ts).toHaveLength(90);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(telemetry.stats).toMatchObject({ sent: 90, queued: 0 });
  });
  it('a failing upload never stops or slows the tracker', async () => {
    const { eyes, telemetry, fail } = await setup();
    fail(true);
    eyes.mock.lookAt({ x: 0.125, y: 0.25 }); eyes.mock.step(1000);
    telemetry.flush();
    eyes.mock.lookAt({ x: 0.875, y: 0.75 }); eyes.mock.step(1000);
    expect(eyes.state).toMatchObject({ lane: 3, band: 'bottom' });
  });
  it('caps the queue while offline and counts what it had to drop', async () => {
    const { eyes, telemetry, sent, fail } = await setup({ maxQueued: 100 });
    await telemetry.flush(); fail(true);
    for (let i = 0; i < 5; i++) { eyes.mock.step(1000); await telemetry.flush(); }
    expect(telemetry.stats).toMatchObject({ queued: 90, dropped: 60 });
    fail(false); await telemetry.flush();
    expect(sent.filter(m => m.type === 'samples').map(b => b.seq)).toEqual([2, 3, 4]);
  });
  it('stop() makes a final upload and stops collecting', async () => {
    const { eyes, telemetry, sent } = await setup();
    eyes.mock.step(500);
    expect(await telemetry.stop()).toBe(true);
    eyes.mock.step(500);
    await telemetry.flush();
    expect(rows(sent)).toHaveLength(15);
  });
  it('requires a send function', () => {
    expect(() => createTelemetry(createMockEyeController({ clock: 'manual' }), {})).toThrow(/send/);
  });
});

describe('versions', () => {
  it('match package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSIONS.app).toBe(pkg.version);
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toContain(VERSIONS.mediapipeRuntime);
  });
});
