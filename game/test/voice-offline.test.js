import { describe, expect, it } from 'vitest';
import { createLocalRecognizer, LOCAL_MESSAGES, MODEL_FALLBACK_URL, resolveModelUrl } from '../src/voice/local-recognizer.js';
import { createVoiceRecognizer, voicePreference } from '../src/voice/voice-engine.js';
import { MESSAGES } from '../src/voice/recognizer.js';
import { editDistance, parseCommand } from '../src/voice/commands.js';

const flush = () => new Promise(r => setTimeout(r, 0));

// ---- fakes: AudioContext, mic stream, vosk model ----
function fakeAudio() {
  const nodes = [];
  const node = () => { const n = { connect() {}, disconnect() { n.disconnected = true; } }; nodes.push(n); return n; };
  const ctx = { state: 'running', sampleRate: 48000, destination: {}, createMediaStreamSource: node, createScriptProcessor: node, resume: async () => {} };
  return { ctx, nodes };
}
function fakeStream() {
  const track = { stopped: false, stop() { track.stopped = true; } };
  return { track, stream: { getTracks: () => [track] } };
}
function fakeVosk() {
  const recs = [];
  class KaldiRecognizer {
    constructor(rate) { this.rate = rate; this.handlers = {}; recs.push(this); }
    on(ev, fn) { this.handlers[ev] = fn; }
    acceptWaveform() {}
    remove() { this.removed = true; }
    partial(text) { this.handlers.partialresult({ result: { partial: text } }); }
    final(text) { this.handlers.result({ result: { text } }); }
  }
  let loads = 0;
  return { recs, get loads() { return loads; }, load: async () => ({ createModel: async () => { loads++; return { KaldiRecognizer }; } }) };
}

function setup(o = {}) {
  const audio = fakeAudio(), mic = fakeStream(), vosk = o.vosk ?? fakeVosk();
  const states = [], finals = [], interims = [], hearing = [];
  globalThis.WebAssembly ??= {};
  const r = createLocalRecognizer({
    audioContext: () => audio.ctx,
    getUserMedia: o.getUserMedia ?? (async () => mic.stream),
    loadVosk: vosk.load, modelUrl: async () => 'model.tar.gz', log: () => {},
    onState: (s, m) => states.push([s, m]), onFinal: t => finals.push(t), onInterim: t => interims.push(t), onHearing: h => hearing.push(h),
  });
  return { r, audio, mic, vosk, states, finals, interims, hearing };
}

describe('offline recognizer', () => {
  it('loads the model, listens, and delivers interim + final text', async () => {
    const t = setup();
    t.r.start();
    expect(t.r.state).toBe('starting');
    expect(t.r.message).toBe(LOCAL_MESSAGES.loading);
    await flush(); await flush();
    expect(t.r.state).toBe('listening');
    expect(t.vosk.recs[0].rate).toBe(48000);
    t.vosk.recs[0].partial('play num');
    t.vosk.recs[0].final('play number three');
    expect(t.interims).toContain('play num');
    expect(t.finals).toEqual(['play number three']);
    expect(t.hearing).toEqual([true, false]);
  });

  it('stop releases the microphone; the model loads only once', async () => {
    const t = setup();
    t.r.start(); await flush(); await flush();
    t.r.stop();
    expect(t.r.state).toBe('off');
    expect(t.mic.track.stopped).toBe(true);
    expect(t.vosk.recs[0].removed).toBe(true);
    t.r.start(); await flush(); await flush();
    expect(t.r.state).toBe('listening');
    expect(t.vosk.loads).toBe(1);
  });

  it('a blocked microphone is explained and can be retried', async () => {
    let allow = false;
    const mic = fakeStream();
    const t = setup({ getUserMedia: async () => { if (!allow) throw Object.assign(new Error(), { name: 'NotAllowedError' }); return mic.stream; } });
    t.r.start(); await flush();
    expect(t.r.state).toBe('denied');
    expect(t.r.message).toBe(MESSAGES.denied);
    allow = true;
    t.r.start(); await flush(); await flush();
    expect(t.r.state).toBe('listening');
  });

  it('a model that fails to load is an error, and the mic is released', async () => {
    const t = setup({ vosk: { load: async () => ({ createModel: async () => { throw new Error('404'); } }) } });
    t.r.start(); await flush(); await flush(); await flush();
    expect(t.r.state).toBe('error');
    expect(t.r.message).toBe(LOCAL_MESSAGES.modelFailed);
    expect(t.mic.track.stopped).toBe(true);
  });

  it('stopping while the model loads leaves nothing running', async () => {
    const t = setup();
    t.r.start(); t.r.stop();
    await flush(); await flush();
    expect(t.r.state).toBe('off');
    expect(t.mic.track.stopped).toBe(true);
  });

  it('uses the local model file when the server has it, the public copy otherwise', async () => {
    const ok = async () => ({ ok: true, headers: { get: () => 'application/gzip' } });
    const spa404 = async () => ({ ok: true, headers: { get: () => 'text/html' } });
    const opts = { base: '/', origin: 'http://localhost:5190/' };
    expect(await resolveModelUrl({ ...opts, fetchFn: ok })).toBe('http://localhost:5190/voice-model/vosk-model-small-en-us-0.15.tar.gz');
    expect(await resolveModelUrl({ ...opts, fetchFn: spa404 })).toBe(MODEL_FALLBACK_URL);
    expect(await resolveModelUrl({ ...opts, fetchFn: async () => { throw new Error('offline'); } })).toBe(MODEL_FALLBACK_URL);
  });
});

