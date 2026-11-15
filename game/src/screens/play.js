// The play screen: song clock, judging, scoring, effects, character, pause/quit.
// When tracking drifts (live quality stays low) the song pauses and goes straight into a quick
// recalibration after a 3 s notice (cancel = resume); it runs on top of the song and resumes it.
// When the face is gone the song pauses; the pause menu also offers Quick recalibrate.
//
// Song time comes from the AudioContext clock (the same clock that plays the music), minus
// the output latency and the player's offset setting, so notes line up with what is heard.
// If the browser is still blocking audio, the song plays silently on performance.now().
import { COUNTDOWN_SEC, DRIFT, INPUT, LEAD_IN_SEC, MODES, PAUSE } from '../config/game-config.js';
import { runEngineCalibration } from '../input/calibration-flow.js';
import { CHARACTERS } from '../characters/characters.js';
import { mountPortrait, startBlinking } from '../characters/portrait.js';
import { songById, loadChart } from '../songs/index.js';
import { createJudge } from '../gameplay/judge.js';
import { createScoring } from '../gameplay/scoring.js';
import { createTrackingStats } from '../gameplay/tracking-stats.js';
import { pathX } from '../gameplay/chart.js';
import { targetPoint } from '../gameplay/zones.js';
import { createGeometry } from '../render/geometry.js';
import { createHighway } from '../render/highway.js';
import { buildResult } from './results.js';
import { createTelemetry } from '../../../eye-controller/src/index.js';
import { esc, gazeButton, html, popup } from './ui.js';

