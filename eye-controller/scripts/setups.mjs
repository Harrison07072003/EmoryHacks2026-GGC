// Compare setups from the setup tester (setup.html).
//   npm run setups
// Table 1: every saved setup (setups/*.json): its tags, live measurements, eye range, score.
// Table 2: every test run recorded from the setup tester (recordings with meta.setup): the
// same setup numbers next to how well that run actually tracked, plus correlations once
// there are enough runs. That is how the ideal seat / camera / screen tilt gets decided.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePlay } from '../src/simulator/evaluate-play.js';
import { mean } from '../src/util/math.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = dir => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter(n => n.endsWith('.json')).sort().map(n => ({ n, d: JSON.parse(readFileSync(join(root, dir, n), 'utf8')) })) : []);
const r3 = v => (v == null ? null : +v.toFixed(3));
const row = s => ({
  player: s.player, distance: s.tags?.distance, camera: s.tags?.camera, tilt: s.tags?.tilt, glasses: s.tags?.glasses ? 'yes' : 'no',
  'face w': r3(s.gauges?.faceWidth), 'face y': r3(s.gauges?.faceY), pitch: r3(s.gauges?.pitch), 'eye px': s.gauges?.eyePx ? Math.round(s.gauges.eyePx) : null,
  'h range': r3(s.range?.h), 'v range': r3(s.range?.v), score: s.score,
});

const setups = read('setups').map(({ d }) => row(d));
if (setups.length) { console.log('\nSETUPS (setups/)'); console.table(setups); } else console.log('\nNo saved setups yet: use setup.html, run the range test, then Save setup.');

const runs = read('recordings').filter(({ d }) => d.meta?.setup).map(({ n, d }) => {
  const p = evaluatePlay(d)?.replay, pct = v => (v == null ? null : Math.round(v * 100));
  return { clip: n.replace(/_\d{4}-.*$/, ''), ...row(d.meta.setup), 'jump on %': pct(p?.jumps?.onTarget), 'switch on %': pct(p?.switch?.onTarget), 'path lane %': pct(p?.path?.lane) };
});
if (!runs.length) { console.log('No test runs from the setup tester yet: use "Calibrate + test run".'); process.exit(0); }
console.log('\nTEST RUNS FROM THE SETUP TESTER (recordings/ with a setup attached)');
console.table(runs);
if (runs.length >= 4) {
  const corr = (a, b) => {
    const xs = runs.map(r => r[a]), ys = runs.map(r => r[b]), ok = xs.map((x, i) => x != null && ys[i] != null);
    const X = xs.filter((_, i) => ok[i]), Y = ys.filter((_, i) => ok[i]);
    if (X.length < 4) return '–';
    const mx = mean(X), my = mean(Y); let s = 0, sx = 0, sy = 0;
    X.forEach((x, i) => { s += (x - mx) * (Y[i] - my); sx += (x - mx) ** 2; sy += (Y[i] - my) ** 2; });
    return sx && sy ? (s / Math.sqrt(sx * sy)).toFixed(2) : '–';
  };
  console.log('\nHow each setup number goes with tracking (correlation, -1..1; ±0.5 or more is a strong link):');
  console.table(['face w', 'face y', 'pitch', 'eye px', 'h range', 'v range', 'score'].map(k => ({ measure: k, 'jump on %': corr(k, 'jump on %'), 'switch on %': corr(k, 'switch on %') })));
} else console.log(`\n${runs.length} test run(s): correlations appear from 4.`);
