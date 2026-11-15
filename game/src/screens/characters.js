// Character select. By default each mode brings its own character (sketch); picking one
// here overrides that for every mode and is remembered.
import { CHARACTERS, CHARACTER_ORDER } from '../characters/characters.js';
import { mountPortrait, startBlinking } from '../characters/portrait.js';
import { esc, gazeButton, html } from './ui.js';

export default function characters(root, app, { back = 'songs' } = {}) {
  const el = html(`
    <section class="screen">
      <h2>Choose your character</h2>
      <p class="hint">Your character dances beside the track, and their eyes light up in Frenzy Mode.</p>
      <div class="row" data-cards></div>
    </section>`);
  root.appendChild(el);
  el.appendChild(Object.assign(gazeButton('◀ Back', () => app.go(back), { sound: 'back' }), { className: 'gbtn small purple top-left' }));
  const stops = [];
  for (const id of CHARACTER_ORDER) {
    const c = CHARACTERS[id];
    const card = html(`<button class="card ${app.session.characterId === id ? 'selected' : ''}" data-gaze>
      <div class="card-title">${esc(c.name)}</div><div class="card-text">${esc(c.blurb)}</div></button>`);
    stops.push(startBlinking(mountPortrait(card, c)));
    card.addEventListener('click', () => {
      app.session.characterId = id;
      app.settings.characterId = id;
      app.saveSettings();
      app.go(back);
    });
    el.querySelector('[data-cards]').appendChild(card);
  }
  return { onEscape: () => app.go(back), unmount: () => stops.forEach(s => s()) };
}
