// Setup tester maths (pure, no DOM): how well the player's seat, camera and screen suit eye
// tracking. Thresholds come from 35 recorded clips (2026-11-15):
//  - The best predictor of accuracy is how far the eyes VISIBLY move across the screen
//    ("eye range"): it grows when you sit closer and roughly halves behind glasses.
//    Left-right range (eye-width units per 3/4 of the screen): ~0.18 without glasses and
//    ~0.09-0.13 with them played well; 0.05-0.07 (far away, head moving, low laptop) played badly.
//  - Face width in the camera: 0.24-0.28 played best, 0.13-0.14 ("far") failed, 0.42 still worked.
//  - Face low in the frame (y 0.83, camera looking down at the player) played worse.
import { clamp, mean, ramp, std } from '../util/math.js';

/** Horizontal / vertical eye signals from a feature vector (both eyes, iris + pupil). */
export const horizontalSignal = f => (f[0] + f[2] + f[4] + f[6]) / 4;
export const verticalSignal = f => (f[3] + f[7]) / 2;

export const SETUP = {
  faceWidth: { bad: 0.17, good: 0.24, high: 0.42 },     // share of the camera frame
  faceY: { min: 0.35, max: 0.70 },                      // face centre, 0 = top of the camera image
  faceX: 0.15,                                          // allowed offset from the centre
  pitch: 0.15, yaw: 0.25,                               // head tilt / turn (radians)
  light: { bad: 45, good: 60 },                         // eye brightness 0-255
  eyePx: { bad: 35, good: 50 },                         // eye width in camera pixels
  hRange: { bad: 0.06, good: 0.15 },                    // left-right eye range per 3/4 of the screen
  vRange: { bad: 0.004, good: 0.022 },                  // top-bottom eye range per 1/2 of the screen
};

// MediaPipe eye-corner landmarks (right eye 33-133, left eye 362-263)
const EYE_CORNERS = [[33, 133], [362, 263]];

/**
 * Live measurements from one frame.
 * @param frame      an eye-controller frame (eyes.faceData().frame)
 * @param landmarks  478 face landmarks (0-1 of the camera frame), or null (mock)
 * @param video      { width, height } of the camera image, or null
 */
export function measureSetup(frame, landmarks = null, video = null) {
  if (!frame?.face) return null;
  const b = frame.box, eyePx = landmarks && video
    ? mean(EYE_CORNERS.map(([a, c]) => Math.hypot((landmarks[a].x - landmarks[c].x) * video.width, (landmarks[a].y - landmarks[c].y) * video.height)))
    : null;
  return {
    faceWidth: b.w, faceX: b.x + b.w / 2, faceY: b.y + b.h / 2,
    yaw: frame.head[0], pitch: frame.head[1],
    light: (frame.eyes.R.lum + frame.eyes.L.lum) / 2,
    eyePx, resolution: video ? `${video.width}x${video.height}` : null,
  };
}

