// Player settings, kept in this browser (localStorage). Small and per-device by design.
import { AUDIO_DEFAULTS, MOUSE } from '../config/game-config.js';

const KEY = 'rhythmeyez:settings';
const DEFAULTS = {
  ...AUDIO_DEFAULTS,
  showGazeCursor: true,
  shareTrackingData: false,   // opt-in: store per-frame gaze measurements for improving the tracker
  playerId: 'player1',
  characterId: null,          // null = use the mode's character
  mouseMode: MOUSE.defaultMode, // 'off' | 'assist' (see MOUSE in game-config.js)
  usePool: false,             // warm-start calibrations from the shared pool of past calibrations
};

export function loadSettings() {
  let s;
  try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { s = { ...DEFAULTS }; }
  // 'emergency' used to be a setting (on by default); it is now offered only after failed calibrations
  if (!['off', 'assist'].includes(s.mouseMode)) s.mouseMode = MOUSE.defaultMode;
  return s;
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked: settings last this session only */ }
}
