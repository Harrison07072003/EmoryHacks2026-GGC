// Per-song gaze accuracy summary, saved with every result. Small, numbers only, always on:
// it tells us how well tracking worked in real play without storing any per-frame data.
//   on_target_pct   share of frames with a target where the gaze was inside the target zone
//   mean_err_x/y    mean |gaze - target| (0-1 of the screen) on frames with a visible face
//   face_lost_pct   share of frames with a target where no face (or no gaze) was available
//   cell_pct        share of frames where the tracker's reported lane AND band were the target's,
//                   from 0.4 s after a target appeared (eyes need that long to get there). The same
//                   measure as "on target" in the eye-controller's test run, so the numbers compare.
import { inStraightZone, nearCurve } from './zones.js';
import { round } from '../util/math.js';
import { LAYOUT } from '../config/game-config.js';

const SETTLE_SEC = 0.4;

export function createTrackingStats(mode) {
  let frames = 0, valid = 0, on = 0, ex = 0, ey = 0, cellFrames = 0, cellOn = 0;
  const firstSeen = new Map();
  const curveZone = { tolerance: mode.curve.tolerance, bandTolerance: mode.bandTolerance };
  return {
    /**
     * target: { note, point } or null, gaze: { x, y, valid },
     * cell: the tracker's reported { lane, band } (null when the mouse drives), t: song time (s)
     */
    add(target, gaze, cell = null, t = null) {
      if (!target) return;
      frames++;
      if (cell && t !== null) {
        if (!firstSeen.has(target.note.id)) firstSeen.set(target.note.id, t);
        if (t - firstSeen.get(target.note.id) >= SETTLE_SEC) {
          const straight = target.note.type === 'straight';
          const lane = straight ? target.note.lane : Math.min(LAYOUT.lanes - 1, Math.max(0, Math.floor(target.point.x * LAYOUT.lanes)));
          cellFrames++;
          if (cell.lane === lane && cell.band === (straight ? 'top' : 'bottom')) cellOn++;
        }
      }
      if (!gaze.valid) return;
      valid++;
      ex += Math.abs(gaze.x - target.point.x); ey += Math.abs(gaze.y - target.point.y);
      const hit = target.note.type === 'straight' ? inStraightZone(gaze, target.note.lane, mode) : nearCurve(gaze, target.point.x, curveZone);
      if (hit) on++;
    },
    summary: () => ({
      frames,
      on_target_pct: frames ? round((on / frames) * 100, 1) : null,
      mean_err_x: valid ? round(ex / valid, 3) : null,
      mean_err_y: valid ? round(ey / valid, 3) : null,
      face_lost_pct: frames ? round(((frames - valid) / frames) * 100, 1) : null,
      cell_pct: cellFrames ? round((cellOn / cellFrames) * 100, 1) : null,
    }),
  };
}
