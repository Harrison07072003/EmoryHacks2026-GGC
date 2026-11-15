// Score, combo, health (danger levels, failure), Frenzy gauge and grades. Pure: feed it
// judgments with the song time; read `state`. All numbers come from game-config.js.
import { FRENZY, GRADES, HEALTH, SCORING } from '../config/game-config.js';
import { clamp } from '../util/math.js';

export function dangerLevel(health, failEnabled, cfg = HEALTH) {
  if (!failEnabled) return 0;
  if (health <= 0) return 3;
  return cfg.danger.find(d => health < d.below)?.level ?? 0;
}

/** Accuracy % over judged notes: Perfect counts 1, Good counts `goodWeight`, Miss 0. */
export function accuracyOf({ perfect, good, miss }, goodWeight = SCORING.goodWeight) {
  const n = perfect + good + miss;
  return n ? Math.round(((perfect + good * goodWeight) / n) * 1000) / 10 : 0;
}

export function gradeOf(accuracy, failed, grades = GRADES) {
  if (failed) return 'F';
  return grades.find(g => accuracy >= g.min)?.grade ?? grades[grades.length - 1].grade;
}

/**
 * @param mode  a MODES entry (failEnabled, id)
 * @returns { state, apply(judgment, t), tick(t) } - apply/tick return a list of event names:
 *          'frenzyStart', 'frenzyEnd', 'danger', 'fail'
 */
export function createScoring(mode, { scoring = SCORING, health = HEALTH, frenzy = FRENZY } = {}) {
  const penalty = health.missPenalty[mode.id] ?? 0;
  const state = {
    score: 0, combo: 0, maxCombo: 0,
    counts: { perfect: 0, good: 0, miss: 0 },
    health: health.start, danger: 0, failed: false,
    frenzy: 0, frenzyActive: false, frenzyEndsAt: 0, frenzyCount: 0,
  };

  function setHealth(value, events) {
    state.health = clamp(value, 0, health.max);
    const level = dangerLevel(state.health, mode.failEnabled, health);
    if (level !== state.danger) { state.danger = level; events.push('danger'); }
    if (level === 3 && !state.failed) { state.failed = true; events.push('fail'); }
  }

  return {
    state,
    apply(judgment, t) {
      const events = [];
      if (state.failed) return events;
      state.counts[judgment]++;
      if (judgment === 'miss') {
        state.combo = 0;
        if (!state.frenzyActive) setHealth(state.health - penalty, events);   // immune during Frenzy
        return events;
      }
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.score += scoring.points[judgment] * (state.frenzyActive ? scoring.frenzyMultiplier : 1);
      setHealth(state.health + health.regen[judgment], events);
      if (!state.frenzyActive) {
        state.frenzy = Math.min(frenzy.max, state.frenzy + frenzy.gain[judgment]);
        if (state.frenzy >= frenzy.max) {
          state.frenzyActive = true; state.frenzyEndsAt = t + frenzy.durationSec; state.frenzyCount++;
          events.push('frenzyStart');
        }
      }
      return events;
    },
    /** Call every frame with the song time; ends Frenzy after exactly durationSec. */
    tick(t) {
      if (state.frenzyActive && t >= state.frenzyEndsAt) {
        state.frenzyActive = false; state.frenzy = 0;
        return ['frenzyEnd'];
      }
      return [];
    },
    /** 0-1 of Frenzy time left (1 at start, 0 at the end). */
    frenzyLeft: t => (state.frenzyActive ? clamp((state.frenzyEndsAt - t) / frenzy.durationSec) : 0),
  };
}
