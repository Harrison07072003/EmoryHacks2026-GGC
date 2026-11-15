// Continuous speech recognition (Web Speech API) with auto-restart and clean failure modes.
// Chrome sends the audio to Google's service, so recognition needs an internet connection.
// Firefox has no SpeechRecognition: `supported` is false and nothing else happens.
//
// States: 'unsupported' | 'off' | 'starting' (checking the mic) | 'listening'
//         | 'denied' (mic permission refused) | 'error'
// Only FINAL results are delivered to onFinal (interim text goes to onInterim for display),
// so a search runs once per phrase. onState(state, message): a message while 'listening' is
// a warning (no sound, service retrying); onHearing(bool) follows speech start / end.
// Every step is logged as "[voice] ..." in the browser console for diagnosing a player's setup.

const RESTART_MS = 250;
const NETWORK_RETRY_MS = [1000, 2000, 4000, 8000];   // then give up with an 'error' state
const NO_AUDIO_MS = 6000;      // listening this long without any audio: warn
const SILENT_RESTARTS = 2;     // this many 'no-speech' ends in a row: warn

export const MESSAGES = {
  checking: 'Checking the microphone…',
  denied: 'Microphone blocked. Click the mic / camera icon in the address bar → Allow, then try again. On a Mac also check System Settings → Privacy & Security → Microphone → Chrome.',
  noMic: 'No microphone was found. Plug one in or pick one in System Settings → Sound → Input.',
  busy: 'The microphone is busy in another app (Zoom, Teams…). Close it and try again.',
  noAudio: 'Listening, but no sound is reaching the browser. Check the input device (System Settings → Sound → Input) and Chrome\'s mic choice (address bar icon).',
  silent: 'Not hearing any speech. Speak up, or check the microphone (System Settings → Sound → Input).',
  retrying: 'Can\'t reach the speech service, retrying…',
  network: 'Can\'t reach the speech service. Voice needs internet and Chrome or Edge (Brave, Arc, Opera and Vivaldi block it). Use the keyboard instead.',
};

export const speechRecognitionClass = (w = globalThis) => w.SpeechRecognition || w.webkitSpeechRecognition || null;

/** Ask for the microphone once (shows the browser's permission prompt), then release it.
    Throws the browser's error (NotAllowedError, NotFoundError, ...). Returns undefined
    without checking when getUserMedia is missing, so recognition can still try. */
export function checkMicrophone(nav = globalThis.navigator) {
  const md = nav?.mediaDevices;
  if (!md?.getUserMedia) return undefined;
  return md.getUserMedia({ audio: true }).then(stream => stream.getTracks().forEach(t => t.stop()));
}

/** Browser getUserMedia error -> { state, message } */
export function micFailure(err) {
  switch (err?.name) {
    case 'NotAllowedError': case 'SecurityError': case 'PermissionDeniedError': return { state: 'denied', message: MESSAGES.denied };
    case 'NotFoundError': case 'DevicesNotFoundError': case 'OverconstrainedError': return { state: 'error', message: MESSAGES.noMic };
    case 'NotReadableError': case 'TrackStartError': case 'AbortError': return { state: 'error', message: MESSAGES.busy };
    default: return { state: 'error', message: `Microphone problem: ${err?.message || err?.name || err}` };
  }
}

const defaultLog = globalThis.window ? (...a) => console.info('[voice]', ...a) : () => {};

/**
 * @param o { SR (class, defaults to the browser's), lang, onInterim(text), onFinal(text),
 *            onState(state, message), onHearing(bool), setTimeout, clearTimeout,
 *            micCheck (defaults to checkMicrophone), log }
 */
