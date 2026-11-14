// Score recorded sessions offline.
//   npm run replay                          every clip in recordings/
//   npm run replay -- recordings/a.json     one clip, in detail
//   npm run replay -- some/folder           every clip in that folder
// Prints two tables (calibration dots, test run) and writes scores.csv next to the clips.
// Test-run numbers come from pushing the frames through the CURRENT engine code, so after a
// code change, re-running this shows whether it helped on real data.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conditionsOf, evaluateRecording } from '../src/simulator/evaluate.js';
import { evaluatePlay } from '../src/simulator/evaluate-play.js';
import { mean } from '../src/util/math.js';

const pct = v => (Number.isFinite(v) ? +(v * 100).toFixed(1) : null);
const target = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'recordings');

function score(file) {
  const rec = JSON.parse(readFileSync(file, 'utf8')), cal = evaluateRecording(rec), c = conditionsOf(rec);
  const play = evaluatePlay(rec)?.replay;
  return {
    clip: basename(file, '.json'),
    partial: cal.dots > 0 && cal.dots < 12 ? cal.dots : 0,
    cal: cal.dots >= 12 ? { dots: cal.dots, score: cal.fullScore, 'x err %': pct(cal.errorX), 'y err %': pct(cal.errorY), 'lanes %': pct(cal.laneAccuracy), 'bands %': pct(cal.bandAccuracy) } : null,
    play: play ? {
      'jump hit %': pct(play.jumps?.hitRate), 'jump ms': play.jumps?.reactionMs ?? null, 'jump on %': pct(play.jumps?.onTarget),
      'path err %': pct(play.path?.errorAtLag), 'path lag ms': play.path?.lagMs ?? null, 'path lane %': pct(play.path?.lane),
      'switch hit %': pct(play.switch?.hitRate), 'switch ms': play.switch?.reactionMs ?? null, 'switch on %': pct(play.switch?.onTarget),
    } : null,
    cond: { light: Math.round(c.light), contrast: +c.pupilContrast.toFixed(2), 'glare %': pct(c.glare), fps: Math.round(c.fps) },
  };
}

function table(title, rows) {
  if (!rows.length) return;
  console.log(`\n${title}`);
  console.table(rows);
  const keys = Object.keys(rows[0]).slice(1);
  const avg = Object.fromEntries(keys.map(k => { const v = rows.map(r => r[k]).filter(Number.isFinite); return [k, v.length ? +mean(v).toFixed(1) : null]; }));
  console.log(`average of ${rows.length}:`, avg);
}

if (statSync(target).isDirectory()) {
  const results = [], skipped = [];
  for (const name of readdirSync(target).filter(n => n.endsWith('.json')).sort()) {
    try {
      const r = score(join(target, name));
      if (r.cal || r.play) results.push(r);
      else skipped.push(`${name} (${r.partial ? `calibration stopped after ${r.partial} of 16 dots` : 'nothing to score'})`);
    } catch (e) { skipped.push(`${name} (${e.message})`); }
  }
  if (!results.length) { console.log(`No scorable clips in ${target}.`); process.exit(0); }
  table('CALIBRATION DOTS (held-out: calibrated on half the dots, tested on the rest)', results.filter(r => r.cal).map(r => ({ clip: r.clip, ...r.cal, ...r.cond })));
  table('TEST RUN (replayed through the current code)', results.filter(r => r.play).map(r => ({ clip: r.clip, ...r.play })));
  if (skipped.length) console.log(`\nSkipped: ${skipped.join(', ')}`);
  const cols = ['dots', 'score', 'x err %', 'y err %', 'lanes %', 'bands %', 'jump hit %', 'jump ms', 'jump on %', 'path err %', 'path lag ms', 'path lane %', 'switch hit %', 'switch ms', 'switch on %', 'light', 'contrast', 'glare %', 'fps'];
  const csv = [['clip', ...cols].join(','), ...results.map(r => { const all = { ...r.cal, ...r.play, ...r.cond }; return [r.clip, ...cols.map(k => all[k] ?? '')].join(','); })];
  writeFileSync(join(target, 'scores.csv'), csv.join('\n') + '\n');
  console.log(`\nWrote ${join(target, 'scores.csv')}`);
} else {
  const rec = JSON.parse(readFileSync(target, 'utf8')), r = score(target), cal = evaluateRecording(rec), play = evaluatePlay(rec);
  console.log(r.clip, r.cond);
  if (r.cal) { console.table([r.cal]); console.table(cal.perPoint.map(p => ({ x: p.target.x, y: p.target.y, steadiness: +p.steadiness.toFixed(2), 'x err %': pct(p.errorX), 'y err %': pct(p.errorY) }))); }
  if (play) {
    const view = v => v && { 'jump hit %': pct(v.jumps?.hitRate), 'jump on %': pct(v.jumps?.onTarget), 'path err %': pct(v.path?.errorAtLag), 'path lag ms': v.path?.lagMs, 'switch hit %': pct(v.switch?.hitRate), 'switch on %': pct(v.switch?.onTarget) };
    console.log('test run: replayed through the current code, and as reported live when recorded');
    console.table({ replay: view(play.replay), live: view(play.live) });
  }
}
