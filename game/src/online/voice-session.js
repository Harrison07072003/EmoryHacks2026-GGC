// One microphone session for the Online Library screens. A screen attach()es its handlers on
// mount and the returned detach() runs on unmount; if the next screen does not attach (song
// select, gameplay...), recognition stops, so it never listens over the song audio. The
// player's on/off choice is remembered and resumes on the next search screen.
import { createRecognizer } from '../voice/recognizer.js';

export function createVoiceSession(makeRecognizer = createRecognizer, { later = (fn, ms) => setTimeout(fn, ms) } = {}) {
  let handler = null, wanted = false, message = '', hearing = false;
  const listeners = new Set();
  const notify = () => listeners.forEach(f => f(api));

  const rec = makeRecognizer({
    onInterim: text => handler?.onInterim?.(text),
    onFinal: text => handler?.onFinal?.(text),
    onState: (state, msg) => {
      if (state === 'denied' || state === 'error') wanted = false;
      if (state !== 'listening') hearing = false;
      message = msg || '';
      notify();
    },
    onHearing: h => { if (h !== hearing) { hearing = h; notify(); } },
  });

  const api = {
    get supported() { return rec.supported; },
    /** 'unsupported' | 'off' | 'starting' | 'listening' | 'denied' | 'error' */
    get state() { return rec.state; },
    get wanted() { return wanted; },
    get message() { return message; },
    /** true while the browser hears speech */
    get hearing() { return hearing; },
    /** Usable now: supported. A blocked mic can be retried (the check runs again and
        explains what to change), so 'denied' does not disable the controls. */
    get usable() { return rec.supported; },

    attach(h) {
      handler = h;
      if (wanted) rec.start();
      return () => {
        if (handler !== h) return;
        handler = null;
        later(() => { if (!handler) rec.stop(); }, 0);
      };
    },
    setOn(on) {
      if (!rec.supported) return;
      wanted = on;
      message = '';
      if (on) rec.start(); else rec.stop();
      notify();
    },
    toggle() { api.setOn(!wanted); return wanted; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return api;
}
