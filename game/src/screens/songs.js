// Song select. Resting the gaze on a song plays an ~8 s preview (one at a time); a 2 s
// dwell opens the "Play this song?" popup, and YES starts it.
import { CALIBRATION, DWELL, MODES, PREVIEW } from '../config/game-config.js';
import { CHARACTERS } from '../characters/characters.js';
import { SONGS } from '../songs/index.js';
import { esc, gazeButton, html, popup } from './ui.js';

/** Start a song: recalibrates first when another song was already played this session. */
export function startSong(app, songId) {
  app.session.songId = songId;
  const between = app.session.songsPlayed > 0 && CALIBRATION.betweenSongs !== 'off' && app.gaze.eyes && !app.gaze.mouseOverride;
  if (between) app.go('calibration', { kind: CALIBRATION.betweenSongs, next: 'play' });
  else app.go('play');
}

export default function songs(root, app) {
  if (!app.session.modeId) { queueMicrotask(() => app.go('modes')); return {}; }
  const mode = MODES[app.session.modeId], character = CHARACTERS[app.session.characterId];
  const el = html(`
    <section class="screen">
      <h2>Choose a song</h2>
      <p class="hint">${esc(mode.label)} mode · ${esc(character.name)} · rest your eyes on a song to hear it, hold for 2 s to pick it</p>
      <div class="song-list"></div>
    </section>`);
  root.appendChild(el);
  el.appendChild(Object.assign(gazeButton('◀ Modes', () => app.go('modes'), { sound: 'back' }), { className: 'gbtn small purple top-left' }));
  el.appendChild(Object.assign(gazeButton('Character', () => app.go('characters', { back: 'songs' })), { className: 'gbtn small purple top-right' }));

  const list = el.querySelector('.song-list'), cards = new Map();
  for (const song of SONGS) {
    const card = html(`
      <button class="song-card" data-gaze data-song="${esc(song.id)}" style="--sc:${song.palette.accent};--sc2:${song.palette.lane}">
        <div class="disc"></div>
        <div><div class="song-title">${esc(song.title)}</div>
          <div class="song-meta">${esc(song.subtitle)} · ${song.bpm} BPM · ${Math.round(song.durationSec)} s</div>
          <div class="preview-tag" data-tag></div></div>
        <div class="best" data-best>best<b>–</b></div>
      </button>`);
    card.addEventListener('click', () => confirm(song));
    cards.set(song.id, card);
    list.appendChild(card);
  }
  app.store.bestScores().then(best => {
    for (const [id, card] of cards) {
      const b = best[`${id}:${mode.id}`];
      if (b) card.querySelector('[data-best]').innerHTML = `best<b>${b.score.toLocaleString()}</b>${b.grade}`;
    }
  }).catch(() => {});

  // ---- previews: one at a time, after the gaze settles on a song ----
  let hoverTimer = null, previewing = null;
  function preview(song) {
    if (previewing === song.id) return;
    previewing = song.id;
    cards.forEach((c, id) => { c.classList.toggle('previewing', id === song.id); c.querySelector('[data-tag]').textContent = id === song.id ? '♪ PREVIEW' : ''; });
    app.music.load(song.audioUrl).then(buf => {
      if (previewing === song.id) app.music.preview(buf, song.previewStart ?? 0, song.previewSec ?? PREVIEW.durationSec, PREVIEW.fadeSec);
    }).catch(() => app.toast(`Could not load ${song.title}`));
  }
  const offHover = app.dwell.onHover(target => {
    clearTimeout(hoverTimer);
    const song = SONGS.find(s => s.id === target?.dataset?.song);
    if (song) hoverTimer = setTimeout(() => preview(song), DWELL.previewDelayMs);
  });
  for (const song of SONGS) cards.get(song.id).addEventListener('pointerenter', () => preview(song));

  function confirm(song) {
    popup({
      title: `Play ${esc(song.title)}?`,
      text: `${esc(mode.label)} mode`,
      buttons: [
        { label: 'Yes', onPress: () => { app.music.stop(0.3); startSong(app, song.id); } },
        { label: 'No', cls: 'purple', sound: 'back', onPress: () => {} },
      ],
    });
  }

  return {
    onEscape: () => app.go('modes'),
    unmount() { offHover(); clearTimeout(hoverTimer); app.music.stop(0.4); },
  };
}
