// Online Library: Downloading… -> Analyzing… -> Ready, then the level starts through the normal
// song flow (startSong: between-song recalibration, play, results).
import { esc, gazeButton, html } from './ui.js';
import { startSong } from './songs.js';
import { prepareLevel } from '../online/level.js';

const STEPS = [['download', 'Downloading'], ['analyze', 'Analyzing'], ['ready', 'Ready']];

export default function onlinePrepare(root, app, { song } = {}) {
  if (!song) { queueMicrotask(() => app.go('onlineSearch')); return {}; }
  const el = html(`
    <section class="screen online-prepare">
      <h2>${esc(song.title)}</h2>
      <p class="hint">${esc(song.artist)} · <span class="os-license">${esc(song.licenseName)}</span></p>
      <ol class="op-steps">${STEPS.map(([id, label]) => `<li data-step="${id}"><i></i>${label}…</li>`).join('')}</ol>
      <p class="op-note">Archive songs play their first 30 seconds as an automatically generated level.</p>
      <p class="os-attr op-attr">${esc(song.attribution)}</p>
      <div class="op-actions"></div>
    </section>`);
  root.appendChild(el);
  const back = () => app.go('onlineResults');
  el.appendChild(Object.assign(gazeButton('◀ Cancel', back, { sound: 'back' }), { className: 'gbtn small purple top-left' }));

  const abort = new AbortController();
  let gone = false, startTimer = null;

  function setStep(step) {
    const at = STEPS.findIndex(([id]) => id === step);
    el.querySelectorAll('[data-step]').forEach((li, i) => {
      li.classList.toggle('done', i < at || step === 'ready');
      li.classList.toggle('active', i === at && step !== 'ready');
    });
  }

  function fail(error) {
    el.querySelector('.op-steps .active')?.classList.add('failed');
    const actions = el.querySelector('.op-actions');
    actions.replaceChildren(html(`<p class="os-status warn">${esc(error.message)}</p>`));
    if (error.retry !== false) actions.appendChild(gazeButton('Try again', () => app.go('onlinePrepare', { song })));
    actions.appendChild(gazeButton('Other songs', back, { cls: 'purple', sound: 'back' }));
  }

  prepareLevel(app, song, { onStep: setStep, signal: abort.signal })
    .then(({ song: level, source }) => {
      if (gone) return;
      el.querySelector('.op-note').textContent = source === 'browser' ? 'Level made on this device (the game server was not reachable).' : source === 'cache' ? 'Level ready.' : 'New level generated.';
      startTimer = setTimeout(() => { if (!gone) startSong(app, level.id); }, 900);
    })
    .catch(e => { if (!gone && !abort.signal.aborted) fail(e); });

  return {
    onEscape: back,
    unmount() { gone = true; abort.abort(); clearTimeout(startTimer); },
  };
}
