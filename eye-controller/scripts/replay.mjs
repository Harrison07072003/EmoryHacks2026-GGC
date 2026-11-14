// Score a recorded session from the command line:  npm run replay -- recordings/my-session.json
import { readFileSync } from 'node:fs';
import { evaluateRecording } from '../src/simulator/evaluate.js';

const file = process.argv[2];
if (!file) { console.error('usage: npm run replay -- <recording.json>'); process.exit(1); }
const r = evaluateRecording(JSON.parse(readFileSync(file, 'utf8')));
const pct = v => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : 'n/a');
console.log(`calibration score  ${r.calibrationScore}/100`);
console.log(`held-out error     ${pct(r.meanError)} of screen`);
console.log(`lane accuracy      ${pct(r.laneAccuracy)}`);
console.log(`band accuracy      ${pct(r.bandAccuracy)}`);
console.table(r.perPoint.map(p => ({ x: p.target.x, y: p.target.y, steadiness: +p.steadiness.toFixed(2), error: +p.error.toFixed(3) })));
