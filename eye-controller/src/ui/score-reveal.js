// Calibration result screen: the score counts up inside a ring, then the play area appears
// as its 4 x 2 cells coloured by how well each was calibrated, with weak cells marked.
//
//   const choice = await showCalibrationResult(result, { layout: eyes.layout });
//   // 'continue' | 'retry' | 'topup'
import { cellOf, DEFAULT_LAYOUT, allCells } from '../signals/lanes.js';
import { alpha, resolveTheme, screenButton } from './theme.js';

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
 * @param options  area, layout, minScore (default 60), autoMs: auto-continue after a good result
 *                 (default 4000, 0 = never), theme ('default' | 'neon' | object), keys: false when
 *                 the page handles keys itself, buttonClass: the page's button class. The buttons
 *                 carry data-gaze, so a gaze-dwell system can press them (eyes-only play).
 * @returns Promise<'continue' | 'retry' | 'topup'>   keys: Enter continue, R retry, T top-up
 */
export function showCalibrationResult(result, { area = document.body, layout = DEFAULT_LAYOUT, minScore = 60, autoMs = 4000, theme, keys = true, buttonClass = '' } = {}) {
  const T = resolveTheme(theme), ok = result.ok ?? result.score >= minScore, cells = cellScores(result, layout);
  const color = v => (v === null ? alpha(T.text, 0.15) : v >= 75 ? T.ok : v >= 55 ? T.warn : T.bad);
  const root = document.createElement('div');
  root.style.cssText = `position:${area === document.body ? 'fixed' : 'absolute'};inset:0;z-index:9999;background:radial-gradient(circle at 50% 35%,${alpha(T.secondary, 0.18)},${T.bg} 70%);background-color:${T.bg};color:${T.text};font:600 16px ${T.font};display:grid;place-items:center`;
  const grid = cells.map((c, i) => `<div style="grid-column:${c.lane + 1};grid-row:${c.band === 'top' ? 1 : 2};background:${alpha(color(c.score), 0.13)};border:2px solid ${c.weak ? T.bad : color(c.score)};border-radius:10px;display:grid;place-items:center;opacity:0;transform:scale(.6);transition:all .35s ${0.9 + i * 0.07}s">
    <span style="font:700 20px ${T.display};color:${color(c.score)}">${c.score ?? '–'}</span>${c.weak ? `<span style="font-size:11px;color:${T.bad}">weak</span>` : ''}</div>`).join('');
  const weakCount = cells.filter(c => c.weak).length, main = ok ? T.ok : T.bad;
  root.innerHTML = `
    <div style="text-align:center;display:grid;gap:18px;justify-items:center;width:min(560px,92vw)">
      <div data-ring style="width:180px;height:180px;border-radius:50%;background:conic-gradient(${main} var(--p,0%),${alpha(T.text, 0.1)} 0);display:grid;place-items:center;box-shadow:0 0 60px ${alpha(main, 0.33)}">
        <div style="width:150px;height:150px;border-radius:50%;background:${T.bg};display:grid;place-items:center">
          <div><div data-score style="font:700 56px ${T.display}">0</div><div style="font-size:12px;opacity:.6">CALIBRATION</div></div></div></div>
      <div style="font:700 26px ${T.display};color:${ok ? T.ok : T.warn}">${ok ? 'Locked in' : 'Needs another pass'}</div>
      <div style="display:grid;grid-template-columns:repeat(${layout.lanes},1fr);grid-template-rows:${layout.bandSplit}fr ${1 - layout.bandSplit}fr;gap:6px;width:100%;height:150px">${grid}</div>
      <div style="opacity:.7;font-weight:500">${weakCount ? `${weakCount} weak area${weakCount > 1 ? 's' : ''}: a top-up re-checks only those.` : 'Every part of the screen calibrated well.'}</div>
      <div data-buttons style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"></div>
      <div data-auto style="font-size:12px;opacity:.5"></div>
    </div>`;
  const k = (label, key) => (keys ? `${label} (${key})` : label);
  const buttons = [screenButton(k(ok ? 'Continue' : 'Continue anyway', 'Enter'), 'continue', T, buttonClass)];
  if (weakCount) buttons.push(screenButton(k('Top-up weak', 'T'), 'topup', T, buttonClass));
  buttons.push(screenButton(k('Redo', 'R'), 'retry', T, buttonClass));
  root.querySelector('[data-buttons]').append(...buttons);
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
    if (keys) addEventListener('keydown', onKey);
    buttons.forEach(b => { b.onclick = () => finish(b.dataset.a); });
    const tick = now => {
      const p = Math.min(1, Math.max(0, (now - t0) / 1200)), eased = 1 - (1 - p) ** 3, v = Math.round(result.score * eased);
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
