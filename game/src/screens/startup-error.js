// Shown when eye tracking could not start (no camera, permission denied, insecure origin,
// MediaPipe files missing). Says what actually went wrong; offers the dev fallbacks clearly
// labelled as such.
import { esc, gazeButton, html } from './ui.js';

export default function startupError(root, app, { error }) {
  const message = String(error?.message ?? error);
  const hint = /permission|denied|notallowed/i.test(message) ? 'Allow the camera in the browser address bar, then reload.'
    : /secure|localhost|https/i.test(message) ? 'Open the game from http://localhost (or https), not a network IP.'
      : /notfound|device/i.test(message) ? 'No camera was found. Plug one in, close other apps using it, then reload.'
        : /wasm|mediapipe|model|fetch/i.test(message) ? 'The face tracking files are missing: run `npm install` and `npm run fetch-model` in eye-controller/.'
          : 'Check the browser console for details.';
  const el = html(`
    <section class="screen">
      <h2>Eye tracking could not start</h2>
      <p class="hint"><b>${esc(message)}</b></p>
      <p class="hint">${esc(hint)}</p>
      <div class="row" data-buttons></div>
      <p class="hint" style="font-size:15px">The two development options below do not use your eyes. Results from them are marked as dev input.</p>
    </section>`);
  root.appendChild(el);
  el.querySelector('[data-buttons]').append(
    gazeButton('Reload', () => location.reload()),
    gazeButton('Dev: simulated gaze', () => { location.search = '?input=sim'; }, { cls: 'purple small' }),
    gazeButton('Dev: mouse as gaze', () => { location.search = '?input=mouse'; }, { cls: 'purple small' }),
  );
  return {};
}
