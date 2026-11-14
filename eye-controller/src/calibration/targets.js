// Where calibration dots go. All coordinates are normalized 0-1 over the play area.
import { allCells, cellCenter, DEFAULT_LAYOUT } from '../signals/lanes.js';

/**
 * Full calibration: every lane centre on three rows (top band, band border, bottom band)
 * plus the four corners, walked in a snake so each eye move is short.
 */
export function defaultTargets(layout = DEFAULT_LAYOUT) {
  const s = layout.bandSplit, xs = Array.from({ length: layout.lanes }, (_, i) => (i + 0.5) / layout.lanes);
  const rows = [s / 2, s, s + (1 - s) / 2];
  const grid = rows.flatMap((y, r) => (r % 2 ? [...xs].reverse() : xs).map(x => ({ x, y })));
  const corners = [{ x: 0.04, y: 0.96 }, { x: 0.04, y: 0.04 }, { x: 0.96, y: 0.04 }, { x: 0.96, y: 0.96 }];
  return [...grid, ...corners];
}

/** Short calibration (one dot per cell): enough once a pooled baseline exists to warm-start from. */
export const quickTargets = (layout = DEFAULT_LAYOUT) => allCells(layout).map(cell => cellCenter(cell, layout));

/** Quick top-up: two dots inside each weak cell instead of redoing everything. */
export function topUpTargets(cells, layout = DEFAULT_LAYOUT) {
  const half = Math.min(layout.bandSplit, 1 - layout.bandSplit) / 2;
  return cells.flatMap(cell => {
    const c = cellCenter(cell, layout), dy = (cell.band === 'top' ? -1 : 1) * half * 0.5;
    return [c, { x: c.x, y: c.y + dy }];
  });
}

export const sameCell = (a, b) => !!a && !!b && a.lane === b.lane && a.band === b.band;
export { allCells };
