// Builds the public eye-controller around any frame source (camera, simulator, replay).
// This file is the seam: the game talks to what is returned here and nothing below it.
import { createEmitter } from './core/emitter.js';
import { Engine } from './core/engine.js';
import { CalibrationSession } from './calibration/session.js';
import { fitCalibration, pointGram } from './calibration/fit.js';
import { defaultTargets, hopTargets, quickTargets, topUpTargets, sameCell } from './calibration/targets.js';
import { createCalibrationOverlay } from './ui/calibration-overlay.js';
import { DEFAULT_LAYOUT, cellOf } from './signals/lanes.js';
import { defaultStore } from './storage/kv.js';
import { profileStore, toProfile } from './storage/profiles.js';
import { baselineStore, contribute, emptyBaseline, isValidBaseline, mergeBaselines } from './storage/baseline.js';
import { addGram, cloneGram, createGram, gramFromJSON, gramWeight } from './model/ridge.js';
import { FEATURE_COUNT } from './cv/features.js';

const DEFAULT_PURSUIT_MS = 10000;
const POOL_PRIOR_SAMPLES = 30;   // the pool counts as this many samples of prior knowledge
const OWN_PRIOR_SAMPLES = 60;    // the player's own recent calibration is trusted more
const DEFAULT_HOPS = 8;

/**
 * @param source   { start(videoEl, onFrame), stop(), lookAt?(target) }
 * @param options  { layout, minScore, storage, headPenalty, smoothing, profileId, pool }
 *                 pool: false = never warm-start from the pooled baseline (default true)
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
    points: c.points.map(p => ({ target: p.target, score: p.score, kept: p.kept, steadiness: p.steadiness, residual: p.residual, ...(p.kind ? { kind: p.kind } : {}) })),
  });

  const usePool = options.pool !== false;
  /** Starting point from the pooled baseline (other sessions / players), if enabled. */
  const poolPrior = () => (usePool && baseline.samples > 0 ? { gram: gramFromJSON(baseline.gram), samples: POOL_PRIOR_SAMPLES } : null);
  /** Starting point from this player's current calibration: the best base for a quick re-check. */
  const ownPrior = () => (engine.calibration && gramWeight(engine.calibration.gram) > 0 ? { gram: cloneGram(engine.calibration.gram), samples: OWN_PRIOR_SAMPLES } : null);

  function applyPoints(points, prior = poolPrior()) {
    const fit = fitCalibration(points, { layout, prior: prior?.gram ?? null, ...(prior ? { priorSamples: prior.samples } : {}), headPenalty: options.headPenalty });
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
     *          quick   - one dot per cell, built on the player's current calibration (or the pool);
     *                    a full calibration when neither exists
     *          pursuitMs - length of the moving-dot phase after the dots (default 10 s, 0 = none)
     *          hops    - number of top/bottom band hops at the end (default 8, 1.2 s each, 0 = none)
     *          targets - your own [{x, y}] list
     *          area    - element the dots are drawn over (default: the whole page)
     *          theme   - built-in screen look: 'default', 'neon' or a partial theme object
     *          keys    - false when the page handles Escape itself (then use cancelCalibration)
     *          onTarget(target | null, index, total, info), onProgress(0-1, { stage, steadiness }) - draw the dots yourself;
     *                    stage is 'seeking' / 'capturing' / 'locked' during the dots (see calibration/session.js);
     *                    info.phase is 'dots', 'pursuit' (info.moving, called every frame) or
     *                    'hops' (info.hop; index / total then count the hops)
     */
    startCalibration(opts = {}) {
      if (!running) return Promise.reject(new Error('Eye tracking is not running: await init() first'));
      if (session) session.abort();
      const previous = engine.calibration?.points ?? [];
      const weak = engine.calibration?.weakCells ?? [];
      const topUp = !!opts.topUp && previous.length > 0 && weak.length > 0;
      // quick: one dot per cell on top of a starting point (the player's own current calibration,
      // else the pool); with no starting point at all it is a full calibration
      const quickPrior = opts.quick && !topUp ? ownPrior() ?? poolPrior() : null;
      const targets = opts.targets ?? (topUp ? topUpTargets(weak, layout) : quickPrior ? quickTargets(layout) : defaultTargets(layout));
      // a moving-dot phase follows the dots (not for a top-up or a custom target list)
      const playLike = !topUp && !opts.targets;
      const pursuitMs = opts.pursuitMs ?? (playLike ? DEFAULT_PURSUIT_MS : 0);
      const hops = playLike ? hopTargets(opts.hops ?? DEFAULT_HOPS, layout) : [];
      const ui = opts.onTarget
        ? { show: opts.onTarget, progress: opts.onProgress ?? (() => {}), destroy() {} }
        : typeof document !== 'undefined' ? createCalibrationOverlay(opts.area, () => session?.abort(), { eyes: api, layout, theme: opts.theme, keys: opts.keys }) : { show() {}, progress() {}, destroy() {} };

      return new Promise(resolve => {
        session = engine.session = new CalibrationSession({
          targets, pursuitMs, hops, bandSplit: layout.bandSplit, ...opts.capture,
          // during the hops, index / total count the hops ("3 / 8"), not the dots
          onTarget: (target, index, info) => { ui.show(target, index, info?.hop ? hops.length : targets.length, info); source.lookAt?.(target); },
          onProgress: (p, info) => ui.progress(p, info),
          onDone: (points, info) => {
            session = engine.session = null;
            ui.destroy();
            if (info?.aborted) return resolve({ aborted: true, score: engine.state.calibrationScore, ok: engine.state.ready, weakCells: weak, points: [] });
            // a top-up replaces the old points of the cells it re-captured
            const merged = topUp ? [...previous.filter(p => !weak.some(c => sameCell(c, cellOf(p.target, layout)))), ...points] : points;
            resolve(applyPoints(merged, quickPrior ?? poolPrior()));
          },
        }).start();
      });
    },

    /** Cancel a running calibration; its promise resolves with { aborted: true }. */
    cancelCalibration() { session?.abort(); },

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
    /**
     * Everything needed to draw the player's face: the latest frame (face box, head pose, eye
     * measurements), and on the live camera also the <video>, the 478 face landmarks (0-1 of
     * the camera frame), MediaPipe's mesh lines, the eye close-up images and where our pupil
     * finder and MediaPipe's iris landed in them, the auto-adjusted image the tracker analyses,
     * and the live conditions score. Fields the source lacks are null (mock).
     */
    faceData() {
      const cam = source.debug ? source : null;
      return {
        frame: engine.lastFrame, video: cam?.video ?? null, landmarks: cam?.landmarks ?? null, mesh: cam?.mesh ?? null,
        eyeImages: cam?.eyeCanvas ?? null, eyeMarks: cam ? { L: cam.debug.L, R: cam.debug.R } : null,
        // the image the tracker actually analyses: auto-exposed and cropped to `roi` (0-1 of the camera frame)
        processed: cam?.work ?? null, roi: cam?.workRoi ?? null, tone: cam?.settings.auto ? cam.tone : null,
        // how good the conditions are right now (light, glare, pupil contrast, framing, head), 0-1
        conditions: { score: engine.quality.live, factors: engine.quality.factors },
      };
    },
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
