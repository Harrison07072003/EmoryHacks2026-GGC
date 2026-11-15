// Song registry. Every folder in src/songs/ with a song.json is a song; drop in a new
// folder (song.json + audio + chart.<difficulty>.json) and it appears in the menu.
// See docs/CHARTS.md for the file formats.
import { parseChart } from '../gameplay/chart.js';

const metas = import.meta.glob('./*/song.json', { eager: true, import: 'default' });
const charts = import.meta.glob('./*/chart.*.json', { import: 'default' });
const audio = import.meta.glob('./*/*.{wav,mp3,ogg,m4a}', { eager: true, query: '?url', import: 'default' });

const folderOf = path => path.split('/')[1];

/** Order shown in the menu (others follow alphabetically). */
const ORDER = ['neon-lullaby', 'pulse-runner', 'overdrive-protocol'];

export const SONGS = Object.entries(metas)
  .map(([path, meta]) => {
    const folder = folderOf(path);
    return { ...meta, folder, audioUrl: audio[`./${folder}/${meta.audio}`] };
  })
  .sort((a, b) => ((ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99)) || a.id.localeCompare(b.id));

export const songById = id => SONGS.find(s => s.id === id);

/** Load and validate the chart for a song and difficulty. */
export async function loadChart(song, difficulty) {
  const loader = charts[`./${song.folder}/chart.${difficulty}.json`];
  if (!loader) throw new Error(`No ${difficulty} chart for ${song.title}`);
  return parseChart(await loader());
}
