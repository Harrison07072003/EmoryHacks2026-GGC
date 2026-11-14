/**
 * Saccade snap: when the measured gaze sits far from the smoothed output for a couple of
 * frames, the eyes really jumped, so the caller should drop its filter state and jump too.
 */
export class SaccadeDetector {
  constructor({ distance = 0.12, confirmFrames = 2 } = {}) {
    Object.assign(this, { distance, confirmFrames });
    this.count = 0;
  }
  reset() { this.count = 0; }
  /**
   * @returns 'snap' when a jump is confirmed, 'pending' while a far sample is still
   *          unconfirmed (could be a glitch), null otherwise
   */
  update(measured, smoothed) {
    if (!smoothed) return null;
    const far = Math.hypot(measured.x - smoothed.x, measured.y - smoothed.y) > this.distance;
    this.count = far ? this.count + 1 : 0;
    if (!far) return null;
    if (this.count < this.confirmFrames) return 'pending';
    this.count = 0;
    return 'snap';
  }
}
