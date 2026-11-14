// Tracker debug page: live camera view, eye crops with pupil / iris markers, the camera
// adjust sliders, calibration, session recording, and baseline export / import.
import { createEyeController, createRecorder, downloadRecording } from '../src/index.js';

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
$('save').onclick = async () => note((await eyes.saveProfile()) ? 'profile saved' : 'nothing to save: calibrate first');
$('load').onclick = async () => note((await eyes.loadProfile()) ? 'profile loaded' : 'no saved profile');

let recorder = null;
$('record').onclick = () => {
  if (recorder) { downloadRecording(recorder.stop(), `session-${Date.now()}`); recorder = null; $('record').textContent = 'Start recording'; }
  else { recorder = createRecorder(eyes, { settings: { ...cam.settings } }); $('record').textContent = 'Stop + download'; }
};
$('export').onclick = async () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(await eyes.exportBaseline())], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: 'baseline.json' }).click();
};
$('import').onclick = () => $('file').click();
$('file').onchange = async e => {
  try { await eyes.importBaseline(JSON.parse(await e.target.files[0].text())); note('baseline merged'); }
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

try { await eyes.init(); await eyes.loadProfile(); } catch (err) { note(`could not start: ${err.message}`); }
draw();
