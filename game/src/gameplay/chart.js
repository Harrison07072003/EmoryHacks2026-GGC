// Chart format (one JSON file per song and difficulty, see docs/CHARTS.md):
//
//   { "format": 1, "song": "neon-lullaby", "difficulty": "normal",
//     "notes": [
//       { "type": "straight", "t": 4.0, "lane": 2 },
//       { "type": "curve", "t": 6.0, "end": 9.0, "path": [ { "t": 6.0, "x": 0.3 }, { "t": 7.5, "x": 0.7 }, ... ] }
//     ] }
//
// `t` is seconds from the start of the audio file. Straight notes are judged on the upper
// line in column `lane` (0-3). A curve's path gives the x (0-1) the eyes must follow along the
// lower line over time. Nothing here is generated at play time: charts are data.
import { clamp } from '../util/math.js';

export const CHART_FORMAT = 1;
const X_MIN = 0.06, X_MAX = 0.94;

export class ChartError extends Error {}

/** Validate and normalize a chart. Returns a new object with sorted notes and stable ids. */
export function parseChart(raw, { lanes = 4 } = {}) {
  if (!raw || raw.format !== CHART_FORMAT || !Array.isArray(raw.notes)) throw new ChartError('Not a format-1 chart');
  const notes = raw.notes.map((n, i) => {
    if (!Number.isFinite(n.t) || n.t < 0) throw new ChartError(`note ${i}: bad time`);
    if (n.type === 'straight') {
      if (!Number.isInteger(n.lane) || n.lane < 0 || n.lane >= lanes) throw new ChartError(`note ${i}: bad lane`);
      return { type: 'straight', t: n.t, lane: n.lane };
    }
    if (n.type === 'curve') {
      if (!(n.end > n.t) || !Array.isArray(n.path) || n.path.length < 2) throw new ChartError(`note ${i}: bad curve`);
      const path = n.path.map(p => ({ t: p.t, x: clamp(p.x, X_MIN, X_MAX) })).sort((a, b) => a.t - b.t);
      return { type: 'curve', t: n.t, end: n.end, path };
    }
    throw new ChartError(`note ${i}: unknown type ${n.type}`);
  }).sort((a, b) => a.t - b.t);
  notes.forEach((n, i) => { n.id = `${n.type[0]}${i}`; });
  return { ...raw, notes, duration: notes.reduce((m, n) => Math.max(m, n.end ?? n.t), 0) };
}

/**
 * x of a curve's path at time t: Catmull-Rom through the points, so the ribbon flows
 * smoothly; held at the ends outside the path.
 */
export function pathX(path, t) {
  if (t <= path[0].t) return path[0].x;
  const last = path.length - 1;
  if (t >= path[last].t) return path[last].x;
  let i = 0;
  while (i < last - 1 && t > path[i + 1].t) i++;
  const p0 = path[Math.max(0, i - 1)], p1 = path[i], p2 = path[i + 1], p3 = path[Math.min(last, i + 2)];
  const u = (t - p1.t) / (p2.t - p1.t || 1);
  const u2 = u * u, u3 = u2 * u;
  const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3);
  return clamp(x, X_MIN, X_MAX);
}

/** Split a curve into judged segments of about `segmentSec` each. */
export function curveSegments(note, segmentSec) {
  const dur = note.end - note.t, n = Math.max(1, Math.round(dur / segmentSec));
  return Array.from({ length: n }, (_, i) => ({ start: note.t + (dur * i) / n, end: note.t + (dur * (i + 1)) / n }));
}

/** Number of judgments a chart produces (straight notes + curve segments): the accuracy denominator. */
export function judgmentCount(chart, segmentSec) {
  return chart.notes.reduce((n, note) => n + (note.type === 'curve' ? curveSegments(note, segmentSec).length : 1), 0);
}
