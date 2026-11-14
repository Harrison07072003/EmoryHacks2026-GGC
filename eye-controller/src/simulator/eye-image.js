// Draws a synthetic eye crop (RGBA) with a known pupil centre, for testing the pupil finder.
import { rng } from '../util/math.js';

/**
 * @param pupil  true pupil centre in pixels { x, y }
 * @param opts   glint { dx, dy, r } offset from the pupil centre, gain (scene brightness), noise
 */
export function drawEye({ width = 64, height = 32, pupil, glint = null, gain = 1, noise = 3, seed = 1 } = {}) {
  const rand = rng(seed), data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + 0.5, py = y + 0.5, d = Math.hypot(px - pupil.x, py - pupil.y);
    const inEye = ((px - width / 2) / (width * 0.36)) ** 2 + ((py - height / 2) / (height * 0.3)) ** 2 < 1;
    let v = 165;                       // skin
    if (inEye) v = 215;                // sclera
    if (inEye && d < 9) v = 75;        // iris
    if (inEye && d < 3.5) v = 22;      // pupil
    v = v * gain + rand.gauss() * noise;
    if (glint && Math.hypot(px - pupil.x - glint.dx, py - pupil.y - glint.dy) < glint.r) v = 255;
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { data, width, height };
}
