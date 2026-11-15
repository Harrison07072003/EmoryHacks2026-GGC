// Offline speech recognition: Vosk (Kaldi compiled to WebAssembly, `vosk-browser`) with the
// small English model, all inside the browser. No Google service, no internet once the model
// is loaded, works in any browser with WebAssembly + Web Audio. Same interface and callbacks
// as createRecognizer in recognizer.js, so the screens do not care which one runs.
//
// The model (~41 MB) is served from <base>voice-model/ (`npm run fetch-voice-model`); when that
// file is missing it is fetched from MODEL_FALLBACK_URL. It loads once per page, on first use.

import { MESSAGES, micFailure } from './recognizer.js';

export const MODEL_FILE = 'vosk-model-small-en-us-0.15.tar.gz';
export const MODEL_FALLBACK_URL = `https://ccoreilly.github.io/vosk-browser/models/${MODEL_FILE}`;
const MODEL_TIMEOUT_MS = 120000;

export const LOCAL_MESSAGES = {
  loading: 'Loading the offline voice model (41 MB, first time only)…',
  modelFailed: 'The offline voice model did not load. Run `npm run fetch-voice-model` in game/, or check the internet once.',
  noAudioContext: 'This browser cannot record audio for voice.',
  suspended: 'Click or press a key once to switch on sound and voice (browsers need one real click).',
};

const defaultLog = globalThis.window ? (...a) => console.info('[voice:offline]', ...a) : () => {};

/** Local model first (HEAD check), the public copy otherwise. */
export async function resolveModelUrl({ base = import.meta.env?.BASE_URL ?? '/', fetchFn = globalThis.fetch, origin = globalThis.location?.href } = {}) {
  const local = new URL(`${base}voice-model/${MODEL_FILE}`, origin).href;
  try {
    const res = await fetchFn(local, { method: 'HEAD' });
    const type = res.headers?.get?.('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) return local;   // dev servers answer 404s with index.html
  } catch { /* offline or blocked: try the public copy */ }
  return MODEL_FALLBACK_URL;
}

/**
 * @param o { onInterim, onFinal, onState, onHearing, log,
 *            audioContext: () => AudioContext (the game's, so it is already unlocked),
 *            getUserMedia, loadVosk, modelUrl: () => Promise<string> }
 */
export function createLocalRecognizer({
  onInterim = () => {}, onFinal = () => {}, onState = () => {}, onHearing = () => {}, log = defaultLog,
  audioContext = () => null,
  getUserMedia = c => globalThis.navigator.mediaDevices.getUserMedia(c),
  loadVosk = () => import('vosk-browser').then(m => (m.createModel ? m : m.default)),   // UMD bundle: default export only
  modelUrl = () => resolveModelUrl(),
} = {}) {
  const supported = !!(globalThis.WebAssembly && (globalThis.AudioContext || globalThis.webkitAudioContext || audioContext()));
  let state = supported ? 'off' : 'unsupported', message = '', wanted = false, run = 0;
  let modelPromise = null, live = null, hearing = false;

  const set = (s, msg = '') => {
    if (s === state && msg === message) return;
    state = s; message = msg;
    log('state', s, msg);
    onState(s, msg);
  };
  const hear = h => { if (h !== hearing) { hearing = h; onHearing(h); } };

  function loadModel() {
    modelPromise ??= (async () => {
      const [{ createModel }, url] = await Promise.all([loadVosk(), modelUrl()]);
      log('loading model', url);
      const model = await Promise.race([
        createModel(url),
        new Promise((_, no) => setTimeout(() => no(new Error('model load timed out')), MODEL_TIMEOUT_MS)),
      ]);
      log('model ready');
      return model;
    })();
    modelPromise.catch(() => { modelPromise = null; });   // allow a retry
    return modelPromise;
  }

  async function begin(myRun) {
    const ctx = audioContext() ?? new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (!ctx) { fail('error', LOCAL_MESSAGES.noAudioContext); return; }
    let stream;
    try {
      stream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
    } catch (err) {
      if (myRun === run) { const f = micFailure(err); fail(f.state, f.message); }
      return;
    }
    if (myRun !== run) { stream.getTracks().forEach(t => t.stop()); return; }

    let model;
    if (!modelPromise) set('starting', LOCAL_MESSAGES.loading);
    try { model = await loadModel(); }
    catch (err) {
      stream.getTracks().forEach(t => t.stop());
      log('model failed', err?.message);
      if (myRun === run) fail('error', LOCAL_MESSAGES.modelFailed);
      return;
    }
    if (myRun !== run) { stream.getTracks().forEach(t => t.stop()); return; }

    const rec = new model.KaldiRecognizer(ctx.sampleRate);
    rec.on('partialresult', m => {
      const partial = m.result?.partial ?? '';
      hear(!!partial);
      onInterim(partial);
    });
    rec.on('result', m => {
      const text = (m.result?.text ?? '').trim();
      hear(false);
      onInterim('');
      if (text) { log('heard', JSON.stringify(text)); onFinal(text); }
    });
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = e => { try { rec.acceptWaveform(e.inputBuffer); } catch (err) { log('acceptWaveform failed', err?.message); } };
    source.connect(node);
    node.connect(ctx.destination);   // Chrome only runs a ScriptProcessor that is connected; it outputs silence
    live = { stream, source, node, rec };
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* needs a gesture */ } }
    set('listening', ctx.state === 'running' ? '' : LOCAL_MESSAGES.suspended);
    if (ctx.state !== 'running') ctx.addEventListener?.('statechange', () => { if (live && ctx.state === 'running' && message === LOCAL_MESSAGES.suspended) set('listening'); });
  }

  function teardown() {
    if (!live) return;
    const { stream, source, node, rec } = live;
    live = null;
    try { node.onaudioprocess = null; source.disconnect(); node.disconnect(); } catch { /* already gone */ }
    stream.getTracks().forEach(t => t.stop());
    try { rec.remove(); } catch { /* model gone */ }
    hear(false); onInterim('');
  }

  function fail(s, msg) { wanted = false; run++; teardown(); set(s, msg); }

  return {
    get supported() { return supported; },
    get state() { return state; },
    get message() { return message; },
    get on() { return wanted; },
    engine: 'offline',
    start() {
      if (!supported || wanted) return;
      wanted = true;
      const myRun = ++run;
      log('start');
      set('starting', modelPromise ? MESSAGES.checking : LOCAL_MESSAGES.loading);
      begin(myRun).catch(err => { if (myRun === run) fail('error', `Voice could not start: ${err?.message}`); });
    },
    stop() {
      if (!supported) return;
      wanted = false; run++;
      teardown();
      if (state === 'listening' || state === 'starting') set('off');
    },
    toggle() { if (wanted) this.stop(); else this.start(); return wanted; },
  };
}
