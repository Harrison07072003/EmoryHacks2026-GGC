import { describe, expect, it } from 'vitest';
import { memoryStore } from '../../eye-controller/src/storage/kv.js';
import { createGameStore } from '../src/data/game-store.js';
import { createSupabaseClient, supabaseConfig } from '../src/data/supabase.js';

const result = (over = {}) => ({ song_id: 's', difficulty: 'normal', score: 1000, grade: 'A', failed: false, input_source: 'live', ...over });

describe('game store (local)', () => {
  it('saves results and reports best completed live scores', async () => {
    const store = createGameStore(memoryStore());
    await store.saveResult(result({ score: 500 }));
    await store.saveResult(result({ score: 900 }));
    await store.saveResult(result({ score: 5000, failed: true, grade: 'F' }));
    await store.saveResult(result({ score: 9999, input_source: 'mouse' }));
    expect((await store.listResults())).toHaveLength(4);
    expect((await store.bestScores())['s:normal'].score).toBe(900);
    expect((await store.bestScores({ includeDev: true }))['s:normal'].score).toBe(9999);
  });

  it('keeps only the last few local tracking sessions', async () => {
    const kv = memoryStore(), store = createGameStore(kv), send = store.trackingSink();
    for (let i = 0; i < 5; i++) {
      await send({ type: 'session', id: `s${i}`, started_at: `2026-01-0${i + 1}` });
      await send({ type: 'samples', id: `s${i}:0`, session_id: `s${i}`, samples: [{ t: 1 }] });
    }
    const sessions = new Set((await kv.keys('tracking:')).map(k => k.split(':')[1]));
    expect([...sessions].sort()).toEqual(['s2', 's3', 's4']);
  });
});

describe('game store (Supabase)', () => {
  it('is off unless both env variables are set', () => {
    expect(supabaseConfig({})).toBeNull();
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co/', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({ url: 'https://x.supabase.co', key: 'k' });
  });

  it('upserts on id, and keeps failed rows in the outbox for retry', async () => {
    const calls = [];
    let up = false;
    const fetchFn = async (url, init) => { calls.push({ url, init }); return up ? { ok: true } : { ok: false, status: 503, text: async () => 'down' }; };
    const kv = memoryStore();
    const store = createGameStore(kv, createSupabaseClient({ url: 'https://x', key: 'k' }, fetchFn));
    const row = await store.saveResult(result());
    expect(calls[0].url).toBe('https://x/rest/v1/game_results?on_conflict=id');
    expect(calls[0].init.headers.Prefer).toContain('ignore-duplicates');
    expect(store.status.pending).toBe(1);
    expect(store.status.lastError).toContain('503');
    up = true;
    expect(await store.flushOutbox()).toBe(true);
    expect(JSON.parse(calls.at(-1).init.body)[0].id).toBe(row.id); // same id on retry: no duplicates
    expect(store.status.pending).toBe(0);
  });
});
