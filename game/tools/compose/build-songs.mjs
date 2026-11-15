// npm run songs  -> renders every song in tools/compose/songs/ into src/songs/<id>/:
//   audio.wav, song.json (metadata + licence), chart.practice|normal|hard.json
// Run it again after changing a song file. Hand-edited charts are overwritten, so edit the
// song file (or copy the chart under a new name) if you want to keep manual changes.
//   npm run songs -- pulse-runner     only that song
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createComposer } from './composer.mjs';
import { generateChart } from './chartgen.mjs';
import { toWav } from './synth.mjs';

const only = process.argv[2];
const songsDir = new URL('./songs/', import.meta.url);
const outRoot = new URL('../../src/songs/', import.meta.url);

for (const file of (await readdir(songsDir)).filter(f => f.endsWith('.mjs')).sort()) {
  const { meta, compose } = await import(new URL(file, songsDir));
  if (only && meta.id !== only) continue;
  const started = Date.now();
  const c = createComposer({ bpm: meta.bpm, bars: meta.bars });
  compose(c);
  const audio = c.render();
  const dir = new URL(`${meta.id}/`, outRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL('audio.wav', dir), toWav(audio));
  const charts = {};
  for (const difficulty of ['practice', 'normal', 'hard']) {
    const chart = generateChart(c.events, meta.id, difficulty);
    charts[difficulty] = chart.notes.length;
    await writeFile(new URL(`chart.${difficulty}.json`, dir), stringifyChart(chart));
  }
  const song = {
    id: meta.id, title: meta.title, subtitle: meta.subtitle, artist: 'RhythmEyez team (original composition)',
    bpm: meta.bpm, durationSec: Math.round(c.totalSec * 100) / 100, previewStart: meta.previewStart, previewSec: 8,
    audio: 'audio.wav', palette: meta.palette,
    license: {
      name: 'Original work of the RhythmEyez team',
      notes: 'Composed and synthesized from code in tools/compose/ (no samples, no third-party audio). Free to use and redistribute with this project.',
      source: `tools/compose/songs/${file}`,
    },
  };
  await writeFile(new URL('song.json', dir), `${JSON.stringify(song, null, 2)}\n`);
  console.log(`${meta.id}: ${song.durationSec}s, notes ${JSON.stringify(charts)} (${Date.now() - started} ms)`);
}

/** One note per line, so charts stay readable and diff well when edited by hand. */
export function stringifyChart({ notes, ...head }) {
  const top = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  return `{\n${top}\n  "notes": [\n${notes.map(n => `    ${JSON.stringify(n)}`).join(',\n')}\n  ]\n}\n`;
}
