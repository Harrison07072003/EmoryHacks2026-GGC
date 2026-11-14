// Software fixes for bad light, all pure functions on plain arrays:
// tone curve (brightness / contrast / gamma), histogram equalization, exposure metering,
// auto-adjust, and the virtual crop / pan (region of interest) that re-centres the face.
import { clamp } from '../util/math.js';

export const DEFAULT_CAMERA_SETTINGS = {
  auto: true,        // meter the face and pick brightness / contrast / gamma automatically
  brightness: 0,     // -1 .. 1, added after contrast
  contrast: 1,       // 0.5 .. 3, around mid grey
  gamma: 1,          // 0.4 .. 3, above 1 lifts shadows
  equalize: 0,       // 0 .. 1, strength of histogram equalization
  autoCenter: true,  // follow the face with the virtual crop
  zoom: 1,           // 1 .. 4, manual crop (used when autoCenter is off)
  panX: 0, panY: 0,  // -1 .. 1, manual crop position
};

const IDENTITY = Uint8ClampedArray.from({ length: 256 }, (_, i) => i);

/** 256-entry lookup table for brightness / contrast / gamma. */
export function toneLut({ brightness = 0, contrast = 1, gamma = 1 } = {}) {
  return Uint8ClampedArray.from({ length: 256 }, (_, i) => {
    const v = (i / 255) ** (1 / gamma);
    return Math.round(((v - 0.5) * contrast + 0.5 + brightness) * 255);
  });
}

/** Luma histogram of RGBA pixels. `step` skips pixels for speed. */
export function lumaHistogram(rgba, step = 1) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < rgba.length; i += 4 * step) hist[Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])]++;
  return hist;
}

/** The histogram an image would have after a LUT is applied to it. */
export function remapHistogram(hist, lut) {
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) out[lut[i]] += hist[i];
  return out;
}

/** Histogram-equalization LUT, blended with identity by `strength` (0 = off, 1 = full). */
export function equalizeLut(hist, strength = 1) {
  let total = 0, run = 0;
  for (const n of hist) total += n;
  if (!total) return IDENTITY.slice();
  return Uint8ClampedArray.from({ length: 256 }, (_, i) => {
    run += hist[i];
    return Math.round(i + strength * ((run / total) * 255 - i));
  });
}

/** One LUT that does `first` and then `second`. */
export const composeLuts = (first, second) => Uint8ClampedArray.from(first, v => second[v]);
export const isIdentity = lut => lut.every((v, i) => v === i);

/** Apply a LUT to the colour channels of RGBA pixels, in place. */
export function applyLut(rgba, lut) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = lut[rgba[i]]; rgba[i + 1] = lut[rgba[i + 1]]; rgba[i + 2] = lut[rgba[i + 2]];
  }
  return rgba;
}

/** @returns { mean, p5, p95 } in 0-255, plus the fractions of crushed and blown-out pixels */
export function estimateExposure(hist) {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  if (!total) return { mean: 0, p5: 0, p95: 0, dark: 1, clipped: 0 };
  const pct = p => { let run = 0; for (let i = 0; i < 256; i++) { run += hist[i]; if (run >= total * p) return i; } return 255; };
  const frac = (a, b) => { let n = 0; for (let i = a; i <= b; i++) n += hist[i]; return n / total; };
  return { mean: sum / total, p5: pct(0.05), p95: pct(0.95), dark: frac(0, 25), clipped: frac(246, 255) };
}

const TARGET_MEAN = 115;

/**
 * Pick tone settings that bring a badly lit face back to mid grey with usable contrast.
 * Gamma fixes the overall level first; contrast is then judged on the result and paired
 * with a brightness shift so the stretch pivots on the image's own mean, not on mid grey.
 * Leaves well-exposed images untouched. `previous` eases the change so it never flickers.
 */
export function autoTone(hist, previous = null) {
  const before = estimateExposure(hist);
  let gamma = 1, contrast = 1, brightness = 0;
  if (before.mean < 90 || before.mean > 150) {
    gamma = clamp(Math.log(clamp(before.mean, 8, 247) / 255) / Math.log(TARGET_MEAN / 255), 0.5, 2.5);
  }
  const after = estimateExposure(remapHistogram(hist, toneLut({ gamma })));
  const span = (after.p95 - after.p5) / 255;
  if (span < 0.45) {
    contrast = clamp(0.6 / Math.max(span, 0.05), 1, 1.8);
    brightness = clamp(TARGET_MEAN / 255 - ((after.mean / 255 - 0.5) * contrast + 0.5), -0.5, 0.5);
  }
  const next = { brightness, contrast, gamma };
  if (!previous) return next;
  const ease = key => previous[key] + 0.25 * (next[key] - previous[key]);
  return { brightness: ease('brightness'), contrast: ease('contrast'), gamma: ease('gamma') };
}

/** Manual crop -> region of interest { x, y, w, h } in 0-1 of the camera frame. */
export function manualRoi({ zoom = 1, panX = 0, panY = 0 } = {}) {
  const size = 1 / clamp(zoom, 1, 4), travel = (1 - size) / 2;
  return { x: 0.5 - size / 2 + clamp(panX, -1, 1) * travel, y: 0.5 - size / 2 + clamp(panY, -1, 1) * travel, w: size, h: size };
}

/**
 * Virtual pan/zoom that keeps the face centred and large without moving the camera.
 * It only starts moving when the face has drifted well off (so the image is normally
 * perfectly still), then glides until the face is centred again.
 */
export class RoiFollower {
  constructor({ faceShare = 0.45, deadzone = 0.15, speed = 0.2 } = {}) {
    Object.assign(this, { faceShare, deadzone, speed });
    this.roi = { x: 0, y: 0, w: 1, h: 1 };
    this.moving = false;
  }
  reset() { this.roi = { x: 0, y: 0, w: 1, h: 1 }; this.moving = false; }
  /** @param face  face box { x, y, w, h } in 0-1 of the full camera frame */
  update(face) {
    const r = this.roi;
    const size = clamp(Math.max(face.w, face.h * 0.75) / this.faceShare, 0.25, 1);
    const want = { x: clamp(face.x + face.w / 2 - size / 2, 0, 1 - size), y: clamp(face.y + face.h / 2 - size / 2, 0, 1 - size), w: size, h: size };
    const off = Math.max(Math.abs(want.x - r.x), Math.abs(want.y - r.y), Math.abs(want.w - r.w)) / r.w;
    if (off > this.deadzone) this.moving = true;
    if (off < 0.02) this.moving = false;
    if (this.moving) for (const k of ['x', 'y', 'w', 'h']) r[k] += this.speed * (want[k] - r[k]);
    return r;
  }
}
