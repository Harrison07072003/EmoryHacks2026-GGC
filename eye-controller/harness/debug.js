// Tracker debug page: live camera view, eye crops with pupil / iris markers, the camera
// adjust sliders, calibration, session recording, and baseline export / import.
import { VERSIONS, createFaceView, createEyeController, createRecorder, evaluatePlay, evaluateRecording, runTestRun, saveJson, saveRecording } from '../src/index.js';
import { PROTOCOL } from './protocol.js';
import { slug } from '../src/util/slug.js';

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
// normalized the same way file names are, so 'Jonathan Zaharia' and 'jonathan-zaharia' are one player
const player = () => slug($('player').value) || 'default';
$('player').value = localStorage.getItem('eyectl-debug:player') ?? '';
$('player').onchange = () => localStorage.setItem('eyectl-debug:player', $('player').value);
$('save').onclick = async () => {
  if (!(await eyes.saveProfile(player()))) return note('nothing to save: calibrate first');
  const pool = await eyes.exportBaseline();
  note(`profile "${player()}" saved${eyes.state.ready ? '' : ' (score too low to join the pool)'}. Pool now holds ${pool.players} player(s).`);
};
$('load').onclick = async () => note((await eyes.loadProfile(player())) ? `profile "${player()}" loaded` : `no saved profile called "${player()}"`);

// ---- data collection: one click = calibrate + test run, recorded, saved and scored ----
const pct = v => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '-');
let saved = [], busy = false, recorder = null;
const selected = () => PROTOCOL.find(p => p.id === document.querySelector('input[name=cond]:checked')?.value) ?? PROTOCOL[0];
const clipLabel = () => [player(), selected().id, slug($('label').value)].filter(Boolean).join('-');
// record which tracker version made each clip, so before/after comparisons are easy
const version = () => VERSIONS.app;
const countOf = cond => saved.filter(f => f.startsWith(`${player()}-${cond.id}_`) || f.startsWith(`${player()}-${cond.id}-`)).length;

async function refreshChecklist(keep = true) {
  try { saved = (await (await fetch('/__save/recordings')).json()).files; } catch { saved = []; }
  const current = keep ? selected().id : (PROTOCOL.find(p => countOf(p) < p.clips) ?? PROTOCOL[0]).id;
  $('protocol').innerHTML = PROTOCOL.map(p => {
    const n = countOf(p), done = n >= p.clips;
    return `<label><input type="radio" name="cond" value="${p.id}" ${p.id === current ? 'checked' : ''}>
      <span>${p.id}${p.calibrate === false ? ' (no calibration)' : ''}</span><span class="${done ? 'done' : ''}">${n}/${p.clips}</span>
      <span class="hint">${p.text}</span></label>`;
  }).join('');
}

function describe(recording) {
  const cal = evaluateRecording(recording), play = evaluatePlay(recording)?.replay;
  const lines = [];
  if (cal.dots) lines.push(`calibration ${cal.fullScore}/100 · held-out error ${pct(cal.errorX)} across, ${pct(cal.errorY)} up-down`);
  if (play?.jumps) lines.push(`lane jumps: ${pct(play.jumps.hitRate)} hit, ${play.jumps.reactionMs ?? '-'} ms to arrive, ${pct(play.jumps.onTarget)} of the time on target`);
  if (play?.path) lines.push(`path: ${pct(play.path.errorAtLag)} off the dot, ${play.path.lagMs} ms behind, right lane ${pct(play.path.lane)}`);
  if (play?.switch) lines.push(`band switches: ${pct(play.switch.hitRate)} hit, ${play.switch.reactionMs ?? '-'} ms to arrive, ${pct(play.switch.onTarget)} on target`);
  return lines.join('\n');
}

