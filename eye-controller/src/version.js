// Versions recorded with collected data, so samples from different builds are never mixed
// by accident. test/telemetry.test.js fails if these drift from package.json.
import { FEATURE_VERSION } from './cv/features.js';

export const VERSIONS = {
  app: '0.5.1',          // 0.4 face view and screens; 0.5 gaze-checked hops; 0.5.1 gaze-checked dots
  features: FEATURE_VERSION,
  mediapipeRuntime: '1.2.3',
  mediapipeModel: 'face_landmarker/float16/1',
};
