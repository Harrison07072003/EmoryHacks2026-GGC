// Load game/.env (then .env.local) into process.env for Node scripts, without a dependency.
// Variables already set in the shell win.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GAME_DIR = fileURLToPath(new URL('..', import.meta.url));

export function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = `${GAME_DIR}${name}`;
    if (existsSync(file)) process.loadEnvFile(file);   // never overrides variables that are already set
  }
  return process.env;
}

export const envFlag = (v, fallback = false) => (v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v));
