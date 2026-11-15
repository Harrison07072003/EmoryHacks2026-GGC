// Online Library, screen 3: an on-screen keyboard for gaze (each key is a dwell button) that
// also takes a physical keyboard. "Search" runs the search and shows the top 5 results.
import { gazeButton, html } from './ui.js';
import { getOnline, handleCommonVoice, runSearch } from '../online/session.js';
import { micToggle, searchField, wireVoice } from '../online/ui.js';

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const MAX_LEN = 60;
const TYPABLE = /^[a-z0-9 '\-&]$/;

export default function onlineKeyboard(root, app) {
  const online = getOnline(app);
  let text = online.draft ?? '';
  const el = html(`
    <section class="screen online-keyboard">
      <div class="os-slot"></div>
      <div class="os-keys" role="group" aria-label="Keyboard"></div>
      <p class="os-status" role="status"></p>
    </section>`);
  root.appendChild(el);
  const field = searchField(text, 'Type a song, artist or genre');
  el.querySelector('.os-slot').appendChild(field.el);
  el.appendChild(Object.assign(gazeButton('◀ Back', () => back(), { sound: 'back' }), { className: 'gbtn small purple top-left' }));
  const mic = micToggle(app);
  el.appendChild(Object.assign(mic.el, { className: `${mic.el.className} top-right` }));

  const update = t => { text = t.slice(0, MAX_LEN); online.draft = text; field.set(text); };
  const type = ch => update(text + ch);
  const backspace = () => update(text.slice(0, -1));
  const submit = () => { if (text.trim()) runSearch(app, { q: text }); else app.toast('Type something first'); };
  const back = () => app.go('onlineSearch');

  const keys = el.querySelector('.os-keys');
  for (const row of ROWS) {
    const r = html('<div class="os-row"></div>');
    for (const ch of row) r.appendChild(gazeButton(ch.toUpperCase(), () => type(ch), { cls: 'os-key', sound: 'tick' }));
    keys.appendChild(r);
  }
  const actions = html('<div class="os-row os-actions"></div>');
  actions.append(
    gazeButton('Space', () => type(' '), { cls: 'os-key wide', sound: 'tick' }),
    gazeButton('⌫', () => backspace(), { cls: 'os-key', sound: 'tick' }),
    gazeButton('Clear', () => update(''), { cls: 'os-key purple', sound: 'back' }),
    gazeButton('Search ✓', () => submit(), { cls: 'os-key wide go' }),
  );
  keys.appendChild(actions);

  const unwire = wireVoice(app, {
    field, statusEl: el.querySelector('.os-status'), baseText: () => text,
    onCommand: cmd => {
      if (cmd.type === 'back') { back(); return true; }
      if (cmd.type === 'clear') { update(''); return true; }
      if (cmd.type === 'confirm') { submit(); return true; }
      if (cmd.type === 'choose') { app.toast('Search first, then choose a song'); return true; }
      return handleCommonVoice(app, cmd);
    },
  });

  return {
    onEscape: back,
    // physical keyboard (main.js lowercases e.key)
    onKey(key) {
      if (key === 'enter') submit();
      else if (key === 'backspace') backspace();
      else if (TYPABLE.test(key)) type(key);
    },
    unmount() { unwire(); mic.dispose(); },
  };
}
