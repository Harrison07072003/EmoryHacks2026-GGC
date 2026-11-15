// Analysis -> musical events for tools/compose/chartgen.mjs: { t, dur, midi, role, accent }.
//
// - Onsets are snapped to the beat grid (1/16 notes = quarter-beats).
// - `accent` decides which difficulty keeps a note (chartgen: practice <= 2, normal <= 3,
//   hard <= 4): bar downbeats 1, other beats 2, eighths 3, sixteenths 4; strong hits move
//   one level up, weak hits and quiet sections one level down (5 = dropped everywhere). So
//   quiet intros get fewer notes and loud choruses more.
// - `midi` is the dominant pitch of the band that hit (kick/bass low -> left columns,
//   hats high -> right), so columns follow the music instead of being random.
// - Sustained passages become `flow` events -> curves the eyes follow along the pitch contour.

const SNAP_TOLERANCE = 0.09;   // seconds: onsets farther than this from any 1/16 grid point are dropped
const CURVE_BEATS = 8, MAX_CURVE_SEC = 5;   // longest curve: 2 bars, at most 5 s
const TAP_BEATS = 4;                        // then a bar of beat taps before the next curve

/** Grid of quarter-beat positions: [{ t, beatIndex, sub }] where sub 0 = beat, 2 = eighth, 1/3 = sixteenths. */
export function beatGrid(beats) {
  const grid = [];
  for (let i = 0; i < beats.length; i++) {
    const next = beats[i + 1] ?? beats[i] + (beats[i] - (beats[i - 1] ?? beats[i] - 0.5));
    for (let sub = 0; sub < 4; sub++) grid.push({ t: beats[i] + ((next - beats[i]) * sub) / 4, beatIndex: i, sub });
  }
  return grid;
}

/** Nearest grid point to t (grid sorted by t), or null if none within tolerance. */
export function snapToGrid(grid, t, tolerance = SNAP_TOLERANCE) {
  let lo = 0, hi = grid.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (grid[mid].t < t) lo = mid; else hi = mid; }
  const best = [grid[lo], grid[hi]].filter(Boolean).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  return best && Math.abs(best.t - t) <= tolerance ? best : null;
}

/** Base accent from the grid position: bar downbeat 1, beat 2, eighth 3, sixteenth 4. */
export function gridAccent({ beatIndex, sub }, downbeatPhase = 0) {
  if (sub === 0) return (beatIndex - downbeatPhase) % 4 === 0 ? 1 : 2;
  return sub === 2 ? 3 : 4;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r3 = v => Math.round(v * 1000) / 1000;

/**
 * @param a       analyze() result
 * @param endSec  last time a note may be at (the level length minus a margin)
 */
export function buildEvents(a, { endSec = a.duration } = {}) {
  const grid = beatGrid(a.beats);
  const phase = downbeatPhase(a);
  const inSustained = t => a.sustained.some(s => t >= s.start - 0.05 && t <= s.end);

  // ---- taps: snapped onsets, one per grid point (the strongest) ----
  const byPoint = new Map();
  for (const o of a.onsets) {
    if (o.t > endSec || inSustained(o.t)) continue;
    const g = snapToGrid(grid, o.t);
    if (!g || g.t > endSec) continue;
    const key = `${g.beatIndex}:${g.sub}`;
    if (!byPoint.has(key) || byPoint.get(key).strength < o.strength) byPoint.set(key, { ...o, g });
  }
  let taps = [...byPoint.values()].map(o => {
    let accent = gridAccent(o.g, phase);
    if (o.strength > 0.6) accent--;
    if (o.strength < 0.2) accent++;
    if (o.energy < 0.3) accent++;          // quiet section
    if (o.energy > 0.75 && o.strength > 0.35) accent--;   // loud section, clear hit
    return { t: r3(o.g.t), dur: 0.1, midi: o.midi, role: 'tap', accent: clamp(accent, 1, 5), strength: o.strength };
  });

  // almost no clear hits (very soft or ambient music): fall back to the beat grid
  if (taps.filter(e => e.accent <= 2).length < 6) {
    taps = a.beats.filter(t => t <= endSec && !inSustained(t) && a.energyAt(t) > 0.1).map((t, i) => ({
      t: r3(t), dur: 0.1, midi: a.pitchAt(t), role: 'tap', accent: (i - phase) % 4 === 0 ? 1 : 2, strength: 0.5,
    }));
  }

  // ---- sustained passages: curves of at most CURVE_BEATS, then TAP_BEATS of beat taps, repeated ----
  // (one long passage must not become one 20 s ribbon)
  const flows = [];
  for (const s of a.sustained) {
    const end = Math.min(s.end, endSec), step = a.period / 2;
    let t = s.start;
    while (t < end - step) {
      const curveEnd = Math.min(end, t + Math.min(CURVE_BEATS * a.period, MAX_CURVE_SEC));
      for (; t < curveEnd; t += step) flows.push({ t: r3(t), dur: r3(Math.min(step, curveEnd - t)), midi: a.pitchAt(t), role: 'flow', accent: 1 });
      const tapsEnd = Math.min(end, t + TAP_BEATS * a.period);
      for (const b of a.beats) if (b >= t + a.period && b < tapsEnd) taps.push({ t: r3(b), dur: 0.1, midi: a.pitchAt(b), role: 'tap', accent: 2, strength: 0.4 });
      t = tapsEnd;
    }
  }

  return [...taps, ...flows].sort((x, y) => x.t - y.t).map(({ strength, ...e }) => e);
}

/** Which beat (0-3) starts the bar: the one whose onsets are strongest on average. */
function downbeatPhase(a) {
  const sums = [0, 0, 0, 0];
  a.beats.forEach((t, i) => {
    const o = a.onsets.find(x => Math.abs(x.t - t) < 0.06);
    if (o) sums[i % 4] += o.strength * (o.band === 0 ? 1.5 : 1);   // kicks mark downbeats
  });
  return sums.indexOf(Math.max(...sums));
}
