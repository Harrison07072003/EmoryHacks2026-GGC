// Results (song completed) and failure (F) screens. Both fully gaze-navigable.
import { CURVE } from '../config/game-config.js';
import { judgmentCount } from '../gameplay/chart.js';
import { accuracyOf, gradeOf } from '../gameplay/scoring.js';
import { VERSIONS } from '../../../eye-controller/src/index.js';
import { startSong } from './songs.js';
import { songById } from '../songs/index.js';
import { esc, gazeButton, html } from './ui.js';

/** Turn the end-of-song state into one flat result row (this is what the database stores). */
export function buildResult({ song, mode, character, scoring, chart, failed, songTime, stats, gaze, settings }) {
  const counts = scoring.counts;
  const accuracy = accuracyOf(counts);
  return {
    player_id: settings.playerId,
    song_id: song.id, song_title: song.title, difficulty: mode.id, mode_label: mode.label, character_id: character.id,
    score: scoring.score, grade: gradeOf(accuracy, failed), accuracy,
    perfect: counts.perfect, good: counts.good, miss: counts.miss,
    total_judgments: judgmentCount(chart, CURVE.segmentSec),
    max_combo: scoring.maxCombo, frenzy_count: scoring.frenzyCount,
    failed, practice: !mode.failEnabled,
    completed_pct: Math.max(0, Math.min(100, Math.round((songTime / chart.duration) * 100))),
    input_source: gaze.mouseOverride && gaze.source !== 'mouse' ? 'mouse' : gaze.source,
    calibration_score: gaze.calibrationScore,
    tracking: stats,
    game_version: '1.0.0', engine_version: VERSIONS.app, feature_version: VERSIONS.features,
  };
}

const PRACTICE_NOTE = {
  S: 'Flawless! You are ready for Normal mode.',
  A: 'Excellent run. Try Normal mode next.',
  B: 'Nice! Keep practising the curves.',
  C: 'Song complete. Practice makes perfect!',
};

export default function results(root, app, { result }) {
  const failed = result.failed;
  const el = html(`
    <section class="screen">
      <h2>${failed ? 'Song failed' : result.practice ? 'Practice complete' : 'Song complete'}</h2>
      <div class="results">
        <div><div class="grade ${result.grade}">${result.grade}</div>
          ${result.practice ? `<div class="hint" style="max-width:260px">${PRACTICE_NOTE[result.grade]}</div>` : ''}
          ${failed ? `<div class="hint">Made it ${result.completed_pct}% of the way</div>` : ''}</div>
        <dl class="stats">
          <dt>Song</dt><dd>${esc(result.song_title)}</dd>${songById(result.song_id)?.attribution ? `<dt>Credit</dt><dd class="hud-attr">${esc(songById(result.song_id).attribution)}</dd>` : ''}
          <dt>Difficulty</dt><dd>${esc(result.mode_label)}</dd>
          <dt>Score</dt><dd>${result.score.toLocaleString()}</dd>
          <dt>Accuracy</dt><dd>${result.accuracy}%</dd>
          <dt class="perfect">Perfect</dt><dd class="perfect">${result.perfect}</dd>
          <dt class="good">Good</dt><dd class="good">${result.good}</dd>
          <dt class="miss">Miss</dt><dd class="miss">${result.miss}</dd>
          <dt>Max combo</dt><dd>${result.max_combo}</dd>
          <dt>Frenzy</dt><dd>${result.frenzy_count}×</dd>
          ${result.tracking?.cell_pct != null ? `<dt>Tracking</dt><dd title="time the tracker put your gaze on the right lane and band">${result.tracking.cell_pct}% on target</dd>` : ''}
        </dl>
      </div>
      <p class="hint" style="font-size:15px">Accuracy = (Perfect + 0.6 × Good) ÷ all notes judged. Tracking = time the tracker had your gaze on the right lane and band (timing not included).${result.input_source !== 'live' ? ' <b>Played with simulated/mouse input (dev).</b>' : ''}</p>
      <div class="row" data-buttons></div>
    </section>`);
  root.appendChild(el);
  const retry = () => startSong(app, result.song_id);
  el.querySelector('[data-buttons]').append(
    gazeButton(failed ? 'Try again' : 'Retry', retry),
    ...(failed ? [] : [gazeButton('Song select', () => app.go('songs'), { cls: 'purple' })]),
    gazeButton('Home', () => app.go('title'), { cls: 'purple', sound: 'back' }),
  );
  return { onEscape: () => app.go('songs') };
}