describe('voice engine choice', () => {
  const fake = (engine, supported = true) => opts => ({ engine, supported, state: 'off', message: '', on: false, opts, started: 0, start() { this.started++; }, stop() {}, toggle() {} });

  it('offline by default, Google with ?voice=google', () => {
    expect(voicePreference('')).toBe('offline');
    expect(voicePreference('?voice=google')).toBe('google');
    expect(createVoiceRecognizer({}, { prefer: 'offline', makeLocal: fake('offline'), makeGoogle: fake('google') }).engine).toBe('offline');
    expect(createVoiceRecognizer({}, { prefer: 'google', makeLocal: fake('offline'), makeGoogle: fake('google') }).engine).toBe('google');
  });

  it('falls back when the preferred engine is unsupported', () => {
    expect(createVoiceRecognizer({}, { prefer: 'offline', makeLocal: fake('offline', false), makeGoogle: fake('google') }).engine).toBe('google');
  });

  it('switches to Google when the offline model fails to load', () => {
    let local, google;
    const states = [];
    const v = createVoiceRecognizer({ onState: (s, m) => states.push(s) }, {
      prefer: 'offline',
      makeLocal: o => (local = fake('offline')(o)), makeGoogle: o => (google = fake('google')(o)),
    });
    v.start();
    local.opts.onState('error', LOCAL_MESSAGES.modelFailed);
    expect(v.engine).toBe('google');
    expect(google.started).toBe(1);
    expect(states).toEqual([]);   // the failure is not shown: Google takes over
    local.opts.onState('error', MESSAGES.noMic);   // other errors are shown as usual
  });
});

describe('command parsing for the offline recognizer', () => {
  const genres = ['lofi', 'rock', 'electronic', 'hip-hop', 'jazz'];
  it('ignores a leading "the" / "uh"', () => {
    expect(parseCommand('the back')).toEqual({ type: 'back' });
    expect(parseCommand('the number three')).toEqual({ type: 'choose', n: 3 });
    expect(parseCommand('uh play two')).toEqual({ type: 'choose', n: 2 });
    expect(parseCommand('the keyboard')).toEqual({ type: 'keyboard' });
  });

  it('matches a genre that is one letter off', () => {
    expect(parseCommand('lo vi', { genres })).toEqual({ type: 'genre', genre: 'lofi' });
    expect(parseCommand('electronik', { genres })).toEqual({ type: 'genre', genre: 'electronic' });
    expect(parseCommand('pip', { genres })).toEqual({ type: 'search', q: 'pip' });   // too short to guess
  });

  it('edit distance', () => {
    expect(editDistance('lofi', 'lovi')).toBe(1);
    expect(editDistance('rock', 'rock')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
