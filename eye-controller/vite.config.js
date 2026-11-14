import { defineConfig } from 'vite';
import { saveRecordings } from './scripts/save-recordings-plugin.mjs';

export default defineConfig({
  plugins: [saveRecordings()],
  build: { rollupOptions: { input: { index: 'index.html', debug: 'debug.html' } } },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
