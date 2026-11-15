// Title screen. Before any calibration exists the gaze cannot press buttons yet, so Start
// also triggers by itself once a face has been steadily in view for a few seconds.
import { CHARACTERS, CHARACTER_ORDER } from '../characters/characters.js';
import { mountPortrait, startBlinking } from '../characters/portrait.js';
import { gazeButton, html } from './ui.js';

const AUTO_START_MS = 3000;

export default function title(root, app) {
  const { gaze } = app;
  const el = html(`
    <section class="screen">
      <div class="logo">RHYTHM<span>EYEZ</span></div>
      <div class="tagline">Play the beat with your eyes</div>
      <div class="status-line"><span data-face></span><span data-cal></span><span data-sound></span></div>
      <div class="row" data-buttons></div>
      <div data-auto style="display:none;text-align:center">
        <div class="auto-ring" style="margin:0 auto 10px"><span data-count>3</span></div>
        <div class="hint">Look at the screen and hold still: calibration starts by itself.</div>
      </div>
      <div class="title-chars"></div>
    </section>`);
  root.appendChild(el);

  const start = () => {
    if (!app.session.calibratedThisSession && gaze.eyes) app.go('calibration', { kind: gaze.calibrated ? 'auto' : 'full', next: 'modes' });
    else app.go('modes');
  };
  const buttons = el.querySelector('[data-buttons]');
  buttons.append(
    gazeButton('Start Game', start),
    gazeButton('Settings', () => app.go('settings', { back: 'title' }), { cls: 'purple small' }),
  );
  if (gaze.eyes && gaze.calibrated) buttons.append(gazeButton('Recalibrate', () => app.go('calibration', { kind: 'full', next: 'title' }), { cls: 'purple small' }));

  const stops = CHARACTER_ORDER.map(id => startBlinking(mountPortrait(el.querySelector('.title-chars'), CHARACTERS[id])));

  const face = el.querySelector('[data-face]'), cal = el.querySelector('[data-cal]'), sound = el.querySelector('[data-sound]');
  const auto = el.querySelector('[data-auto]'), ring = auto.querySelector('.auto-ring'), count = auto.querySelector('[data-count]');
  let faceSince = null;

  return {
    frame(now) {
      face.innerHTML = gaze.faceVisible ? '<span class="ok">● face found</span>' : '<span class="bad">● no face: sit in front of the camera, face a light</span>';
      cal.innerHTML = gaze.calibrationScore === null ? (gaze.eyes ? 'not calibrated yet' : '')
        : `calibration <span class="${gaze.calibrationOk ? 'ok' : 'bad'}">${gaze.calibrationScore}/100</span>`;
      sound.innerHTML = app.audio.running ? '' : '<span class="bad">sound starts after one click or key press</span>';
      // hands-free start: no calibration yet means the eyes cannot press buttons
      const needsAuto = gaze.eyes && !gaze.calibrated && !gaze.mouseOverride;
      auto.style.display = needsAuto ? '' : 'none';
      if (!needsAuto) return;
      faceSince = gaze.faceVisible ? (faceSince ?? now) : null;
      const p = faceSince === null ? 0 : (now - faceSince) / AUTO_START_MS;
      ring.style.setProperty('--p', Math.min(1, p).toFixed(3));
      count.textContent = faceSince === null ? '–' : Math.max(1, Math.ceil(3 - p * 3));
      if (p >= 1) start();
    },
    unmount() { stops.forEach(s => s()); },
  };
}
