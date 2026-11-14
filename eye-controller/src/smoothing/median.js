/** Sliding median: kills one-frame spikes without adding lag to real moves. */
export class MedianFilter {
  constructor(size = 3) { this.size = size; this.buf = []; }
  reset() { this.buf = []; }
  push(v) {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    const s = [...this.buf].sort((a, b) => a - b);
    return s[(s.length - 1) >> 1];
  }
}
