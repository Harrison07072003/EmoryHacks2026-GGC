// Pupil finder (classic CV, no libraries): weighted centroid of the darkest blob in an
// eye crop, in two passes, with specular glints inside the blob filled back in.
// Thresholds are percentiles, so brightness / contrast / gamma changes do not move the result.

const EMPTY = { u: 0.5, v: 0.5, conf: 0, glare: 0, mean: 0 };

/**
 * @param img  ImageData-like { data (RGBA), width, height }: an eye-aligned crop
 * @returns { u, v } pupil centre in 0-1 crop coordinates, `conf` 0-1 (dark-vs-mean contrast),
 *          `glare` fraction of blown-out pixels, `mean` brightness 0-255
 */
export function findPupil(img, { fillGlints = true, glareLevel = 235 } = {}) {
  const { data, width: w, height: h } = img;
  const lum = new Float32Array(w * h), inMask = new Uint8Array(w * h), vals = [];
  let bright = 0, sum = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // elliptical mask = the eye opening; skips brow and cheek
    const dx = (x + 0.5 - w / 2) / (w * 0.4), dy = (y + 0.5 - h / 2) / (h * 0.3);
    if (dx * dx + dy * dy > 1) continue;
    const i = y * w + x, L = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = L; inMask[i] = 1; vals.push(L); sum += L;
    if (L > glareLevel) bright++;
  }
  if (vals.length < 20) return EMPTY;
  vals.sort((a, b) => a - b);
  const mean = sum / vals.length, pct = p => vals[Math.floor(vals.length * p)];
  const t1 = pct(0.12), t2 = pct(0.06), darkest = vals[0];

  // A glint is a blown-out pixel sitting inside the dark blob.
  const isGlint = (x, y) => {
    if (lum[y * w + x] <= glareLevel) return false;
    let dark = 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++)
      for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++)
        if (inMask[yy * w + xx] && lum[yy * w + xx] <= t1) dark++;
    return dark >= 5;
  };
  const centroid = (thr, cx0, cy0, r, fill) => {
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inMask[i] || (r && (x - cx0) ** 2 + (y - cy0) ** 2 > r * r)) continue;
      let wt = 0;
      if (lum[i] <= thr) wt = thr - lum[i] + 1; // darker = heavier
      else if (fill && isGlint(x, y)) wt = thr - darkest + 1;
      if (!wt) continue;
      sx += wt * (x + 0.5); sy += wt * (y + 0.5); sw += wt;
    }
    return sw ? [sx / sw, sy / sw] : [cx0, cy0];
  };
  const [x1, y1] = centroid(t1, w / 2, h / 2, 0, false);        // pass 1: darkest 12%, whole eye
  const [x2, y2] = centroid(t2, x1, y1, h * 0.4, fillGlints);   // pass 2: darkest 6% near pass 1
  return {
    u: x2 / w, v: y2 / h,
    conf: Math.max(0, Math.min(1, (mean - t2) / (mean + 1))),
    glare: bright / vals.length,
    mean,
  };
}
