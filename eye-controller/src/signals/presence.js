/** Debounced face lost / found, so one dropped frame does not fire an event. */
export class FacePresence {
  constructor({ lostAfterMs = 250 } = {}) { this.lostAfterMs = lostAfterMs; this.visible = false; this.lastSeen = null; }
  /** @returns 'found' | 'lost' | null */
  update(face, tMs) {
    if (face) {
      this.lastSeen = tMs;
      if (!this.visible) { this.visible = true; return 'found'; }
    } else if (this.visible && tMs - this.lastSeen > this.lostAfterMs) {
      this.visible = false;
      return 'lost';
    }
    return null;
  }
}