export function createRecognizer({
  SR = speechRecognitionClass(), lang = 'en-US', onInterim = () => {}, onFinal = () => {}, onState = () => {}, onHearing = () => {},
  setTimeout: later = globalThis.setTimeout.bind(globalThis), clearTimeout: cancel = globalThis.clearTimeout.bind(globalThis),
  micCheck = checkMicrophone, log = defaultLog,
} = {}) {
  let rec = null, wanted = false, state = SR ? 'off' : 'unsupported', message = '';
  let networkFails = 0, restartTimer = null, audioTimer = null, heardAudio = false, silentEnds = 0, micOk = false;
  const set = (s, msg = '') => {
    if (s === state && msg === message) return;
    state = s; message = msg;
    log('state', s, msg);
    onState(s, msg);
  };
  const fail = (s, msg) => { wanted = false; cancel(audioTimer); set(s, msg); };

  function build() {
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      if (!wanted) return;
      set('listening', networkFails ? MESSAGES.retrying : silentEnds >= SILENT_RESTARTS ? MESSAGES.silent : '');
      if (!heardAudio) { cancel(audioTimer); audioTimer = later(() => { if (wanted && state === 'listening' && !heardAudio) set('listening', MESSAGES.noAudio); }, NO_AUDIO_MS); }
    };
    r.onaudiostart = () => { heardAudio = true; cancel(audioTimer); log('audio started'); if (message === MESSAGES.noAudio) set('listening'); };
    r.onspeechstart = () => { log('speech'); onHearing(true); };
    r.onspeechend = () => onHearing(false);
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], text = res[0]?.transcript ?? '';
        if (res.isFinal) { networkFails = 0; silentEnds = 0; log('heard', JSON.stringify(text)); if (text.trim()) onFinal(text.trim()); }
        else interim += text;
      }
      if (state === 'listening' && message) set('listening');   // speech works: clear warnings
      onInterim(interim.trim());
    };
    r.onerror = e => {
      log('error', e.error, e.message || '');
      switch (e.error) {
        case 'aborted': return;   // our own stop/restart
        case 'no-speech': silentEnds++; return;   // onend restarts
        case 'not-allowed': case 'service-not-allowed': fail('denied', MESSAGES.denied); return;
        case 'audio-capture': fail('error', MESSAGES.noMic); return;
        case 'network':
          networkFails++;
          if (networkFails > NETWORK_RETRY_MS.length) fail('error', MESSAGES.network);
          else set(state, MESSAGES.retrying);
          return;
        default: fail('error', `Voice error: ${e.error}`);
      }
    };
    // the browser ends recognition on its own (silence, time limits, errors): restart while wanted
    r.onend = () => {
      onInterim(''); onHearing(false);
      if (!wanted) { if (state === 'listening' || state === 'starting') set('off'); return; }
      const wait = networkFails ? NETWORK_RETRY_MS[Math.min(networkFails, NETWORK_RETRY_MS.length) - 1] : RESTART_MS;
      cancel(restartTimer);
      restartTimer = later(() => { if (wanted) begin(); }, wait);
    };
    return r;
  }

  function begin() {
    try { rec ??= build(); rec.start(); }
    catch (e) { if (e?.name !== 'InvalidStateError') fail('error', `Voice could not start: ${e.message}`); }
  }

  // ask for the mic first: the browser's own prompt, and a precise reason when it fails
  function checkThenBegin() {
    if (micOk) { begin(); return; }
    const ok = () => { micOk = true; log('microphone ok'); if (wanted) begin(); };
    const bad = err => { log('microphone check failed', err?.name, err?.message); if (wanted) { const f = micFailure(err); fail(f.state, f.message); } };
    let check;
    try { check = micCheck(); } catch (e) { bad(e); return; }
    if (check?.then) { set('starting', MESSAGES.checking); check.then(ok, bad); } else ok();
  }

  return {
    get supported() { return !!SR; },
    get state() { return state; },
    get message() { return message; },
    get on() { return wanted; },
    start() {
      if (!SR || wanted) return;
      wanted = true; networkFails = 0; silentEnds = 0; heardAudio = false;
      log('start');
      checkThenBegin();
    },
    stop() {
      if (!SR) return;
      wanted = false;
      cancel(restartTimer); cancel(audioTimer);
      try { rec?.abort(); } catch { /* not running */ }
      if (state === 'listening' || state === 'starting') set('off');
    },
    toggle() { if (wanted) this.stop(); else this.start(); return wanted; },
  };
}
