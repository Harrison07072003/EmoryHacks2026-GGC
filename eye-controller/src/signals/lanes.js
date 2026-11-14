// Gaze position -> lane and band, with hysteresis so borders do not chatter.
import { clamp } from '../util/math.js';

export const DEFAULT_LAYOUT = { lanes: 4, bandSplit: 0.5 };

/** `margin` is the fraction of a lane you must cross into the neighbour before switching. */
export function laneOf(x, lanes, current = null, margin = 0.12) {
  const cell = 1 / lanes, i = clamp(Math.floor(x / cell), 0, lanes - 1);
  if (current === null || i === current) return i;
  const m = cell * margin;
  return x > current * cell - m && x < (current + 1) * cell + m ? current : i;
}

export function bandOf(y, split = 0.5, current = null, margin = 0.04) {
  if (current === 'top' && y < split + margin) return 'top';
  if (current === 'bottom' && y > split - margin) return 'bottom';
  return y < split ? 'top' : 'bottom';
}

export function createLaneMapper(layout = DEFAULT_LAYOUT) {
  let lane = null, band = null;
  return {
    update({ x, y }) {
      lane = laneOf(x, layout.lanes, lane);
      band = bandOf(y, layout.bandSplit, band);
      return { lane, band };
    },
    reset() { lane = null; band = null; },
  };
}

/** Which cell a point belongs to, or null when it sits on the band border. */
export function cellOf({ x, y }, layout = DEFAULT_LAYOUT, borderMargin = 0.08) {
  if (Math.abs(y - layout.bandSplit) < borderMargin) return null;
  return { lane: laneOf(x, layout.lanes), band: bandOf(y, layout.bandSplit) };
}

export function cellCenter({ lane, band }, layout = DEFAULT_LAYOUT) {
  const s = layout.bandSplit;
  return { x: (lane + 0.5) / layout.lanes, y: band === 'top' ? s / 2 : s + (1 - s) / 2 };
}

export function allCells(layout = DEFAULT_LAYOUT) {
  return ['top', 'bottom'].flatMap(band => Array.from({ length: layout.lanes }, (_, lane) => ({ lane, band })));
}
