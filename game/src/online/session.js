// Online Library state shared by its screens (search -> keyboard -> results), created on first
// use so nothing changes for players who never open it.
import { onlineConfig } from './config.js';
import { createOnlineSearch } from './search-client.js';
import { createSegmentLoader } from './audio-segment.js';
import { createVoiceSession } from './voice-session.js';
import { createVoiceRecognizer } from '../voice/voice-engine.js';
import { parseCommand } from '../voice/commands.js';

export const PREVIEW_SEC = 10;   // hover preview: the first 10 s of the song
export const LEVEL_SEC = 30;     // archive levels use the first 30 s of the song

export function getOnline(app) {
  if (!app.online) {
    const config = onlineConfig();
    const search = createOnlineSearch(config);
    app.online = {
      config, search,
      segments: createSegmentLoader(app.audio.ctx),
      // offline speech by default (?voice=google for Google's); it records through the game's AudioContext
      voice: createVoiceSession(o => createVoiceRecognizer(o, { audioContext: () => app.audio?.ctx })),
      query: { q: '', genre: null },   // the current search: what the results screen shows
      draft: '',                        // keyboard text not yet searched
      genres: [],
    };
    search.genres().then(g => { app.online.genres = g; });
  }
  return app.online;
}

/** Every input (keyboard, gaze, voice) ends up here: set the query and show the results. */
export function runSearch(app, { q = '', genre = null }) {
  const online = getOnline(app);
  online.query = { q: String(q).trim(), genre };
  online.draft = online.query.q;
  app.go('onlineResults');
}

/** Parse a final voice phrase with the genres the index actually has. */
export function parseVoice(app, transcript, opts = {}) {
  return parseCommand(transcript, { genres: getOnline(app).genres, ...opts });
}

/** Commands that mean the same on every Online Library screen. Returns true when handled. */
export function handleCommonVoice(app, cmd) {
  const online = getOnline(app);
  switch (cmd?.type) {
    case 'search': runSearch(app, { q: cmd.q }); return true;
    case 'genre': runSearch(app, { genre: cmd.genre }); return true;
    case 'clear': online.query = { q: '', genre: null }; online.draft = ''; app.go('onlineSearch'); return true;
    case 'keyboard': app.go('onlineKeyboard'); return true;
    case 'stop': online.voice.setOn(false); app.toast('Voice off'); return true;
    default: return false;
  }
}

export const queryLabel = ({ q, genre }) => (genre ? `Genre: ${genre}` : q ? `“${q}”` : 'Most popular');

export const formatDuration = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
