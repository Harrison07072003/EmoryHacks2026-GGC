// Downloads the MediaPipe Face Landmarker model into public/mediapipe/ so tracking works
// offline. Run once:  npm run fetch-model
// Without it the app still works: it falls back to fetching the model from Google at runtime.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public/mediapipe');
const file = join(dir, 'face_landmarker.task');

if (existsSync(file) && !process.argv.includes('--force')) {
  console.log(`Already present: ${file} (use --force to re-download)`);
} else {
  const res = await fetch(URL_);
  if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1_000_000) { console.error(`Download looks wrong: only ${bytes.length} bytes`); process.exit(1); }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, bytes);
  console.log(`Saved ${(bytes.length / 1e6).toFixed(1)} MB to ${file}`);
}
