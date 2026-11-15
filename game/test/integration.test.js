// Integration: every real chart, played through the eye-controller MOCK (simulated eyes
// with realistic jitter, head drift, blinks, saccade latency, the real smoothing pipeline)
// and the game's own judge + scoring. This proves the chart -> gaze -> judgment -> score
// chain end to end. It is NOT a substitute for testing with a real webcam.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createMockEyeController } from '../../eye-controller/src/index.js';
import { parseChart, pathX } from '../src/gameplay/chart.js';
import { createJudge } from '../src/gameplay/judge.js';
import { createScoring } from '../src/gameplay/scoring.js';
import { accuracyOf, gradeOf } from '../src/gameplay/scoring.js';
import { targetPoint } from '../src/gameplay/zones.js';
import { INPUT, LAYOUT, MODES } from '../src/config/game-config.js';

const songsDir = new URL('../src/songs/', import.meta.url);
const SONGS = readdirSync(songsDir).filter(f => !f.includes('.'));
const chartOf = (song, diff) => parseChart(JSON.parse(readFileSync(new URL(`${song}/chart.${diff}.json`, songsDir), 'utf8')));
const FRAME_MS = 1000 / 30;

/**
 * Play a chart with simulated eyes. `player(t, chart)` returns where the simulated player
 * looks at song time t (or null to keep looking where they were).
 */
async function playChart(chart, mode, player, { noise = 'realistic' } = {}) {
  const eyes = createMockEyeController({ clock: 'manual', noise, seed: 3, layout: { lanes: 4, bandSplit: 0.5 } });
  await eyes.init();
  const judge = createJudge(chart, mode), scoring = createScoring(mode);
  const latency = INPUT.gazeLatencyMs.sim / 1000;
  const frenzyLog = [];
  let t = -1, failedAt = null;
  while (t < chart.duration + 1 && failedAt === null) {
    const look = player(t, chart);
    if (look) eyes.mock.lookAt(look);
    eyes.mock.step(FRAME_MS);
    t += FRAME_MS / 1000;
    const s = eyes.state, gaze = { x: s.gaze.x, y: s.gaze.y, valid: s.faceVisible && s.calibrationScore !== null };
    for (const j of judge.update(t - latency, gaze)) {
      if (scoring.apply(j.judgment, t).includes('fail')) failedAt = t;
    }
    for (const e of scoring.tick(t)) frenzyLog.push({ e, t });
    if (scoring.state.frenzyActive && !frenzyLog.some(f => f.e === 'start' && f.t >= scoring.state.frenzyEndsAt - 5.0001)) frenzyLog.push({ e: 'start', t });
  }
  eyes.stop();
  const st = scoring.state, accuracy = accuracyOf(st.counts);
  return { ...st, accuracy, grade: gradeOf(accuracy, st.failed), failedAt, frenzyLog, done: judge.isDone() };
}

/** A good player: looks at the next target a little early, follows curves. */
const goodPlayer = (t, chart) => {
  const ahead = t + 0.35;   // eyes move ~350 ms before a note lands (they see it coming)
  const curve = chart.notes.find(n => n.type === 'curve' && ahead >= n.t - 0.1 && t <= n.end);
  if (curve) return { x: pathX(curve.path, Math.max(curve.t, t + 0.12)), y: LAYOUT.lowerLineY };
  const next = chart.notes.find(n => n.type === 'straight' && n.t > t - 0.05);
  return next && next.t - t < 0.9 ? targetPoint(next, t, pathX) : null;
};
const absentPlayer = () => ({ x: 0.02, y: 0.98 });

describe('every song and difficulty is playable with (simulated) eyes', () => {
  for (const song of SONGS) for (const diff of ['practice', 'normal', 'hard']) {
    it(`${song} / ${diff}: a good player finishes with a high grade`, async () => {
      const r = await playChart(chartOf(song, diff), MODES[diff], goodPlayer);
      expect(r.failed).toBe(false);
      expect(r.done).toBe(true);
      expect(r.accuracy).toBeGreaterThanOrEqual(80);
      expect(['S', 'A', 'B']).toContain(r.grade);
    }, 30000);
  }
});

describe('failure and practice', () => {
  it('a player who never looks fails Normal and Hard (F) before the end', async () => {
    for (const diff of ['normal', 'hard']) {
      const chart = chartOf('pulse-runner', diff);
      const r = await playChart(chart, MODES[diff], absentPlayer);
      expect(r.failed).toBe(true);
      expect(r.grade).toBe('F');
      expect(r.failedAt).toBeLessThan(chart.duration);
    }
  }, 30000);

  it('the same player reaches the end of Practice without failing', async () => {
    const r = await playChart(chartOf('pulse-runner', 'practice'), MODES.practice, absentPlayer);
    expect(r.failed).toBe(false);
    expect(r.done).toBe(true);
    expect(r.counts.miss).toBeGreaterThan(0);
    expect(r.score).toBe(0);
  }, 30000);
});

describe('Frenzy in real play', () => {
  it('triggers during a good run and lasts 5 s of song time', async () => {
    const r = await playChart(chartOf('overdrive-protocol', 'hard'), MODES.hard, goodPlayer, { noise: 'ideal' });
    expect(r.frenzyCount).toBeGreaterThan(0);
    const start = r.frenzyLog.find(f => f.e === 'start'), end = r.frenzyLog.find(f => f.e === 'frenzyEnd');
    expect(end.t - start.t).toBeGreaterThan(4.9);
    expect(end.t - start.t).toBeLessThan(5.1);
  }, 30000);
});