/** One row per thing to fix: { id, label, value, status: 'good' | 'ok' | 'bad', advice } */
export function setupChecks(g, S = SETUP) {
  if (!g) return [{ id: 'face', label: 'Face', value: 'not found', status: 'bad', advice: 'Sit in front of the camera.' }];
  const rows = [];
  const add = (id, label, value, status, advice = '') => rows.push({ id, label, value, status, advice });
  const w = g.faceWidth;
  add('distance', 'Distance', `face ${Math.round(w * 100)}% of the image`,
    w < S.faceWidth.bad ? 'bad' : w < S.faceWidth.good ? 'ok' : w > S.faceWidth.high ? 'ok' : 'good',
    w < S.faceWidth.good ? 'Sit closer: your face should fill about a quarter of the camera width (closer still with glasses).'
      : w > S.faceWidth.high ? 'A little too close: small head moves will leave the camera view.' : '');
  const lowFace = g.faceY > S.faceY.max, highFace = g.faceY < S.faceY.min;
  add('camera', 'Camera height', `face at ${Math.round(g.faceY * 100)}% down the image`, lowFace || highFace ? 'bad' : 'good',
    lowFace ? 'The camera looks down on you: tilt the screen forward (top towards you) or sit up / raise your seat.'
      : highFace ? 'The camera looks up at you: tilt the screen back or raise the laptop.' : '');
  add('centre', 'Centred', `${Math.round((g.faceX - 0.5) * 100)}% off centre`, Math.abs(g.faceX - 0.5) > S.faceX ? 'bad' : 'good',
    Math.abs(g.faceX - 0.5) > S.faceX ? 'Move so your face is in the middle of the camera image.' : '');
  const tilted = Math.abs(g.pitch) > S.pitch, turned = Math.abs(g.yaw) > S.yaw;
  add('head', 'Head angle', `tilt ${g.pitch.toFixed(2)}, turn ${g.yaw.toFixed(2)}`, tilted || turned ? 'ok' : 'good',
    g.pitch > S.pitch ? 'You look up at the screen: raise the screen or sit lower so it is at eye level.'
      : g.pitch < -S.pitch ? 'You look down a lot: raise the screen towards eye level.'
        : turned ? 'Face the screen straight on.' : '');
  add('light', 'Light on face', `${Math.round(g.light)} / 255`, g.light < S.light.bad ? 'bad' : g.light < S.light.good ? 'ok' : 'good',
    g.light < S.light.good ? 'Add light in front of you (not behind).' : '');
  if (g.eyePx !== null) add('eyesize', 'Eye size in the image', `${Math.round(g.eyePx)} px wide`,
    g.eyePx < S.eyePx.bad ? 'bad' : g.eyePx < S.eyePx.good ? 'ok' : 'good',
    g.eyePx < S.eyePx.good ? 'Your eyes are small in the image: sit closer.' : '');
  return rows;
}

/**
 * Range test result from the holds: [{ target: {x, y}, samples: [features] }] for the left,
 * right, top and bottom edge dots. Ranges are scaled to the spans used in the recorded clips
 * (3/4 of the screen across, 1/2 down) so the thresholds above apply.
 */
export function rangeFromHolds(holds) {
  const at = pick => holds.find(h => pick(h.target) && h.samples.length >= 5);
  const left = at(t => t.x < 0.3), right = at(t => t.x > 0.7), top = at(t => t.y < 0.3), bottom = at(t => t.y > 0.7);
  const sig = (h, fn) => mean(h.samples.map(fn));
  const h = left && right ? (Math.abs(sig(right, horizontalSignal) - sig(left, horizontalSignal)) * 0.75) / Math.abs(right.target.x - left.target.x) : null;
  const v = top && bottom ? (Math.abs(sig(bottom, verticalSignal) - sig(top, verticalSignal)) * 0.5) / Math.abs(bottom.target.y - top.target.y) : null;
  const jitter = mean(holds.filter(x => x.samples.length >= 5).map(x => std(x.samples.map(horizontalSignal))));
  return { h, v, jitter, holds: holds.map(x => ({ target: x.target, n: x.samples.length })) };
}

/** 0-100: mostly the eye range (what predicts accuracy), plus the setup checks. */
export function setupScore(checks, range, S = SETUP) {
  const rangePart = range?.h == null ? null : 0.65 * ramp(range.h, S.hRange.bad, S.hRange.good) + 0.35 * ramp(range.v ?? 0, S.vRange.bad, S.vRange.good);
  const penalty = checks.reduce((p, c) => p + (c.status === 'bad' ? 0.15 : c.status === 'ok' ? 0.05 : 0), 0);
  const base = rangePart ?? 0.6;   // no range test yet: judge the setup checks alone
  return Math.round(100 * clamp(base - penalty, 0, 1));
}

/** Plain advice from the range test. */
export function rangeAdvice(range, S = SETUP) {
  if (!range || range.h == null) return [];
  const out = [];
  const pct = Math.round((100 * range.h) / S.hRange.good);
  if (range.h < S.hRange.good) out.push(`Your eyes move ${pct}% as far as a good setup's when you look across the screen. Sit closer${range.h < 0.1 ? ' (with glasses on, closer still)' : ''}.`);
  if (range.v != null && range.v < S.vRange.good) out.push('Up-down eye movement is small: sit closer, and keep the camera near eye level so it sees your eyes from the front.');
  if (range.jitter > 0.012) out.push('Your gaze was unsteady during the holds: rest your head (or elbows) and look at the dot centre.');
  return out;
}
