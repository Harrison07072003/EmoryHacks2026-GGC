import { defineConfig } from 'vite';
export default defineConfig({
  server: { watch: { usePolling: true } },
  build: { rollupOptions: { input: {
    index: 'index.html', piano: 'piano.html', echo: 'echo.html', drums: 'drums.html', horn: 'horn.html',
  } } },
});