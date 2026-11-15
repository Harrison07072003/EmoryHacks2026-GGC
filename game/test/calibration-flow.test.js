// @vitest-environment jsdom
// Hands-free start in ?input=sim (the eye-controller mock): with no calibration yet, the
// title starts calibration by itself, the engine's real calibration session and its own
// calibration and result screens run on the simulated eyes, the result is saved, and the
// game moves on to mode select without any click. Takes ~60 s of real time.
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
    // fake 2D context: every method is a no-op, gradients return something with addColorStop
    HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get: (o, k) => (k in o ? o[k] : /Gradient$/.test(k) ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
      set: (o, k, v) => { o[k] = v; return true; },
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    document.body.innerHTML = '<main id="app"></main><div id="overlay-layer"></div><div id="gaze-cursor"></div><div id="dwell-ring"><div class="pie"></div></div><div id="input-badge"></div><div id="toast"></div>';
    history.replaceState({}, '', '/?input=sim');

    await import('../src/main.js');
    const app = globalThis.__rhythmeyez;
    await until(() => app?.screen === 'title', 5000);
    expect(app.gaze.calibrated).toBe(false);
    expect(document.querySelector('#input-badge').textContent).toMatch(/SIMULATED/);

    await until(() => app.screen === 'faceCheck', 14000);           // auto-start after 10 s with a face in view
    await until(() => /Centred in the oval/.test(document.querySelector('.fc-checks')?.textContent ?? ''), 3000);   // the engine's checks
    await until(() => app.screen === 'calibration', 6000);          // all checks green for 1.5 s -> continues by itself
    const layer = document.querySelector('#overlay-layer');
    await until(() => layer.querySelector('canvas'), 8000);         // the engine's calibration screen is up
    await until(() => /Locked in/.test(layer.textContent), 120000); // dots, moving dot, hops done -> engine result screen
    expect(app.gaze.calibrationScore).toBeGreaterThanOrEqual(60);
    expect([...layer.querySelectorAll('button[data-gaze]')].map(b => b.textContent)).toEqual(['Continue', 'Redo']); // eye-pressable
    await until(() => app.screen === 'modes', 8000);                 // a good result continues by itself
    expect(app.session.calibratedThisSession).toBe(true);
    const saved = (await app.store.listResults()).length; // results untouched
    expect(saved).toBe(0);
  }, 180000);
});
