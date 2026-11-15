// Versions recorded with collected data, so samples from different builds are never mixed
// by accident. test/telemetry.test.js fails if these drift from package.json.
import { FEATURE_VERSION } from './cv/features.js';

export const VERSIONS = {
  app: '0.6.0',          // 0.5 gaze-checked hops; 0.5.1 gaze-checked dots; 0.6 themes + eye-pressable screens (game merged)
  features: FEATURE_VERSION,
  mediapipeRuntime: '1.2.3',
  mediapipeModel: 'face_landmarker/float16/1',
};
