// Online Library, screen 2: the search field, "Say Genre" (voice) and "Keyboard".
// Reached from the song select screen's Search button. Results are the top 5 by popularity.
import { esc, gazeButton, html } from './ui.js';
import { getOnline, queryLabel } from '../online/session.js';
import { micToggle, notice, searchField, wireVoice } from '../online/ui.js';

export default function onlineSearch(root, app) {
  const online = getOnline(app);
  const { voice, search } = online;
  const el = html(`
    <section class="screen online-search">
      <h2>Search songs</h2>
      <div class="os-slot"></div>
      <div class="os-options"></div>
      <p class="hint os-genres"></p>
      <p class="os-status" role="status"></p>
    </section>`);
  root.appendChild(el);
  const field = searchField(online.draft || online.query.q);
  el.querySelector('.os-slot').appendChild(field.el);
  el.appendChild(Object.assign(gazeButton('◀ Songs', () => app.go('songs'), { sound: 'back' }), { className: 'gbtn small purple top-left' }));

  if (!search.available) {
    el.querySelector('.os-options').appendChild(notice('Online search is unavailable right now', 'The built-in songs still work. Go back to play them.'));
    return { onEscape: () => app.go('songs') };
  }

  const mic = micToggle(app);
  el.appendChild(Object.assign(mic.el, { className: `${mic.el.className} top-right` }));

  const options = el.querySelector('.os-options');
  const sayGenre = gazeButton('🎤 Say Genre', () => { voice.setOn(true); }, { cls: 'os-say' });
  const keyboard = gazeButton('⌨ Keyboard', () => app.go('onlineKeyboard'));
  options.append(sayGenre, keyboard);
  const renderSay = () => {
    sayGenre.disabled = !voice.usable;
    sayGenre.textContent = !voice.supported ? 'Voice not available in this browser' : voice.state === 'denied' ? '🎤 Mic blocked: try again' : voice.state === 'starting' ? '🎤 Starting…' : voice.state === 'listening' ? (voice.hearing ? '🎤 Hearing you…' : '🎤 Listening…') : '🎤 Say Genre';
    sayGenre.classList.toggle('on', voice.state === 'listening');
  };
  const offSay = voice.onChange(renderSay);
  renderSay();

  // spoken genre examples, from the genres the index really has
  const genresHint = el.querySelector('.os-genres');
  const showGenres = g => { if (g.length) genresHint.innerHTML = `Try saying: ${g.slice(0, 6).map(x => `<b>${esc(x)}</b>`).join(', ')} · or “search” and any words`; };
  showGenres(online.genres);
  search.genres().then(showGenres);
  if (online.query.q || online.query.genre) field.set(online.query.genre ? queryLabel(online.query) : online.query.q);

  const statusEl = el.querySelector('.os-status');
  const unwire = wireVoice(app, {
    field, statusEl, baseText: () => '',
    onCommand: cmd => {
      if (cmd.type === 'back') { app.go('songs'); return true; }
      if (cmd.type === 'choose') { app.toast('Search first, then choose a song'); return true; }
      return false;
    },
  });

  return {
    onEscape: () => app.go('songs'),
    unmount() { unwire(); offSay(); mic.dispose(); },
  };
}
