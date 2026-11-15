// Level preparation in the client: server charts, browser fallback when the server is down,
// refusals, and the song object handed to the normal loader.
import { describe, expect, it, vi } from 'vitest';
import { LevelError, paletteFor, prepareLevel, toLevelSong } from '../src/online/level.js';
import { createSegmentLoader, withFadeOut } from '../src/online/audio-segment.js';
import { loadChart, songById } from '../src/songs/index.js';
import { validateChart } from '../src/services/chartgen/validate.js';

const RATE = 22050;
function fakeCtx() {
  const buffer = (channels, sampleRate) => ({
    numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate,
    getChannelData: c => channels[c],
  });
  return {
    createBuffer: (n, length, rate) => buffer(Array.from({ length: n }, () => new Float32Array(length)), rate),
    // "decodes" 32 s of clicks at 120 BPM
    decodeAudioData: async () => {
      const x = new Float32Array(RATE * 32);
      for (let t = 0.5; t < 31; t += 0.5) for (let i = 0; i < 1500; i++) x[Math.round(t * RATE) + i] = Math.sin(i / 2) * Math.exp(-i / 250);
      return buffer([x], RATE);
    },
  };
}
const song = { id: 'ia_test_1', title: 'Test', artist: 'Someone', licenseName: 'CC BY 4.0', attribution: '"Test" by Someone · CC BY 4.0', itemUrl: 'https://archive.org/details/t', audioUrl: 'https://archive.org/download/t/a.mp3', bitrateKbps: 128 };
const audioResponse = () => ({ ok: true, status: 206, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(100) });

function makeApp(serverResponse) {
  const ctx = fakeCtx();
  globalThis.fetch = vi.fn(async url => (String(url).includes('/charts/') ? serverResponse() : audioResponse()));
  return {
    audio: { ctx },
    music: { preload: vi.fn() },
    online: { config: { serverUrl: 'https://server.example' }, segments: createSegmentLoader(ctx, { fetchFn: (...a) => globalThis.fetch(...a) }) },
  };
}

describe('prepareLevel', () => {
  it('generates in the browser when the server is unreachable, and the level loads normally', async () => {
    const app = makeApp(() => { throw new TypeError('Failed to fetch'); });
    const steps = [];
    const { song: level, source } = await prepareLevel(app, song, { onStep: s => steps.push(s) });
    expect(steps).toEqual(['download', 'analyze', 'ready']);
    expect(source).toBe('browser');
    expect(level).toMatchObject({ id: 'ia_test_1', online: true, generated: true, attribution: song.attribution, audioUrl: 'online:ia_test_1' });
    expect(level.levelEndSec).toBeCloseTo(30, 1);   // only the first 30 s
    expect(app.music.preload).toHaveBeenCalledWith('online:ia_test_1', expect.objectContaining({ sampleRate: RATE }));
    expect(songById('ia_test_1')).toBe(level);
    for (const d of ['practice', 'normal', 'hard']) {
      expect((await loadChart(level, d)).notes.length).toBeGreaterThan(0);
      expect(validateChart(level.charts[d], { durationSec: 30 })).toEqual([]);
    }
  });

  it('also falls back when the server answers 5xx / busy', async () => {
    const app = makeApp(() => ({ ok: false, status: 503, json: async () => ({ error: 'busy' }) }));
    expect((await prepareLevel(app, song)).source).toBe('browser');
  });

  it('uses the server\'s charts when it has them', async () => {
    const chart = d => ({ format: 1, song: 'x', difficulty: d, notes: [{ type: 'straight', t: 2, lane: 1 }] });
    const app = makeApp(() => ({ ok: true, status: 200, json: async () => ({ cached: true, meta: { bpm: 99 }, charts: { practice: chart('practice'), normal: chart('normal'), hard: chart('hard') } }) }));
    const { song: level, source } = await prepareLevel(app, song);
    expect(source).toBe('cache');
    expect(level.bpm).toBe(99);
  });

  it('does not work around a refusal: 404 (not allowed) is an error, not a fallback', async () => {
    const app = makeApp(() => ({ ok: false, status: 404, json: async () => ({ error: 'song not available: license' }) }));
    const err = await prepareLevel(app, song).catch(e => e);
    expect(err).toBeInstanceOf(LevelError);
    expect(err.retry).toBe(false);
  });

  it('reports a failed download as retryable', async () => {
    const app = makeApp(() => audioResponse());
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null } }));
    const err = await prepareLevel(app, song).catch(e => e);
    expect(err).toBeInstanceOf(LevelError);
    expect(err.retry).toBe(true);
  });
});

describe('level helpers', () => {
  it('fades the last 1.5 s to silence', () => {
    const ctx = fakeCtx();
    const src = ctx.createBuffer(1, RATE * 3, RATE);
    src.getChannelData(0).fill(1);
    const out = withFadeOut(ctx, src, 1.5);
    const d = out.getChannelData(0);
    expect(d[0]).toBe(1);
    expect(d[Math.round(RATE * 1.4)]).toBe(1);
    expect(d[Math.round(RATE * 2.25)]).toBeCloseTo(0.5, 1);
    expect(d.at(-1)).toBeLessThan(0.01);
    expect(src.getChannelData(0).at(-1)).toBe(1);   // the cached original is untouched
  });

  it('picks a palette deterministically from the song id', () => {
    expect(paletteFor('ia_a_1')).toBe(paletteFor('ia_a_1'));
    expect(paletteFor('ia_a_1')).toHaveProperty('accent');
  });

  it('builds a song object shaped like a built-in song.json', () => {
    const s = toLevelSong(song, { charts: {}, meta: { bpm: 0 } }, 30);
    expect(s).toMatchObject({ title: 'Test', subtitle: 'Someone', bpm: 120, durationSec: 30, previewStart: 0, license: { name: 'CC BY 4.0', source: 'https://archive.org/details/t' } });
  });
});
