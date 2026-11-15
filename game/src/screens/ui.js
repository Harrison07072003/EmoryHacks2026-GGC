// Small DOM helpers shared by the screens.

/** Create an element from an HTML string (one root). */
export function html(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * A gaze button: 2 s dwell or a click both call `onPress`.
 * opts: cls (extra classes), sound (sfx name), disabled
 */
export function gazeButton(label, onPress, { cls = '', sound = 'select', disabled = false } = {}) {
  const b = html(`<button class="gbtn ${cls}" data-gaze data-sound="${sound}">${label}</button>`);
  if (disabled) b.disabled = true;
  b.addEventListener('click', () => { if (!b.disabled) onPress(); });
  return b;
}

/** A modal yes/no style popup in the overlay layer. Returns { close() }. */
export function popup({ title, text = '', buttons }) {
  const layer = document.getElementById('overlay-layer');
  const back = html(`<div class="popup-backdrop"><div class="popup"><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}<div class="row"></div></div></div>`);
  const row = back.querySelector('.row');
  const close = () => back.remove();
  for (const { label, cls, sound, onPress } of buttons) row.appendChild(gazeButton(label, () => { close(); onPress(); }, { cls, sound }));
  layer.appendChild(back);
  // everything behind the popup must not take gaze
  document.getElementById('app').inert = true;
  const restore = new MutationObserver(() => { if (!back.isConnected) { document.getElementById('app').inert = false; restore.disconnect(); } });
  restore.observe(layer, { childList: true });
  return { close, el: back };
}

export function closePopups() {
  document.querySelectorAll('#overlay-layer .popup-backdrop').forEach(p => p.remove());
  document.getElementById('app').inert = false;
}

let toastTimer;
export function toast(message, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