async function recordClip({ calibrate = selected().calibrate !== false } = {}) {
  if (busy) return;
  // a drift check is only meaningful on a calibration that passed
  if (!calibrate && !eyes.state.ready) return note(`this step needs a calibration that passed (60+): record a baseline clip first${eyes.state.calibrationScore === null ? '' : `. The current one scored ${eyes.state.calibrationScore}`}`);
  busy = true; $('result').textContent = '';
  const label = clipLabel(), rec = createRecorder(eyes, { label, player: player(), condition: selected().id, version: version(), settings: { ...cam.settings } });
  try {
    if (calibrate) {
      const cal = await eyes.startCalibration();
      lastResult = cal;
      if (cal.aborted) { rec.stop(); return note('clip cancelled, nothing saved'); }
    }
    const run = await runTestRun(eyes);
    const recording = rec.stop();
    if (run.aborted) return note('clip cancelled, nothing saved');
    const where = await saveRecording(recording, label);
    if (calibrate && lastResult.ok) await eyes.saveProfile(player());
    $('result').textContent = `saved ${where}\n${describe(recording)}`;
    await refreshChecklist(false);   // move on to the next condition that still needs clips
  } catch (e) { rec.stop(); note(`clip failed: ${e.message}`); }
  finally { busy = false; }
}
$('clip').onclick = () => recordClip();
$('testrun').onclick = () => recordClip({ calibrate: false });
addEventListener('keydown', e => { if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement && e.target.type !== 'radio')) recordClip(); });
$('player').addEventListener('change', () => refreshChecklist());

$('record').onclick = async () => {
  if (!recorder) {
    recorder = createRecorder(eyes, { label: clipLabel(), settings: { ...cam.settings } });
    $('record').textContent = 'Stop + save';
    return;
  }
  const recording = recorder.stop();
  recorder = null; $('record').textContent = 'Start recording';
  $('result').textContent = `saved ${await saveRecording(recording, clipLabel())}\n${describe(recording) || 'nothing to score: run a calibration or test run while recording'}`;
  refreshChecklist();
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
// camera view with the full face mesh, eye close-ups, head direction and lane map
let faceView = createFaceView(eyes, $('frame'), { mesh: 'full', checks: true, image: 'processed' });
// P toggles between what the tracker analyses (auto-exposed, cropped) and the raw camera
addEventListener('keydown', e => {
  if (e.key !== 'p' || e.target instanceof HTMLInputElement) return;
  const image = faceView.image === 'raw' ? 'processed' : 'raw';
  faceView.destroy(); faceView = createFaceView(eyes, $('frame'), { mesh: 'full', checks: true, image }); faceView.image = image;
});
function drawEye(canvas, key) {
  const g = canvas.getContext('2d'), d = cam.debug[key];
  if (!d || !cam.eyeCanvas) return;
  const w = canvas.width = cam.eyeCanvas[key].width, h = canvas.height = cam.eyeCanvas[key].height;
  g.drawImage(cam.eyeCanvas[key], 0, 0);
  g.fillStyle = '#ff3b3b'; g.fillRect(d.pupil.u * w - 2, d.pupil.v * h - 2, 4, 4);          // red: our pupil finder
  g.strokeStyle = '#4de1ff'; g.lineWidth = 2; g.strokeRect(d.iris.u * w - 4, d.iris.v * h - 4, 8, 8); // blue: MediaPipe iris
}
function draw() {
  const s = eyes.state, f = eyes.debug.engine.lastFrame;
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
    f?.res ? `camera ${f.res[0]}x${f.res[1]}   frame time ${f.ms?.toFixed(1) ?? '-'} ms` : '',
    `crop: x ${cam.roi.x.toFixed(2)} y ${cam.roi.y.toFixed(2)} size ${cam.roi.w.toFixed(2)}`,
    lastResult ? `last calibration: ${lastResult.score}/100 ${lastResult.ok ? 'OK' : 'TOO LOW'}  weak cells: ${lastResult.weakCells.map(c => `${c.band} ${c.lane}`).join(', ') || 'none'}` : '',
    recorder ? `recording: ${recorder.length} frames` : '',
    message,
  ].filter(Boolean).join('\n');
  requestAnimationFrame(draw);
}

refreshChecklist(false);
try { await eyes.init(); await eyes.loadProfile(player()); } catch (err) { note(`could not start: ${err.message}`); }
draw();
