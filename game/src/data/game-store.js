// Game data: song results, calibration records and (opt-in) gaze-tracking samples.
//
// Local storage is the eye-controller's own key-value interface (IndexedDB in the browser),
// the storage technology the project already uses. When Supabase is configured
// (src/data/supabase.js) every record is also upserted there; failed uploads wait in a
// local outbox and are retried on the next save or page load.
//
// Never stored: camera images or video. Gaze samples are numbers only, and only when the
// player has switched on "Help improve eye tracking" in Settings.
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const MAX_LOCAL_TRACKING_SESSIONS = 3;

/**
 * @param kv      async key-value store { get, set, delete, keys }
 * @param remote  optional Supabase client { upsert(table, rows) }
 */
export function createGameStore(kv, remote = null) {
  const status = { backend: remote ? 'IndexedDB + Supabase' : 'IndexedDB (this browser)', pending: 0, lastError: null };

  async function queue(table, row) {
    if (!remote) return;
    await kv.set(`outbox:${table}:${row.id}`, { table, row });
    await flushOutbox();
  }

  let flushing = null;
  function flushOutbox() {
    if (!remote) return Promise.resolve(true);
    return (flushing ??= (async () => {
      const keys = await kv.keys('outbox:');
      for (const key of keys) {
        const item = await kv.get(key);
        try { await remote.upsert(item.table, [item.row]); await kv.delete(key); }
        catch (e) { status.lastError = String(e.message ?? e); }
      }
      status.pending = (await kv.keys('outbox:')).length;
      return status.pending === 0;
    })().finally(() => { flushing = null; }));
  }

  return {
    status, flushOutbox,

    /** One finished (or failed) song. Returns the stored row. */
    async saveResult(result) {
      const row = { id: uuid(), created_at: new Date().toISOString(), ...result };
      await kv.set(`result:${row.id}`, row);
      await queue('game_results', row);
      return row;
    },

    async listResults() {
      const keys = await kv.keys('result:');
      return (await Promise.all(keys.map(k => kv.get(k)))).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    /** Best completed score per "song:difficulty", from real (non-simulated) play only unless includeDev. */
    async bestScores({ includeDev = false } = {}) {
      const best = {};
      for (const r of await this.listResults()) {
        if (r.failed || (!includeDev && r.input_source !== 'live')) continue;
        const key = `${r.song_id}:${r.difficulty}`;
        if (!best[key] || r.score > best[key].score) best[key] = { score: r.score, grade: r.grade };
      }
      return best;
    },

    /** Calibration metadata: score, per-dot error, weak cells. No images, no raw samples. */
    async saveCalibration(record) {
      const row = { id: uuid(), created_at: new Date().toISOString(), ...record };
      await kv.set(`calibration:${row.id}`, row);
      await queue('calibrations', row);
      return row;
    },

    /**
     * `send` for the eye-controller's createTelemetry(): stores its session / calibration /
     * sample-batch messages. Remote when configured (throws on failure so telemetry retries),
     * otherwise kept locally, last few sessions only.
     */
    trackingSink() {
      const TABLE = { session: 'tracking_sessions', calibration: 'tracking_calibrations', samples: 'tracking_samples' };
      return async message => {
        if (remote) {
          const { type, ...row } = message;
          await remote.upsert(TABLE[type], [row]);
          return;
        }
        const session = message.type === 'session' ? message.id : message.session_id;
        await kv.set(`tracking:${session}:${message.type}:${message.id}`, message);
        if (message.type === 'session') await pruneTracking(kv, session);
      };
    },
  };
}

async function pruneTracking(kv, keep) {
  const keys = await kv.keys('tracking:');
  const sessions = [...new Set(keys.filter(k => k.includes(':session:')).map(k => k.split(':')[1]))];
  if (sessions.length <= MAX_LOCAL_TRACKING_SESSIONS) return;
  const rows = await Promise.all(sessions.map(async id => ({ id, at: (await kv.get(keys.find(k => k.startsWith(`tracking:${id}:session:`))))?.started_at ?? '' })));
  const old = rows.filter(r => r.id !== keep).sort((a, b) => a.at.localeCompare(b.at)).slice(0, sessions.length - MAX_LOCAL_TRACKING_SESSIONS);
  for (const { id } of old) for (const k of keys.filter(k => k.startsWith(`tracking:${id}:`))) await kv.delete(k);
}
