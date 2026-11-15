// Mode select: Practice / Normal / Challenge, each shown with its character (as in the
// sketch), plus Multiplayer marked Coming Soon (not selectable).
import { MODES, MODE_ORDER } from '../config/game-config.js';
import { CHARACTERS } from '../characters/characters.js';
import { mountPortrait, startBlinking } from '../characters/portrait.js';
import { esc, gazeButton, html } from './ui.js';

export default function modes(root, app) {
  const el = html(`
    <section class="screen">
      <h2>Choose your mode</h2>
      <div class="row" data-cards></div>
    </section>`);
  root.appendChild(el);
  el.appendChild(Object.assign(gazeButton('◀ Back', () => app.go('title'), { cls: 'small purple', sound: 'back' }), { className: 'gbtn small purple top-left' }));

  const cards = el.querySelector('[data-cards]'), stops = [];
  for (const id of MODE_ORDER) {
    const mode = MODES[id], character = CHARACTERS[mode.characterId];
    const card = html(`
      <button class="card" data-gaze>
        <div class="card-sub">${esc(mode.subtitle)}</div>
        <div class="card-title">${esc(mode.label)}</div>
        <div class="card-text">${esc(mode.blurb)}</div>
      </button>`);
    stops.push(startBlinking(mountPortrait(card, character)));
    card.addEventListener('click', () => {
      app.session.modeId = id;
      app.session.characterId = app.settings.characterId ?? mode.characterId;
      app.go('songs');
    });
    cards.appendChild(card);
  }
  cards.appendChild(html(`
    <div class="card" disabled aria-disabled="true">
      <div class="coming-soon">COMING SOON</div>
      <div class="card-sub">Versus</div>
      <div class="card-title">Multiplayer</div>
      <div class="card-text">Not available yet. Play head-to-head with a friend in a future update.</div>
    </div>`));

  return { onEscape: () => app.go('title'), unmount: () => stops.forEach(s => s()) };
}
