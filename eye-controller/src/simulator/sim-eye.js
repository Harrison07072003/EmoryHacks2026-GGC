// A fake eye: maps a true gaze point to the feature frame the real capture stage would
// produce for a made-up person. Deterministic for a given seed.
import { assembleFeatures } from '../cv/features.js';
import { rng } from '../util/math.js';

export const NOISE = {
  ideal: { jitter: 0, drift: 0, blinks: false },
  realistic: { jitter: 0.004, drift: 0.015, blinks: true },
};

export function createSimEye({ seed = 1, noise = 'realistic' } = {}) {
  const rand = rng(seed), level = typeof noise === 'string' ? NOISE[noise] : noise;
  const vary = (base, spread) => base * (1 + spread * (rand() * 2 - 1));
  // every simulated person has their own eye geometry
  const eye = () => ({ u0: vary(0.5, 0.06), v0: vary(0.02, 0.5), gx: vary(0.22, 0.15), gy: vary(0.12, 0.15), qx: vary(0.03, 0.5), xy: vary(0.02, 0.5) });
  const person = { R: eye(), L: eye(), yaw0: (rand() - 0.5) * 0.1, pitch0: (rand() - 0.5) * 0.1 };

  /**
   * @param t     time in ms
   * @param gaze  true gaze { x, y } in 0-1
   * @param cond  { faceLost, light: 'good' | 'bad', glare }
   */
  return function frame(t, gaze, cond = {}) {
    if (cond.faceLost) return { t, face: false };
    const bad = cond.light === 'bad';
    const sigma = level.jitter * (bad ? 3.5 : 1) * (cond.glare ? 2 : 1) + (bad ? 0.006 : 0);
    const n = () => rand.gauss() * sigma;
    const yaw = person.yaw0 + level.drift * Math.sin(t / 3100), pitch = person.pitch0 + level.drift * 0.6 * Math.sin(t / 4700);
    const cx = 0.5 + level.drift * 0.5 * Math.sin(t / 5300), cy = 0.5, fw = 0.3;
    const x = gaze.x - 0.5, y = gaze.y - 0.5;
    const one = e => {
      // turning the head toward a point means the eye turns less: the model must learn that
      const u = e.u0 + e.gx * x + e.qx * x * x - 0.25 * (yaw - person.yaw0) - 0.3 * (cx - 0.5);
      const v = e.v0 + e.gy * y + e.xy * x * y - 0.2 * (pitch - person.pitch0);
      return { u: u + n(), v: v + n(), pu: u + n(), pv: v + n() };
    };
    const info = { open: 0.3, glare: cond.glare ? 0.07 : 0.004, conf: bad ? 0.12 : 0.5, lum: bad ? 38 : 125 };
    return {
      t, face: true,
      f: assembleFeatures(one(person.R), one(person.L), [yaw, pitch, cx, cy, fw]),
      blink: level.blinks && t % 4200 < 140,
      eyes: { R: { ...info }, L: { ...info } },
      head: [yaw, pitch, cx, cy, fw],
      box: { x: cx - fw / 2, y: 0.25, w: fw, h: 0.5 },
    };
  };
}
