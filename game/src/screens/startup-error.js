// Shown when eye tracking could not start (no camera, permission denied, insecure origin,
// MediaPipe files missing). Says what actually went wrong; offers the dev fallbacks clearly
// labelled as such.
import { esc, gazeButton, html } from './ui.js';

export default function startupError(root, app, { error }) {
  const message = String(error?.message ?? error);
  // Dev only: Vite rebuilt its dependency cache while this page was loading ("504 Outdated
  // Optimize Dep"). A reload fetches the new files; do it once by itself so the page does not
  // stay stuck (through Coder's forwarding Vite cannot always trigger the reload).
  if (/\.vite\/deps|Outdated Optimize Dep/i.test(message) && reloadOnce()) return {};
  const hint = /permission|denied|notallowed/i.test(message) ? 'Allow the camera in the browser address bar, then reload.'
    : /secure|localhost|https/i.test(message) ? 'Open the game from http://localhost (or https), not a network IP.'
      : /notfound|device/i.test(message) ? 'No camera was found. Plug one in, close other apps using it, then reload.'
        : /\.vite\/deps|Outdated Optimize Dep|dynamically imported module/i.test(message) ? 'The dev server was rebuilding its files. Reload the page; if it happens again, stop and restart `npm run dev`.'
        : /wasm|mediapipe|model|fetch/i.test(message) ?'The face tracking files are missing: run `npm install` and `npm run fetch-model` in eye-controller/.'
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

/** Reload at most once per 30 s (sessionStorage guard against loops). Returns true when reloading. */
function reloadOnce() {
  try {
    const key = 'rhythmeyez:deps-reload', last = Number(sessionStorage.getItem(key)) || 0;
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}
