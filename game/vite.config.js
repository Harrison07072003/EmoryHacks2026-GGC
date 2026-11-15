import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

// The game imports the eye engine straight from ../eye-controller/src (its public entry
// point only) and serves that package's public/ folder, which holds the MediaPipe wasm
// runtime and face model at /mediapipe/. Run `npm install` + `npm run fetch-model` in
// eye-controller once so those files exist.
const engine = fileURLToPath(new URL('../eye-controller', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');   // all of game/.env, for this config only
  assertNoSecretsInClient(env);
  // VITE_BASE_PATH: '/' locally; '/<repo-name>/' for GitHub Pages project sites
  const base = env.VITE_BASE_PATH || '/';
  const typesense = `${env.TYPESENSE_PROTOCOL || 'http'}://${env.TYPESENSE_HOST || 'localhost'}:${env.TYPESENSE_PORT || 8108}`;
  const server = `http://localhost:${env.SERVER_PORT || 8787}`;
  const strip = prefix => path => path.slice(prefix.length - 1);

  return {
    base,
    publicDir: `${engine}/public`,
    // A fixed port keeps the same origin (http://localhost:5190) every time. Browser storage is
    // per origin, so a different port would look like a new player: calibration, settings and
    // results would seem to vanish.
    // host: listen on all interfaces so Coder's port forwarding can reach it.
    // allowedHosts: accept Coder's forwarded https address (https://5190--<workspace>.coder...).
    // proxy (dev only): the Online Library reaches Typesense and the game server through this
    // origin, so only port 5190 needs forwarding.
    server: {
      port: 5190, strictPort: true, host: true, allowedHosts: ['.cdr.dev', '.coder.com'], fs: { allow: ['..'] },
      proxy: {
        [`${base}typesense`]: { target: typesense, changeOrigin: true, rewrite: strip(`${base}typesense/`) },
        [`${base}api`]: { target: server, changeOrigin: true, rewrite: strip(`${base}api/`) },
      },
    },
    preview: { port: 5190, strictPort: true },
    resolve: { dedupe: ['@mediapipe/tasks-vision'] },
    test: { environment: 'node', include: ['test/**/*.test.js'] },
  };
});

/** Fail the build if a browser-visible (VITE_) variable holds the Typesense admin key. */
function assertNoSecretsInClient(env) {
  const admin = env.TYPESENSE_ADMIN_API_KEY;
  if (!admin) return;
  const leak = Object.keys(env).find(k => k.startsWith('VITE_') && env[k] === admin);
  if (leak) throw new Error(`${leak} contains the Typesense ADMIN key. Browser code may only get the search-only key.`);
}
