// Score the test-run part of a recording: lane jumps, smooth pursuit and band switches.
//
// Two views of the same clip:
//   replay - the frames are pushed through the CURRENT engine code, calibrated on the
//            clip's own calibration. Change smoothing / scoring / model code, re-run, compare.
//   live   - what the tracker actually reported while recording (the code of that day).
import { Engine } from '../core/engine.js';
import { fitCalibration } from '../calibration/fit.js';
import { cellOf, DEFAULT_LAYOUT, laneOf, bandOf } from '../signals/lanes.js';
import { labelledPoints, playLikePoints } from './evaluate.js';
import { isHit, PHASES } from '../testrun/script.js';
import { mean, median } from '../util/math.js';

const SETTLE_MS = 400;          // time allowed to move before "on target" is counted
const MAX_LAG_MS = 500;

/** Calibration for replay: the clip's own dots, or the one stored when recording started. */
export function clipCalibration(recording, layout = DEFAULT_LAYOUT) {
  const points = labelledPoints(recording);
  const source = points.length >= 6 ? [...points, ...playLikePoints(recording)] : recording.meta?.calibrationPoints ?? [];
  return source.length ? fitCalibration(source, { layout }) : null;
}

/**
 * Push every frame through a fresh engine; returns what it reported per game frame.
 * learn: confirm hits like the live test run does, so the replay includes play learning.
 */
export function replayFrames(recording, calibration, layout = DEFAULT_LAYOUT, { learn = true } = {}) {
  const engine = new Engine({ layout, minScore: 0 }), out = [], first = new Map();
  engine.setCalibration(calibration);
  for (const fr of recording.frames) {
    engine.handleFrame(fr);
    if (fr.src !== 'game') continue;
    if (!first.has(fr.tid)) first.set(fr.tid, fr.t);
    const s = engine.state;
    out.push({ ...fr, out: { x: s.gaze.x, y: s.gaze.y, lane: s.lane, band: s.band } });
    if (learn && isHit(fr.tid.split(':')[0], fr.t - first.get(fr.tid), s, fr.target, layout)) engine.confirmOnTarget(fr.target);
  }
  return out;
}

/** Notes: did the reported cell reach the target cell, how fast, and did it stay there. */
function scoreNotes(frames, layout) {
  const notes = new Map();
  for (const fr of frames) (notes.get(fr.tid) ?? notes.set(fr.tid, []).get(fr.tid)).push(fr);
  const per = [...notes.values()].map(fs => {
    const t0 = fs[0].t, cell = cellOf(fs[0].target, layout);
    const on = f => f.out && f.out.lane === cell.lane && f.out.band === cell.band;
    const first = fs.find(on), settled = fs.filter(f => f.t - t0 >= SETTLE_MS);
    return { hit: !!first, reactionMs: first ? first.t - t0 : null, onTarget: settled.length ? settled.filter(on).length / settled.length : 0 };
  });
  if (!per.length) return null;
  const reactions = per.filter(p => p.hit).map(p => p.reactionMs);
  return { notes: per.length, hitRate: per.filter(p => p.hit).length / per.length, reactionMs: reactions.length ? median(reactions) : null, onTarget: mean(per.map(p => p.onTarget)) };
}

/** Pursuit: distance to the moving dot, the tracker's lag behind it, and lane/band agreement. */
function scorePath(frames, layout) {
  const t0 = frames[0]?.t;
  const fs = frames.filter(f => f.t - t0 >= PHASES.path.leadMs && f.out && f.out.x !== null && !f.blink);
  if (fs.length < 10) return null;
  const targetAt = t => { // target position at time t, interpolated from the recorded targets
    let i = frames.findIndex(f => f.t >= t);
    if (i <= 0) return frames[Math.max(i, 0)].target;
    const a = frames[i - 1], b = frames[i], k = (t - a.t) / (b.t - a.t || 1);
    return { x: a.target.x + k * (b.target.x - a.target.x), y: a.target.y + k * (b.target.y - a.target.y) };
  };
  const errorAt = lag => mean(fs.map(f => { const tg = targetAt(f.t - lag); return Math.hypot(f.out.x - tg.x, f.out.y - tg.y); }));
  let lagMs = 0, best = Infinity;
  for (let lag = 0; lag <= MAX_LAG_MS; lag += 33) { const e = errorAt(lag); if (e < best) { best = e; lagMs = lag; } }
  // lane / band agreement is judged against where the dot was `lagMs` ago, so the eyes' own
  // reaction time is not counted as tracker error
  const lagged = fs.map(f => ({ f, tg: targetAt(f.t - lagMs) }));
  return {
    errorX: mean(fs.map(f => Math.abs(f.out.x - f.target.x))),
    errorY: mean(fs.map(f => Math.abs(f.out.y - f.target.y))),
    lagMs, errorAtLag: best,
    inBand: mean(fs.map(f => +(f.out.band === 'bottom'))),   // the path is always in the bottom band
    lane: mean(lagged.map(({ f, tg }) => +(f.out.lane === laneOf(tg.x, layout.lanes)))),
    band: mean(lagged.map(({ f, tg }) => +(f.out.band === bandOf(tg.y, layout.bandSplit)))),
  };
}

function scoreGameFrames(frames, layout) {
  const phase = p => frames.filter(f => f.tid?.split(':')[0] === p);
  return { jumps: scoreNotes(phase('jumps'), layout), path: scorePath(phase('path'), layout), switch: scoreNotes(phase('switch'), layout) };
}

/**
 * @returns null when the clip has no test run, else
 *          { replay: { jumps, path, switch }, live: {...} | null, calibrationScore }
 *          jumps / switch: { notes, hitRate, reactionMs, onTarget }
 *          path: { errorX, errorY (raw, lag included), lagMs (best-fitting delay),
 *                  errorAtLag (distance once that delay is removed), lane, band, inBand }
 */
export function evaluatePlay(recording, { layout = DEFAULT_LAYOUT, learn = true } = {}) {
  const game = recording.frames.filter(f => f.src === 'game');
  if (!game.length) return null;
  const calibration = clipCalibration(recording, layout);
  const replay = calibration?.model ? scoreGameFrames(replayFrames(recording, calibration, layout, { learn }), layout) : null;
  const live = game.some(f => f.out) ? scoreGameFrames(game, layout) : null;
  return { replay, live, calibrationScore: calibration?.score ?? null };
}
