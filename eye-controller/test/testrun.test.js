import { describe, expect, it } from 'vitest';
import { buildTestRun, PHASES } from '../src/testrun/script.js';
import { createMockEyeController } from '../src/mock.js';
import { createRecorder } from '../src/simulator/recording.js';
import { evaluatePlay } from '../src/simulator/evaluate-play.js';
import { evaluateRecording, labelledPoints } from '../src/simulator/evaluate.js';
import { cellOf } from '../src/signals/lanes.js';

const STEP = 1000 / 30;

/**
 * Play the test run headlessly on the mock: the fake player follows the script with a
 * human-like reaction delay (`reactMs`), the "game" labels frames with setTarget.
 */
async function recordTestRun({ calibrate = false, reactMs = 220, noise = 'realistic', lookAway = null } = {}) {
  const run = buildTestRun();
  let T0 = Infinity, last = { x: 0.5, y: 0.5 };
  const drive = t => {
    const cur = run.at(t - T0 - reactMs);
    if (cur?.id) last = lookAway?.(cur) ?? { x: cur.x, y: cur.y };
    return last;
  };
  const eyes = createMockEyeController({ clock: 'manual', drive, noise, seed: 4, autoCalibrate: !calibrate });
  await eyes.init();
  const rec = createRecorder(eyes, { label: 'test' });
  if (calibrate) { const done = eyes.startCalibration({ onTarget() {} }); eyes.mock.step(60000); await done; }
  T0 = eyes.debug.source.t;
  for (let ms = 0; ms <= run.durationMs; ms += STEP) {
    const cur = run.at(ms);
    eyes.setTarget(cur?.id ? { x: cur.x, y: cur.y } : null, cur?.id ?? null);
    eyes.mock.step(STEP);
  }
  eyes.setTarget(null);
  return JSON.parse(JSON.stringify(rec.stop()));
}

describe('test-run script', () => {
  const run = buildTestRun();
  it('runs about 47 s and ends', () => {
    expect(run.durationMs).toBeGreaterThan(40000);
    expect(run.durationMs).toBeLessThan(55000);
    expect(run.at(run.durationMs + 1)).toBeNull();
  });
  it('has the three phases in order, with rests between', () => {
    const seen = [];
    for (let ms = 0; ms < run.durationMs; ms += 50) { const p = run.at(ms).phase; if (p !== seen.at(-1)) seen.push(p); }
    expect(seen).toEqual(['rest', 'jumps', 'rest', 'path', 'rest', 'switch']);
  });
  it('jumps stay in the top band and always change lane', () => {
    const notes = [];
    for (let ms = 0; ms < run.durationMs; ms += 50) { const c = run.at(ms); if (c.phase === 'jumps' && c.id !== notes.at(-1)?.id) notes.push(c); }
    expect(notes).toHaveLength(PHASES.jumps.count);
    const cells = notes.map(n => cellOf(n));
    expect(cells.every(c => c.band === 'top')).toBe(true);
    expect(cells.every((c, i) => !i || c.lane !== cells[i - 1].lane)).toBe(true);
  });
  it('switch notes alternate bands; the path stays in the bottom band and crosses lanes', () => {
    const sw = [], path = [];
    for (let ms = 0; ms < run.durationMs; ms += 50) {
      const c = run.at(ms);
      if (c.phase === 'switch' && c.id !== sw.at(-1)?.id) sw.push(c);
      if (c.phase === 'path') path.push(c);
    }
    expect(sw.map(n => cellOf(n).band)).toEqual(Array.from({ length: 12 }, (_, i) => (i % 2 ? 'bottom' : 'top')));
    expect(path.every(p => p.y > 0.55 && p.y < 0.95)).toBe(true);
    expect(Math.min(...path.map(p => p.x))).toBeLessThan(0.15);
    expect(Math.max(...path.map(p => p.x))).toBeGreaterThan(0.85);
  });
  it('is the same every time for the same seed', () => {
    const a = buildTestRun({ seed: 3 }), b = buildTestRun({ seed: 3 });
    for (let ms = 0; ms < a.durationMs; ms += 777) expect(a.at(ms)).toEqual(b.at(ms));
  });
});

