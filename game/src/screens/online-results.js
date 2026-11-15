// Online Library, screen 4: the top 5 songs for the current search.
//
// - Resting the gaze (or the pointer) on a song plays its first 10 s right away; looking away
//   stops it. Only the bytes for those 10 s are downloaded.
// - Each row has a "Choose" area: a 2 s dwell (the fill shows progress) confirms the song.
//   A voice "choose 3" asks for confirmation first, so nothing is picked by accident.
// - Every row shows artist and license attribution.
import { esc, gazeButton, html, popup } from './ui.js';
import { formatDuration, getOnline, PREVIEW_SEC, queryLabel } from '../online/session.js';
import { micToggle, notice, searchField, wireVoice } from '../online/ui.js';

const LOOK_AWAY_GRACE_MS = 250;   // gaze is noisy: a glance off the row this short keeps the preview

export default function onlineResults(root, app) {
  const online = getOnline(app);
  const el = html(`
    <section class="screen online-results">
      <h2>Top songs</h2>
      <div class="os-slot"></div>
      <div class="os-results" aria-live="polite"></div>
      <p class="os-status" role="status"></p>
    </section>`);
  root.appendChild(el);
  const field = searchField(online.query.genre ? queryLabel(online.query) : online.query.q);
  el.querySelector('.os-slot').appendChild(field.el);
  const list = el.querySelector('.os-results');
  const back = () => app.go('onlineSearch');
  el.appendChild(Object.assign(gazeButton('◀ Back', back, { sound: 'back' }), { className: 'gbtn small purple top-left' }));
  const mic = online.search.available ? micToggle(app) : null;
  if (mic) el.appendChild(Object.assign(mic.el, { className: `${mic.el.className} top-right` }));

  let songs = [], rows = [], gone = false, confirmPopup = null;

  // ---- search ----
  list.appendChild(html('<div class="os-loading">Searching…</div>'));
  online.search.search(online.query).then(res => {
    if (gone) return;
    songs = res.songs;
    list.replaceChildren();
    if (!songs.length) {
      list.appendChild(notice('No songs found', 'Try another word or genre, or say “back”.'));
      return;
    }
    rows = songs.map((song, i) => renderRow(song, i));
    rows.forEach(r => list.appendChild(r));
  }).catch(() => {
    if (gone) return;
    list.replaceChildren(notice('Online search is unavailable right now', 'Check your connection and try again. The built-in songs still work.'));
  });

  function renderRow(song, i) {
    const row = html(`
      <div class="os-song" data-index="${i}" data-song-id="${esc(song.id)}">
        <div class="os-num">${i + 1}</div>
        <div class="os-info">
          <div class="os-title">${esc(song.title)}</div>
          <div class="os-meta">${esc(song.artist)} · ${esc(song.genre.slice(0, 2).join(', ') || 'no genre')} · ${formatDuration(song.duration)}
            <span class="os-license">${esc(song.licenseName)}</span>${song.chartStatus === 'ready' ? '<span class="os-ready" title="Level already generated">⚡ ready</span>' : ''}<span class="os-tag"></span></div>
          <div class="os-attr">${esc(song.attribution)}</div>
        </div>
      </div>`);
    const choose = gazeButton('Choose', () => choose_(song), { cls: 'os-choose' });
    choose.setAttribute('aria-label', `Choose ${song.title}: look here for 2 seconds`);
    row.appendChild(choose);
    row.addEventListener('pointerenter', () => { pointerRow = i; });
    row.addEventListener('pointerleave', () => { if (pointerRow === i) pointerRow = null; });
    return row;
  }

  // ---- hover preview: gaze or pointer over a row ----
  let pointerRow = null, hovered = null, leaveTimer = null, previewAbort = null;
  function rowAtGaze() {
    const g = app.gaze.gaze;
    if (!g?.valid) return null;
    const x = g.x * innerWidth, y = g.y * innerHeight;
    const i = rows.findIndex(r => { const b = r.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; });
    return i < 0 ? null : i;
  }
  function setHovered(i) {
    if (i === hovered) { clearTimeout(leaveTimer); leaveTimer = null; return; }
    if (i === null) {   // looked away: stop after a short grace
      leaveTimer ??= setTimeout(() => { leaveTimer = null; hovered = null; stopPreview(); }, LOOK_AWAY_GRACE_MS);
      return;
    }
    clearTimeout(leaveTimer); leaveTimer = null;
    hovered = i;
    startPreview(i);
  }
  function startPreview(i) {
    stopPreview();
    const song = songs[i], row = rows[i];
    row.classList.add('previewing');
    row.querySelector('.os-tag').textContent = '♪ loading';
    const abort = previewAbort = new AbortController();
    online.segments.get(song, PREVIEW_SEC, { signal: abort.signal }).then(buffer => {
      if (abort.signal.aborted || hovered !== i || gone) return;
      row.querySelector('.os-tag').textContent = '♪ preview';
      const handle = app.music.start(buffer, { offset: 0, duration: Math.min(PREVIEW_SEC, buffer.duration), fadeIn: 0.05, fadeOut: 0.5 });
      handle.src.addEventListener?.('ended', () => { if (hovered === i) row.querySelector('.os-tag').textContent = ''; });
    }).catch(e => {
      if (abort.signal.aborted || gone) return;
      row.querySelector('.os-tag').textContent = '';
      if (e?.name !== 'AbortError') app.toast(`Could not load a preview of ${song.title}`);
    });
  }
  function stopPreview() {
    previewAbort?.abort(); previewAbort = null;
    rows.forEach(r => { r.classList.remove('previewing'); r.querySelector('.os-tag').textContent = ''; });
    app.music.stop(0.25);
  }

  // ---- choosing ----
  function choose_(song) {
    stopPreview();
    confirmPopup?.close(); confirmPopup = null;
    online.chosen = song;
    app.go('onlinePrepare', { song });
  }
  function askToChoose(i) {
    const song = songs[i];
    if (!song) { app.toast(songs.length ? `Say a number from 1 to ${songs.length}` : 'No songs to choose'); return; }
    setHovered(i);
    confirmPopup = popup({
      title: `Play ${esc(song.title)}?`,
      text: `${esc(song.artist)} · ${esc(song.licenseName)}<br>Say “yes” or look at Yes.`,
      buttons: [
        { label: 'Yes', onPress: () => { confirmPopup = null; choose_(song); } },
        { label: 'No', cls: 'purple', sound: 'back', onPress: () => { confirmPopup = null; } },
      ],
    });
  }

  const unwire = wireVoice(app, {
    field, statusEl: el.querySelector('.os-status'), baseText: () => '',
    onCommand: cmd => {
      if (cmd.type === 'back') { if (confirmPopup) { confirmPopup.close(); confirmPopup = null; } else back(); return true; }
      if (cmd.type === 'choose') { askToChoose(cmd.n ? cmd.n - 1 : hovered ?? -1); return true; }
      if (cmd.type === 'confirm') { confirmPopup?.el.querySelector('.gbtn')?.click(); return true; }
      if (cmd.type === 'cancel') { confirmPopup?.close(); confirmPopup = null; return true; }
      return false;
    },
  });

  return {
    // no previews for rows behind an open popup (the app is inert while one is shown)
    frame() { if (rows.length && !root.inert) setHovered(pointerRow ?? rowAtGaze()); },
    onEscape: back,
    unmount() { gone = true; clearTimeout(leaveTimer); previewAbort?.abort(); unwire(); mic?.dispose(); app.music.stop(0.3); },
  };
}
