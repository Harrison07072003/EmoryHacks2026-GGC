// HELLO LANES: the smallest possible "game" on top of the eye-controller.
// Copy this pattern: create -> init -> read `eyes.state` every frame -> subscribe to events.
import { createEyeController, createMockEyeController } from '../src/index.js';

// ---- the one line to switch between simulated eyes and the live webcam ----
const live = new URLSearchParams(location.search).has('live');
const eyes = live ? createEyeController() : createMockEyeController();

const canvas = document.getElementById('view'), g = canvas.getContext('2d'), hud = document.getElementById('hud');
const log = [];
const say = line => { log.unshift(line); log.length = Math.min(log.length, 5); };

// ---- events ----
eyes.onLaneChange((lane, band) => say(`lane ${lane ?? '-'} ${band ?? ''}`));
eyes.onFaceLost(() => say('face lost'));
eyes.onFaceFound(() => say('face found'));
eyes.onCalibrationComplete(score => say(`calibration ${score}/100`));
const trail = [];
eyes.onPathSample(p => { trail.push(p); if (trail.length > 40) trail.shift(); });

// ---- state, read every frame ----
function draw() {
  const W = (canvas.width = innerWidth), H = (canvas.height = innerHeight);
  const { gaze, lane, band, quality, faceVisible, ready, calibrationScore } = eyes.state;
  const { lanes, bandSplit } = eyes.layout;

  for (let i = 0; i < lanes; i++) for (const b of ['top', 'bottom']) {
    const y = b === 'top' ? 0 : bandSplit * H, h = b === 'top' ? bandSplit * H : (1 - bandSplit) * H;
    g.fillStyle = i === lane && b === band ? '#1f5f78' : (i + (b === 'top')) % 2 ? '#11111d' : '#0e0e18';
    g.fillRect((i * W) / lanes, y, W / lanes, h);
  }
  g.strokeStyle = '#4de1ff'; g.lineWidth = 2; g.beginPath();
  trail.forEach((p, i) => (i ? g.lineTo(p.x * W, p.y * H) : g.moveTo(p.x * W, p.y * H)));
  g.stroke();
  g.fillStyle = faceVisible ? '#ffd34d' : '#e74c3c';
  g.beginPath(); g.arc(gaze.x * W, gaze.y * H, 12, 0, 7); g.fill();

  hud.textContent = [
    live ? 'LIVE webcam' : 'MOCK: move the mouse (F = hide face, B = bad light)',
    `lane ${lane ?? '-'}   band ${band ?? '-'}   quality ${quality}   face ${faceVisible ? 'yes' : 'NO'}`,
    ready ? `calibrated ${calibrationScore}/100` : calibrationScore === null ? 'not calibrated: press C' : `calibration ${calibrationScore}/100 is too low: press C or T`,
    ...log,
  ].join('\n');
  requestAnimationFrame(draw);
}

// ---- lifecycle ----
async function calibrate(topUp) {
  try {
    const result = await eyes.startCalibration({ topUp });
    if (result.ok) await eyes.saveProfile();
  } catch (e) { say(e.message); }
}
document.getElementById('calibrate').onclick = () => calibrate(false);
document.getElementById('topup').onclick = () => calibrate(true);
const cond = { faceLost: false, light: 'good' };
addEventListener('keydown', e => {
  if (e.key === 'c') calibrate(false);
  if (e.key === 't') calibrate(true);
  if (e.key === 'f' && eyes.mock) eyes.mock.setConditions({ faceLost: (cond.faceLost = !cond.faceLost) });
  if (e.key === 'b' && eyes.mock) eyes.mock.setConditions({ light: (cond.light = cond.light === 'bad' ? 'good' : 'bad') });
});
Object.assign(document.getElementById('mode'), live ? { textContent: 'Use mock', href: './' } : { textContent: 'Use live webcam', href: '?live' });

try {
  await eyes.init();
  if (live && !(await eyes.loadProfile())) say('no saved profile: press C to calibrate');
} catch (e) {
  say(`could not start: ${e.message}`);
}
draw();
