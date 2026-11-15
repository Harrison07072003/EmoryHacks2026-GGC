// The test run: a fixed ~47 s sequence that exercises what the game needs, with a known
// target at every moment. Same seed = same sequence, so clips are comparable.
//   jumps   - notes hop between lanes in the top band (fast discrete moves)
//   path    - a dot glides along the bottom band (smooth pursuit)
//   switch  - notes alternate between the bands (vertical moves)
import { cellCenter, cellOf, DEFAULT_LAYOUT } from '../signals/lanes.js';
import { rng } from '../util/math.js';

export const PHASES = {
  jumps: { title: 'Look at each note as it appears', noteMs: 900, count: 14 },
  path: { title: 'Follow the dot with your eyes', ms: 21000, leadMs: 1000 },
  switch: { title: 'Look at each note: top and bottom', noteMs: 1000, count: 12 },
};
const REST_MS = 1500;

/** Lanes that never repeat back to back, so every note is a real move. */
function laneSequence(rand, count, lanes) {
  const out = [];
  while (out.length < count) {
    const lane = Math.floor(rand() * lanes);
    if (lane !== out.at(-1)) out.push(lane);
  }
  return out;
}

/** Pursuit path in the bottom band: two slow sweeps across, with a gentle wave. */
export function pathPoint(ms, layout = DEFAULT_LAYOUT) {
  const { leadMs, ms: total } = PHASES.path, s = layout.bandSplit;
  const t = Math.max(0, ms - leadMs) / (total - leadMs);
  return { x: 0.5 - 0.38 * Math.cos(4 * Math.PI * t), y: s + (1 - s) / 2 + 0.07 * (1 - s) * 2 * Math.sin(2 * Math.PI * 3 * t) };
}

/**
 * @returns { durationMs, at(ms) } where at() gives the target at `ms` after the start:
 *          { phase, id, x, y }, or { phase: 'rest', next } between phases, or null when done.
 */
export function buildTestRun({ seed = 1, layout = DEFAULT_LAYOUT } = {}) {
  const rand = rng(seed), segments = [];
  let t = 0;
  const add = (phase, ms, fn) => { segments.push({ phase, start: t, end: t + ms, fn }); t += ms; };
  const rest = next => add('rest', REST_MS, () => ({ phase: 'rest', next }));

  rest('jumps');
  for (const [i, lane] of laneSequence(rand, PHASES.jumps.count, layout.lanes).entries()) {
    add('jumps', PHASES.jumps.noteMs, () => ({ phase: 'jumps', id: `jumps:${i}`, ...cellCenter({ lane, band: 'top' }, layout) }));
  }
  rest('path');
  add('path', PHASES.path.ms, ms => ({ phase: 'path', id: 'path', ...pathPoint(ms, layout) }));
  rest('switch');
  const lanes = laneSequence(rand, PHASES.switch.count, layout.lanes);
  for (const [i, lane] of lanes.entries()) {
    const band = i % 2 ? 'bottom' : 'top';
    add('switch', PHASES.switch.noteMs, () => ({ phase: 'switch', id: `switch:${i}`, ...cellCenter({ lane, band }, layout) }));
  }

  return {
    durationMs: t,
    at(ms) {
      const seg = segments.find(s => ms >= s.start && ms < s.end);
      return seg ? seg.fn(ms - seg.start) : null;
    },
  };
}

/**
 * What a game would do: on a hit, tell the tracker where the player is looking
 * (eyes.confirmOnTarget) so it keeps learning. A hit = the reported cell matches the note
 * once the eyes have had time to arrive, or the gaze is in the bottom band on the path.
 * Shared by the live test run and offline replay so both measure the same thing.
 */
export function isHit(phase, sinceMs, state, target, layout = DEFAULT_LAYOUT) {
  if (sinceMs < 400) return false;
  if (phase === 'path') return state.band === 'bottom';
  const cell = cellOf(target, layout);
  return !!cell && state.lane === cell.lane && state.band === cell.band;
}
