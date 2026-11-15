// @vitest-environment jsdom
// Mouse modes, the in-game tracking measure and old settings.
import { describe, expect, it } from 'vitest';
import { createGazeInput } from '../src/input/gaze-input.js';
import { createTrackingStats } from '../src/gameplay/tracking-stats.js';
import { loadSettings } from '../src/data/settings.js';
import { MODES } from '../src/config/game-config.js';

const moveMouse = (from, to, steps = 10) => {
  for (let i = 0; i <= steps; i++) dispatchEvent(new MouseEvent('pointermove', { clientX: from + ((to - from) * i) / steps, clientY: 300 }));
};

describe('mouse modes', () => {
  it('off (default): moving the mouse never takes over the eyes', () => {
    const gaze = createGazeInput('sim');
    gaze.update();
    moveMouse(100, 700);
    gaze.update();
    expect(gaze.mouseOverride).toBe(false);
    expect(gaze.mouseLocked).toBe(false);
  });
  it('emergency mouse is only switched on by the game, and a passing calibration ends it', () => {
    const gaze = createGazeInput('sim');
    gaze.enableEmergencyMouse(); gaze.update();
    expect(gaze.mouseLocked).toBe(true);
    expect(gaze.mouseOverride).toBe(true);
    expect(gaze.sourceInfo.label).toMatch(/MOUSE/);
    gaze.clearMouseLock(); gaze.update();
    expect(gaze.mouseOverride).toBe(false);
  });
});

describe('in-game tracking measure', () => {
  const straight = { id: 's1', type: 'straight', lane: 2 }, curve = { id: 'c1', type: 'curve' };
  const g = { x: 0.6, y: 0.3, valid: true };
  it('counts the reported lane and band, from 0.4 s after the target appears', () => {
    const stats = createTrackingStats(MODES.practice);
    stats.add({ note: straight, point: { x: 0.625, y: 0.36 } }, g, { lane: 0, band: 'top' }, 10.0);   // still travelling: not counted
    stats.add({ note: straight, point: { x: 0.625, y: 0.36 } }, g, { lane: 2, band: 'top' }, 10.5);
    stats.add({ note: straight, point: { x: 0.625, y: 0.36 } }, g, { lane: 2, band: 'bottom' }, 10.6);
    stats.add({ note: curve, point: { x: 0.1, y: 0.8 } }, g, { lane: 0, band: 'bottom' }, 11.0);
    stats.add({ note: curve, point: { x: 0.1, y: 0.8 } }, g, { lane: 0, band: 'bottom' }, 11.5);
    expect(stats.summary().cell_pct).toBe(66.7);   // 2 of the 3 counted frames
  });
  it('is empty while the mouse drives', () => {
    const stats = createTrackingStats(MODES.practice);
    stats.add({ note: straight, point: { x: 0.625, y: 0.36 } }, g, null, 10.5);
    expect(stats.summary().cell_pct).toBeNull();
  });
});

describe('settings', () => {
  it('an old saved "emergency" mouse setting becomes off', () => {
    localStorage.setItem('rhythmeyez:settings', JSON.stringify({ mouseMode: 'emergency' }));
    expect(loadSettings()).toMatchObject({ mouseMode: 'off', usePool: false });
  });
});
