// Per-song gaze accuracy summary, saved with every result. Small, numbers only, always on:
// it tells us how well tracking worked in real play without storing any per-frame data.
//   on_target_pct   share of frames with a target where the gaze was inside the target zone
//   mean_err_x/y    mean |gaze - target| (0-1 of the screen) on frames with a visible face
//   face_lost_pct   share of frames with a target where no face (or no gaze) was available
import { inStraightZone, nearCurve } from './zones.js';
import { round } from '../util/math.js';

export function createTrackingStats(mode) {
  let frames = 0, valid = 0, on = 0, ex = 0, ey = 0;
  const curveZone = { tolerance: mode.curve.tolerance, bandTolerance: mode.bandTolerance };
  return {
    /** target: { note, point } or null, gaze: { x, y, valid } */
    add(target, gaze) {
      if (!target) return;
      frames++;
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
    }),
  };
}
