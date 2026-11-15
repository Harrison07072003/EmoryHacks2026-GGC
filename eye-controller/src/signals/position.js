// Is the player sitting well for tracking? Checks for the face check before calibration,
// with thresholds measured on real clips (2026-11-15):
//   face width: 0.21-0.23 at a normal distance tracked well; 0.13-0.14 ("far") failed
//   light: eye brightness 64-70 normal; 53-54 (backlit) was poor; 3 (dark room) failed
//   centre: a face at y 0.83 of the frame (backlit clips) tracked badly
// Same shape as the game's own faceChecks(): [{ id, label, pass, hint, warnOnly }].

export const POSITION = {
  maxOffsetX: 0.15, maxOffsetY: 0.22,   // face centre may be this far from the middle of the camera
  minWidth: 0.17, maxWidth: 0.42,       // face width as a share of the camera frame
  minLight: 45, goodLight: 60,          // eye brightness 0-255: fail below min, warn below good
  maxGlare: 0.03,                       // share of blown-out pixels on the worse eye (glasses)
  maxYaw: 0.3, maxPitch: 0.3,           // head turned / tilted (radians)
};

/** @param frame  an eye-controller frame (eyes.faceData().frame, or sample.frame) */
export function positionChecks(frame, cfg = POSITION) {
  const face = !!frame?.face && !!frame.box;
  const b = frame?.box ?? { x: 0, y: 0, w: 0, h: 0 }, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const light = face ? (frame.eyes.R.lum + frame.eyes.L.lum) / 2 : 0;
  const glare = face ? Math.max(frame.eyes.R.glare, frame.eyes.L.glare) : 0;
  const [yaw, pitch] = face ? frame.head : [0, 0];
  const okX = Math.abs(cx - 0.5) < cfg.maxOffsetX, okY = Math.abs(cy - 0.5) < cfg.maxOffsetY;
  // the camera view is mirrored on screen, so directions are the player's own
  const centreHint = !okX ? (cx < 0.5 ? 'move a little to your left' : 'move a little to your right') : cy > 0.5 ? 'raise the camera or sit up' : 'lower the camera or sit lower';
  return [
    { id: 'face', label: 'Face found', pass: face, hint: 'sit in front of the camera' },
    { id: 'center', label: 'Centred in the oval', pass: face && okX && okY, hint: centreHint },
    { id: 'distance', label: 'Distance', pass: face && b.w >= cfg.minWidth && b.w <= cfg.maxWidth, hint: b.w < cfg.minWidth ? 'move closer' : 'move back a little' },
    { id: 'light', label: 'Lighting', pass: face && light >= cfg.minLight, hint: 'add light in front of you, not behind' },
    { id: 'light-good', label: 'Bright enough for best accuracy', pass: face && light >= cfg.goodLight, hint: 'a little more light on your face helps', warnOnly: true },
    { id: 'glare', label: 'No glare on glasses', pass: face && glare < cfg.maxGlare, hint: 'tilt your glasses or move the light', warnOnly: true },
    { id: 'head', label: 'Facing the screen', pass: face && Math.abs(yaw) < cfg.maxYaw && Math.abs(pitch) < cfg.maxPitch, hint: 'face the screen straight on', warnOnly: true },
  ];
}

/** True when every required (non-warning) check passes. */
export const positionOk = checks => checks.every(c => c.pass || c.warnOnly);
