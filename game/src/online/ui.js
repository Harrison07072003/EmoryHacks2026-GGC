// Pieces shared by the Online Library screens: the search field, the mic toggle, and the
// voice wiring (live transcription + commands).
import { esc, gazeButton, html } from '../screens/ui.js';
import { getOnline, handleCommonVoice, parseVoice } from './session.js';

/** The field at the top: typed/searched text, plus live speech in a lighter style. */
export function searchField(text = '', placeholder = 'Type or say a song, artist or genre') {
  const el = html(`<div class="os-field" aria-live="polite"><span class="os-text"></span><span class="os-interim"></span><span class="os-caret"></span></div>`);
  const set = (t, interim = '') => {
    el.querySelector('.os-text').textContent = t;
    el.querySelector('.os-interim').textContent = interim ? ` ${interim}` : '';
    el.classList.toggle('empty', !t && !interim);
    el.dataset.placeholder = placeholder;
  };
  set(text);
  return { el, set };
}

const MIC_LABEL = {
  listening: '🎤 Mic on', starting: '🎤 Starting…', off: '🎤 Mic off', denied: '🎤 Blocked: retry', error: '🎤 Mic off', unsupported: '🎤 No voice',
};

/**
 * Gaze/click toggle for the microphone with a live on/off indicator. Alt+M toggles it too.
 * Disabled (with a reason) when the browser has no speech recognition. A blocked mic stays
 * pressable: pressing it asks again and explains what to change.
 */
export function micToggle(app) {
  const { voice } = getOnline(app);
  const btn = gazeButton('', () => voice.toggle(), { cls: 'small purple os-mic' });
  const render = () => {
    const listening = voice.state === 'listening';
    btn.textContent = MIC_LABEL[voice.state] ?? MIC_LABEL.off;
    btn.classList.toggle('on', listening || (voice.wanted && voice.state !== 'denied'));
    btn.classList.toggle('hearing', listening && voice.hearing);
    btn.disabled = !voice.usable;
    btn.title = !voice.supported ? 'This browser has no speech recognition (try Chrome or Edge)' : voice.state === 'denied' ? 'Allow the microphone in the browser to use voice' : 'Toggle voice (Alt+M)';
  };
  // capture phase + stopImmediatePropagation: Alt+M must not also type an "m" on the keyboard screen
  const onKey = e => { if (e.altKey && e.code === 'KeyM') { e.preventDefault(); e.stopImmediatePropagation(); voice.toggle(); } };
  addEventListener('keydown', onKey, { capture: true });
  const off = voice.onChange(render);
  render();
  return { el: btn, dispose() { off(); removeEventListener('keydown', onKey, { capture: true }); } };
}

/**
 * Connect the voice session to a screen: interim text goes to the field, final phrases are
 * parsed and handled by `onCommand` first, then by the shared commands.
 * Also shows voice errors in `statusEl`. Returns dispose().
 */
export function wireVoice(app, { field, statusEl, onCommand = () => false, plainIsSearch = true, baseText = () => '' }) {
  const { voice } = getOnline(app);
  const showStatus = () => {
    if (!statusEl) return;
    const listening = voice.state === 'listening';
    const msg = voice.message || (listening ? (voice.hearing ? '🎤 Hearing you…' : 'Listening… say a genre, “search <words>”, “back” or “stop listening”') : '');
    statusEl.textContent = msg;
    // a message while listening is a warning (no sound, service retrying)
    statusEl.classList.toggle('warn', voice.state === 'denied' || voice.state === 'error' || (listening && !!voice.message));
    statusEl.classList.toggle('hearing', listening && voice.hearing && !voice.message);
  };
  const detach = voice.attach({
    onInterim: text => field?.set(baseText(), text),
    onFinal: text => {
      field?.set(baseText(), text);
      const cmd = parseVoice(app, text, { plainIsSearch });
      if (!cmd) return;
      if (!onCommand(cmd)) handleCommonVoice(app, cmd);
    },
  });
  const off = voice.onChange(showStatus);
  showStatus();
  return () => { off(); detach(); };
}

/** Message block for "search is unavailable" and similar states. */
export const notice = (title, text) => html(`<div class="os-notice"><b>${esc(title)}</b><span>${esc(text)}</span></div>`);
