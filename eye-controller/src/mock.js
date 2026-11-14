// Mock eye-controller: the full contract, driven by the gaze simulator instead of a camera.
// In a browser the fake eyes follow the mouse; headless they follow a script.
import { buildController } from './controller.js';
import { SyntheticSource } from './simulator/synthetic-source.js';
import { defaultTargets } from './calibration/targets.js';
import { memoryStore } from './storage/kv.js';

/**
 * @param options  drive, noise ('ideal' | 'realistic'), seed, fps, clock ('auto' | 'manual'),
 *                 autoCalibrate (default true: ready to play right after init),
 *                 plus everything createEyeController accepts.
 */
export function createMockEyeController(options = {}) {
  const source = new SyntheticSource(options);
  const eyes = buildController(source, { storage: memoryStore(), ...options });
  const init = eyes.init;
  eyes.init = async videoEl => {
    await init(videoEl);
    if (options.autoCalibrate !== false) eyes.debug.applyPoints(source.instantPoints(defaultTargets(eyes.layout)));
  };
  /** Test hooks that only exist on the mock. */
  eyes.mock = {
    step: ms => source.step(ms),
    lookAt: target => source.lookAt(target),
    setConditions: cond => source.setConditions(cond),
  };
  return eyes;
}
