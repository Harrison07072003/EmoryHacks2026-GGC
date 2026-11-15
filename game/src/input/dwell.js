// Gaze-dwell buttons: look at a control for DWELL.activateMs (2 s) to press it.
// A clockwise pie fills while you look; looking away drains it (decayRate x faster).
// After an activation: a sound, a flash, a global cooldown, and that control will not fire
// again until the gaze has left it, so nothing repeats by accident.
//
// Any element with [data-gaze] is a target. Activation calls element.click(), so mouse
// clicks and gaze go through exactly the same handler. [disabled] targets never fire.
import { DWELL } from '../config/game-config.js';

/** Pure dwell state machine (tested in test/dwell.test.js). */
export function createDwellCore(cfg = DWELL) {
  let current = null, progress = 0, cooldownUntil = 0, spent = null;
  return {
    get current() { return current; },
    get progress() { return progress; },
    /**
     * @param id   key of the target under the gaze, or null
     * @returns    the id that activated this step, or null
     */
    update(id, dtMs, now) {
      if (spent !== null && id !== spent) spent = null;  // gaze left the control that just fired: re-arm it
      if (id !== current) {
        // drain the old target first; only switch when it has emptied (smooth reversal)
        progress = Math.max(0, progress - (dtMs / cfg.activateMs) * cfg.decayRate);
        if (progress > 0 && current !== null) return null;
        current = id; progress = 0;
      }
      if (id === null || id === spent || now < cooldownUntil) return null;
      progress = Math.min(1, progress + dtMs / cfg.activateMs);
      if (progress < 1) return null;
      progress = 0; spent = id; cooldownUntil = now + cfg.cooldownMs;
      return id;
    },
    reset() { current = null; progress = 0; },
  };
}

/** DOM layer: hit-tests the gaze against [data-gaze] elements every frame. */
export function createDwell({ ring, sfx, cfg = DWELL }) {
  const core = createDwellCore(cfg);
  const pie = ring.querySelector('.pie');
  let last = performance.now(), currentEl = null, enabled = true, hoverListeners = new Set();

  function hit(gaze) {
    if (!gaze.valid) return null;
    const px = gaze.x * innerWidth, py = gaze.y * innerHeight;
    const pad = cfg.hitPadding * innerWidth, sticky = cfg.stickyPadding * innerWidth;
    // keep the current target while the gaze stays near it (noisy gaze must not flicker)
    if (currentEl?.isConnected && within(currentEl.getBoundingClientRect(), px, py, sticky)) return currentEl;
    let best = null, bestD = Infinity;
    for (const el of document.querySelectorAll('[data-gaze]')) {
      if (el.closest('[inert]') || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (!within(r, px, py, pad)) continue;
      const d = Math.hypot(px - (r.left + r.width / 2), py - (r.top + r.height / 2));
      if (d < bestD) { best = el; bestD = d; }
    }
    return best;
  }

  function setHover(el) {
    if (el === currentEl) return;
    currentEl?.classList.remove('gaze-on');
    currentEl?.style.setProperty('--dwell', 0);
    currentEl = el;
    el?.classList.add('gaze-on');
    hoverListeners.forEach(f => f(el));
  }

  return {
    /** Call every frame with the current gaze. */
    update(gaze) {
      const now = performance.now(), dt = Math.min(100, now - last);
      last = now;
      const el = enabled ? hit(gaze) : null;
      const target = el && !el.disabled && !el.hasAttribute('disabled') ? el : null;
      const fired = core.update(target, dt, now);
      const shown = core.current;
      setHover(shown ?? el);
      if (shown) {
        shown.style.setProperty('--dwell', core.progress.toFixed(3));
        const r = shown.getBoundingClientRect();
        ring.style.left = `${Math.min(innerWidth - 34, r.right - 8)}px`;
        ring.style.top = `${Math.max(34, r.top + 8)}px`;
        pie.style.setProperty('--p', core.progress.toFixed(3));
      }
      ring.classList.toggle('show', !!shown && core.progress > 0.02);
      if (fired) {
        fired.style.setProperty('--dwell', 0);
        fired.classList.remove('activated'); void fired.offsetWidth; fired.classList.add('activated');
        sfx?.play(fired.dataset.sound || 'select');
        fired.click();
      }
    },
    /** Disable gaze activation (e.g. during calibration). */
    setEnabled(on) { enabled = on; if (!on) { core.reset(); setHover(null); ring.classList.remove('show'); } },
    reset() { core.reset(); setHover(null); ring.classList.remove('show'); },
    /** Called with the element under the gaze (or null) whenever it changes: song previews use it. */
    onHover(fn) { hoverListeners.add(fn); return () => hoverListeners.delete(fn); },
  };
}

const within = (r, x, y, pad) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
