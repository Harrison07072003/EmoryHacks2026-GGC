// Score recorded sessions offline.
//   npm run replay                          every clip in recordings/, one row each
//   npm run replay -- recordings/a.json     one clip, with a row per held-out dot
//   npm run replay -- some/folder           every clip in that folder
// A batch run also writes scores.csv next to the clips.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conditionsOf, evaluateRecording } from '../src/simulator/evaluate.js';
import { mean } from '../src/util/math.js';

const pct = v => (Number.isFinite(v) ? +(v * 100).toFixed(1) : null);
const target = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'recordings');
const load = file => JSON.parse(readFileSync(file, 'utf8'));

if (statSync(target).isDirectory()) batch(target); else single(target);

function row(file) {
  const rec = load(file), r = evaluateRecording(rec), c = conditionsOf(rec);
  return {
    clip: basename(file, '.json'), dots: r.dots, score: r.fullScore,
    'x err %': pct(r.errorX), 'y err %': pct(r.errorY), 'lanes %': pct(r.laneAccuracy), 'bands %': pct(r.bandAccuracy),
    light: Math.round(c.light), contrast: +c.pupilContrast.toFixed(2), 'glare %': pct(c.glare), fps: Math.round(c.fps),
  };
}

function batch(dir) {
  const rows = [], skipped = [];
  for (const name of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    try {
      const r = row(join(dir, name));
      if (r.dots >= 4) rows.push(r); else skipped.push(`${name} (no calibration in it)`);
    } catch (e) { skipped.push(`${name} (${e.message})`); }
  }
  if (!rows.length) return console.log(`No scorable clips in ${dir}. Record one on /debug.html with a calibration in it.`);
  console.table(rows);
  const cols = Object.keys(rows[0]).slice(2), avg = Object.fromEntries(cols.map(k => [k, +mean(rows.map(r => r[k]).filter(v => v !== null)).toFixed(1)]));
  console.log(`Average of ${rows.length} clip(s):`, avg);
  console.log('Errors are % of screen on held-out dots (calibrated on half the dots), so live play should be a little better.');
  if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
  const csv = [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).join(','))].join('\n');
  writeFileSync(join(dir, 'scores.csv'), csv + '\n');
  console.log(`Wrote ${join(dir, 'scores.csv')}`);
}

function single(file) {
  const r = evaluateRecording(load(file));
  console.table([row(file)]);
  console.table(r.perPoint.map(p => ({ x: p.target.x, y: p.target.y, steadiness: +p.steadiness.toFixed(2), 'x err %': pct(p.errorX), 'y err %': pct(p.errorY) })));
}
