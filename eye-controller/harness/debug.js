// Tracker debug page: live camera view, eye crops with pupil / iris markers, the camera
// adjust sliders, calibration, session recording, and baseline export / import.
import { createEyeController, createRecorder, evaluateRecording, saveJson, saveRecording } from '../src/index.js';

const $ = id => document.getElementById(id);
const eyes = createEyeController();
const cam = eyes.camera;

// ---- camera adjust sliders ----
const SLIDERS = [
  ['brightness', -0.5, 0.5, 0.01], ['contrast', 0.5, 3, 0.05], ['gamma', 0.4, 3, 0.05], ['equalize', 0, 1, 0.05],
  ['zoom', 1, 4, 0.05], ['panX', -1, 1, 0.02], ['panY', -1, 1, 0.02],
];
const TOGGLES = [['auto', 'Auto exposure (overrides brightness / contrast / gamma)'], ['autoCenter', 'Auto-centre on face (overrides zoom / pan)']];
for (const [key, text] of TOGGLES) {
  const label = Object.assign(document.createElement('label'), { className: 'check' });
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: cam.settings[key] });
  box.onchange = () => cam.set({ [key]: box.checked });
  label.append(box, text);
  $('sliders').append(label);
}
for (const [key, min, max, step] of SLIDERS) {
  const label = document.createElement('label'), out = document.createElement('span');
  const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: cam.settings[key] });
  out.textContent = cam.settings[key];
  input.oninput = () => { cam.set({ [key]: +input.value }); out.textContent = input.value; };
  label.append(key, input, out);
  $('sliders').append(label);
}

// ---- buttons ----
let lastResult = null;
const calibrate = async opts => { try { lastResult = await eyes.startCalibration(opts); } catch (e) { note(e.message); } };
$('calibrate').onclick = () => calibrate({});
$('quick').onclick = () => calibrate({ quick: true });
$('topup').onclick = () => calibrate({ topUp: true });
// One profile per player name. Saving a good calibration also adds that player to the pooled
// baseline; saving the same name again replaces their entry instead of counting them twice.
const player = () => $('player').value.trim().toLowerCase() || 'default';
$('player').value = localStorage.getItem('eyectl-debug:player') ?? '';
$('player').onchange = () => localStorage.setItem('eyectl-debug:player', $('player').value);
$('save').onclick = async () => {
  if (!(await eyes.saveProfile(player()))) return note('nothing to save: calibrate first');
  const pool = await eyes.exportBaseline();
  note(`profile "${player()}" saved${eyes.state.ready ? '' : ' (score too low to join the pool)'}. Pool now holds ${pool.players} player(s).`);
};
$('load').onclick = async () => note((await eyes.loadProfile(player())) ? `profile "${player()}" loaded` : `no saved profile called "${player()}"`);

let recorder = null;
$('record').onclick = async () => {
  if (!recorder) {
    recorder = createRecorder(eyes, { label: $('label').value, settings: { ...cam.settings } });
    $('record').textContent = 'Stop + save';
    return;
  }
  const recording = recorder.stop();
  recorder = null; $('record').textContent = 'Start recording';
  const where = await saveRecording(recording, $('label').value);
  // score it on the spot: calibrate on half the dots, test on the other half
  const r = evaluateRecording(recording), pct = v => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');
  note(`saved ${recording.frames.length} frames to ${where}\n` + (r.perPoint.length
    ? `score ${r.fullScore}/100, error ${pct(r.errorX)} across / ${pct(r.errorY)} up-down, lanes ${pct(r.laneAccuracy)}, bands ${pct(r.bandAccuracy)}`
    : 'no calibration dots in this clip, so it cannot be scored: press Calibrate while recording'));
};
$('export').onclick = async () => {
  const pool = await eyes.exportBaseline();
  if (!pool.players) return note('the pool is empty: calibrate, then Save profile first');
  note(`pool of ${pool.players} player(s) saved to ${await saveJson('baselines', pool, `baseline-${pool.players}-players`)}`);
};
$('import').onclick = () => $('file').click();
$('file').onchange = async e => {
  try {
    await eyes.importBaseline(JSON.parse(await e.target.files[0].text()));
    note(`baseline merged. Pool now holds ${(await eyes.exportBaseline()).players} player(s).`);
  }
  catch (err) { note(`import failed: ${err.message}`); }
};
let message = '';
const note = m => { message = m; };

// ---- live view ----
const frame = $('frame'), fg = frame.getContext('2d');
function drawEye(canvas, key) {
  const g = canvas.getContext('2d'), d = cam.debug[key];
  if (!d || !cam.eyeCanvas) return;
  g.drawImage(cam.eyeCanvas[key], 0, 0);
  g.fillStyle = '#ff3b3b'; g.fillRect(d.pupil.u * 64 - 1, d.pupil.v * 32 - 1, 2, 2);        // red: our pupil finder
  g.strokeStyle = '#4de1ff'; g.strokeRect(d.iris.u * 64 - 2, d.iris.v * 32 - 2, 4, 4);       // blue: MediaPipe iris
}
function draw() {
  const s = eyes.state, f = eyes.debug.engine.lastFrame;
  if (cam.work) {
    frame.height = Math.round((960 * cam.work.height) / cam.work.width);
    fg.save(); fg.translate(960, 0); fg.scale(-1, 1); fg.drawImage(cam.work, 0, 0, 960, frame.height); fg.restore(); // mirrored
  }
  drawEye($('eyeL'), 'L'); drawEye($('eyeR'), 'R');
  Object.assign($('gaze').style, { left: `${s.gaze.x * 100}%`, top: `${s.gaze.y * 100}%`, display: s.calibrationScore === null ? 'none' : 'block' });
  const factors = Object.entries(eyes.debug.qualityFactors()).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ');
  const e = f?.exposure, eye = k => (f?.face ? `conf ${f.eyes[k].conf.toFixed(2)} glare ${(f.eyes[k].glare * 100).toFixed(1)}% light ${f.eyes[k].lum.toFixed(0)}` : '-');
  $('stats').textContent = [
    `quality ${s.quality}   face ${s.faceVisible ? 'yes' : 'NO'}   lane ${s.lane ?? '-'}   band ${s.band ?? '-'}   ${s.ready ? 'READY' : 'not ready'}   calibration ${s.calibrationScore ?? '-'}`,
    `quality factors: ${factors}`,
    `left eye: ${eye('L')}    right eye: ${eye('R')}`,
    e ? `exposure: mean ${e.mean.toFixed(0)}  p5 ${e.p5}  p95 ${e.p95}  dark ${(e.dark * 100).toFixed(0)}%  clipped ${(e.clipped * 100).toFixed(0)}%` : '',
    cam.tone && cam.settings.auto ? `auto tone: gamma ${cam.tone.gamma.toFixed(2)}  contrast ${cam.tone.contrast.toFixed(2)}  brightness ${cam.tone.brightness.toFixed(2)}` : '',
    `crop: x ${cam.roi.x.toFixed(2)} y ${cam.roi.y.toFixed(2)} size ${cam.roi.w.toFixed(2)}`,
    lastResult ? `last calibration: ${lastResult.score}/100 ${lastResult.ok ? 'OK' : 'TOO LOW'}  weak cells: ${lastResult.weakCells.map(c => `${c.band} ${c.lane}`).join(', ') || 'none'}` : '',
    recorder ? `recording: ${recorder.length} frames` : '',
    message,
  ].filter(Boolean).join('\n');
  requestAnimationFrame(draw);
}

try { await eyes.init(); await eyes.loadProfile(player()); } catch (err) { note(`could not start: ${err.message}`); }
draw();
