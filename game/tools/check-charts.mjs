// npm run check-charts -> validates every chart and checks it is playable with the eyes:
// format, notes inside the audio, no straight note while a curve is active, and enough
// time between notes in different columns for the eyes to move.
import { readdir, readFile, stat } from 'node:fs/promises';
import { parseChart } from '../src/gameplay/chart.js';

const root = new URL('../src/songs/', import.meta.url);
const MIN_MOVE_SEC = { practice: 0.7, normal: 0.35, hard: 0.24 };
let problems = 0;
const fail = msg => { problems++; console.log(`  ✗ ${msg}`); };

for (const folder of (await readdir(root)).sort()) {
  if (!(await stat(new URL(folder, root))).isDirectory()) continue;
  const song = JSON.parse(await readFile(new URL(`${folder}/song.json`, root), 'utf8'));
  console.log(`${song.title}`);
  for (const difficulty of ['practice', 'normal', 'hard']) {
    let chart;
    try { chart = parseChart(JSON.parse(await readFile(new URL(`${folder}/chart.${difficulty}.json`, root), 'utf8'))); }
    catch (e) { fail(`${difficulty}: ${e.message}`); continue; }
    const curves = chart.notes.filter(n => n.type === 'curve'), straight = chart.notes.filter(n => n.type === 'straight');
    if (chart.duration > song.durationSec) fail(`${difficulty}: notes run past the audio (${chart.duration}s > ${song.durationSec}s)`);
    for (const s of straight) if (curves.some(c => s.t > c.t - 0.2 && s.t < c.end + 0.2)) fail(`${difficulty}: straight note at ${s.t}s overlaps a curve`);
    for (let i = 1; i < straight.length; i++) {
      const a = straight[i - 1], b = straight[i];
      if (a.lane !== b.lane && b.t - a.t < MIN_MOVE_SEC[difficulty]) fail(`${difficulty}: ${b.t}s column jump only ${(b.t - a.t).toFixed(2)}s after the previous note`);
    }
    console.log(`  ${difficulty.padEnd(8)} ${String(straight.length).padStart(3)} straight, ${curves.length} curves (${curves.reduce((s, c) => s + c.end - c.t, 0).toFixed(1)} s of following)`);
  }
}
console.log(problems ? `\n${problems} problem(s)` : '\nall charts OK');
process.exit(problems ? 1 : 0);
