// Downloads the offline speech model (Vosk small English, ~41 MB) into voice-model/ so voice
// works without Google's speech service. Run once:  npm run fetch-voice-model
// Without it the game fetches the same file from MODEL_FALLBACK_URL at runtime (needs internet).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'vosk-model-small-en-us-0.15.tar.gz';
// hosted by the vosk-browser author; same files as alphacephei.com's zip, packed as tar.gz
const URL_ = `https://ccoreilly.github.io/vosk-browser/models/${NAME}`;
const SHA256 = 'f0b24bb92a48ca575b6a96500d6b543f0f079c573dfe85bbe16001fc0404e1d8';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'voice-model');
const file = join(dir, NAME);

if (existsSync(file) && !process.argv.includes('--force')) {
  console.log(`Already present: ${file} (use --force to re-download)`);
} else {
  console.log(`Downloading ${URL_} ...`);
  const res = await fetch(URL_);
  if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
  const bytes = Buffer.from(await res.arrayBuffer());
  const sum = createHash('sha256').update(bytes).digest('hex');
  if (sum !== SHA256) { console.error(`Download looks wrong (sha256 ${sum})`); process.exit(1); }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, bytes);
  console.log(`Saved ${(bytes.length / 1e6).toFixed(1)} MB to ${file}`);
}
