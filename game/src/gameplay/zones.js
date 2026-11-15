// Target zones: where on screen the gaze has to be. Straight notes use one column of the
// top band; curves use a point on the lower line in the bottom band. Pure geometry.
import { LAYOUT } from '../config/game-config.js';

export const laneCenter = (lane, lanes = LAYOUT.lanes) => (lane + 0.5) / lanes;

/** Is the gaze inside column `lane` of the top band (with the mode's tolerances)? */
export function inStraightZone(gaze, lane, { zoneTolerance = 0, bandTolerance = 0 } = {}, layout = LAYOUT) {
  if (!gaze?.valid) return false;
  const half = 0.5 / layout.lanes + zoneTolerance;
  return Math.abs(gaze.x - laneCenter(lane, layout.lanes)) <= half && gaze.y <= layout.bandSplit + bandTolerance;
}

/** Is the gaze in the bottom band, close enough horizontally to `x`? */
export function nearCurve(gaze, x, { tolerance, bandTolerance = 0 }, layout = LAYOUT) {
  if (!gaze?.valid) return false;
  return gaze.y >= layout.bandSplit - bandTolerance && Math.abs(gaze.x - x) <= tolerance;
}

/** Where the player should be looking for a note at time t (for telemetry labels). */
export function targetPoint(note, t, pathXFn, layout = LAYOUT) {
  return note.type === 'straight'
    ? { x: laneCenter(note.lane, layout.lanes), y: layout.upperLineY }
    : { x: pathXFn(note.path, t), y: layout.lowerLineY };
}
