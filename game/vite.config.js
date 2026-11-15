import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The game imports the eye engine straight from ../eye-controller/src (its public entry
// point only) and serves that package's public/ folder, which holds the MediaPipe wasm
// runtime and face model at /mediapipe/. Run `npm install` + `npm run fetch-model` in
// eye-controller once so those files exist.
const engine = fileURLToPath(new URL('../eye-controller', import.meta.url));

export default defineConfig({
  publicDir: `${engine}/public`,
  // A fixed port keeps the same origin (http://localhost:5190) every time. Browser storage is
  // per origin, so a different port would look like a new player: calibration, settings and
  // results would seem to vanish.
  server: { port: 5190, strictPort: true, fs: { allow: ['..'] } },
  preview: { port: 5190, strictPort: true },
  resolve: { dedupe: ['@mediapipe/tasks-vision'] },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
