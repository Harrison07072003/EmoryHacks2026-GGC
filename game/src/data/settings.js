// Player settings, kept in this browser (localStorage). Small and per-device by design.
import { AUDIO_DEFAULTS, MOUSE } from '../config/game-config.js';

const KEY = 'rhythmeyez:settings';
const DEFAULTS = {
  ...AUDIO_DEFAULTS,
  showGazeCursor: true,
  shareTrackingData: false,   // opt-in: store per-frame gaze measurements for improving the tracker
  playerId: 'player1',
  characterId: null,          // null = use the mode's character
  mouseMode: MOUSE.defaultMode, // 'emergency' | 'assist' | 'off' (see MOUSE in game-config.js)
};

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked: settings last this session only */ }
}
