// Picks the speech engine. Default: offline (Vosk in the browser, no Google service). Google's
// Web Speech is used with ?voice=google, or automatically when the offline engine cannot run
// (no WebAssembly / Web Audio) or its model fails to load. Same interface as each engine.
import { createRecognizer } from './recognizer.js';
import { createLocalRecognizer, LOCAL_MESSAGES } from './local-recognizer.js';

/** 'offline' | 'google' from ?voice=..., default 'offline' */
export function voicePreference(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get('voice') === 'google' ? 'google' : 'offline';
}

/**
 * @param opts  the callbacks shared by both engines (onInterim, onFinal, onState, onHearing)
 * @param o { prefer, audioContext, makeLocal, makeGoogle }
 */
export function createVoiceRecognizer(opts = {}, { prefer = voicePreference(), audioContext, makeLocal = createLocalRecognizer, makeGoogle = createRecognizer } = {}) {
  let current = null;
  const onState = (state, msg) => {
    // offline model missing / unreachable: Google, when this browser has it, takes over
    if (current?.engine === 'offline' && state === 'error' && msg === LOCAL_MESSAGES.modelFailed && google.supported) {
      current = google;
      google.start();
      return;
    }
    opts.onState?.(state, msg);
  };
  const shared = { ...opts, onState };
  const google = makeGoogle(shared);
  const offline = makeLocal({ ...shared, audioContext });
  current = prefer === 'google' ? (google.supported ? google : offline) : (offline.supported ? offline : google);

  return {
    get engine() { return current === google ? 'google' : 'offline'; },
    get supported() { return current.supported; },
    get state() { return current.state; },
    get message() { return current.message; },
    get on() { return current.on; },
    start() { current.start(); },
    stop() { current.stop(); },
    toggle() { return current.toggle(); },
  };
}