describe('scoring a test run', () => {
  it('a recording keeps game targets apart from calibration dots', async () => {
    const rec = await recordTestRun({ calibrate: true });
    expect(labelledPoints(rec)).toHaveLength(16);                       // test-run frames are not mistaken for dots
    expect(evaluateRecording(rec).dots).toBe(16);
    expect(rec.frames.some(f => f.src === 'game' && f.tid === 'path')).toBe(true);
    expect(rec.frames.filter(f => f.out).length).toBeGreaterThan(1000); // live output was stored
  });
  it('an attentive player scores well on every phase, live and replayed', async () => {
    const r = evaluatePlay(await recordTestRun({ calibrate: true }));
    for (const view of [r.replay, r.live]) {
      expect(view.jumps.hitRate).toBe(1);
      expect(view.switch.hitRate).toBe(1);
      expect(view.jumps.onTarget).toBeGreaterThan(0.9);
      expect(view.jumps.reactionMs).toBeGreaterThan(200);       // the fake player reacts after 220 ms
      expect(view.jumps.reactionMs).toBeLessThan(500);
      expect(view.path.errorAtLag).toBeLessThan(0.06);
      expect(view.path.lane).toBeGreaterThan(0.85);
      expect(view.path.band).toBe(1);
      expect(view.path.lagMs).toBeGreaterThanOrEqual(200);      // finds the reaction delay
    }
    expect(r.calibrationScore).toBeGreaterThanOrEqual(80);
  });
  it('replay of a clip without its own calibration uses the one stored at record time', async () => {
    const rec = await recordTestRun({ calibrate: false });
    expect(labelledPoints(rec)).toHaveLength(0);
    expect(rec.meta.calibrationPoints).toHaveLength(16);
    expect(evaluatePlay(rec).replay.jumps.hitRate).toBe(1);
  });
  it('a player who keeps looking at the wrong lane scores badly', async () => {
    const r = evaluatePlay(await recordTestRun({ lookAway: cur => (cur.phase === 'path' ? null : { x: 1 - cur.x, y: cur.y }) }));
    expect(r.replay.jumps.onTarget).toBeLessThan(0.5);
    expect(r.replay.path.errorAtLag).toBeLessThan(0.06); // path still fine
  });
  it('returns null for a clip with no test run', async () => {
    const eyes = createMockEyeController({ clock: 'manual' });
    await eyes.init();
    const rec = createRecorder(eyes); eyes.mock.step(1000);
    expect(evaluatePlay(rec.stop())).toBeNull();
  });
});

describe('learning during the test run', () => {
  it('counts a note as hit only once the eyes had time to arrive on the right cell', async () => {
    const { isHit } = await import('../src/testrun/script.js');
    const note = { x: 0.375, y: 0.25 };
    expect(isHit('jumps', 200, { lane: 1, band: 'top' }, note)).toBe(false);
    expect(isHit('jumps', 500, { lane: 1, band: 'top' }, note)).toBe(true);
    expect(isHit('jumps', 500, { lane: 2, band: 'top' }, note)).toBe(false);
    expect(isHit('path', 500, { lane: 3, band: 'bottom' }, { x: 0.1, y: 0.75 })).toBe(true);
  });
  it('replay with learning never does worse than without on an attentive player', async () => {
    const rec = await recordTestRun({ calibrate: true });
    const on = evaluatePlay(rec).replay, off = evaluatePlay(rec, { learn: false }).replay;
    expect(on.switch.onTarget).toBeGreaterThanOrEqual(off.switch.onTarget - 0.02);
    expect(on.jumps.hitRate).toBe(1);
  });
});