export default function play(root, app) {
  const song = songById(app.session.songId), mode = MODES[app.session.modeId];
  if (!song || !mode) { queueMicrotask(() => app.go('songs')); return {}; }
  const character = CHARACTERS[app.session.characterId] ?? CHARACTERS[mode.characterId];
  const { audio, music, sfx, gaze } = app;
  const pal = song.palette;

  const el = html(`
    <section class="play" data-danger="0" style="--song-bg1:${pal.bg1};--song-bg2:${pal.bg2};--song-lane:${pal.lane};--song-accent:${pal.accent}">
      <canvas></canvas>
      <div class="danger-vignette"></div>
      <div class="hud-song"><b>${esc(song.title)}</b>${esc(mode.label)}</div>
      <div class="hud-top"><div class="hud-score">0</div><div class="hud-combo"></div></div>
      <div class="danger-label">DANGER</div>
      <div class="frenzy-banner"><b>FRENZY</b><small>DOUBLE POINTS · NO DAMAGE</small><div class="timer"><i></i></div></div>
      ${mode.failEnabled ? '<div class="health"><i></i></div><div class="health-label">HP</div>' : ''}
      <div class="frenzy-meter"><i></i><span>FRENZY</span></div>
      <div class="warn-strip">Face not visible: look at the screen</div>
      <div class="countdown"></div>
    </section>`);
  root.appendChild(el);
  const $ = s => el.querySelector(s);
  const portrait = mountPortrait(el, character);
  portrait.classList.add('character');
  const stopBlink = startBlinking(portrait);
  el.appendChild(gazeButton('Pause', () => pause(), { cls: 'purple small pause-btn' }));
  el.appendChild(gazeButton('Quit', () => confirmQuit(), { cls: 'danger small quit-btn', sound: 'back' }));

  let state = 'loading', chart, judge, scoring, highway, buffer = null, stats, telemetry = null;
  let clock = null, faceLostSince = null, driftSince = null, resumeAt = null, lastT = -LEAD_IN_SEC, countdownUntil = 0, lastCount = null;
  const noteState = new Map(), curveDone = new Set();
  const latency = () => (INPUT.gazeLatencyMs[gaze.latencyKey] ?? 0) / 1000;

  // ---- clock ----
  function startClock(songTimeNow, withAudio) {
    if (withAudio && buffer) {
      const ctx = audio.ctx, c0 = ctx.currentTime + 0.05, startAt = c0 - songTimeNow;   // context time at which song time = 0
      // song time < 0 (lead-in): the audio starts later at offset 0; otherwise right away, part-way in
      music.start(buffer, { when: Math.max(c0, startAt), offset: Math.max(0, songTimeNow) });
      clock = () => ctx.currentTime - startAt - audio.outputLatency + app.settings.offsetMs / 1000;
    } else {
      const startPerf = performance.now() + 50 - songTimeNow * 1000;
      clock = () => (performance.now() - startPerf) / 1000 + app.settings.offsetMs / 1000;
    }
  }
  const songTime = () => (clock ? clock() : -LEAD_IN_SEC);

  async function setup() {
    try {
      chart = await loadChart(song, mode.id);
      buffer = await music.load(song.audioUrl).catch(() => null);
    } catch (e) { app.toast(`Could not load this song: ${e.message}`); app.go('songs'); return; }
    if (state === 'gone') return;
    const geometry = createGeometry(mode.approachSec);
    highway = createHighway($('canvas'), { geometry, palette: pal, bpm: song.bpm });
    judge = createJudge(chart, mode);
    scoring = createScoring(mode);
    stats = createTrackingStats(mode);
    if (app.settings.shareTrackingData && gaze.source === 'live' && gaze.eyes) {
      telemetry = createTelemetry(gaze.eyes, {
        send: app.store.trackingSink(),
        session: { player_id: app.settings.playerId, song_id: song.id, difficulty: mode.id, game_version: '1.0.0', consent: true },
      });
    }
    if (!buffer) app.toast('Music could not be loaded: playing without sound');
    else if (!audio.running) app.toast('Sound is blocked until a click or key press: playing silently');
    countdown(COUNTDOWN_SEC);
  }

  function countdown(sec) {
    state = 'countdown';
    countdownUntil = performance.now() + sec * 1000;
    lastCount = null;
  }

  function begin() {
    state = 'playing';
    $('.countdown').replaceChildren();
    startClock(resumeAt ?? -LEAD_IN_SEC, audio.running);
    sfx.play('go');
  }

  // ---- pause / quit ----
  /** Freeze the song. Returns false if there is nothing to pause. */
  function halt() {
    if (state !== 'playing' && state !== 'countdown') return false;
    if (state === 'playing') resumeAt = songTime() - PAUSE.resumeRewindSec;   // resume a little early so the player can find the notes again
    state = 'paused';
    music.stop(0.08);
    clock = null;
    gaze.setTarget(null);
    return true;
  }
  const resume = () => countdown(resumeAt === null ? COUNTDOWN_SEC : PAUSE.resumeCountdownSec);

  const canRecalibrate = () => !!gaze.eyes && !gaze.manualMouse;

  function pause(reason = '') {
    if (!halt()) return;
    popup({
      title: 'Paused',
      text: reason || `${esc(song.title)} · ${esc(mode.label)}`,
      buttons: [
        { label: 'Resume', onPress: resume },
        ...(canRecalibrate() ? [{ label: 'Quick recalibrate', cls: 'purple', onPress: recalibrateAndResume }] : []),
        { label: 'Songs', cls: 'purple', sound: 'back', onPress: () => app.go('songs') },
        { label: 'Home', cls: 'danger', sound: 'back', onPress: () => app.go('title') },
      ],
    });
  }

  /** Pause, show a short notice (cancel = resume), then recalibrate on top of the song. */
  function driftRecalibrate() {
    if (!canRecalibrate() || !halt()) return;
    let left = DRIFT.noticeSec, timer = 0;
    const notice = popup({
      title: 'Tracking drifted',
      text: `Recalibrating in <b data-left>${left}</b>… (you may have moved, or the light changed)`,
      buttons: [{ label: 'Cancel', cls: 'purple', onPress: () => { clearInterval(timer); resume(); } }],
    });
    timer = setInterval(() => {
      left--;
      const el = notice.el.querySelector('[data-left]');
      if (el) el.textContent = left;
      if (left > 0) return;
      clearInterval(timer);
      notice.close();
      recalibrateAndResume();
    }, 1000);
  }

  /** The engine's quick calibration on top of the paused song, then a short countdown back in. */
  async function recalibrateAndResume() {
    state = 'recalibrating';
    const r = await runEngineCalibration(app, { quick: true });
    if (state === 'gone') return;
    state = 'paused';
    if (r.aborted) return pause('Recalibration cancelled.');
    if (gaze.mouseLocked) app.toast('Playing with the mouse: eye input comes back when a calibration passes', 4000);
    driftSince = null; faceLostSince = null;
    resume();
  }

  function confirmQuit() {
    if (!halt()) return;
    popup({
      title: 'Quit this song?',
      text: 'Your progress in this song will be lost.',
      buttons: [
        { label: 'Keep playing', onPress: resume },
        { label: 'Song select', cls: 'danger', sound: 'back', onPress: () => app.go('songs') },
        { label: 'Home', cls: 'danger', sound: 'back', onPress: () => app.go('title') },
      ],
    });
  }

  // ---- judgments ----
  function onJudgment(j, t) {
    const frenzyBefore = scoring.state.frenzyActive;
    const events = scoring.apply(j.judgment, t);
    if (j.note.type === 'straight') noteState.set(j.note.id, { judgment: j.judgment, at: t });
    highway.addJudgment(j, frenzyBefore);
    sfx.play(j.judgment);
    if (j.judgment === 'perfect' && j.note.type === 'straight' && INPUT.refineOnPerfect) gaze.confirmOnTarget(targetPoint(j.note, t, pathX));
    for (const e of events) {
      if (e === 'frenzyStart') { sfx.play('frenzy'); el.classList.add('frenzy'); portrait.classList.add('frenzy'); }
      if (e === 'danger') el.dataset.danger = String(Math.min(2, scoring.state.danger));
      if (e === 'fail') fail(t);
    }
  }

  function currentTarget(jt) {
    for (const n of chart.notes) {
      if (n.type === 'curve' && jt >= n.t - 0.3 && jt <= n.end) return { note: n, point: targetPoint(n, jt, pathX) };
      if (n.type === 'straight' && !noteState.has(n.id) && n.t - jt < 0.6) return { note: n, point: targetPoint(n, jt, pathX) };
      if (n.t > jt + 0.6) break;
    }
    return null;
  }

  // ---- end of song ----
  function finishOrFail(failed, t) {
    state = failed ? 'failed' : 'finished';
    gaze.setTarget(null);
    telemetry?.stop();
    el.classList.remove('frenzy'); portrait.classList.remove('frenzy');
    const result = buildResult({ song, mode, character, scoring: scoring.state, chart, failed, songTime: t, stats: stats.summary(), gaze, settings: app.settings });
    app.session.songsPlayed++;
    app.store.saveResult(result).catch(e => app.toast(`Result not saved: ${e.message}`));
    setTimeout(() => { if (state !== 'gone') app.go('results', { result }); }, failed ? 1600 : 1400);
  }
  function fail(t) {
    music.windDown(1.3);
    sfx.play('fail');
    finishOrFail(true, t);
  }

  setup();
  app.debugPlay = { songTime, chart: () => chart, state: () => state, scoring: () => scoring?.state, latency };

  return {
    frame(now) {
      if (!highway) return;
      const t = state === 'playing' ? (lastT = songTime()) : state === 'finished' || state === 'failed' ? lastT : resumeAt ?? -LEAD_IN_SEC;
      if (state === 'countdown') {
        const left = Math.ceil((countdownUntil - now) / 1000);
        if (left !== lastCount && left > 0) { lastCount = left; $('.countdown').innerHTML = `<b>${left}</b>`; sfx.play('count'); }
        if (now >= countdownUntil) begin();
      }
      // auto-pause when the player's face has been gone for a while (eye tracking only)
      const tracking = gaze.eyes && !gaze.mouseOverride;
      faceLostSince = state === 'playing' && tracking && PAUSE.autoPauseOnFaceLostSec > 0 && !gaze.faceVisible ? (faceLostSince ?? now) : null;
      if (faceLostSince !== null && now - faceLostSince > PAUSE.autoPauseOnFaceLostSec * 1000) {
        faceLostSince = null;
        pause('Your face left the camera view. Sit back in front of the camera, then look at Resume.');
      }
      // tracking drifted (head moved, light changed): straight into a quick recalibration
      driftSince = state === 'playing' && tracking && gaze.faceVisible && gaze.quality < DRIFT.qualityBelow ? (driftSince ?? now) : null;
      if (driftSince !== null && now - driftSince > DRIFT.sustainSec * 1000) { driftSince = null; driftRecalibrate(); }
      if (state === 'playing') {
        const jt = t - latency();
        for (const j of judge.update(jt, gaze.gaze)) { onJudgment(j, t); if (state !== 'playing') break; }
        for (const e of scoring.tick(t)) if (e === 'frenzyEnd') { el.classList.remove('frenzy'); portrait.classList.remove('frenzy'); }
        const target = currentTarget(jt);
        gaze.setTarget(target?.point ?? null, target?.note.id ?? null);
        stats.add(target, gaze.gaze, gaze.cell, jt);
        if (state === 'playing' && judge.isDone() && t > chart.duration + 0.8) { sfx.play('complete'); finishOrFail(false, t); }
      }
      // HUD
      const s = scoring.state;
      $('.hud-score').textContent = s.score.toLocaleString();
      $('.hud-combo').textContent = s.combo >= 3 ? `${s.combo} COMBO` : '';
      el.querySelector('.health')?.style.setProperty('--hp', (s.health / 100).toFixed(3));
      const meter = $('.frenzy-meter');
      meter.style.setProperty('--fz', (s.frenzyActive ? scoring.frenzyLeft(t) : s.frenzy / 100).toFixed(3));
      meter.classList.toggle('full', s.frenzyActive);
      $('.frenzy-banner .timer').style.setProperty('--left', scoring.frenzyLeft(t).toFixed(3));
      $('.warn-strip').classList.toggle('show', state === 'playing' && !gaze.faceVisible);
      // character moves with the beat
      const beat = 60 / song.bpm, phase = ((t % beat) + beat) % beat / beat;
      const bounce = state === 'playing' ? Math.pow(1 - phase, 3) : 0;
      portrait.style.setProperty('--bob', `${(-8 * bounce).toFixed(2)}px`);
      portrait.style.setProperty('--pulse', (1 + (s.frenzyActive ? 0.05 : 0.02) * bounce).toFixed(3));

      highway.draw({ now: t, notes: chart.notes, noteState, curveOnPath: judge.curveOnPath(), curveDone, gaze: gaze.gaze, activeLanes: judge.activeLanes(), frenzy: s.frenzyActive });
    },
    onEscape: () => { if (state === 'recalibrating') gaze.eyes?.cancelCalibration(); else pause(); },
    onKey: key => { if (key === 'p') pause(); },
    unmount() {
      if (['playing', 'countdown', 'paused', 'recalibrating'].includes(state)) telemetry?.stop();
      state = 'gone';
      music.stop(0.2);
      gaze.setTarget(null);
      stopBlink();
      highway?.destroy();
    },
  };
}
