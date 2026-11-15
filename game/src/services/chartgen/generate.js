// Audio -> one chart per difficulty, in the game's existing chart format (format 1), using
// the existing chart builder (tools/compose/chartgen.mjs) so lane rules, gaps and curve speed
// limits are exactly those of the built-in songs. Deterministic: no randomness anywhere, so
// the same audio always gives the same charts.
//
// Bump GENERATOR_VERSION whenever the output can change: cached charts of older versions are
// regenerated.
import { generateChart } from '../../../tools/compose/chartgen.mjs';
import { ANALYSIS_RATE, analyze } from './analyze.js';
import { buildEvents } from './events.js';
import { toMono } from './dsp.js';
import { enforceRules, validateChart } from './validate.js';
import { assessMusic } from './musicality.js';

/** The audio is not music with a clear beat (spoken word, drones, noise...): no level. */
export class NotASongError extends Error {
  constructor(music) { super(`not a playable song: ${music.reasons.join('; ')}`); this.music = music; }
}

export const GENERATOR_VERSION = 3;   // 2: tempo kept inside 70-180 BPM; 3: songs without a clear beat are refused
export const DIFFICULTIES = ['practice', 'normal', 'hard'];
const END_MARGIN_SEC = 1.5;   // last note this long before the level ends (the audio fades out)
// Minimum notes per second (straight notes + curve seconds) before a chart counts as too sparse:
// soft music has few strong hits, so its events are promoted one accent level (up to twice).
const MIN_DENSITY = { practice: 0.3, normal: 0.55, hard: 0.8 };

const promote = (events, shift) => (shift ? events.map(e => ({ ...e, accent: Math.max(1, e.accent - shift) })) : events);
const density = (chart, sec) => chart.notes.reduce((n, x) => n + (x.type === 'curve' ? x.end - x.t : 1), 0) / sec;

/**
 * @param o { channels: Float32Array[], sampleRate, songId, levelSec (use only the first N seconds),
 *            requireSong (default true: throw NotASongError for audio without a clear beat) }
 * @returns {{ charts: Record<difficulty, chart>, meta: { bpm, offset, difficulty, notesPerSec, generatorVersion, levelSec } }}
 */
export function generateCharts({ channels, sampleRate, songId, levelSec = 30, requireSong = true }) {
  const samples = toMono(channels, sampleRate, ANALYSIS_RATE, levelSec);
  const durationSec = samples.length / ANALYSIS_RATE;
  if (durationSec < 8) throw new Error(`audio too short to make a level (${durationSec.toFixed(1)} s)`);
  const a = analyze(samples, ANALYSIS_RATE);
  const music = assessMusic(a);
  if (requireSong && !music.isSong) throw new NotASongError(music);
  const events = buildEvents(a, { endSec: durationSec - END_MARGIN_SEC });

  const charts = {};
  for (const difficulty of DIFFICULTIES) {
    let chart;
    for (let shift = 0; shift <= 2; shift++) {
      const raw = generateChart(promote(events, shift), songId, difficulty);
      chart = enforceRules({ ...raw, generatedBy: `services/chartgen v${GENERATOR_VERSION} (automatic, from audio)`, generator: GENERATOR_VERSION }, { durationSec: durationSec - 0.5 });
      if (density(chart, durationSec) >= MIN_DENSITY[difficulty]) break;
    }
    const problems = validateChart(chart, { durationSec, difficulty });
    if (problems.length) throw new Error(`generated ${difficulty} chart is invalid: ${problems[0]}`);
    charts[difficulty] = chart;
  }
  const hard = charts.hard.notes;
  const notesPerSec = hard.length / durationSec;
  return {
    charts,
    meta: {
      bpm: a.bpm, offset: Math.round(a.offset * 1000) / 1000, notesPerSec: Math.round(notesPerSec * 100) / 100,
      // 1 (calm) .. 5 (dense), from the hard chart: notes per second + share of curve time
      difficulty: Math.max(1, Math.min(5, Math.round(notesPerSec * 2 + hard.filter(n => n.type === 'curve').length * 0.3))),
      generatorVersion: GENERATOR_VERSION, levelSec: Math.round(durationSec * 100) / 100,
      music: { isSong: music.isSong, score: music.score, ...music.metrics },
    },
  };
}

/** Analyze the first `levelSec` and decide whether it is a song (used by ingestion). */
export function checkMusic({ channels, sampleRate, levelSec = 30 }) {
  const samples = toMono(channels, sampleRate, ANALYSIS_RATE, levelSec);
  if (samples.length / ANALYSIS_RATE < 8) return { isSong: false, score: 0, reasons: ['shorter than 8 s'], metrics: {} };
  return assessMusic(analyze(samples, ANALYSIS_RATE));
}
