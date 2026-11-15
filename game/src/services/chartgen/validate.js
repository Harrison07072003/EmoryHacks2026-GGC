// Playability rules for charts, the same as `npm run check-charts` (tools/check-charts.mjs):
// format 1, no straight note while a curve is active, enough time between column changes for
// the eyes to move, no notes after the audio ends. Generated charts are repaired with
// enforceRules() and then must pass validateChart().
import { parseChart } from '../../gameplay/chart.js';

export const MIN_MOVE_SEC = { practice: 0.7, normal: 0.35, hard: 0.24 };
const CURVE_CLEARANCE = 0.2;

/** @returns problem strings ([] = valid) */
export function validateChart(raw, { durationSec, difficulty = raw?.difficulty } = {}) {
  let chart;
  try { chart = parseChart(raw); } catch (e) { return [e.message]; }
  const problems = [];
  const curves = chart.notes.filter(n => n.type === 'curve'), straight = chart.notes.filter(n => n.type === 'straight');
  if (durationSec !== undefined && chart.duration > durationSec) problems.push(`notes run past the audio (${chart.duration}s > ${durationSec}s)`);
  for (const s of straight) if (curves.some(c => s.t > c.t - CURVE_CLEARANCE && s.t < c.end + CURVE_CLEARANCE)) problems.push(`straight note at ${s.t}s overlaps a curve`);
  for (let i = 1; i < straight.length; i++) {
    const a = straight[i - 1], b = straight[i];
    if (a.lane !== b.lane && b.t - a.t < MIN_MOVE_SEC[difficulty]) problems.push(`${b.t}s column jump only ${(b.t - a.t).toFixed(2)}s after the previous note`);
  }
  return problems;
}

/** Drop whatever breaks the rules (a safety net; the generator should not produce any). */
export function enforceRules(chart, { durationSec }) {
  const minMove = MIN_MOVE_SEC[chart.difficulty];
  const curves = chart.notes.filter(n => n.type === 'curve' && n.end <= durationSec);
  const straight = [];
  for (const n of chart.notes.filter(x => x.type === 'straight' && x.t <= durationSec).sort((x, y) => x.t - y.t)) {
    if (curves.some(c => n.t > c.t - CURVE_CLEARANCE && n.t < c.end + CURVE_CLEARANCE)) continue;
    const prev = straight.at(-1);
    if (prev && prev.lane !== n.lane && n.t - prev.t < minMove) continue;
    straight.push(n);
  }
  return { ...chart, notes: [...straight, ...curves].sort((x, y) => x.t - y.t) };
}
