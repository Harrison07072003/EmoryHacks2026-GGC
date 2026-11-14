// The engine: feature frames in, game state and events out. No DOM, no camera, no storage,
// so it runs identically on live frames, simulated frames and recorded sessions.
import { nextEyeMix, predictGaze, fitGazeModel, lerpModel } from '../model/gaze-model.js';
import { addGram, addSample, cloneGram, createGram, gramWeight, scaleGram } from '../model/ridge.js';
import { GazeSmoother } from '../smoothing/gaze-smoother.js';
import { createLaneMapper, DEFAULT_LAYOUT } from '../signals/lanes.js';
import { FacePresence } from '../signals/presence.js';
import { QualityTracker } from '../signals/quality.js';
import { FEATURE_COUNT } from '../cv/features.js';

const REFINE = { weight: 0.25, decay: 0.98, maxShare: 0.3, every: 5, blend: 0.3, maxError: 0.2 };

export class Engine {
  constructor({ layout = DEFAULT_LAYOUT, minScore = 60, smoothing, headPenalty = 6, emit = () => {} } = {}) {
    Object.assign(this, { layout, minScore, headPenalty, emit });
    this.state = { gaze: { x: 0.5, y: 0.5 }, lane: null, band: null, quality: 0, faceVisible: false, ready: false, calibrationScore: null };
    this.smoother = new GazeSmoother(smoothing);
    this.mapper = createLaneMapper(layout);
    this.presence = new FacePresence();
    this.quality = new QualityTracker();
    this.model = null; this.calibration = null; this.session = null; this.lastFrame = null; this.mix = 0;
    this.gameTarget = null;
  }

  handleFrame(frame) {
    this.lastFrame = frame;
    this.emit('frame', frame);
    const dot = this.session?.target ?? null; // read before processing: the session may move on
    this.process(frame);
    this.emit('sample', this.sampleOf(frame, dot));
  }

  /** Label the frames that follow with where the player should be looking (null to clear). */
  setTarget(target, id = null) { this.gameTarget = target ? { x: target.x, y: target.y, id } : null; }

  /** Everything known about one frame, in one object: measurements, model output, target. */
  sampleOf(frame, dot) {
    const s = this.state, target = dot ?? this.gameTarget;
    return {
      frame,
      gaze: this.model && frame.face ? { x: s.gaze.x, y: s.gaze.y } : null,
      lane: s.lane, band: s.band, quality: s.quality, ready: s.ready,
      target: target ? { x: target.x, y: target.y } : null,
      targetId: dot ? null : this.gameTarget?.id ?? null,
      targetSource: dot ? 'calibration' : this.gameTarget ? 'game' : null,
    };
  }

  process(frame) {
    const s = this.state;

    const change = this.presence.update(frame.face, frame.t);
    if (change === 'found') { s.faceVisible = true; this.emit('faceFound'); }
    if (change === 'lost') { s.faceVisible = false; this.smoother.reset(); this.setLane(null, null); this.emit('faceLost'); }

    const q = this.quality.update(frame, { calibrationScore: s.calibrationScore, headRef: this.calibration?.headRef });
    if (q !== null) { s.quality = q; this.emit('qualityChange', q); }

    this.session?.push(frame);
    if (!frame.face || frame.blink || !this.model) return; // hold the last gaze through blinks

    this.mix = nextEyeMix(this.mix, frame.eyes);
    const g = this.smoother.push(predictGaze(this.model, frame.f, this.mix), frame.t);
    s.gaze.x = g.x; s.gaze.y = g.y;
    if (!s.ready || this.session) return;
    const { lane, band } = this.mapper.update(g);
    this.setLane(lane, band);
    this.emit('pathSample', { x: g.x, y: g.y }, frame.t);
  }

  setLane(lane, band) {
    const s = this.state;
    if (lane === null) this.mapper.reset();
    if (lane === s.lane && band === s.band) return;
    s.lane = lane; s.band = band;
    this.emit('laneChange', lane, band);
  }

  /** Install the result of fitCalibration. Play is only enabled when the score clears minScore. */
  setCalibration(calibration) {
    this.calibration = calibration;
    this.model = calibration.model;
    this.refineGram = createGram(FEATURE_COUNT); this.sinceRefine = 0;
    this.state.calibrationScore = calibration.score;
    this.state.ready = !!calibration.model && calibration.score >= this.minScore;
    this.smoother.reset();
    if (!this.state.ready) this.setLane(null, null);
  }

  /**
   * Online refinement: the game says "the player is definitely looking at `target` right now".
   * The sample gets a small weight and the live model only drifts part of the way toward the
   * refit, so play never sees a jump and a few wrong confirmations cannot wreck calibration.
   */
  confirmOnTarget(target) {
    const fr = this.lastFrame;
    if (!this.model || !this.calibration || !fr?.face || fr.blink) return false;
    const p = predictGaze(this.model, fr.f);
    if (Math.hypot(p.x - target.x, p.y - target.y) > REFINE.maxError) return false; // probably looking elsewhere
    scaleGram(this.refineGram, REFINE.decay);
    addSample(this.refineGram, fr.f, target.x, target.y, REFINE.weight);
    const cap = REFINE.maxShare * gramWeight(this.calibration.fitGram);
    if (gramWeight(this.refineGram) > cap) scaleGram(this.refineGram, cap / gramWeight(this.refineGram));
    if (++this.sinceRefine >= REFINE.every) {
      this.sinceRefine = 0;
      const refit = fitGazeModel(addGram(cloneGram(this.calibration.fitGram), this.refineGram), { headPenalty: this.headPenalty });
      this.model = lerpModel(this.model, refit, REFINE.blend);
    }
    return true;
  }
}
