// The feature vector the gaze model is trained on, and the pure geometry that produces it.
// Layout (19 numbers):
//   0-3   right eye  [iris u, iris v, pupil u, pupil v]
//   4-7   left eye   [iris u, iris v, pupil u, pupil v]
//   8-12  head       [yaw, pitch, face centre x, face centre y, face width]
//   13-15 right eye curvature [pu^2, pv^2, pu*pv]
//   16-18 left eye curvature
// u runs along the eye-corner line (0 = one corner, 1 = the other), v is perpendicular,
// both in eye-width units, so they do not change with distance or with the virtual crop.

/** Bump when the layout changes: stored profiles and baselines with another version are ignored. */
export const FEATURE_VERSION = 2;
export const FEATURE_COUNT = 19;

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
export const IDX = {
  both: range(0, 19),
  R: [...range(0, 4), ...range(8, 13), ...range(13, 16)],
  L: [...range(4, 8), ...range(8, 13), ...range(16, 19)],
};
export const HEAD_IDX = range(8, 13);
/** Iris features used to judge how steady the eyes were. */
export const STEADY_IDX = [0, 1, 4, 5];

export const SD_FLOOR = [...Array(8).fill(0.005), 0.03, 0.03, 0.02, 0.02, 0.02, ...Array(6).fill(0.0005)];
/**
 * Per-feature regularization. Head features: higher = trust the eyes more than head motion.
 * Curvature terms are held back so a short calibration cannot overfit them.
 */
const CURVATURE_PENALTY = 10;
export const penalties = headPenalty => range(0, 19).map(i => (i >= 13 ? CURVATURE_PENALTY : i >= 8 ? headPenalty : 1));

// MediaPipe Face Landmarker indices.
export const EYE_IDS = {
  R: { a: 33, b: 133, iris: 468, up: 159, lo: 145 },
  L: { a: 362, b: 263, iris: 473, up: 386, lo: 374 },
};
const FACE_IDS = { nose: 1, left: 234, right: 454, top: 10, chin: 152 };

/**
 * Eye crop handed to the pupil finder: CROP.w x CROP.h pixels covering `span` eye-widths.
 * 128 px is about the eye's native size in a 1080p frame. At 64 px the eye was shrunk to
 * half resolution, and looking from the top band to the bottom moved the pupil ~1 pixel.
 * Only the precision changes with the size, not the meaning of the features.
 */
export const CROP = { w: 128, h: 64, span: 1.4 };

/**
 * Geometry of one eye from landmarks (normalized to the full video frame).
 * Returns iris position (u, v), openness, the crop placement (cx, cy, ang, len in video px)
 * and where the iris falls inside that crop (cu, cv in 0-1).
 */
export function eyeGeometry(L, ids, vw, vh) {
  let A = L[ids.a], B = L[ids.b];
  if (A.x > B.x) [A, B] = [B, A]; // always image-left -> image-right
  const ax = A.x * vw, ay = A.y * vh, ex = B.x * vw - ax, ey = B.y * vh - ay;
  const len = Math.hypot(ex, ey), ang = Math.atan2(ey, ex);
  const cx = ax + ex / 2, cy = ay + ey / 2;
  const ix = L[ids.iris].x * vw, iy = L[ids.iris].y * vh;
  const lidMid = ((L[ids.up].y + L[ids.lo].y) / 2) * vh;
  const c = Math.cos(ang), s = Math.sin(ang), dx = ix - cx, dy = iy - cy;
  return {
    u: ((ix - ax) * ex + (iy - ay) * ey) / (len * len),
    v: (iy - lidMid) / len,
    open: (Math.abs(L[ids.up].y - L[ids.lo].y) * vh) / len,
    cx, cy, ang, len,
    cu: 0.5 + (dx * c + dy * s) / (len * CROP.span),
    cv: 0.5 + ((-dx * s + dy * c) * CROP.w) / (len * CROP.span * CROP.h),
  };
}

/** Crop coordinates (0-1) -> the same eye-width units as the iris features. */
export const cropToEye = (cu, cv) => ({
  pu: 0.5 + (cu - 0.5) * CROP.span,
  pv: ((cv - 0.5) * CROP.h * CROP.span) / CROP.w,
});

/**
 * Pupil feature for one eye. `k` (0-1) is how much we trust our pupil finder; the rest
 * falls back to the MediaPipe iris, expressed in the same crop frame so the blend never jumps.
 */
export function pupilFeature(geo, pupil, k) {
  return cropToEye(k * pupil.u + (1 - k) * geo.cu, k * pupil.v + (1 - k) * geo.cv);
}

/** Head pose: rotation from the MediaPipe face matrix, position/size from landmarks. */
export function headFeatures(L, matrix) {
  const { nose, left, right, top, chin } = FACE_IDS;
  const cx = (L[left].x + L[right].x) / 2, cy = (L[top].y + L[chin].y) / 2;
  const fw = Math.hypot(L[right].x - L[left].x, L[right].y - L[left].y);
  const fh = Math.hypot(L[chin].x - L[top].x, L[chin].y - L[top].y);
  let yaw = (L[nose].x - cx) / fw, pitch = (L[nose].y - cy) / fh; // fallback without a matrix
  if (matrix) {
    yaw = Math.atan2(matrix[8], matrix[10]);
    pitch = Math.atan2(matrix[9], Math.hypot(matrix[8], matrix[10]));
  }
  return [yaw, pitch, cx, cy, fw];
}

const curvature = e => { const a = e.pu - 0.5, b = e.pv; return [a * a, b * b, a * b]; };

/** R and L are { u, v, pu, pv }; head is the 5 numbers from headFeatures. */
export function assembleFeatures(R, L, head) {
  return [R.u, R.v, R.pu, R.pv, L.u, L.v, L.pu, L.pv, ...head, ...curvature(R), ...curvature(L)];
}
