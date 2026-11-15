// Regression: the Online Library must not change how built-in songs resolve or load.
// Every song folder in src/songs/ must load through songById/loadChart exactly as its files say.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SONGS, loadChart, songById } from '../src/songs/index.js';
import { parseChart } from '../src/gameplay/chart.js';
import { registerOnlineSong } from '../src/online/registry.js';
import { validateChart } from '../src/services/chartgen/validate.js';

const root = new URL('../src/songs/', import.meta.url);
const folders = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

describe('built-in songs after adding the Online Library', () => {
  it('the song list is exactly the song folders, in the original menu order', () => {
    expect(SONGS.map(s => s.folder).sort()).toEqual(folders);
    expect(SONGS.map(s => s.id)).toEqual(['neon-lullaby', 'pulse-runner', 'overdrive-protocol']);
    expect(SONGS.some(s => s.online)).toBe(false);
  });

  for (const folder of folders) {
    const meta = json(`${folder}/song.json`);
    it(`${meta.id}: metadata and every chart load unchanged`, async () => {
      const song = songById(meta.id);
      expect(song).toMatchObject(meta);
      expect(song.audioUrl).toBeTruthy();
      for (const difficulty of ['practice', 'normal', 'hard']) {
        const fromDisk = parseChart(json(`${folder}/chart.${difficulty}.json`));
        expect(await loadChart(song, difficulty)).toEqual(fromDisk);
        expect(validateChart(json(`${folder}/chart.${difficulty}.json`), { durationSec: meta.durationSec })).toEqual([]);
      }
    });
  }

  it('built-in songs always resolve first, even if a generated level used the same id', () => {
    const builtIn = SONGS[0];
    registerOnlineSong({ id: builtIn.id, title: 'impostor', online: true, charts: {} });
    expect(songById(builtIn.id)).toBe(builtIn);
  });

  it('generated levels resolve after built-ins and load from memory', async () => {
    const chart = { format: 1, song: 'ia_x_1', difficulty: 'normal', notes: [{ type: 'straight', t: 2, lane: 1 }] };
    registerOnlineSong({ id: 'ia_x_1', title: 'Generated', online: true, charts: { normal: chart } });
    const song = songById('ia_x_1');
    expect(song.title).toBe('Generated');
    expect((await loadChart(song, 'normal')).notes).toHaveLength(1);
    await expect(loadChart(song, 'hard')).rejects.toThrow(/No hard chart/);
    expect(songById('nope')).toBeUndefined();
  });
});
