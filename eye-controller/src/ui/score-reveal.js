// Calibration result screen: the score counts up inside a ring, then the play area appears
// as its 4 x 2 cells coloured by how well each was calibrated, with weak cells marked.
//
//   const choice = await showCalibrationResult(result, { layout: eyes.layout });
//   // 'continue' | 'retry' | 'topup'
import { cellOf, DEFAULT_LAYOUT, allCells } from '../signals/lanes.js';

/** Per-cell average score of the kept calibration dots. Pure; exported for tests. */
export function cellScores(result, layout = DEFAULT_LAYOUT) {
  return allCells(layout).map(cell => {
    const mine = (result.points ?? []).filter(p => !p.kind && p.kept && p.score !== null && sameCell(cellOf(p.target, layout), cell));
    const weak = (result.weakCells ?? []).some(c => sameCell(c, cell));
    return { ...cell, score: mine.length ? Math.round(mine.reduce((a, p) => a + p.score, 0) / mine.length) : null, weak };
  });
}
const sameCell = (a, b) => !!a && !!b && a.lane === b.lane && a.band === b.band;

/**
 * @param result   what startCalibration() resolved with
 * @param options  area, layout, minScore (default 60), autoMs: auto-continue after a good result (default 4000, 0 = never)
 * @returns Promise<'continue' | 'retry' | 'topup'>   keys: Enter continue, R retry, T top-up
 */
export function showCalibrationResult(result, { area = document.body, layout = DEFAULT_LAYOUT, minScore = 60, autoMs = 4000 } = {}) {
  const ok = result.ok ?? result.score >= minScore, cells = cellScores(result, layout);
  const color = v => (v === null ? '#2a2a40' : v >= 75 ? '#39ffb0' : v >= 55 ? '#ffd34d' : '#ff4d6d');
  const root = document.createElement('div');
  root.style.cssText = `position:${area === document.body ? 'fixed' : 'absolute'};inset:0;z-index:9999;background:radial-gradient(circle at 50% 35%,#15152a,#07070d 70%);color:#e8ecff;font:600 16px system-ui;display:grid;place-items:center`;
  const grid = cells.map((c, i) => `<div style="grid-column:${c.lane + 1};grid-row:${c.band === 'top' ? 1 : 2};background:${color(c.score)}22;border:2px solid ${c.weak ? '#ff4d6d' : color(c.score)};border-radius:10px;display:grid;place-items:center;opacity:0;transform:scale(.6);transition:all .35s ${0.9 + i * 0.07}s">
    <span style="font-size:20px;color:${color(c.score)}">${c.score ?? '–'}</span>${c.weak ? '<span style="font-size:11px;color:#ff4d6d">weak</span>' : ''}</div>`).join('');
  const weakCount = cells.filter(c => c.weak).length;
  root.innerHTML = `
    <div style="text-align:center;display:grid;gap:18px;justify-items:center;width:min(560px,92vw)">
      <div data-ring style="width:180px;height:180px;border-radius:50%;background:conic-gradient(${ok ? '#39ffb0' : '#ff4d6d'} var(--p,0%),#20203a 0);display:grid;place-items:center;box-shadow:0 0 60px ${ok ? '#39ffb055' : '#ff4d6d44'}">
        <div style="width:150px;height:150px;border-radius:50%;background:#0b0b16;display:grid;place-items:center">
          <div><div data-score style="font-size:56px">0</div><div style="font-size:12px;opacity:.6">CALIBRATION</div></div></div></div>
      <div style="font-size:26px;color:${ok ? '#39ffb0' : '#ffd34d'}">${ok ? 'Locked in' : 'Needs another pass'}</div>
      <div style="display:grid;grid-template-columns:repeat(${layout.lanes},1fr);grid-template-rows:${layout.bandSplit}fr ${1 - layout.bandSplit}fr;gap:6px;width:100%;height:150px">${grid}</div>
      <div style="opacity:.7;font-weight:500">${weakCount ? `${weakCount} weak area${weakCount > 1 ? 's' : ''}: a top-up re-checks only those.` : 'Every part of the screen calibrated well.'}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button data-a="continue">${ok ? 'Continue' : 'Continue anyway'} (Enter)</button>
        ${weakCount ? '<button data-a="topup">Top-up weak (T)</button>' : ''}<button data-a="retry">Redo (R)</button></div>
      <div data-auto style="font-size:12px;opacity:.5"></div>
    </div>`;
  root.querySelectorAll('button').forEach(b => { b.style.cssText = 'font:inherit;color:#e8ecff;background:#1a1a2a;border:1px solid #4de1ff;border-radius:8px;padding:9px 14px;cursor:pointer'; });
  area.append(root);
  requestAnimationFrame(() => root.querySelectorAll('[style*="scale(.6)"]').forEach(el => { el.style.opacity = 1; el.style.transform = 'scale(1)'; }));

  return new Promise(resolve => {
    const t0 = performance.now(), ring = root.querySelector('[data-ring]'), num = root.querySelector('[data-score]'), auto = root.querySelector('[data-auto]');
    let raf = 0;
    const finish = choice => { cancelAnimationFrame(raf); removeEventListener('keydown', onKey); root.remove(); resolve(choice); };
    const onKey = e => {
      if (e.key === 'Enter') finish('continue');
      if (e.key === 'r' || e.key === 'R') finish('retry');
      if ((e.key === 't' || e.key === 'T') && weakCount) finish('topup');
    };
    addEventListener('keydown', onKey);
    root.querySelectorAll('button').forEach(b => { b.onclick = () => finish(b.dataset.a); });
    const tick = now => {
      const k = Math.min(1, (now - t0) / 1200), eased = 1 - (1 - k) ** 3, v = Math.round(result.score * eased);
      num.textContent = v; ring.style.setProperty('--p', `${v}%`);
      if (ok && autoMs) {
        const left = autoMs - (now - t0);
        auto.textContent = `continuing in ${Math.max(0, Math.ceil(left / 1000))}…`;
        if (left <= 0) return finish('continue');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}
