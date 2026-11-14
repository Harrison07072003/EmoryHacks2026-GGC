// Data collection for a remote database. It buffers one row per camera frame and hands
// batches to a `send` function you supply (e.g. a Supabase upsert). It knows nothing about
// any particular database, and it never makes the tracker wait: the frame handler only
// pushes to an array.
//
//   const telemetry = createTelemetry(eyes, { send: async message => { ...upsert... } });
//   ...
//   await telemetry.stop();
//
// `send` receives messages in order, each with a stable `id` to upsert on:
//   { type: 'session',     id, ...session info and versions }
//   { type: 'calibration', id, session_id, score, ok, weak_cells, points }
//   { type: 'samples',     id, session_id, seq, samples: [row, ...] }
// If `send` throws, the message stays queued and is retried with the same id, so a retry
// can never create duplicates and nothing is lost silently.
import { VERSIONS } from '../version.js';
import { round } from '../util/math.js';

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const r3 = v => (v === undefined || v === null ? null : round(v, 3));

/** One sample event -> one flat row with database-friendly names. Only values the tracker really has. */
export function toRow(sample) {
  const fr = sample.frame, R = fr.eyes?.R, L = fr.eyes?.L;
  return {
    t: round(fr.t, 1),                      // ms since page load; add session.clock_offset_ms for wall-clock time
    face: !!fr.face, blink: !!fr.blink,
    features: fr.f ? fr.f.map(v => round(v)) : null,   // the 19 model inputs: keep these above all else
    gaze_x: r3(sample.gaze?.x), gaze_y: r3(sample.gaze?.y),
    lane: sample.lane, band: sample.band, quality: sample.quality,
    target_x: r3(sample.target?.x), target_y: r3(sample.target?.y),
    target_id: sample.targetId, target_source: sample.targetSource,
    r_open: r3(R?.open), r_glare: r3(R?.glare), r_contrast: r3(R?.conf), r_light: r3(R?.lum),
    l_open: r3(L?.open), l_glare: r3(L?.glare), l_contrast: r3(L?.conf), l_light: r3(L?.lum),
    eye_shapes: fr.shapes ?? null,        // MediaPipe eyeLook* / squint / wide / blink scores, 0-1
    process_ms: r3(fr.ms),
  };
}

/**
 * @param eyes     an eye-controller (live or mock)
 * @param options  send(message)   async; throw or reject to signal failure
 *                 flushMs         how often to upload (default 1500; 0 = only when flush() is called)
 *                 maxQueued       cap on rows waiting to upload (default 50,000, about 25 minutes);
 *                                 beyond it the oldest batches are dropped and counted in stats.dropped
 *                 session         extra fields for the session message (player, game, song, ...)
 *                 onError(error)  called on every failed upload
 */
export function createTelemetry(eyes, { send, flushMs = 1500, maxQueued = 50000, session = {}, onError = () => {} } = {}) {
  if (typeof send !== 'function') throw new Error('createTelemetry needs a send(message) function');
  const sessionId = uuid(), queue = [], stats = { sent: 0, queued: 0, dropped: 0, failures: 0, lastError: null };
  let buffer = [], seq = 0, sending = null, stopped = false;

  queue.push({
    type: 'session', id: sessionId, started_at: new Date().toISOString(),
    clock_offset_ms: Math.round(Date.now() - (globalThis.performance?.now() ?? 0)),
    app_version: VERSIONS.app, feature_version: VERSIONS.features,
    mediapipe_runtime: VERSIONS.mediapipeRuntime, mediapipe_model: VERSIONS.mediapipeModel,
    layout: eyes.layout, camera_settings: eyes.camera ? { ...eyes.camera.settings } : null,
    ...session,
  });

  const offSample = eyes.onSample(sample => { buffer.push(toRow(sample)); });
  const offCalibration = eyes.onCalibrationResult(result => queue.push({
    type: 'calibration', id: uuid(), session_id: sessionId, t: round(globalThis.performance?.now() ?? 0, 1),
    score: result.score, ok: result.ok, weak_cells: result.weakCells,
    points: result.points.map(p => ({ x: p.target.x, y: p.target.y, score: p.score, kept: p.kept, steadiness: r3(p.steadiness), residual: Number.isFinite(p.residual) ? r3(p.residual) : null })),
  }));

  function cut() {
    if (buffer.length) { queue.push({ type: 'samples', id: `${sessionId}:${seq}`, session_id: sessionId, seq: seq++, samples: buffer }); buffer = []; }
    // never grow without bound while offline: drop the oldest sample batches, and say so
    let rows = queue.reduce((n, m) => n + (m.samples?.length ?? 0), 0);
    while (rows > maxQueued) {
      const i = queue.findIndex(m => m.type === 'samples');
      rows -= queue[i].samples.length; stats.dropped += queue[i].samples.length;
      queue.splice(i, 1);
    }
    stats.queued = rows;
  }

  async function drain() {
    while (queue.length) {
      const message = queue[0];
      try { await send(message); }
      catch (error) { stats.failures++; stats.lastError = String(error?.message ?? error); onError(error); return false; } // keep it, retry next time
      queue.shift();
      if (message.samples) { stats.sent += message.samples.length; stats.queued -= message.samples.length; }
    }
    return true;
  }

  /** Upload what is buffered now. Resolves true when the queue is empty. */
  function flush() {
    cut();
    return (sending ??= drain().finally(() => { sending = null; }));
  }

  const timer = flushMs > 0 ? setInterval(flush, flushMs) : null;

  return {
    sessionId, stats, flush,
    /** Stop collecting and make a last upload attempt. Resolves false if rows are still queued. */
    async stop() {
      if (stopped) return queue.length === 0;
      stopped = true;
      offSample(); offCalibration(); clearInterval(timer);
      await sending;
      return flush();
    },
  };
}
