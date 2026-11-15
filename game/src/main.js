// RhythmEyez entry point: builds the shared services, runs the frame loop and switches
// screens. Each screen is a module in src/screens/ exporting mount(root, app, params).
import { indexedDbStore, memoryStore } from '../../eye-controller/src/index.js';
import { createGazeInput, SOURCES } from './input/gaze-input.js';
import { createDwell } from './input/dwell.js';
import { createAudioEngine } from './audio/audio-engine.js';
import { createSfx } from './audio/sfx.js';
import { createMusic } from './audio/music.js';
import { createGameStore } from './data/game-store.js';
import { createSupabaseClient, supabaseConfig } from './data/supabase.js';
import { loadSettings, saveSettings } from './data/settings.js';
import { closePopups, toast } from './screens/ui.js';
import title from './screens/title.js';
import calibration from './screens/calibration.js';
import modes from './screens/modes.js';
import characters from './screens/characters.js';
import songs from './screens/songs.js';
import play from './screens/play.js';
import results from './screens/results.js';
import settingsScreen from './screens/settings.js';
import startupError from './screens/startup-error.js';
import faceCheck from './screens/face-check.js';

const SCREENS = { title, calibration, modes, characters, songs, play, results, settings: settingsScreen, startupError, faceCheck };

const params = new URLSearchParams(location.search);
const sourceName = SOURCES[params.get('input')] ? params.get('input') : 'live';

const settings = loadSettings();
const audio = createAudioEngine(settings);
const sfx = createSfx(audio);
const music = createMusic(audio);
const gaze = createGazeInput(sourceName, { mouseMode: () => settings.mouseMode, pool: settings.usePool });
const dwell = createDwell({ ring: document.getElementById('dwell-ring'), sfx });
const remoteCfg = supabaseConfig();
const store = createGameStore(safeIndexedDb(), remoteCfg ? createSupabaseClient(remoteCfg) : null);
store.flushOutbox().catch(() => {});

const root = document.getElementById('app');
let current = null, currentName = null;

const app = {
  gaze, dwell, audio, sfx, music, store, settings,
  session: { modeId: null, characterId: settings.characterId, songId: null, songsPlayed: 0, calibratedThisSession: false, failedCalibrations: 0 },
  saveSettings() { saveSettings(settings); audio.setVolumes(settings); },
  toast,
  get screen() { return currentName; },
  /** Switch screen. Unmounts the current one first; any music it left playing is stopped. */
  go(name, screenParams = {}) {
    closePopups();
    current?.unmount?.();
    root.replaceChildren();
    dwell.reset();
    currentName = name;
    current = SCREENS[name](root, app, screenParams) ?? {};
  },
};

// ---- frame loop: gaze -> dwell -> cursor -> screen ----
const cursor = document.getElementById('gaze-cursor');
function frame(now) {
  const g = gaze.update();
  dwell.update(g);
  cursor.classList.toggle('show', settings.showGazeCursor && gaze.calibrated && currentName !== 'calibration' && currentName !== 'faceCheck');
  cursor.classList.toggle('lost', !g.valid);
  cursor.style.left = `${g.x * innerWidth}px`; cursor.style.top = `${g.y * innerHeight}px`;
  current?.frame?.(now);
  requestAnimationFrame(frame);
}

function showSource() {
  const badge = document.getElementById('input-badge'), info = gaze.sourceInfo;
  badge.textContent = info.label;
  badge.classList.toggle('dev', info.dev);
  badge.classList.toggle('warn', !!info.warn);
}

// ---- testing keys (never required to play) ----
addEventListener('keydown', e => {
  if (e.key === 'Escape') current?.onEscape?.();
  else current?.onKey?.(e.key.toLowerCase());
});

function safeIndexedDb() {
  try { if (globalThis.indexedDB) return indexedDbStore('rhythmeyez'); } catch { /* blocked */ }
  return memoryStore();
}

// dev builds only: lets automated browser tests read the game state
if (import.meta.env?.DEV) globalThis.__rhythmeyez = app;

gaze.onSourceChange(showSource);
showSource();
requestAnimationFrame(frame);
try {
  await gaze.init(document.getElementById('camera'));
  if (gaze.eyes && sourceName === 'live') await gaze.loadProfile();   // a saved calibration makes the menus usable straight away
  app.go('title');
} catch (error) {
  app.go('startupError', { error });
}
