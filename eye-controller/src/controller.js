// Builds the public eye-controller around any frame source (camera, simulator, replay).
// This file is the seam: the game talks to what is returned here and nothing below it.
import { createEmitter } from './core/emitter.js';
import { Engine } from './core/engine.js';
import { CalibrationSession } from './calibration/session.js';
import { fitCalibration, pointGram } from './calibration/fit.js';
import { defaultTargets, quickTargets, topUpTargets, sameCell } from './calibration/targets.js';
import { createCalibrationOverlay } from './ui/calibration-overlay.js';
import { DEFAULT_LAYOUT, cellOf } from './signals/lanes.js';
import { defaultStore } from './storage/kv.js';
import { profileStore, toProfile } from './storage/profiles.js';
import { baselineStore, contribute, emptyBaseline, isValidBaseline, mergeBaselines } from './storage/baseline.js';
import { addGram, createGram, gramFromJSON } from './model/ridge.js';
import { FEATURE_COUNT } from './cv/features.js';

/**
 * @param source   { start(videoEl, onFrame), stop(), lookAt?(target) }
 * @param options  { layout, minScore, storage, headPenalty, smoothing, profileId }
 */
export function buildController(source, options = {}) {
  const layout = { ...DEFAULT_LAYOUT, ...options.layout };
  const emitter = createEmitter();
  const engine = new Engine({ layout, minScore: options.minScore, smoothing: options.smoothing, headPenalty: options.headPenalty, emit: emitter.emit });
  const kv = options.storage ?? defaultStore();
  const profiles = profileStore(kv), baselines = baselineStore(kv);
  let baseline = emptyBaseline(), profileId = options.profileId ?? 'default', session = null, running = false;

  const summary = c => ({
    score: c.score, ok: engine.state.ready, weakCells: c.weakCells,
    points: c.points.map(p => ({ target: p.target, score: p.score, kept: p.kept, steadiness: p.steadiness, residual: p.residual })),
  });

  function applyPoints(points) {
    const prior = baseline.samples > 0 ? gramFromJSON(baseline.gram) : null;
    const fit = fitCalibration(points, { layout, prior, headPenalty: options.headPenalty });
    engine.setCalibration(fit);
    const result = summary(fit);
    emitter.emit('calibrationResult', result);
    emitter.emit('calibrationComplete', fit.score);
    return result;
  }

  const keptGram = points => points.filter(p => p.kept).reduce((g, p) => addGram(g, pointGram(p)), createGram(FEATURE_COUNT));

  const api = {
    // ---- state (read any time; the object is updated in place every frame) ----
    state: engine.state,

    // ---- events (each returns an unsubscribe function) ----
    onLaneChange: cb => emitter.on('laneChange', cb),
    onPathSample: cb => emitter.on('pathSample', cb),
    onFaceLost: cb => emitter.on('faceLost', cb),
    onFaceFound: cb => emitter.on('faceFound', cb),
    onQualityChange: cb => emitter.on('qualityChange', cb),
    onCalibrationComplete: cb => emitter.on('calibrationComplete', cb),

    // ---- lifecycle ----
    async init(videoEl) {
      baseline = await baselines.load();
      await source.start(videoEl, frame => engine.handleFrame(frame));
      running = true;
    },

    /**
     * Run a calibration. Resolves with { score, ok, weakCells, points } when it finishes.
     * options: topUp   - only re-capture the weak cells and merge with the existing data
     *          quick   - one dot per cell; only shortens things once a pooled baseline exists
     *          targets - your own [{x, y}] list
     *          area    - element the dots are drawn over (default: the whole page)
     *          onTarget(target | null, index, total), onProgress(0-1) - draw the dots yourself
     */
    startCalibration(opts = {}) {
      if (!running) return Promise.reject(new Error('Eye tracking is not running: await init() first'));
      if (session) session.abort();
      const previous = engine.calibration?.points ?? [];
      const weak = engine.calibration?.weakCells ?? [];
      const topUp = !!opts.topUp && previous.length > 0 && weak.length > 0;
      const targets = opts.targets ?? (topUp ? topUpTargets(weak, layout) : opts.quick && baseline.samples > 0 ? quickTargets(layout) : defaultTargets(layout));
      const ui = opts.onTarget
        ? { show: opts.onTarget, progress: opts.onProgress ?? (() => {}), destroy() {} }
        : typeof document !== 'undefined' ? createCalibrationOverlay(opts.area, () => session?.abort()) : { show() {}, progress() {}, destroy() {} };

      return new Promise(resolve => {
        session = engine.session = new CalibrationSession({
          targets, ...opts.capture,
          onTarget: (target, index) => { ui.show(target, index, targets.length); source.lookAt?.(target); },
          onProgress: p => ui.progress(p),
          onDone: (points, info) => {
            session = engine.session = null;
            ui.destroy();
            if (info?.aborted) return resolve({ aborted: true, score: engine.state.calibrationScore, ok: engine.state.ready, weakCells: weak, points: [] });
            // a top-up replaces the old points of the cells it re-captured
            const merged = topUp ? [...previous.filter(p => !weak.some(c => sameCell(c, cellOf(p.target, layout)))), ...points] : points;
            resolve(applyPoints(merged));
          },
        }).start();
      });
    },

    stop() {
      session?.abort();
      running = false;
      source.stop();
    },

    /** Load a saved player. Resolves false when there is no usable profile under that id. */
    async loadProfile(id = profileId) {
      const profile = await profiles.load(id);
      if (!profile) return false;
      profileId = id;
      applyPoints(profile.points);
      return true;
    },

    /** Save the current calibration under `id`, and fold it into the pooled baseline if it is good. */
    async saveProfile(id = profileId) {
      const cal = engine.calibration;
      if (!cal) return false;
      profileId = id;
      const old = await profiles.load(id);
      if (old?.pooled) baseline = contribute(baseline, keptGram(old.points), -1); // replace, never double count
      const pooled = engine.state.ready;
      if (pooled) baseline = contribute(baseline, cal.gram);
      await profiles.save({ ...toProfile(id, cal), pooled });
      await baselines.save(baseline);
      return true;
    },

    /** The pooled baseline as a plain JSON-safe object (share it between machines). */
    async exportBaseline() { return structuredClone(baseline); },

    /** Bring in a baseline. merge: true adds it to the local pool, false replaces the pool. */
    async importBaseline(data, { merge = true } = {}) {
      if (!isValidBaseline(data)) throw new Error('Not a baseline for this version of the eye-controller');
      baseline = merge && baseline.samples > 0 ? mergeBaselines(baseline, data) : structuredClone(data);
      await baselines.save(baseline);
    },

    // ---- extras (useful, but not part of the frozen contract) ----
    layout,
    /**
     * One object per camera frame with everything in it: { frame, gaze, lane, band, quality,
     * ready, target, targetId, targetSource }. This is what data collection listens to.
     */
    onSample: cb => emitter.on('sample', cb),
    /** Full result of every calibration: { score, ok, weakCells, points }. */
    onCalibrationResult: cb => emitter.on('calibrationResult', cb),
    /**
     * Game says "the player should be looking at {x, y} now" (a note, a point on the path).
     * Samples are labelled with it until it is changed or cleared with null. It does not
     * affect tracking; it only makes recorded data measurable.
     */
    setTarget: (target, id) => engine.setTarget(target, id),
    /** Game says "the player is certainly looking at {x, y} now" -> gentle online refinement. */
    confirmOnTarget: target => engine.confirmOnTarget(target),
    weakCells: () => engine.calibration?.weakCells ?? [],
    listProfiles: () => profiles.list(),
    debug: {
      engine, source,
      on: emitter.on,
      applyPoints,
      calibrationTarget: () => session?.target ?? null,
      qualityFactors: () => engine.quality.factors,
    },
  };
  return api;
}
