// Offline chart generator: musical events -> one predetermined chart per difficulty.
// Runs at development time only (npm run songs); the game just loads the JSON it writes.
// The output is plain data: edit the JSON by hand afterwards if a pattern feels wrong.
//
// A future "upload a song" feature would replace the composed events with onsets and
// pitches detected offline from audio, and reuse everything below unchanged.

export const DIFFICULTY_RULES = {
  practice: { maxAccent: 2, minGap: 0.8, minGapSameLane: 0.5, maxJump: 2, curveAmp: 0.55, curveMaxSpeed: 0.4, transitionGap: 1.0, minCurveSec: 1.2 },
  normal:   { maxAccent: 3, minGap: 0.4, minGapSameLane: 0.26, maxJump: 3, curveAmp: 0.82, curveMaxSpeed: 0.75, transitionGap: 0.6, minCurveSec: 1.0 },
  hard:     { maxAccent: 4, minGap: 0.27, minGapSameLane: 0.16, maxJump: 3, curveAmp: 1.0, curveMaxSpeed: 1.25, transitionGap: 0.4, minCurveSec: 0.8 },
};

const FIRST_NOTE_SEC = 1.8;  // leave time for the first note to travel in
const PHRASE_BREAK_SEC = 0.9;
const r3 = v => Math.round(v * 1000) / 1000;

/** Group events of one role into phrases split by silences. */
function phrases(events, role, breakSec) {
  const out = [];
  for (const e of events.filter(e => e.role === role).sort((a, b) => a.t - b.t)) {
    const last = out.at(-1)?.at(-1);
    if (last && e.t - (last.t + last.dur) < breakSec) out.at(-1).push(e); else out.push([e]);
  }
  return out;
}

/** Pitch -> lane inside one phrase: distinct pitches spread over the 4 columns, low = left. */
function laneMap(phrase, lanes) {
  const pitches = [...new Set(phrase.map(e => e.midi))].sort((a, b) => a - b);
  const k = pitches.length;
  return midi => (k === 1 ? 1 : Math.round((pitches.indexOf(midi) / (k - 1)) * (lanes - 1)));
}

function makeCurves(events, rules) {
  return phrases(events, 'flow', 0.35).map(ph => {
    const lo = Math.min(...ph.map(e => e.midi)), hi = Math.max(...ph.map(e => e.midi));
    const xOf = m => 0.5 + (hi === lo ? 0 : ((m - lo) / (hi - lo) - 0.5)) * 0.76 * rules.curveAmp;
    const last = ph.at(-1), end = last.t + Math.min(last.dur, 1.6);
    const raw = ph.map(e => ({ t: e.t, x: xOf(e.midi) }));
    raw.push({ t: end, x: raw.at(-1).x });
    // limit how fast the eyes must travel (difficulty), keep the first point where it is
    const path = [raw[0]];
    for (const p of raw.slice(1)) {
      const prev = path.at(-1), dt = p.t - prev.t;
      if (dt < 0.12) continue;
      const maxDx = rules.curveMaxSpeed * dt;
      path.push({ t: r3(p.t), x: r3(prev.x + Math.max(-maxDx, Math.min(maxDx, p.x - prev.x))) });
    }
    return { type: 'curve', t: r3(ph[0].t), end: r3(end), path: path.map(p => ({ t: r3(p.t), x: r3(p.x) })) };
  }).filter(c => c.end - c.t >= rules.minCurveSec && c.path.length >= 2);
}

function makeStraight(events, rules, curves, lanes) {
  const blocked = t => curves.some(c => t > c.t - rules.transitionGap && t < c.end + rules.transitionGap);
  const notes = [];
  for (const ph of phrases(events, 'tap', PHRASE_BREAK_SEC)) {
    const lane = laneMap(ph, lanes);
    for (const e of ph) {
      if (e.accent > rules.maxAccent || e.t < FIRST_NOTE_SEC || blocked(e.t)) continue;
      let l = lane(e.midi);
      const prev = notes.at(-1);
      if (prev) {
        if (Math.abs(l - prev.lane) > rules.maxJump) l = prev.lane + Math.sign(l - prev.lane) * rules.maxJump;
        const gap = e.t - prev.t;
        if (gap < (l === prev.lane ? rules.minGapSameLane : rules.minGap)) continue;
      }
      notes.push({ type: 'straight', t: r3(e.t), lane: l });
    }
  }
  return notes;
}

/** @returns a format-1 chart object */
export function generateChart(events, songId, difficulty, { lanes = 4 } = {}) {
  const rules = DIFFICULTY_RULES[difficulty];
  const curves = makeCurves(events, rules);
  const straight = makeStraight(events, rules, curves, lanes);
  return {
    format: 1, song: songId, difficulty,
    generatedBy: 'tools/compose (offline, from the composed note data)',
    notes: [...straight, ...curves].sort((a, b) => a.t - b.t),
  };
}
