// @vitest-environment jsdom
// Hands-free start in ?input=sim (the eye-controller mock): with no calibration yet, the
// title starts calibration by itself, the engine's real calibration session runs on the
// simulated eyes through the game's own dot screen, the result is saved, and the game moves
// on to mode select without any click. Takes ~30 s of real time.
import { describe, expect, it, vi } from 'vitest';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
  throw new Error('condition not met');
}

describe('first-run calibration flow (simulated gaze)', () => {
  it('auto-starts, calibrates, saves and continues to modes', async () => {
    const param = () => ({ value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
    const node = () => ({ playbackRate: param(), gain: { value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect(n) { return n ?? this; }, start() {}, stop() {} });
    globalThis.AudioContext = class { state = 'running'; destination = node(); get currentTime() { return performance.now() / 1000; } createGain() { return node(); } createBufferSource() { return node(); } createBuffer(c, n) { const d = new Float32Array(n); return { getChannelData: () => d }; } resume() { return Promise.resolve(); } };
    HTMLCanvasElement.prototype.getContext = () => null;
    globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    document.body.innerHTML = '<main id="app"></main><div id="overlay-layer"></div><div id="gaze-cursor"></div><div id="dwell-ring"><div class="pie"></div></div><div id="input-badge"></div><div id="toast"></div>';
    history.replaceState({}, '', '/?input=sim');

    await import('../src/main.js');
    const app = globalThis.__rhythmeyez;
    await until(() => app?.screen === 'title', 5000);
    expect(app.gaze.calibrated).toBe(false);
    expect(document.querySelector('#input-badge').textContent).toMatch(/SIMULATED/);

    await until(() => app.screen === 'calibration', 6000);          // auto-start after ~3 s of face
    await until(() => document.querySelector('.calib .dot'), 6000);  // dots are being shown
    await until(() => !document.querySelector('.calib'), 90000);     // engine finished all dots + follow phase
    expect(app.gaze.calibrationScore).toBeGreaterThanOrEqual(60);
    expect(document.querySelector('h2').textContent).toBe('Calibrated');
    await until(() => app.screen === 'modes', 8000);                 // continues by itself
    expect(app.session.calibratedThisSession).toBe(true);
    const saved = (await app.store.listResults()).length; // results untouched
    expect(saved).toBe(0);
  }, 120000);
});
