import { describe, expect, it } from 'vitest';
import { createDwellCore } from '../src/input/dwell.js';
import { DWELL } from '../src/config/game-config.js';

const FRAME = 1000 / 60;
/** Feed `ms` of frames looking at `id`; return activations. */
function look(core, id, ms, clock) {
  const fired = [];
  for (let t = 0; t < ms; t += FRAME) { clock.now += FRAME; const f = core.update(id, FRAME, clock.now); if (f) fired.push({ id: f, at: clock.now }); }
  return fired;
}

describe('gaze dwell', () => {
  it('activates after exactly the configured 2 seconds of continuous gaze', () => {
    const core = createDwellCore(), clock = { now: 0 };
    expect(look(core, 'start', DWELL.activateMs - 50, clock)).toEqual([]);
    const fired = look(core, 'start', 100, clock);
    expect(fired.map(f => f.id)).toEqual(['start']);
    expect(DWELL.activateMs).toBe(2000);
  });

  it('does not repeat while the gaze stays on the same control', () => {
    const core = createDwellCore(), clock = { now: 0 };
    expect(look(core, 'retry', 10000, clock)).toHaveLength(1);
  });

  it('re-arms after the gaze leaves and returns', () => {
    const core = createDwellCore(), clock = { now: 0 };
    look(core, 'a', 2100, clock);
    look(core, null, DWELL.cooldownMs, clock);
    expect(look(core, 'a', 2100, clock)).toHaveLength(1);
  });

  it('looking away drains the progress instead of keeping it', () => {
    const core = createDwellCore(), clock = { now: 0 };
    look(core, 'a', 1500, clock);
    expect(core.progress).toBeGreaterThan(0.7);
    look(core, null, 200, clock);
    expect(core.progress).toBeLessThan(0.75 - 0.15);
    look(core, null, 1000, clock);
    expect(core.progress).toBe(0);
    // a fresh full dwell is needed afterwards
    expect(look(core, 'a', 1900, clock)).toEqual([]);
  });

  it('a different control cannot fire during the cooldown', () => {
    const core = createDwellCore({ ...DWELL, activateMs: 100, cooldownMs: 1000 }), clock = { now: 0 };
    expect(look(core, 'a', 120, clock)).toHaveLength(1);
    expect(look(core, 'b', 500, clock)).toEqual([]);
    expect(look(core, 'b', 800, clock)).toHaveLength(1);
  });

  it('glancing between two controls never activates either', () => {
    const core = createDwellCore(), clock = { now: 0 };
    let fired = [];
    for (let i = 0; i < 20; i++) fired = fired.concat(look(core, i % 2 ? 'a' : 'b', 900, clock));
    expect(fired).toEqual([]);
  });
});
