// Music playback, separate from sound effects: decoding, song playback with a precise clock,
// and previews. Only one music source plays at a time: starting anything stops the rest.

export function createMusic(audio) {
  const { ctx, buses } = audio;
  const cache = new Map();
  let current = null;   // { src, gain }

  async function load(url) {
    if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`audio ${url}: ${r.status}`); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b)));
    return cache.get(url);
  }

  function stop(fadeSec = 0.05) {
    if (!current) return;
    const { src, gain } = current, t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fadeSec);
    try { src.stop(t + fadeSec + 0.02); } catch { /* already stopped */ }
    current = null;
  }

  /** Start `buffer` at context time `when`, from `offset` seconds into the file. */
  function start(buffer, { when = ctx.currentTime, offset = 0, duration, fadeIn = 0, fadeOut = 0, rate = 1 } = {}) {
    stop();
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = buffer; src.playbackRate.value = rate;
    src.connect(gain).connect(buses.music);
    gain.gain.setValueAtTime(fadeIn ? 0 : 1, when);
    if (fadeIn) gain.gain.linearRampToValueAtTime(1, when + fadeIn);
    if (duration && fadeOut) { gain.gain.setValueAtTime(1, when + duration - fadeOut); gain.gain.linearRampToValueAtTime(0, when + duration); }
    src.start(when, Math.max(0, offset), duration);
    const handle = { src, gain, when, offset };
    src.onended = () => { if (current === handle) current = null; };
    current = handle;
    return handle;
  }

  const preloaded = [];
  /**
   * Make `load(url)` return an already decoded buffer (Online Library levels: the first 30 s of
   * an archive song). Only the last few are kept, so memory stays bounded.
   */
  function preload(url, buffer, keep = 3) {
    cache.set(url, Promise.resolve(buffer));
    const i = preloaded.indexOf(url);
    if (i >= 0) preloaded.splice(i, 1);
    preloaded.push(url);
    while (preloaded.length > keep) cache.delete(preloaded.shift());
  }

  /** Drop a decoded buffer from the cache (e.g. an Online Library level that was left). */
  function forget(url) {
    cache.delete(url);
    const i = preloaded.indexOf(url);
    if (i >= 0) preloaded.splice(i, 1);
  }

  return {
    load, start, stop, preload, forget,
    get playing() { return !!current; },
    /** A short preview from `startSec`, faded in and out. Replaces whatever was playing. */
    preview(buffer, startSec, durationSec, fadeSec) {
      return start(buffer, { offset: startSec, duration: durationSec, fadeIn: fadeSec * 0.5, fadeOut: fadeSec });
    },
    /** Slow the current song to a stop (failure). */
    windDown(sec = 1.2) {
      if (!current) return;
      const t = ctx.currentTime;
      current.src.playbackRate.setValueAtTime(current.src.playbackRate.value, t);
      current.src.playbackRate.linearRampToValueAtTime(0.3, t + sec);
      stop(sec);
    },
  };
}
