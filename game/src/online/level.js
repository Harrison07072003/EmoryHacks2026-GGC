// Archive song -> playable level, through the game's normal song/chart loading:
//
//   Downloading  the first 30 s of audio (HTTP Range from archive.org; server proxy as fallback)
//   Analyzing    charts from the game server (shared cache, BPM/difficulty written to Typesense);
//                if the server is unreachable, the same generator runs here in the browser
//   Ready        registered as a song (src/online/registry.js), so play.js loads it like any other
import { DIFFICULTIES, NotASongError, generateCharts } from '../services/chartgen/generate.js';
import { seededRandom } from '../services/chartgen/dsp.js';
import { parseChart } from '../gameplay/chart.js';
import { SONGS } from '../songs/index.js';
import { withFadeOut } from './audio-segment.js';
import { clearOnlineSongs, registerOnlineSong } from './registry.js';
import { getOnline, LEVEL_SEC } from './session.js';

const FADE_SEC = 1.5;
const NOT_A_SONG = 'This track does not have a clear enough beat to make a level. Try another song.';
const SERVER_TIMEOUT_MS = 75000;

export class LevelError extends Error {
  constructor(message, { retry = true } = {}) { super(message); this.retry = retry; }
}

const EXTRA_PALETTES = [
  { bg1: '#120a1f', bg2: '#2a0f3d', lane: '#c77dff', accent: '#ffd166', straight: '#7cf5ff', curve: '#ff7ab6', glow: '#c77dff' },
  { bg1: '#06140c', bg2: '#0d2e1d', lane: '#64ffb2', accent: '#ff9f43', straight: '#c6ff4d', curve: '#4dd8ff', glow: '#64ffb2' },
];
/** A built-in look, picked deterministically from the song id. */
export function paletteFor(id) {
  const all = [...SONGS.map(s => s.palette), ...EXTRA_PALETTES];
  return all[Math.floor(seededRandom(id)() * all.length)];
}

async function serverCharts(serverUrl, id, signal) {
  const ctrl = new AbortController(), stop = () => ctrl.abort();
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, SERVER_TIMEOUT_MS);
  try {
    const res = await fetch(`${serverUrl}/charts/${encodeURIComponent(id)}`, { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `server error ${res.status}`), { status: res.status });
    return body;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

const channelsOf = buffer => Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
const nextFrame = () => new Promise(r => setTimeout(r, 30));   // let the "Analyzing" step paint first

/** The song object play.js gets (same shape as a built-in song.json, plus the charts). */
export function toLevelSong(song, { charts, meta }, levelSec) {
  return {
    id: song.id, title: song.title, subtitle: song.artist, artist: song.artist,
    bpm: meta.bpm || 120, durationSec: levelSec, previewStart: 0, previewSec: 10,
    audio: null, audioUrl: `online:${song.id}`,
    palette: paletteFor(song.id),
    license: { name: song.licenseName, notes: song.attribution, source: song.itemUrl },
    attribution: song.attribution,
    online: true, generated: true, levelEndSec: levelSec,
    charts, meta,
  };
}

/**
 * @param onStep  called with 'download' | 'analyze' | 'ready'
 * @returns {{ song, source: 'server'|'cache'|'browser' }}
 */
export async function prepareLevel(app, song, { onStep = () => {}, signal } = {}) {
  const online = getOnline(app), { serverUrl } = online.config;

  onStep('download');
  const fallbackUrl = serverUrl ? `${serverUrl}/audio/${encodeURIComponent(song.id)}` : null;
  let buffer;
  try { buffer = await online.segments.get({ ...song, fallbackUrl }, LEVEL_SEC, { signal }); }
  catch (e) { if (signal?.aborted) throw e; throw new LevelError('The song could not be downloaded. Check your connection and try again.'); }
  if (buffer.duration < 10) throw new LevelError('This song is too short to make a level.', { retry: false });
  const level = withFadeOut(app.audio.ctx, buffer, FADE_SEC);

  onStep('analyze');
  let entry = null, source = 'server';
  if (serverUrl) {
    try { entry = await serverCharts(serverUrl, song.id, signal); if (entry.cached) source = 'cache'; }
    catch (e) {
      if (signal?.aborted) throw e;
      if (e.status === 404) throw new LevelError(/not a playable song/.test(e.message) ? NOT_A_SONG : 'This song is not available.', { retry: false });
      if (e.status === 429) throw new LevelError('Too many new levels at once. Wait a minute and try again.');
      entry = null;   // server down or failing: generate here instead
    }
  }
  if (!entry) {
    source = 'browser';
    await nextFrame();
    try { entry = generateCharts({ channels: channelsOf(level), sampleRate: level.sampleRate, songId: song.id, levelSec: LEVEL_SEC }); }
    catch (e) { throw new LevelError(e instanceof NotASongError ? NOT_A_SONG : `A level could not be made from this song (${e.message}).`, { retry: false }); }
  }
  for (const d of DIFFICULTIES) {
    try { parseChart(entry.charts?.[d]); } catch { throw new LevelError('The generated level was invalid.', { retry: false }); }
  }

  const levelSong = registerOnlineSong(toLevelSong(song, entry, level.duration));
  app.music.preload(levelSong.audioUrl, level);
  dropLevelsAfterStage(app);
  onStep('ready');
  return { song: levelSong, source };
}

// Screens that belong to playing a stage. Leaving them for anything else (song select, search,
// title...) discards the generated level: nothing about an archive song is kept.
const STAGE_SCREENS = new Set(['play', 'results', 'calibration', 'faceCheck']);
const watching = new WeakSet();

export function dropLevelsAfterStage(app) {
  if (watching.has(app) || !app.onScreen) return;
  watching.add(app);
  app.onScreen(name => { if (!STAGE_SCREENS.has(name)) discardLevels(app); });
}

/** Forget every generated level, its decoded audio and its downloaded bytes. */
export function discardLevels(app) {
  for (const song of clearOnlineSongs()) {
    app.music.forget?.(song.audioUrl);
    app.online?.segments?.forget?.(song.id);
  }
}
