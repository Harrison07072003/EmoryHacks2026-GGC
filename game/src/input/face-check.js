// Face position checks for the pre-calibration face check (ported from the prototype's
// "Face check" in app/core/shell.js, rebuilt on the eye-controller's frame data). Pure.
//
// frame: one eye-controller feature frame (eyes.onSample -> sample.frame):
//   face, box { x, y, w, h } (0-1 of the camera frame), eyes.R/L { glare, lum }, exposure { mean }
import { FACE_CHECK } from '../config/game-config.js';

/** @returns [{ id, label, pass, hint, warnOnly }] */
export function faceChecks(frame, cfg = FACE_CHECK) {
  const face = !!frame?.face && !!frame.box;
  const b = frame?.box ?? { x: 0, y: 0, w: 0, h: 0 };
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const light = frame?.exposure?.mean ?? (face && frame.eyes ? (frame.eyes.R.lum + frame.eyes.L.lum) / 2 : 0);
  const glare = face && frame.eyes ? Math.max(frame.eyes.R.glare, frame.eyes.L.glare) : 0;
  // the camera view is mirrored on screen, so "move left" means the player's own left
  const sideHint = cx < 0.5 ? 'move a little to your left' : 'move a little to your right';
  const vertHint = cy < 0.5 ? 'lower your head or tilt the camera up' : 'raise your head or tilt the camera down';
  const centeredX = Math.abs(cx - 0.5) < cfg.maxOffsetX, centeredY = Math.abs(cy - 0.5) < cfg.maxOffsetY;
  return [
    { id: 'face', label: 'Face found', pass: face, hint: 'sit in front of the camera' },
    { id: 'center', label: 'Centered in the oval', pass: face && centeredX && centeredY, hint: !centeredX ? sideHint : vertHint },
    { id: 'distance', label: 'Distance', pass: face && b.w > cfg.minWidth && b.w < cfg.maxWidth, hint: b.w <= cfg.minWidth ? 'move closer' : 'move back' },
    { id: 'light', label: 'Lighting', pass: face && light >= cfg.minLight, hint: 'add light in front of you (not behind)' },
    { id: 'glare', label: 'Glasses glare', pass: face && glare < cfg.maxGlare, hint: 'tilt your glasses or move the light', warnOnly: true },
  ];
}

/** True when every required (non-warning) check passes. */
export const facePositionOk = checks => checks.every(c => c.pass || c.warnOnly);
