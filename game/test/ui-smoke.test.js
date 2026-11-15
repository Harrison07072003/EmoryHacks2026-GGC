// @vitest-environment jsdom
// UI smoke test: boots the whole game in a simulated DOM (mouse input, stubbed audio and
// canvas, no layout engine) and walks every screen through the same click handlers that
// gaze dwell triggers. It catches runtime errors in screen code; it does not check visuals,
// real dwell hit-testing (needs a layout engine) or webcam tracking.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const errors = [];
let app;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find(el => el.textContent.trim().toLowerCase().includes(text.toLowerCase()));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  throw new Error('condition not met');
}

function stubBrowser() {
  const param = () => ({ value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ gain: param(), playbackRate: param(), connect(n) { return n ?? this; }, start() {}, stop() {}, buffer: null, onended: null });
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; this.destination = node(); this.outputLatency = 0.02; this.baseLatency = 0.01; }
    get currentTime() { return performance.now() / 1000; }
    createGain() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d, length: n }; }
    decodeAudioData() { return Promise.resolve({ duration: 30 }); }
    resume() { return Promise.resolve(); }
  };
  const ctx2d = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = () => ctx2d;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  document.body.innerHTML = `<div id="bg"></div><main id="app"></main><div id="overlay-layer"></div><div id="gaze-cursor"></div>
    <div id="dwell-ring"><div class="pie"></div></div><div id="input-badge"></div><div id="toast"></div>`;
  history.replaceState({}, '', '/?input=mouse');
  addEventListener('error', e => errors.push(e.message));
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); origError(...a); };
}

beforeAll(async () => {
  stubBrowser();
  await import('../src/main.js');
  app = globalThis.__rhythmeyez;
  await until(() => app?.screen === 'title');
});
afterAll(() => app?.go('title'));

describe('UI walk-through (mouse input, simulated DOM)', () => {
  it('shows the title with the dev input badge', () => {
    expect($('.logo').textContent).toContain('RHYTHM');
    expect($('#input-badge').classList.contains('dev')).toBe(true);
    expect($('#input-badge').textContent).toMatch(/DEV/);
  });

  it('title -> modes: three modes plus a disabled Multiplayer card', async () => {
    byText('.gbtn', 'Start Game').click();
    await until(() => app.screen === 'modes');
    expect($$('button.card[data-gaze]')).toHaveLength(3);
    const mp = byText('.card', 'Multiplayer');
    expect(mp.hasAttribute('disabled')).toBe(true);
    expect(mp.hasAttribute('data-gaze')).toBe(false);  // can never be dwelled on
  });

  it('modes -> songs with three songs; a song opens the YES/NO popup', async () => {
    $$('button.card')[1].click();
    await until(() => app.screen === 'songs');
    expect(app.session.modeId).toBe('normal');
    expect(app.session.characterId).toBe('volt');
    expect($$('.song-card')).toHaveLength(3);
    $$('.song-card')[0].click();
    await until(() => $('.popup'));
    expect($('#app').inert).toBe(true);
    byText('.popup .gbtn', 'No').click();
    await until(() => !$('.popup'));
    expect($('#app').inert).toBe(false);
  });

  it('character select changes and remembers the character', async () => {
    byText('.gbtn', 'Character').click();
    await until(() => app.screen === 'characters');
    expect($$('.card .char-portrait')).toHaveLength(3);
    $$('button.card')[2].click();
    await until(() => app.screen === 'songs');
    expect(app.session.characterId).toBe('nova');
    expect(app.settings.characterId).toBe('nova');
  });

  it('YES starts the song: countdown, then the song clock runs and notes are judged', async () => {
    $$('.song-card')[1].click();
    await until(() => $('.popup'));
    byText('.popup .gbtn', 'Yes').click();
    await until(() => app.screen === 'play');
    expect($('.play .char-portrait')).toBeTruthy();
    expect(byText('.gbtn', 'Quit')).toBeTruthy();
    await until(() => app.debugPlay.state() === 'playing', 6000);
    await sleep(3500);
    expect(app.debugPlay.songTime()).toBeGreaterThan(2);
    // nobody is looking (mouse never moved): notes must have been judged as misses
    expect(app.debugPlay.scoring().counts.miss).toBeGreaterThan(0);
    expect(app.debugPlay.scoring().health).toBeLessThan(100);
  }, 15000);

  it('Quit pauses with Resume / Songs / Home, and Resume continues', async () => {
    byText('.gbtn', 'Quit').click();
    await until(() => $('.popup'));
    expect(app.debugPlay.state()).toBe('paused');
    expect($$('.popup .gbtn').map(b => b.textContent)).toEqual(['Resume', 'Songs', 'Home']);
    byText('.popup .gbtn', 'Resume').click();
    await until(() => app.debugPlay.state() === 'playing', 4000);
    byText('.gbtn', 'Quit').click();
    await until(() => $('.popup'));
    byText('.popup .gbtn', 'Songs').click();
    await until(() => app.screen === 'songs');
  }, 15000);

  it('results and failure screens render with Retry / Song select / Home', async () => {
    const result = { song_id: 'pulse-runner', song_title: 'Pulse Runner', mode_label: 'Normal', score: 12345, grade: 'A', accuracy: 88.2,
      perfect: 30, good: 5, miss: 2, max_combo: 20, frenzy_count: 1, failed: false, practice: false, completed_pct: 100, input_source: 'mouse' };
    app.go('results', { result });
    expect($('.grade').textContent).toBe('A');
    expect($$('[data-buttons] .gbtn').map(b => b.textContent)).toEqual(['Retry', 'Song select', 'Home']);
    app.go('results', { result: { ...result, failed: true, grade: 'F', completed_pct: 40 } });
    expect($('.grade').textContent).toBe('F');
    expect($$('[data-buttons] .gbtn').map(b => b.textContent)).toEqual(['Try again', 'Home']);
    byText('.gbtn', 'Home').click();
    await until(() => app.screen === 'title');
  });

  it('settings change volumes and the opt-in switch', async () => {
    app.go('settings', { back: 'title' });
    const before = app.settings.master;
    $$('.settings .gbtn')[0].click();   // master −
    expect(app.settings.master).toBeCloseTo(before - 0.1);
    const share = app.settings.shareTrackingData;
    expect(share).toBe(false);                  // off by default
    $$('.settings .gbtn').at(-1).click();       // Help improve eye tracking
    expect(app.settings.shareTrackingData).toBe(true);
    $$('.settings .gbtn').at(-1).click();
  });

  it('the startup error screen explains the problem', () => {
    app.go('startupError', { error: new Error('Permission denied') });
    expect($('.screen').textContent).toMatch(/Allow the camera/);
  });

  it('raised no runtime errors', () => {
    expect(errors).toEqual([]);
  });
});
