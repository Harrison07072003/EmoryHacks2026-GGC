// Live frame source: webcam -> preprocess -> MediaPipe landmarks -> eye crops -> pupil
// finder -> feature frame. The only module that touches the camera and the DOM canvas.
import { createLandmarker } from './landmarker.js';
import {
  DEFAULT_CAMERA_SETTINGS, RoiFollower, applyLut, autoTone, composeLuts, equalizeLut,
  estimateExposure, isIdentity, lumaHistogram, manualRoi, remapHistogram, toneLut,
} from './preprocess.js';
import { findPupil } from '../cv/pupil.js';
import { CROP, EYE_IDS, assembleFeatures, eyeGeometry, headFeatures, pupilFeature } from '../cv/features.js';
import { clamp, ramp } from '../util/math.js';

const MAX_WORK_WIDTH = 960;   // the detector never sees more pixels than this
const METER_EVERY = 8;        // frames between exposure measurements
const BLINK = { blendshape: 0.45, openness: 0.12 };
// MediaPipe's own eye-direction scores. Recorded (not yet used by the model) so clips can
// show whether they fix our weak vertical signal before the feature layout is changed.
const EYE_SHAPES = ['eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'eyeBlinkLeft', 'eyeBlinkRight'];

const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

export class CameraSource {
  constructor({ settings, modelUrl, wasmPath, constraints } = {}) {
    this.settings = { ...DEFAULT_CAMERA_SETTINGS, ...settings };
    this.options = { modelUrl, wasmPath };
    // ask for 1080p: more pixels per eye. Cameras that cannot do it fall back to what they can.
    this.constraints = constraints ?? { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'user' };
    this.follower = new RoiFollower();
    this.roi = { x: 0, y: 0, w: 1, h: 1 };
    this.pupilTrust = { R: 0.5, L: 0.5 };
    this.exposure = null; this.tone = null; this.lut = null; this.frameCount = 0;
    this.debug = { R: null, L: null };
  }

  async start(videoEl, onFrame) {
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera unavailable: open the page from http://localhost or https');
    }
    this.video = videoEl ?? this.hiddenVideo();
    this.onFrame = onFrame;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: this.constraints });
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true;
    await this.video.play();
    this.landmarker = await createLandmarker(this.options);

    this.work = canvas(2, 2); this.workCtx = this.work.getContext('2d', { willReadFrequently: true });
    this.meter = canvas(48, 48); this.meterCtx = this.meter.getContext('2d', { willReadFrequently: true });
    this.crop = canvas(CROP.w, CROP.h); this.cropCtx = this.crop.getContext('2d', { willReadFrequently: true });
    this.eyeCanvas = { R: canvas(CROP.w, CROP.h), L: canvas(CROP.w, CROP.h) }; // copies for the debug view
    this.running = true;
    this.schedule();
  }

  // The video must be in the page or Chrome may stop delivering frames.
  hiddenVideo() {
    const v = document.createElement('video');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none';
    document.body.appendChild(v);
    return (this.ownVideo = v);
  }

  schedule() {
    const run = () => { if (!this.running) return; this.tick(); this.schedule(); };
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(run); // exactly once per camera frame
    else requestAnimationFrame(run);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.landmarker?.close();
    this.ownVideo?.remove();
    this.onFrame = null;
  }

  /** Change camera tuning at runtime, e.g. from the slider panel. */
  set(patch) {
    Object.assign(this.settings, patch);
    if (!this.settings.auto) this.tone = null;
    if (!this.settings.autoCenter) this.follower.reset();
    this.rebuildLut();
  }

  tick() {
    const v = this.video, vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;
    const t = performance.now(), roi = this.roi;

    this.drawWorkFrame(vw, vh, roi);
    const result = this.landmarker.detectForVideo(this.work, t);
    const raw = result.faceLandmarks[0];
    if (!raw) {
      if (this.settings.autoCenter) { this.follower.reset(); this.roi = { x: 0, y: 0, w: 1, h: 1 }; } // look at the whole frame again
      if (this.frameCount++ % METER_EVERY === 0) this.measure({ x: 0, y: 0, w: 1, h: 1 }, vw, vh);
      return this.onFrame?.({ t, face: false, ms: performance.now() - t });
    }

    // landmarks come back relative to the crop; put them in full-frame coordinates
    const L = raw.map(p => ({ x: roi.x + p.x * roi.w, y: roi.y + p.y * roi.h }));
    const box = boundingBox(L);
    const R = this.eye(L, 'R', vw, vh), Le = this.eye(L, 'L', vw, vh);
    const head = headFeatures(L, result.facialTransformationMatrixes?.[0]?.data);

    const shapes = {};
    for (const c of result.faceBlendshapes?.[0]?.categories ?? []) shapes[c.categoryName] = c.score;
    const blink = ((shapes.eyeBlinkLeft ?? 0) + (shapes.eyeBlinkRight ?? 0)) / 2 > BLINK.blendshape || (R.open + Le.open) / 2 < BLINK.openness;

    if (this.frameCount++ % METER_EVERY === 0) this.measure(box, vw, vh);
    this.roi = this.settings.autoCenter ? { ...this.follower.update(box) } : manualRoi(this.settings);

    const info = e => ({ open: e.open, glare: e.glare, conf: e.conf, lum: e.lum });
    this.onFrame?.({
      t, face: true, blink,
      f: assembleFeatures(R, Le, head),
      eyes: { R: info(R), L: info(Le) },
      head, box, exposure: this.exposure,
      shapes: Object.fromEntries(EYE_SHAPES.map(k => [k, Math.round((shapes[k] ?? 0) * 1000) / 1000])),
      ms: performance.now() - t, // time spent on this frame: detector + eye crops + pupil finder
      res: [vw, vh],             // camera resolution actually delivered
    });
  }

  /** Crop + tone-correct the camera frame into the canvas the face detector looks at. */
  drawWorkFrame(vw, vh, roi) {
    const sw = roi.w * vw, sh = roi.h * vh, ww = Math.round(Math.min(sw, MAX_WORK_WIDTH)), wh = Math.round((ww * sh) / sw);
    if (this.work.width !== ww || this.work.height !== wh) { this.work.width = ww; this.work.height = wh; }
    this.workCtx.drawImage(this.video, roi.x * vw, roi.y * vh, sw, sh, 0, 0, ww, wh);
    if (!this.lut) return; // well lit: skip the pixel readback entirely
    const img = this.workCtx.getImageData(0, 0, ww, wh);
    applyLut(img.data, this.lut);
    this.workCtx.putImageData(img, 0, 0);
  }

  /** Meter exposure on the face and rebuild the tone curve. */
  measure(box, vw, vh) {
    this.meterCtx.drawImage(this.video, box.x * vw, box.y * vh, box.w * vw, box.h * vh, 0, 0, 48, 48);
    this.hist = lumaHistogram(this.meterCtx.getImageData(0, 0, 48, 48).data);
    this.exposure = estimateExposure(this.hist);
    if (this.settings.auto) this.tone = autoTone(this.hist, this.tone);
    this.rebuildLut();
  }

  rebuildLut() {
    const s = this.settings;
    let lut = toneLut(s.auto && this.tone ? this.tone : s);
    if (s.equalize > 0 && this.hist) lut = composeLuts(lut, equalizeLut(remapHistogram(this.hist, lut), s.equalize));
    this.lut = isIdentity(lut) ? null : lut;
  }

  /** One eye: geometry from landmarks + our pupil finder on a full-resolution, eye-aligned crop. */
  eye(L, key, vw, vh) {
    const geo = eyeGeometry(L, EYE_IDS[key], vw, vh), g = this.cropCtx, s = CROP.w / (geo.len * CROP.span);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(CROP.w / 2, CROP.h / 2); g.scale(s, s); g.rotate(-geo.ang); g.translate(-geo.cx, -geo.cy);
    g.drawImage(this.video, 0, 0, vw, vh);
    const pupil = findPupil(g.getImageData(0, 0, CROP.w, CROP.h));
    // ease trust in the pupil finder by its contrast; a hard switch would make features jump
    const k = (this.pupilTrust[key] = this.pupilTrust[key] * 0.8 + 0.2 * ramp(pupil.conf, 0.15, 0.4));
    this.eyeCanvas[key].getContext('2d').drawImage(this.crop, 0, 0);
    this.debug[key] = { pupil: { u: pupil.u, v: pupil.v }, iris: { u: geo.cu, v: geo.cv }, trust: k };
    return { u: geo.u, v: geo.v, ...pupilFeature(geo, pupil, k), open: geo.open, glare: pupil.glare, conf: pupil.conf, lum: pupil.mean };
  }
}

function boundingBox(L) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of L) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: clamp(x0), y: clamp(y0), w: x1 - x0, h: y1 - y0 };
}
