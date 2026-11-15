import { describe, expect, it, vi } from 'vitest';
import { normalize, parseCommand } from '../src/voice/commands.js';
import { createRecognizer, MESSAGES, micFailure } from '../src/voice/recognizer.js';
import { createVoiceSession } from '../src/online/voice-session.js';

const GENRES = ['rock', 'electronic', 'drum & bass', 'hip-hop', 'lo-fi', 'ambient'];
const p = (text, o = {}) => parseCommand(text, { genres: GENRES, ...o });

describe('voice command parsing', () => {
  it('normalizes case, punctuation and "&"', () => {
    expect(normalize('  Drum & Bass!! ')).toBe('drum and bass');
    expect(normalize('Play #3.')).toBe('play 3');
  });

  it('search / find with natural variations', () => {
    expect(p('search lofi beats')).toEqual({ type: 'search', q: 'lofi beats' });
    expect(p('Search for Jason Shaw')).toEqual({ type: 'search', q: 'jason shaw' });
    expect(p('find me something calm')).toEqual({ type: 'search', q: 'something calm' });
    expect(p('look for piano')).toEqual({ type: 'search', q: 'piano' });
  });

  it('genres: explicit, bare, with "music", and spoken forms of written genres', () => {
    expect(p('genre rock')).toEqual({ type: 'genre', genre: 'rock' });
    expect(p('Rock')).toEqual({ type: 'genre', genre: 'rock' });
    expect(p('electronic music')).toEqual({ type: 'genre', genre: 'electronic' });
    expect(p('drum and bass')).toEqual({ type: 'genre', genre: 'drum & bass' });
    expect(p('hip hop')).toEqual({ type: 'genre', genre: 'hip-hop' });
    expect(p('lofi')).toEqual({ type: 'genre', genre: 'lo-fi' });
    expect(p('play some ambient')).toEqual({ type: 'genre', genre: 'ambient' });
  });

  it('unknown genre falls back to a text search (text search covers the genre field)', () => {
    expect(p('genre polka')).toEqual({ type: 'search', q: 'polka' });
  });

  it('choose by number, in digits, words, ordinals and common mishearings', () => {
    expect(p('play 3')).toEqual({ type: 'choose', n: 3 });
    expect(p('choose three')).toEqual({ type: 'choose', n: 3 });
    expect(p('pick the second')).toEqual({ type: 'choose', n: 2 });
    expect(p('play number five')).toEqual({ type: 'choose', n: 5 });
    expect(p('song 1')).toEqual({ type: 'choose', n: 1 });
    expect(p('play for')).toEqual({ type: 'choose', n: 4 });
    expect(p('the first one')).toEqual({ type: 'choose', n: 1 });
  });

  it('choose the highlighted song', () => {
    expect(p('play')).toEqual({ type: 'choose', n: null });
    expect(p('choose this one')).toEqual({ type: 'choose', n: null });
  });

  it('control words', () => {
    expect(p('back')).toEqual({ type: 'back' });
    expect(p('Go back.')).toEqual({ type: 'back' });
    expect(p('clear')).toEqual({ type: 'clear' });
    expect(p('start over')).toEqual({ type: 'clear' });
    expect(p('stop listening')).toEqual({ type: 'stop' });
    expect(p('mic off')).toEqual({ type: 'stop' });
    expect(p('keyboard')).toEqual({ type: 'keyboard' });
    expect(p('yes')).toEqual({ type: 'confirm' });
    expect(p('cancel')).toEqual({ type: 'cancel' });
  });

  it('plain speech is a search only when allowed', () => {
    expect(p('calm piano')).toEqual({ type: 'search', q: 'calm piano' });
    expect(p('calm piano', { plainIsSearch: false })).toBeNull();
    expect(p('   ')).toBeNull();
  });

  it('"play <genre>" is not mistaken for a number', () => {
    expect(p('play rock')).not.toMatchObject({ type: 'choose' });
  });
});

// ---- recognizer lifecycle with a fake SpeechRecognition ----
function fakeSR() {
  const instances = [];
  class SR {
    constructor() { instances.push(this); this.started = 0; }
    start() { if (this.running) { const e = new Error('already'); e.name = 'InvalidStateError'; throw e; } this.running = true; this.started++; this.onstart?.(); if (!SR.mute) this.onaudiostart?.(); }
    abort() { this.running = false; this.onend?.(); }
    // test helpers
    say(text, isFinal = true) { this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }); }
    fail(error) { this.onerror({ error }); this.running = false; this.onend(); }
    end() { this.running = false; this.onend(); }
  }
  return { SR, instances };
}

