// Highway geometry: song time -> screen position, in normalized 0-1 units. Pure.
//
// Above the upper line the highway is in perspective (notes come from the horizon and grow).
// From the upper line down it is flat, so each column exactly matches its gaze zone (a
// quarter of the screen) and a curve's x on the lower line is exactly where to look.
// The flat part scrolls at the same speed notes reach the upper line, so nothing jumps.
import { LAYOUT } from '../config/game-config.js';

export function createGeometry(approachSec, layout = LAYOUT) {
  const { horizonY: H, upperLineY: U, lowerLineY: L, horizonWidth } = layout;
  const k = 1 / horizonWidth - 1;                    // perspective strength: scale at the horizon = horizonWidth
  const gapSec = ((L - U) * approachSec) / ((U - H) * k);   // time from the upper line to the lower line

  /**
   * @param d  seconds until the object reaches the UPPER line (negative = already past it)
   * @param x  0-1 position across the highway at the upper line
   * @returns  { x, y, s } screen position and size scale (1 at and below the upper line)
   */
  function project(d, x = 0.5) {
    if (d >= 0) {
      const s = 1 / (1 + k * (d / approachSec));
      return { x: 0.5 + (x - 0.5) * s, y: H + (U - H) * s, s };
    }
    return { x, y: U + (-d / gapSec) * (L - U), s: 1 };
  }

  return {
    approachSec, gapSec, project,
    /** A straight note at time T, seen at song time `now`. */
    straight: (T, now, x) => project(T - now, x),
    /** A point of a curve's path at time tau: it reaches the LOWER line at tau. */
    curve: (tau, now, x) => project(tau - now - gapSec, x),
    /** How far ahead (seconds of song time) anything is visible. */
    lookAheadSec: approachSec + gapSec,
  };
}
