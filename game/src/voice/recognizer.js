// Continuous speech recognition (Web Speech API) with auto-restart and clean failure modes.
// Chrome sends the audio to Google's service, so recognition needs an internet connection.
// Firefox has no SpeechRecognition: `supported` is false and nothing else happens.
//
// States: 'unsupported' | 'off' | 'listening' | 'denied' (mic permission refused) | 'error'
// Only FINAL results are delivered to onFinal (interim text goes to onInterim for display),
// so a search runs once per phrase.

const RESTART_MS = 250;
const NETWORK_RETRY_MS = [1000, 2000, 4000, 8000];   // then give up with an 'error' state

export const speechRecognitionClass = (w = globalThis) => w.SpeechRecognition || w.webkitSpeechRecognition || null;

/**
 * @param o { SR (class, defaults to the browser's), lang, onInterim(text), onFinal(text),
 *            onState(state, message), setTimeout }
 */
export function createRecognizer({ SR = speechRecognitionClass(), lang = 'en-US', onInterim = () => {}, onFinal = () => {}, onState = () => {}, setTimeout: later = globalThis.setTimeout.bind(globalThis) } = {}) {
  let rec = null, wanted = false, state = SR ? 'off' : 'unsupported', networkFails = 0, restartTimer = null;
  const set = (s, message = '') => { state = s; onState(s, message); };

  function build() {
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => { if (wanted) set('listening'); };
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], text = res[0]?.transcript ?? '';
        if (res.isFinal) { networkFails = 0; if (text.trim()) onFinal(text.trim()); }
        else interim += text;
      }
      onInterim(interim.trim());
    };
    r.onerror = e => {
      switch (e.error) {
        case 'no-speech': case 'aborted': return;   // normal: onend restarts
        case 'not-allowed': case 'service-not-allowed':
          wanted = false; set('denied', 'Microphone permission was denied'); return;
        case 'audio-capture':
          wanted = false; set('error', 'No microphone was found'); return;
        case 'network':
          networkFails++;
          if (networkFails > NETWORK_RETRY_MS.length) { wanted = false; set('error', 'Voice needs an internet connection'); }
          return;
        default:
          wanted = false; set('error', `Voice error: ${e.error}`);
      }
    };
    // the browser ends recognition on its own (silence, time limits, errors): restart while wanted
    r.onend = () => {
      onInterim('');
      if (!wanted) { if (state === 'listening') set('off'); return; }
      const wait = networkFails ? NETWORK_RETRY_MS[Math.min(networkFails, NETWORK_RETRY_MS.length) - 1] : RESTART_MS;
      clearTimeout(restartTimer);
      restartTimer = later(() => { if (wanted) begin(); }, wait);
    };
    return r;
  }

  function begin() {
    try { rec ??= build(); rec.start(); }
    catch (e) { if (e?.name !== 'InvalidStateError') { wanted = false; set('error', `Voice could not start: ${e.message}`); } }
  }

  return {
    get supported() { return !!SR; },
    get state() { return state; },
    get on() { return wanted; },
    start() {
      if (!SR || wanted) return;
      wanted = true; networkFails = 0;
      begin();
    },
    stop() {
      if (!SR) return;
      wanted = false;
      clearTimeout(restartTimer);
      try { rec?.abort(); } catch { /* not running */ }
      if (state === 'listening') set('off');
    },
    toggle() { if (wanted) this.stop(); else this.start(); return wanted; },
  };
}
