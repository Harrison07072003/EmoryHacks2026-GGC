// Default calibration screen: a dot that walks the targets, with a ring that fills while
// the point is being captured. Escape cancels. Pass your own `onTarget` to startCalibration
// to replace it.

export function createCalibrationOverlay(area = document.body, onCancel = () => {}) {
  const fixed = area === document.body;
  const root = document.createElement('div');
  root.style.cssText = `position:${fixed ? 'fixed' : 'absolute'};inset:0;background:rgba(8,8,14,.94);z-index:9999;cursor:none;font:600 18px system-ui;color:#dde`;
  root.innerHTML = `
    <div data-msg style="position:absolute;left:0;right:0;top:46%;text-align:center;pointer-events:none;opacity:.75">Look at each dot until it fills. Keep your head still.</div>
    <div data-dot style="position:absolute;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;transition:left .25s,top .25s;background:conic-gradient(#ffd34d var(--p,0%),#2a2a40 0)">
      <div style="position:absolute;inset:8px;border-radius:50%;background:#fff"></div>
      <div style="position:absolute;inset:24px;border-radius:50%;background:#ff4d6d"></div>
    </div>`;
  const dot = root.querySelector('[data-dot]'), msg = root.querySelector('[data-msg]');
  area.appendChild(root);
  const onKey = e => { if (e.key === 'Escape') onCancel(); };
  addEventListener('keydown', onKey);
  return {
    show(target, index, total, info) {
      if (!target) return;
      dot.style.transition = info?.moving ? 'none' : 'left .25s, top .25s'; // a moving dot must not lag
      dot.style.left = `${target.x * 100}%`; dot.style.top = `${target.y * 100}%`;
      if (info?.moving) { msg.textContent = 'Follow the dot with your eyes'; return; }
      dot.style.setProperty('--p', '0%');
      if (index > 0) msg.textContent = `${index + 1} / ${total}`;
    },
    progress(p) { dot.style.setProperty('--p', `${Math.round(p * 100)}%`); },
    destroy() { root.remove(); removeEventListener('keydown', onKey); },
  };
}