describe('recognizer', () => {
  const setup = (o = {}) => {
    const { SR, instances } = fakeSR(), states = [], finals = [], interims = [], timers = [], hearing = [];
    if (o.mute) SR.mute = true;
    const r = createRecognizer({
      SR, onState: (s, m) => states.push([s, m]), onFinal: t => finals.push(t), onInterim: t => interims.push(t), onHearing: h => hearing.push(h),
      setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
      clearTimeout: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
      micCheck: o.micCheck ?? (() => undefined), log: () => {},
    });
    return { r, SR, rec: () => instances[0], states, finals, interims, timers, hearing, runTimers: () => timers.splice(0).forEach(t => t.fn()) };
  };

  it('reports unsupported browsers and does nothing', () => {
    const states = [];
    const r = createRecognizer({ SR: null, onState: s => states.push(s) });
    expect(r.supported).toBe(false);
    expect(r.state).toBe('unsupported');
    r.start(); r.toggle(); r.stop();
    expect(states).toEqual([]);
  });

  it('delivers interim text for display and final text once', () => {
    const t = setup();
    t.r.start();
    expect(t.r.state).toBe('listening');
    t.rec().say('search lo', false);
    t.rec().say('search lofi');
    expect(t.interims).toContain('search lo');
    expect(t.finals).toEqual(['search lofi']);
  });

  it('auto-restarts when the browser ends recognition, but not after stop()', () => {
    const t = setup();
    t.r.start();
    t.rec().end();
    t.runTimers();
    expect(t.rec().started).toBe(2);
    t.r.stop();
    expect(t.r.state).toBe('off');
    t.runTimers();
    expect(t.rec().started).toBe(2);
  });

  it('ignores no-speech and keeps listening', () => {
    const t = setup();
    t.r.start();
    t.rec().fail('no-speech');
    t.runTimers();
    expect(t.r.on).toBe(true);
    expect(t.rec().started).toBe(2);
  });

  it('stops for good when mic permission is denied', () => {
    const t = setup();
    t.r.start();
    t.rec().fail('not-allowed');
    t.runTimers();
    expect(t.r.state).toBe('denied');
    expect(t.r.on).toBe(false);
    expect(t.rec().started).toBe(1);
  });

  it('retries network errors with backoff, then reports that voice needs the internet', () => {
    const t = setup();
    t.r.start();
    const waits = [];
    for (let i = 0; i < 4; i++) { t.rec().fail('network'); waits.push(t.timers[0].ms); t.runTimers(); }
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
    t.rec().fail('network');
    expect(t.r.state).toBe('error');
    expect(t.states.at(-1)[1]).toMatch(/internet/);
  });

  it('a missing microphone is reported', () => {
    const t = setup();
    t.r.start();
    t.rec().fail('audio-capture');
    expect(t.states.at(-1)).toEqual(['error', MESSAGES.noMic]);
  });

  it('toggle switches on and off', () => {
    const t = setup();
    expect(t.r.toggle()).toBe(true);
    expect(t.r.toggle()).toBe(false);
    expect(vi.isMockFunction(t.r.toggle)).toBe(false);
  });

  it('checks the microphone first and explains a blocked one', async () => {
    let reject;
    const t = setup({ micCheck: () => new Promise((_, no) => { reject = no; }) });
    t.r.start();
    expect(t.r.state).toBe('starting');
    expect(t.rec()).toBeUndefined();   // recognition waits for the check
    reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    await Promise.resolve(); await Promise.resolve();
    expect(t.r.state).toBe('denied');
    expect(t.r.message).toMatch(/address bar/);
    expect(t.r.on).toBe(false);
  });

  it('a blocked microphone can be retried; a passed check is not repeated', async () => {
    let calls = 0, allow = false;
    const t = setup({ micCheck: () => { calls++; return allow ? Promise.resolve() : Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' })); } });
    t.r.start();
    await new Promise(r => setTimeout(r, 0));
    expect(t.r.state).toBe('denied');
    allow = true;
    t.r.start();
    await new Promise(r => setTimeout(r, 0));
    expect(t.r.state).toBe('listening');
    t.r.stop(); t.r.start();
    expect(calls).toBe(2);
    expect(t.r.state).toBe('listening');
  });

  it('maps microphone errors to clear reasons', () => {
    expect(micFailure({ name: 'NotFoundError' })).toEqual({ state: 'error', message: MESSAGES.noMic });
    expect(micFailure({ name: 'NotReadableError' })).toEqual({ state: 'error', message: MESSAGES.busy });
    expect(micFailure({ name: 'NotAllowedError' }).state).toBe('denied');
  });

  it('warns when no audio reaches the browser, and clears the warning when speech arrives', () => {
    const t = setup({ mute: true });
    t.r.start();
    expect(t.timers.map(x => x.ms)).toEqual([6000]);
    t.runTimers();
    expect(t.r.message).toBe(MESSAGES.noAudio);
    t.rec().onaudiostart();
    expect(t.r.message).toBe('');
  });

  it('reports speech activity and warns after repeated silence', () => {
    const t = setup();
    t.r.start();
    t.rec().onspeechstart(); t.rec().onspeechend();
    expect(t.hearing).toEqual([true, false]);
    t.rec().fail('no-speech'); t.runTimers();
    t.rec().fail('no-speech'); t.runTimers();
    expect(t.r.message).toBe(MESSAGES.silent);
    t.rec().say('rock');
    expect(t.r.message).toBe('');
  });

  it('says why the speech service failed after the retries', () => {
    const t = setup();
    t.r.start();
    t.rec().fail('network');
    expect(t.r.message).toBe(MESSAGES.retrying);
    for (let i = 0; i < 4; i++) { t.runTimers(); t.rec().fail('network'); }
    expect(t.r.message).toBe(MESSAGES.network);
  });
});

describe('voice session', () => {
  it('stays usable after the mic was blocked, so the player can retry', () => {
    let opts, state = 'off';
    const rec = { supported: true, get state() { return state; }, start() {}, stop() {} };
    const v = createVoiceSession(o => { opts = o; return rec; });
    v.setOn(true);
    state = 'denied'; opts.onState('denied', MESSAGES.denied);
    expect(v.usable).toBe(true);
    expect(v.wanted).toBe(false);
    expect(v.message).toBe(MESSAGES.denied);
  });

  it('tracks hearing while listening', () => {
    let opts;
    const v = createVoiceSession(o => { opts = o; return { supported: true, state: 'listening', start() {}, stop() {} }; });
    opts.onHearing(true);
    expect(v.hearing).toBe(true);
    opts.onState('off', '');
    expect(v.hearing).toBe(false);
  });
});
