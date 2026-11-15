// Eyes cannot scroll. When the current screen is taller than the window, two gaze buttons
// appear (▲ top centre, ▼ bottom centre); looking at one for the usual dwell scrolls the
// screen by most of a window. They hide when there is nothing more in that direction, and
// while a popup or calibration covers the screen.
import { gazeButton } from './ui.js';

const STEP = 0.7;   // share of the visible height scrolled per press

export function createGazeScroll(root = document.body) {
  const make = (label, dir, cls) => {
    const b = gazeButton(label, () => scroll(dir), { cls: `small purple gaze-scroll ${cls}`, sound: 'tick' });
    b.hidden = true;
    root.appendChild(b);
    return b;
  };
  const up = make('▲', -1, 'gaze-scroll-up'), down = make('▼ More', 1, 'gaze-scroll-down');
  let screen = null;

  function scroll(dir) {
    if (!screen) return;
    screen.scrollBy({ top: dir * screen.clientHeight * STEP, behavior: 'smooth' });
  }

  return {
    /** Call every frame. `covered`: a popup / calibration is on top, so hide both. */
    update(covered = false) {
      screen = document.querySelector('#app > .screen');
      const tall = !!screen && getComputedStyle(screen).overflowY !== 'hidden' && contentBottom(screen) > screen.clientHeight + 4;
      screen?.classList.toggle('has-gaze-scroll', tall);   // extra bottom room so the last row clears ▼
      const can = tall && !covered;
      up.hidden = !can || screen.scrollTop <= 2;
      down.hidden = !can || screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 2;
    },
  };
}

/** Bottom of the screen's in-flow content, in scroll coordinates (ignores padding, so adding
    the extra bottom room cannot keep the ▼ button on after the content fits again). */
function contentBottom(screen) {
  const top = screen.getBoundingClientRect().top - screen.scrollTop;
  let bottom = 0;
  for (const c of screen.children) {
    const pos = getComputedStyle(c).position;
    if (pos !== 'absolute' && pos !== 'fixed') bottom = Math.max(bottom, c.getBoundingClientRect().bottom - top);
  }
  return bottom;
}
