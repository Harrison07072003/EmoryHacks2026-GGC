// Full-screen face check, shown before calibration: the face view with the oval, mesh and a
// checklist. Continues by itself once every required check has stayed green for `holdMs`.
//
//   const { skipped } = await runFaceCheck(eyes);
import { createFaceView } from './face-view.js';
import { positionChecks, positionOk } from '../signals/position.js';

/** @returns Promise<{ skipped: boolean }>   Enter / Escape / the Skip button skip it. */
export function runFaceCheck(eyes, { area = document.body, holdMs = 1500, mesh = 'contours' } = {}) {
  const root = document.createElement('div');
  root.style.cssText = `position:${area === document.body ? 'fixed' : 'absolute'};inset:0;z-index:9999;background:#07070d;color:#e8ecff;font:600 16px system-ui;display:flex;flex-direction:column;gap:10px;padding:16px;box-sizing:border-box`;
  root.innerHTML = `
    <div style="text-align:center"><div style="font-size:28px;color:#ffd34d">Face check</div>
      <div style="opacity:.75;font-weight:500">Sit how you will play. Fit your face in the oval and keep every line green.</div></div>
    <div style="flex:1;min-height:0;position:relative"><canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>
    <div style="display:flex;justify-content:center;align-items:center;gap:16px">
      <div data-ring style="width:54px;height:54px;border-radius:50%;background:conic-gradient(#39ffb0 var(--p,0%),#2a2a40 0);display:grid;place-items:center">
        <span data-count style="background:#07070d;border-radius:50%;width:42px;height:42px;display:grid;place-items:center">–</span></div>
      <button data-skip style="font:inherit;color:#e8ecff;background:#1a1a2a;border:1px solid #4de1ff;border-radius:8px;padding:8px 14px;cursor:pointer">Skip (Enter)</button>
    </div>`;
  area.append(root);
  const view = createFaceView(eyes, root.querySelector('canvas'), { checks: true, mesh });
  const ring = root.querySelector('[data-ring]'), count = root.querySelector('[data-count]');

  return new Promise(resolve => {
    let okSince = null, raf = 0;
    const finish = skipped => { cancelAnimationFrame(raf); view.destroy(); root.remove(); removeEventListener('keydown', onKey); resolve({ skipped }); };
    const onKey = e => { if (e.key === 'Enter' || e.key === 'Escape') finish(true); };
    addEventListener('keydown', onKey);
    root.querySelector('[data-skip]').onclick = () => finish(true);
    const tick = now => {
      const ok = positionOk(positionChecks(eyes.faceData().frame));
      okSince = ok ? okSince ?? now : null;
      const p = okSince === null ? 0 : Math.min(1, (now - okSince) / holdMs);
      ring.style.setProperty('--p', `${Math.round(p * 100)}%`);
      count.textContent = okSince === null ? '–' : ((holdMs * (1 - p)) / 1000).toFixed(1);
      if (p >= 1) return finish(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}
