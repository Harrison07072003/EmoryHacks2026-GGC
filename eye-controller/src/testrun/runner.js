// Plays the test run full screen and tells the tracker where the player should be looking
// on every frame (eyes.setTarget), so a recording made during it can be scored.
// The player's own gaze is deliberately not shown: chasing the cursor would spoil the data.
import { buildTestRun, PHASES } from './script.js';

const COUNTDOWN_MS = 1500;

/** @returns Promise<{ aborted: boolean }> */
export function runTestRun(eyes, { area = document.body, seed = 1 } = {}) {
  const run = buildTestRun({ seed, layout: eyes.layout });
  const { lanes, bandSplit } = eyes.layout;
  const root = document.createElement('div');
  root.style.cssText = `position:${area === document.body ? 'fixed' : 'absolute'};inset:0;z-index:9999;background:#0b0b12;cursor:none`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  root.append(canvas);
  area.append(root);
  const g = canvas.getContext('2d');
  const trail = [];

  return new Promise(resolve => {
    const start = performance.now() + COUNTDOWN_MS;
    let raf = 0;
    const finish = aborted => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey);
      eyes.setTarget(null);
      root.remove();
      resolve({ aborted });
    };
    const onKey = e => { if (e.key === 'Escape') finish(true); };
    addEventListener('keydown', onKey);

    const frame = now => {
      const W = (canvas.width = root.clientWidth), H = (canvas.height = root.clientHeight), ms = now - start;
      const cur = ms < 0 ? { phase: 'rest', next: 'jumps' } : run.at(ms);
      if (!cur) return finish(false);
      eyes.setTarget(cur.id ? { x: cur.x, y: cur.y } : null, cur.id ?? null);

      // lane grid, like the game
      for (let i = 0; i < lanes; i++) for (const top of [true, false]) {
        g.fillStyle = (i + top) % 2 ? '#11111d' : '#0e0e18';
        g.fillRect((i * W) / lanes, top ? 0 : bandSplit * H, W / lanes, (top ? bandSplit : 1 - bandSplit) * H);
      }
      text(g, ms < 0 ? `${Math.ceil(-ms / 500)}` : '', W / 2, H / 2, 64);
      if (cur.phase === 'rest') text(g, PHASES[cur.next].title, W / 2, H / 2 - 70, 28);
      else if (cur.phase === 'path') {
        trail.push({ x: cur.x, y: cur.y }); if (trail.length > 20) trail.shift();
        g.strokeStyle = '#4de1ff55'; g.lineWidth = 6; g.beginPath();
        trail.forEach((p, i) => (i ? g.lineTo(p.x * W, p.y * H) : g.moveTo(p.x * W, p.y * H))); g.stroke();
        dot(g, cur.x * W, cur.y * H, 18);
      } else {
        trail.length = 0;
        const cw = W / lanes, ch = (cur.y < bandSplit ? bandSplit : 1 - bandSplit) * H;
        g.fillStyle = '#ffd34d33'; g.beginPath();
        g.roundRect(cur.x * W - cw * 0.4, cur.y * H - ch * 0.4, cw * 0.8, ch * 0.8, 16); g.fill();
        dot(g, cur.x * W, cur.y * H, 16);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}

function dot(g, x, y, r) {
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(x, y, r * 0.3, 0, 7); g.fill();
}
function text(g, s, x, y, size) {
  g.font = `600 ${size}px system-ui`; g.fillStyle = '#dde'; g.textAlign = 'center'; g.fillText(s, x, y);
}
