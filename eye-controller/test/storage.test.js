import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { indexedDbStore, localStorageStore, memoryStore } from '../src/storage/kv.js';
import { profileStore, toProfile } from '../src/storage/profiles.js';
import { baselineStore, contribute, emptyBaseline, isValidBaseline, mergeBaselines } from '../src/storage/baseline.js';
import { fitCalibration } from '../src/calibration/fit.js';
import { defaultTargets } from '../src/calibration/targets.js';
import { SyntheticSource } from '../src/simulator/synthetic-source.js';
import { FEATURE_VERSION } from '../src/cv/features.js';
import { gramFromJSON } from '../src/model/ridge.js';

function fakeLocalStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i], get length() { return m.size; } };
}
const STORES = {
  memory: () => memoryStore(),
  localStorage: () => localStorageStore('test', fakeLocalStorage()),
  indexedDB: () => indexedDbStore('test', new IDBFactory()),
};
const calibration = seed => fitCalibration(new SyntheticSource({ seed, clock: 'manual' }).instantPoints(defaultTargets()));

for (const [name, make] of Object.entries(STORES)) {
  describe(`key-value store: ${name}`, () => {
    it('round-trips values and returns null for missing keys', async () => {
      const kv = make();
      expect(await kv.get('nope')).toBeNull();
      await kv.set('a', { n: 1, list: [1, 2, 3], nested: { ok: true } });
      expect(await kv.get('a')).toEqual({ n: 1, list: [1, 2, 3], nested: { ok: true } });
      await kv.set('a', { n: 2 });
      expect(await kv.get('a')).toEqual({ n: 2 });
    });
    it('deletes and lists keys by prefix', async () => {
      const kv = make();
      await kv.set('profile:ann', 1); await kv.set('profile:bob', 2); await kv.set('baseline', 3);
      expect((await kv.keys('profile:')).sort()).toEqual(['profile:ann', 'profile:bob']);
      await kv.delete('profile:ann');
      expect(await kv.keys('profile:')).toEqual(['profile:bob']);
      expect(await kv.get('profile:ann')).toBeNull();
    });
    it('does not hand back a live reference', async () => {
      const kv = make(), value = { list: [1] };
      await kv.set('k', value);
      value.list.push(2);
      expect((await kv.get('k')).list).toEqual([1]);
    });
    it('stores a profile and a baseline that refit to the same model', async () => {
      const kv = make(), profiles = profileStore(kv), baselines = baselineStore(kv), cal = calibration(4);
      await profiles.save(toProfile('ann', cal));
      const loaded = await profiles.load('ann');
      expect(await profiles.list()).toEqual(['ann']);
      expect(loaded.points).toHaveLength(16);
      const refit = fitCalibration(loaded.points);
      expect(refit.score).toBe(cal.score);
      expect(refit.model.both.wx[0]).toBeCloseTo(cal.model.both.wx[0], 2);
      await baselines.save(contribute(emptyBaseline(), cal.gram));
      expect((await baselines.load()).players).toBe(1);
      await profiles.remove('ann');
      expect(await profiles.load('ann')).toBeNull();
    });
  });
}

describe('profiles', () => {
  it('ignores profiles recorded with another feature layout', async () => {
    const kv = memoryStore(), profiles = profileStore(kv);
    await kv.set('profile:old', { id: 'old', featureVersion: FEATURE_VERSION - 1, points: [] });
    expect(await profiles.load('old')).toBeNull();
  });
});

describe('pooled baseline', () => {
  it('starts empty and falls back to empty on bad data', async () => {
    const kv = memoryStore(), baselines = baselineStore(kv);
    expect(await baselines.load()).toMatchObject({ players: 0, samples: 0 });
    await kv.set('baseline', { junk: true });
    expect((await baselines.load()).players).toBe(0);
    expect(isValidBaseline(emptyBaseline())).toBe(true);
    expect(isValidBaseline({ ...emptyBaseline(), featureVersion: 0 })).toBe(false);
  });
  it('grows with each player, and a contribution can be taken back out', () => {
    const a = calibration(1), b = calibration(2);
    const one = contribute(emptyBaseline(), a.gram), two = contribute(one, b.gram);
    expect(two.players).toBe(2);
    expect(two.samples).toBe(2 * 16 * 18);
    const back = contribute(two, b.gram, -1);
    expect(back.players).toBe(1);
    gramFromJSON(back.gram).A.forEach((v, i) => expect(v).toBeCloseTo(a.gram.A[i], 6));
  });
  it('merges two pools', () => {
    const x = contribute(emptyBaseline(), calibration(1).gram), y = contribute(contribute(emptyBaseline(), calibration(2).gram), calibration(3).gram);
    const m = mergeBaselines(x, y);
    expect(m.players).toBe(3);
    expect(m.samples).toBe(3 * 16 * 18);
  });
});
