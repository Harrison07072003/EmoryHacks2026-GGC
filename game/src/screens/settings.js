// Settings: volumes, audio offset, gaze cursor, and the opt-in tracking-data switch.
// Every control is a gaze button (2 s dwell), so no hands are needed.
import { gazeButton, html } from './ui.js';

const pct = v => `${Math.round(v * 100)}%`;
const clamp01 = v => Math.round(Math.max(0, Math.min(1, v)) * 10) / 10;

export default function settings(root, app, { back = 'title' } = {}) {
  const s = app.settings;
  const el = html(`
    <section class="screen">
      <h2>Settings</h2>
      <div class="settings" data-grid></div>
      <p class="hint" style="font-size:15px" data-store></p>
    </section>`);
  root.appendChild(el);
  el.appendChild(Object.assign(gazeButton('◀ Back', () => app.go(back), { sound: 'back' }), { className: 'gbtn small purple top-left' }));
  const grid = el.querySelector('[data-grid]');

  function stepper(label, get, set, format, note) {
    const value = html(`<div class="value">${format(get())}</div>`);
    const change = d => { set(d); app.saveSettings(); value.textContent = format(get()); };
    grid.append(html(`<div class="label">${label}</div>`),
      gazeButton('−', () => change(-1), { cls: 'small purple', sound: 'tick' }), value, gazeButton('+', () => change(1), { cls: 'small purple', sound: 'tick' }));
    if (note) grid.append(html(`<div class="note">${note}</div>`));
  }
  function toggle(label, key, note) {
    const value = html(`<div class="value">${s[key] ? 'ON' : 'OFF'}</div>`);
    grid.append(html(`<div class="label">${label}</div>`), html('<div></div>'), value,
      gazeButton('Switch', () => { s[key] = !s[key]; app.saveSettings(); value.textContent = s[key] ? 'ON' : 'OFF'; }, { cls: 'small purple' }));
    if (note) grid.append(html(`<div class="note">${note}</div>`));
  }

  stepper('Master volume', () => s.master, d => { s.master = clamp01(s.master + d * 0.1); }, pct);
  stepper('Music volume', () => s.music, d => { s.music = clamp01(s.music + d * 0.1); }, pct);
  stepper('Effects volume', () => s.sfx, d => { s.sfx = clamp01(s.sfx + d * 0.1); }, pct);
  stepper('Audio offset', () => s.offsetMs, d => { s.offsetMs += d * 10; }, v => `${v > 0 ? '+' : ''}${v} ms`,
    'If notes feel late compared with the music, lower this; if early, raise it.');
  toggle('Gaze cursor', 'showGazeCursor');
  toggle('Help improve eye tracking', 'shareTrackingData',
    'Off by default. When on, each song saves numeric eye measurements (19 numbers per camera frame: eye and head positions, never images or video) with where you were meant to look, so the team can improve the tracker. Stored in this browser, or in the team database if one is configured.');

  el.querySelector('[data-store]').textContent = `Results are saved to: ${app.store.status.backend}${app.store.status.pending ? ` (${app.store.status.pending} waiting to upload)` : ''}. Calibration ${app.gaze.calibrationScore ?? '–'}/100.`;
  return { onEscape: () => app.go(back) };
}
