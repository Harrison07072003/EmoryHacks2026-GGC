// A returning player must get their calibration back instead of starting over. This uses
// the same storage path as the live game (localStorage, the eye-controller's default
// store) and two separate controller instances, as two page loads would.
import { describe, expect, it } from 'vitest';
import { createMockEyeController, localStorageStore } from '../../eye-controller/src/index.js';

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k),
    key: i => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}

describe('returning player', () => {
  it('a saved calibration is restored on the next visit', async () => {
    const ls = fakeLocalStorage();
    // visit 1: calibrate (the mock auto-calibrates) and save, as the calibration screen does
    const first = createMockEyeController({ clock: 'manual', storage: localStorageStore('eyectl', ls) });
    await first.init();
    expect(first.state.ready).toBe(true);
    expect(await first.saveProfile()).toBe(true);
    const score = first.state.calibrationScore;
    first.stop();

    // visit 2: a fresh controller, nothing calibrated until the profile loads
    const second = createMockEyeController({ clock: 'manual', autoCalibrate: false, storage: localStorageStore('eyectl', ls) });
    await second.init();
    expect(second.state.calibrationScore).toBeNull();
    expect(await second.loadProfile()).toBe(true);
    expect(second.state.calibrationScore).toBe(score);
    expect(second.state.ready).toBe(true);
    second.stop();
  });

  it('a different origin (different storage) starts fresh, which is why the port is pinned', async () => {
    const other = createMockEyeController({ clock: 'manual', autoCalibrate: false, storage: localStorageStore('eyectl', fakeLocalStorage()) });
    await other.init();
    expect(await other.loadProfile()).toBe(false);
    other.stop();
  });
});
