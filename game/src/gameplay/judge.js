// Note judging. Pure and clock-driven: call update(time, gaze) every frame with the song
// time (already corrected for gaze latency) and the current gaze; it returns the judgments
// decided this frame. No DOM, no audio, so tests can drive it frame by frame.
//
// Straight notes: the gaze must be in the note's column of the top band during its timing
// window. Holding the gaze on a column hits every note that arrives there - no blinking or
// looking away between notes. Arriving early and staying = Perfect; arriving late = Good
// (within the good window) or Miss.
//
// Curved notes: split into ~1 s segments. Each frame inside a segment counts as "on path"
// when the gaze is in the bottom band near where the path was during the last `lagSec`
// (eyes trail a moving target). Segment coverage (on-path time / segment time) sets the
// judgment: >= perfectCoverage Perfect, >= goodCoverage Good, else Miss.
import { CURVE, LAYOUT } from '../config/game-config.js';
import { curveSegments, pathX } from './chart.js';
import { inStraightZone, nearCurve } from './zones.js';

const RANK = { good: 1, perfect: 2 };

/**
 * @param chart  parsed chart
 * @param mode   a MODES entry (windows, tolerances, minDwellMs, curve)
 * @param curveConfig  CURVE (segmentSec, lagSec)
 * @param lanes  number of columns
 */
export function createJudge(chart, mode, curveConfig = CURVE, lanes = LAYOUT.lanes) {
  const { windows, minDwellMs } = mode;
  const straight = chart.notes.filter(n => n.type === 'straight').map(note => ({ note, candidate: null, done: false }));
  const curves = chart.notes.filter(n => n.type === 'curve').map(note => ({
    note, onPath: false,
    segments: curveSegments(note, curveConfig.segmentSec).map(s => ({ ...s, total: 0, on: 0, done: false })),
  }));
  const curveZone = { tolerance: mode.curve.tolerance, bandTolerance: mode.bandTolerance };
  const zoneSince = new Map();   // lane -> time the gaze entered that lane's zone
  let last = null, sIdx = 0;

  function trackZones(t, gaze) {
    for (let lane = 0; lane < lanes; lane++) {
      if (!inStraightZone(gaze, lane, mode)) zoneSince.delete(lane);
      else if (!zoneSince.has(lane)) zoneSince.set(lane, t);
    }
  }
  const laneDwelled = (lane, t) => zoneSince.has(lane) && (t - zoneSince.get(lane)) * 1000 >= minDwellMs;

  function judgeStraight(t, gaze, out) {
    while (sIdx < straight.length && straight[sIdx].done) sIdx++;
    for (let i = sIdx; i < straight.length; i++) {
      const s = straight[i];
      if (s.done) continue;
      const dt = t - s.note.t;
      if (dt < -windows.good) break;   // sorted by time: everything after is further away
      if (laneDwelled(s.note.lane, t)) {
        const now = Math.abs(dt) <= windows.perfect ? 'perfect' : dt <= windows.good ? 'good' : null;
        if (now && (!s.candidate || RANK[now] > RANK[s.candidate])) s.candidate = now;
      }
      let result = null;
      if (s.candidate === 'perfect' && dt >= 0) result = 'perfect';        // locked in early: resolve as it reaches the line
      else if (s.candidate === 'good' && dt > windows.perfect) result = 'good';  // late arrival: no Perfect possible any more
      else if (dt > windows.good) result = s.candidate ?? 'miss';
      if (result) { s.done = true; out.push({ note: s.note, judgment: result, t, offset: dt }); }
    }
  }

  function judgeCurves(t, gaze, dtFrame, out) {
    for (const c of curves) {
      const { note } = c;
      if (t < note.t - 0.5 || c.segments.every(s => s.done)) { c.onPath = false; continue; }
      const lag = curveConfig.lagSec;
      // close to the path anywhere in the last `lag` seconds?
      let on = false;
      for (let k = 0; k <= 4 && !on; k++) on = nearCurve(gaze, pathX(note.path, t - (lag * k) / 4), curveZone);
      c.onPath = on && t >= note.t;
      c.segments.forEach((seg, index) => {
        if (seg.done) return;
        if (t >= seg.start && dtFrame > 0) {
          const span = Math.min(t, seg.end) - Math.max(t - dtFrame, seg.start);
          if (span > 0) { seg.total += span; if (on) seg.on += span; }
        }
        if (t > seg.end) {
          seg.done = true;
          const coverage = seg.total > 0 ? seg.on / seg.total : 0;
          const judgment = coverage >= mode.curve.perfectCoverage ? 'perfect' : coverage >= mode.curve.goodCoverage ? 'good' : 'miss';
          out.push({ note, judgment, t, segment: index, coverage, x: pathX(note.path, seg.end) });
        }
      });
    }
  }

  return {
    /** @returns judgments decided this frame: [{ note, judgment, t, offset? , segment?, coverage? }] */
    update(t, gaze) {
      const out = [], dtFrame = last === null ? 0 : Math.min(0.1, Math.max(0, t - last));
      last = t;
      trackZones(t, gaze);
      judgeStraight(t, gaze, out);
      judgeCurves(t, gaze, dtFrame, out);
      return out;
    },
    /** Curve id -> true while the gaze is on that curve's path (for the glow). */
    curveOnPath: () => new Map(curves.map(c => [c.note.id, c.onPath])),
    isDone: () => straight.every(s => s.done) && curves.every(c => c.segments.every(s => s.done)),
    /** Lanes the gaze is currently counted in (for the zone highlight). */
    activeLanes: () => [...zoneSince.keys()],
  };
}
