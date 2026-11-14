// MediaPipe Face Landmarker setup. The wasm runtime is served locally (copied from
// node_modules by `npm install`). The model file is used from public/mediapipe/ when it
// has been placed there, otherwise it is fetched from Google's model storage.
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const base = () => new URL(`${import.meta.env?.BASE_URL ?? '/'}mediapipe/`, location.href).href;

async function localModelIfPresent() {
  const url = `${base()}face_landmarker.task`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    // the dev server answers unknown paths with index.html, so check the type too
    if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) return url;
  } catch { /* fall through to the remote model */ }
  return REMOTE_MODEL;
}

export async function createLandmarker({ wasmPath, modelUrl } = {}) {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(wasmPath ?? `${base()}wasm`);
  const model = modelUrl ?? (await localModelIfPresent());
  const options = delegate => ({
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  });
  try { return await FaceLandmarker.createFromOptions(fileset, options('GPU')); }
  catch { return FaceLandmarker.createFromOptions(fileset, options('CPU')); }
}
