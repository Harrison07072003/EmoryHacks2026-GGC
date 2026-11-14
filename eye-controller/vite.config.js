import { defineConfig } from 'vite';

export default defineConfig({
  build: { rollupOptions: { input: { index: 'index.html', debug: 'debug.html' } } },
  test: { environment: 'node', include: ['test/**/*.test.js'] },
});
