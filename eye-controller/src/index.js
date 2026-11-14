// Public entry point. The game imports from here and nowhere else.
//
//   import { createMockEyeController } from './src/index.js';   // simulated eyes
//   import { createEyeController } from './src/index.js';       // live webcam
//
// Both return the same object: see README.md, "Public interface".
import { buildController } from './controller.js';
import { CameraSource } from './capture/camera-source.js';

export { createMockEyeController } from './mock.js';
export { buildController } from './controller.js';
export { memoryStore, localStorageStore, indexedDbStore } from './storage/kv.js';
export { createRecorder, saveRecording, ReplaySource } from './simulator/recording.js';
export { saveJson, downloadJson } from './ui/save-file.js';
export { createTelemetry } from './telemetry/telemetry.js';
export { VERSIONS } from './version.js';
export { evaluateRecording } from './simulator/evaluate.js';

/**
 * Live webcam eye-controller.
 * @param options  layout { lanes, bandSplit }, minScore (default 60), storage, profileId,
 *                 camera { settings, modelUrl, wasmPath }
 */
export function createEyeController(options = {}) {
  const source = new CameraSource(options.camera);
  const eyes = buildController(source, options);
  /** Camera tuning (brightness, contrast, gamma, equalize, zoom, pan): see README. */
  eyes.camera = source;
  return eyes;
}
