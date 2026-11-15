import { defineConfig } from 'vite';
import { saveRecordings } from './scripts/save-recordings-plugin.mjs';

// Same port as the game (game/vite.config.js): browser storage is per port, so calibrations,
// profiles and the pooled baseline made on the debug page are the ones the game sees.
// Run one dev server at a time.
export default defineConfig({
  plugins: [saveRecordings()],
  server: { port: 5190, strictPort: true },
  build: { rollupOptions: { input: { index: 'index.html', debug: 'debug.html' } } },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
