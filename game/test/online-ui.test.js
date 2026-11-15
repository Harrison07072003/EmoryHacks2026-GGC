// @vitest-environment jsdom
// Online Library walk-through in a simulated DOM: song select -> Search -> Keyboard -> results,
// with Typesense and archive.org faked at the fetch level and a fake SpeechRecognition.
// Checks the screen flow, the single search path, the 5-result limit, attribution, previews,
// the Choose confirmation, voice commands and the built-in song list staying unchanged.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const errors = [], requests = [];
let app, recognizers = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find(el => el.textContent.trim().toLowerCase().includes(text.toLowerCase()));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  throw new Error('condition not met');
}

const doc = i => ({
  id: `ia_item${i}_k${i}`, title: `Track ${i}`, artist: `Artist ${i}`, album: 'Album', genre: ['electronic', 'ambient'],
  duration: 150 + i, popularity: 1000 - i, license_name: 'CC BY 4.0', license_url: 'http://creativecommons.org/licenses/by/4.0/',
  source_id: `item${i}/t.mp3`, attribution: `"Track ${i}" by Artist ${i} · CC BY 4.0 · https://archive.org/details/item${i}`, audio_url: `https://archive.org/download/item${i}/t.mp3`,
  bitrate_kbps: 128, is_explicit: false, is_commercial_ok: true,
});

function stubBrowser() {
  const param = () => ({ value: 1, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ gain: param(), playbackRate: param(), connect(n) { return n ?? this; }, start() {}, stop() {}, buffer: null, onended: null });
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; this.destination = node(); this.outputLatency = 0.02; this.baseLatency = 0.01; }
    get currentTime() { return performance.now() / 1000; }
    createGain() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(ch, n, rate = 44100) { const d = new Float32Array(n); return { getChannelData: () => d, length: n, numberOfChannels: ch, sampleRate: rate, duration: n / rate }; }
    decodeAudioData() { const d = new Float32Array(44100 * 12); return Promise.resolve({ duration: 12, length: d.length, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => d }); }
    resume() { return Promise.resolve(); }
  };
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  HTMLCanvasElement.prototype.getContext = () => ctx2d;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const json = body => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body, arrayBuffer: async () => new ArrayBuffer(8) });
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    requests.push({ url: u, headers: init.headers ?? {} });
    if (u.includes('/charts/')) {
      const chart = d => ({ format: 1, song: 'x', difficulty: d, notes: [{ type: 'straight', t: 2, lane: 0 }, { type: 'straight', t: 3, lane: 1 }, { type: 'straight', t: 4, lane: 2 }] });
      return json({ songId: 'x', generatorVersion: 1, cached: false, meta: { bpm: 120, difficulty: 2 }, charts: { practice: chart('practice'), normal: chart('normal'), hard: chart('hard') } });
    }
    if (u.includes('/documents/search')) {
      const p = new URL(u, 'http://x').searchParams;
      if (p.get('per_page') === '0') return json({ found: 9, hits: [], facet_counts: [{ field_name: 'genre', counts: [{ value: 'electronic' }, { value: 'ambient' }, { value: 'rock' }] }] });
      return json({ found: 9, hits: Array.from({ length: Number(p.get('per_page')) }, (_, i) => ({ document: doc(i + 1) })) });
    }
    return json({});
  });
  // fake Web Speech API
  globalThis.webkitSpeechRecognition = class {
    constructor() { recognizers.push(this); }
    start() { this.running = true; this.onstart?.(); }
    abort() { this.running = false; this.onend?.(); }
    say(text) { this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] }); }
  };
  document.body.innerHTML = `<div id="bg"></div><main id="app"></main><div id="overlay-layer"></div><div id="gaze-cursor"></div>
    <div id="dwell-ring"><div class="pie"></div></div><div id="input-badge"></div><div id="toast"></div>`;
  history.replaceState({}, '', '/?input=mouse');
  addEventListener('error', e => errors.push(e.message));
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); origError(...a); };
}

beforeAll(async () => {
  vi.stubEnv('VITE_TYPESENSE_URL', 'https://search.example');
  vi.stubEnv('VITE_TYPESENSE_SEARCH_API_KEY', 'scoped-search-key');
  stubBrowser();
  await import('../src/main.js');
  app = globalThis.__rhythmeyez;
  await until(() => app?.screen === 'title');
  app.session.modeId = 'normal';
  app.session.characterId = 'volt';
  app.go('songs');
});
afterAll(() => { app?.go('title'); vi.unstubAllEnvs(); });

const lastSearch = () => new URL(requests.filter(r => r.url.includes('/documents/search') && !r.url.includes('per_page=0')).at(-1).url).searchParams;

