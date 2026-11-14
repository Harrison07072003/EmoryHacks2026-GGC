// Copies the MediaPipe wasm runtime out of node_modules so the dev server serves it locally
// (no CDN needed at demo time). Runs automatically after `npm install`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const to = join(root, 'public/mediapipe/wasm');
if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log('MediaPipe wasm copied to public/mediapipe/wasm');
}
