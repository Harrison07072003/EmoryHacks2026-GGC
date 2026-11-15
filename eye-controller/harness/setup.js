// Setup tester page: live setup checks over the face view, a 6-second range test, and a
// calibrate + test run whose recording is linked to the setup being tested.
import {
  VERSIONS, createEyeController, createFaceView, createMockEyeController, createRecorder, evaluatePlay,
  runTestRun, saveJson, saveRecording,
} from '../src/index.js';
import { measureSetup, rangeAdvice, rangeFromHolds, setupChecks, setupScore } from '../src/setup/setup-score.js';
import { slug } from '../src/util/slug.js';

const $ = id => document.getElementById(id);
const mock = new URLSearchParams(location.search).has('mock');
const eyes = mock ? createMockEyeController() : createEyeController();
createFaceView(eyes, $('face'), { mesh: 'contours', lanes: false });

let range = null, lastGauges = null, lastChecks = [];
const out = text => { $('out').textContent = text; };
$('player').value = localStorage.getItem('eyectl-debug:player') ?? '';
$('player').onchange = () => localStorage.setItem('eyectl-debug:player', $('player').value);
const player = () => slug($('player').value) || 'player';
const tags = () => ({ distance: $('distance').value, camera: $('camera').value, tilt: $('tilt').value, glasses: $('glasses').value === 'yes', note: $('note').value.trim() });

// ---- live checks (5 times a second is plenty) ----
function measure() {
  const d = eyes.faceData(), v = d.video?.videoWidth ? { width: d.video.videoWidth, height: d.video.videoHeight } : null;
  return measureSetup(d.frame, d.landmarks, v);
}
setInterval(() => {
  lastGauges = measure();
  lastChecks = setupChecks(lastGauges);
  $('checks').innerHTML = lastChecks.map(c => `<li class="${c.status}"><b>${c.label}</b><span class="v">${c.value}</span>${c.advice ? `<span class="a">${c.advice}</span>` : ''}</li>`).join('');
  const score = setupScore(lastChecks, range);
  $('score').textContent = score;
  $('score').style.color = score >= 75 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
  $('scoreText').innerHTML = range ? `With range test. ${rangeAdvice(range).join(' ') || 'Your eyes move well across the screen.'}` : 'Run the range test for a full score.';
}, 200);

// ---- range test: centre, then the left / right / top / bottom edges ----
const RANGE_TARGETS = [{ x: 0.5, y: 0.5, warmup: true }, { x: 0.06, y: 0.5 }, { x: 0.94, y: 0.5 }, { x: 0.5, y: 0.08 }, { x: 0.5, y: 0.92 }];
const HOLD_MS = 1600, CAPTURE_FROM_MS = 700;

function runRangeTest() {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#07070d;cursor:none';
  root.innerHTML = '<div data-dot style="position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:conic-gradient(#ffd34d var(--p,0%),#2a2a40 0);transition:left .2s,top .2s"><div style="position:absolute;inset:8px;border-radius:50%;background:#fff"></div><div style="position:absolute;inset:18px;border-radius:50%;background:#ff4d6d"></div></div><div style="position:absolute;left:0;right:0;top:44%;text-align:center;color:#9aa0b8;font:600 18px system-ui">Look at the dot. Move only your eyes, not your head.</div>';
  document.body.append(root);
  const dot = root.querySelector('[data-dot]');
  const holds = RANGE_TARGETS.map(t => ({ target: { x: t.x, y: t.y }, warmup: t.warmup, samples: [] }));
  let i = 0, shownAt = performance.now();
  const off = eyes.onSample(s => {
    const h = holds[i], f = s.frame;
    if (h && performance.now() - shownAt >= CAPTURE_FROM_MS && f.face && !f.blink && f.f) h.samples.push(f.f);
  });
  return new Promise(resolve => {
    const show = () => { const t = holds[i].target; dot.style.left = `${t.x * 100}%`; dot.style.top = `${t.y * 100}%`; shownAt = performance.now(); eyes.mock?.lookAt(t); }; // ?mock: the fake eyes follow
    show();
    const timer = setInterval(() => {
      const p = (performance.now() - shownAt) / HOLD_MS;
      dot.style.setProperty('--p', `${Math.min(100, Math.round(p * 100))}%`);
      if (p < 1) return;
      if (++i < holds.length) return show();
      clearInterval(timer); off(); root.remove(); eyes.mock?.lookAt(null);
      resolve(rangeFromHolds(holds.filter(h => !h.warmup)));
    }, 50);
  });
}

// every range test saves itself (with the tags as they are now), so nothing is lost
$('range').onclick = async () => {
  out('Range test: look at each dot…');
  range = await runRangeTest();
  const pct = v => (v == null ? '–' : v.toFixed(3));
  const where = await saveJson('setups', setupRecord(), label());
  out(`Range test done, saved to ${where}\nleft-right eye range ${pct(range.h)} (good ≥ 0.15 without glasses, ≥ 0.10 with)\nup-down eye range ${pct(range.v)} (good ≥ 0.022)\n${rangeAdvice(range).join('\n') || 'Your eyes move well across the screen.'}`);
};

/** Everything about this setup, saved on its own and inside a linked test-run recording. */
const setupRecord = () => ({
  kind: 'setup', player: player(), measuredAt: new Date().toISOString(), version: VERSIONS.app,
  tags: tags(), gauges: lastGauges, checks: lastChecks.map(({ id, status }) => ({ id, status })), range, score: setupScore(lastChecks, range),
});
const label = () => [player(), 'setup', slug(`${tags().distance}-${tags().camera}-${tags().tilt}${tags().glasses ? '-glasses' : ''}`)].join('-');

// only needed if the description changed after the range test (it saves itself)
$('save').onclick = async () => {
  if (!range) return out('Run the range test first: the eye range is what the setup score is mostly about.');
  out(`Setup saved again to ${await saveJson('setups', setupRecord(), label())}`);
};

$('run').onclick = async () => {
  const setup = setupRecord(), rec = createRecorder(eyes, { label: label(), player: player(), condition: 'setup', version: VERSIONS.app, setup });
  out('Calibrating…');
  const cal = await eyes.startCalibration();
  if (cal.aborted) { rec.stop(); return out('Cancelled.'); }
  const run = await runTestRun(eyes);
  const recording = rec.stop();
  if (run.aborted) return out('Cancelled.');
  const where = await saveRecording(recording, label()), p = evaluatePlay(recording)?.replay, pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
  out(`Test run saved to ${where}\ncalibration ${cal.score}/100\nlane jumps on target ${pct(p?.jumps?.onTarget)} · band switches on target ${pct(p?.switch?.onTarget)} · path in the right lane ${pct(p?.path?.lane)}`);
};

try { await eyes.init(); out(mock ? 'Simulated eyes (?mock): the mouse moves them.' : 'Camera on.'); }
catch (e) { out(`Could not start: ${e.message}`); }
