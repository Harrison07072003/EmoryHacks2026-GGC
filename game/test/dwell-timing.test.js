import { describe, expect, it } from 'vitest';
import { createDwellCore } from '../src/input/dwell.js';
import { DWELL } from '../src/config/game-config.js';

const FRAME = 1000 / 60;
function run(core, id, ms, clock, timing) {
  const fired = [];
  for (let t = 0; t < ms; t += FRAME) { clock.now += FRAME; const f = core.update(id, FRAME, clock.now, timing); if (f) fired.push(clock.now); }
  return fired;
}

describe('per-target dwell timing', () => {
  it('default buttons still need the full 2 s', () => {
    const core = createDwellCore(), clock = { now: 0 };
    expect(run(core, 'btn', 1900, clock)).toHaveLength(0);
    expect(run(core, 'btn', 200, clock)).toHaveLength(1);
  });

  it('keyboard keys press after 1 s and recover after a short cooldown', () => {
    const core = createDwellCore(), clock = { now: 0 }, key = { activateMs: DWELL.keyActivateMs, cooldownMs: DWELL.keyCooldownMs };
    expect(DWELL.keyActivateMs).toBe(1000);
    expect(run(core, 'k', 900, clock, key)).toHaveLength(0);
    expect(run(core, 'k', 150, clock, key)).toHaveLength(1);
    // the same key needs the gaze to leave first (no accidental repeats); the next key is ready after the cooldown
    expect(run(core, 'k', 1500, clock, key)).toHaveLength(0);
    run(core, null, 50, clock, key);
    const fired = run(core, 'j', 1500, clock, key);
    expect(fired).toHaveLength(1);
  });

  it('a 2 s button after a key still takes 2 s', () => {
    const core = createDwellCore(), clock = { now: 0 };
    run(core, 'k', 1100, clock, { activateMs: 1000, cooldownMs: 300 });
    run(core, null, 1000, clock);
    expect(run(core, 'back', 1800, clock)).toHaveLength(0);
    expect(run(core, 'back', 300, clock)).toHaveLength(1);
  });
});
