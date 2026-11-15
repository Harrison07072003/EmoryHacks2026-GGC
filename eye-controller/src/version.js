// Versions recorded with collected data, so samples from different builds are never mixed
// by accident. test/telemetry.test.js fails if these drift from package.json.
import { FEATURE_VERSION } from './cv/features.js';

export const VERSIONS = {
  app: '0.4.0',          // 0.2 moving dot; 0.3 band hops + learning on hits; 0.4 face view, face check, result screen
  features: FEATURE_VERSION,
  mediapipeRuntime: '1.2.3',
  mediapipeModel: 'face_landmarker/float16/1',
};
