import { describe, expect, it } from 'vitest';
import { accuracyOf, createScoring, dangerLevel, gradeOf } from '../src/gameplay/scoring.js';
import { FRENZY, HEALTH, MODES, SCORING } from '../src/config/game-config.js';

describe('points and counts', () => {
  it('Perfect > Good > Miss, and a miss never takes points away', () => {
    const s = createScoring(MODES.normal);
    s.apply('perfect', 0); s.apply('good', 0);
    const before = s.state.score;
    s.apply('miss', 0);
    expect(before).toBe(SCORING.points.perfect + SCORING.points.good);
    expect(s.state.score).toBe(before);
    expect(s.state.counts).toEqual({ perfect: 1, good: 1, miss: 1 });
    expect(s.state.combo).toBe(0);
    expect(s.state.maxCombo).toBe(2);
  });
});

describe('health, danger and failure', () => {
  it('misses drain health through danger levels to failure', () => {
    const s = createScoring(MODES.normal), seen = [];
    for (let i = 0; i < 30 && !s.state.failed; i++) { s.apply('miss', i); seen.push(s.state.danger); }
    expect(seen).toContain(1);
    expect(seen).toContain(2);
    expect(s.state.failed).toBe(true);
    expect(s.state.danger).toBe(3);
  });
  it('hits bring the player back out of danger', () => {
    const s = createScoring(MODES.normal);
    while (s.state.danger < 2) s.apply('miss', 0);
    for (let i = 0; i < 40; i++) s.apply('perfect', 0);
    expect(s.state.danger).toBe(0);
  });
  it('practice mode never fails', () => {
    const s = createScoring(MODES.practice);
    for (let i = 0; i < 200; i++) s.apply('miss', 0);
    expect(s.state.failed).toBe(false);
    expect(s.state.danger).toBe(0);
  });
  it('danger thresholds come from config', () => {
    expect(dangerLevel(HEALTH.danger[1].below - 1, true)).toBe(1);
    expect(dangerLevel(HEALTH.danger[0].below - 1, true)).toBe(2);
    expect(dangerLevel(0, true)).toBe(3);
    expect(dangerLevel(0, false)).toBe(0);
  });
});

describe('Frenzy', () => {
  const fill = (s, t = 0) => { while (!s.state.frenzyActive) s.apply('perfect', t); };

  it('fills faster on Perfect than on Good', () => {
    const a = createScoring(MODES.normal), b = createScoring(MODES.normal);
    a.apply('perfect', 0); b.apply('good', 0);
    expect(a.state.frenzy).toBeGreaterThan(b.state.frenzy);
    expect(FRENZY.gain.miss).toBe(0);
  });

  it('starts when full, doubles points, blocks health loss, and lasts exactly 5 s', () => {
    const s = createScoring(MODES.normal);
    fill(s, 10);
    expect(s.state.frenzyEndsAt).toBeCloseTo(10 + FRENZY.durationSec);
    const before = s.state.score;
    s.apply('perfect', 11);
    expect(s.state.score - before).toBe(SCORING.points.perfect * SCORING.frenzyMultiplier);
    const health = s.state.health;
    s.apply('miss', 12);
    expect(s.state.health).toBe(health);
    expect(s.state.score - before).toBe(SCORING.points.perfect * 2); // the miss earned nothing
    expect(s.tick(14.99)).toEqual([]);
    expect(s.tick(15)).toEqual(['frenzyEnd']);
    expect(s.state.frenzyActive).toBe(false);
    expect(s.state.frenzy).toBe(0);
    s.apply('perfect', 16);
    expect(s.state.frenzy).toBe(FRENZY.gain.perfect); // refills from zero
  });
});

describe('grades', () => {
  it('maps accuracy to S/A/B/C and failure to F', () => {
    expect(gradeOf(99, false)).toBe('S');
    expect(gradeOf(90, false)).toBe('A');
    expect(gradeOf(75, false)).toBe('B');
    expect(gradeOf(10, false)).toBe('C');
    expect(gradeOf(99, true)).toBe('F');
  });
  it('accuracy weighs Good below Perfect', () => {
    expect(accuracyOf({ perfect: 10, good: 0, miss: 0 })).toBe(100);
    expect(accuracyOf({ perfect: 0, good: 10, miss: 0 })).toBe(SCORING.goodWeight * 100);
    expect(accuracyOf({ perfect: 0, good: 0, miss: 0 })).toBe(0);
  });
});