describe('Online Library flow', () => {
  it('song select keeps the 3 built-in songs and adds a Search button', () => {
    expect($$('.song-card')).toHaveLength(3);
    expect(byText('.gbtn', 'Search')).toBeTruthy();
  });

  it('Search opens screen 2 with "Say Genre" and "Keyboard"', async () => {
    byText('.gbtn', 'Search').click();
    await until(() => app.screen === 'onlineSearch');
    expect(byText('.gbtn', 'Say Genre')).toBeTruthy();
    expect(byText('.gbtn', 'Keyboard')).toBeTruthy();
    await until(() => $('.os-genres').textContent.includes('electronic'));
  });

  it('Keyboard: on-screen keys and a physical keyboard both type; Search shows the top 5 by popularity', async () => {
    byText('.gbtn', 'Keyboard').click();
    await until(() => app.screen === 'onlineKeyboard');
    expect($$('.os-key').length).toBeGreaterThanOrEqual(40);
    byText('.os-key', 'L').click(); byText('.os-key', 'O').click();
    dispatchEvent(new KeyboardEvent('keydown', { key: 'F' }));
    dispatchEvent(new KeyboardEvent('keydown', { key: 'i' }));
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    dispatchEvent(new KeyboardEvent('keydown', { key: 'I' }));
    expect($('.os-text').textContent).toBe('lofi');
    byText('.os-key', 'Search').click();
    await until(() => app.screen === 'onlineResults');
    await until(() => $$('.os-song').length === 5);
    const p = lastSearch();
    expect(p.get('q')).toBe('lofi');
    expect(p.get('per_page')).toBe('30');   // candidates; the screen shows 5 distinct releases
    expect(p.get('sort_by')).toBe('popularity:desc');
    expect(p.get('filter_by')).toContain('is_explicit:false');
    expect(requests.at(-1).headers['X-TYPESENSE-API-KEY']).toBe('scoped-search-key');
  });

  it('every result shows title, artist, genre, duration and license attribution, plus a Choose area', () => {
    const row = $$('.os-song')[0];
    expect(row.querySelector('.os-title').textContent).toBe('Track 1');
    expect(row.querySelector('.os-meta').textContent).toMatch(/Artist 1 · electronic, ambient · 2:31/);
    expect(row.querySelector('.os-license').textContent).toBe('CC BY 4.0');
    expect(row.querySelector('.os-attr').textContent).toContain('archive.org/details/item1');
    expect(row.querySelector('.gbtn.os-choose[data-gaze]')).toBeTruthy();
  });

  it('hovering a song previews only the start of the file (HTTP Range)', async () => {
    $$('.os-song')[1].dispatchEvent(new Event('pointerenter'));
    await until(() => requests.some(r => r.url.includes('item2/t.mp3')));
    const req = requests.find(r => r.url.includes('item2/t.mp3'));
    expect(req.headers.Range).toMatch(/^bytes=0-\d+$/);
    expect(Number(req.headers.Range.split('-')[1])).toBeLessThan(600000);   // ~10 s at 128 kbps + header room
    await until(() => $$('.os-song')[1].classList.contains('previewing'));
    $$('.os-song')[1].dispatchEvent(new Event('pointerleave'));
    await until(() => !$$('.os-song')[1].classList.contains('previewing'));
  });

  it('voice: mic toggle, "choose 2" asks to confirm, "no" cancels, genre runs a filtered search', async () => {
    byText('.gbtn', 'Mic').click();
    await until(() => recognizers.at(-1)?.running);
    expect($('.os-mic').classList.contains('on')).toBe(true);
    const rec = recognizers.at(-1);
    rec.say('choose two');
    await until(() => $('.popup'));
    expect($('.popup').textContent).toContain('Track 2');
    rec.say('no');
    await until(() => !$('.popup'));
    rec.say('genre ambient');
    await until(() => lastSearch().get('filter_by').includes('genre:=[`ambient`]'));
    await until(() => $$('.os-song').length === 5);
  });

  it('voice: "back" returns to search; leaving the search screens stops the mic', async () => {
    const rec = recognizers.at(-1);
    rec.say('back');
    await until(() => app.screen === 'onlineSearch');
    expect(rec.running).toBe(true);           // still listening on the search screens
    byText('.gbtn', 'Songs').click();
    await until(() => app.screen === 'songs');
    await until(() => !rec.running);          // stopped outside the Online Library (and in gameplay)
    expect($$('.song-card')).toHaveLength(3);
  });

  it('keyboard keys dwell for 1 s; Clear and Back keep 2 s', async () => {
    byText('.gbtn', 'Search').click();
    await until(() => app.screen === 'onlineSearch');
    byText('.gbtn', 'Keyboard').click();
    await until(() => app.screen === 'onlineKeyboard');
    expect(byText('.os-key', 'Q').dataset.dwellMs).toBe('1000');
    expect(byText('.os-key', 'Search').dataset.dwellMs).toBe('1000');
    expect(byText('.os-key', 'Clear').dataset.dwellMs).toBeUndefined();
    expect(byText('.gbtn', 'Back').dataset.dwellMs).toBeUndefined();
  });

  it('Choose: Downloading -> Analyzing -> Ready, then the level plays on the normal play screen', async () => {
    byText('.os-key', 'A').click();
    byText('.os-key', 'Search').click();
    await until(() => $$('.os-song').length === 5);
    $$('.os-choose')[2].click();
    await until(() => app.screen === 'onlinePrepare');
    expect($('.online-prepare h2').textContent).toBe('Track 3');
    expect($('.online-prepare .os-attr').textContent).toContain('archive.org/details/item3');
    await until(() => app.screen === 'play', 8000);
    expect(requests.some(r => r.url.includes('/charts/ia_item3_k3'))).toBe(true);
    const audioReq = requests.find(r => r.url.includes('item3/t.mp3'));
    expect(audioReq.headers.Range).toMatch(/^bytes=0-\d+$/);         // only the first 30 s are downloaded
    await until(() => app.debugPlay?.chart());
    expect(app.debugPlay.chart().notes).toHaveLength(3);
    expect($('.hud-attr').textContent).toContain('CC BY 4.0');      // attribution while playing
    byText('.gbtn', 'Quit').click();
    await until(() => $('.popup'));
    byText('.popup .gbtn', 'Song select').click();
    await until(() => app.screen === 'songs');
    expect($$('.song-card')).toHaveLength(3);                          // built-in list untouched
  }, 20000);

  it('no runtime errors', () => {
    expect(errors).toEqual([]);
  });
});
