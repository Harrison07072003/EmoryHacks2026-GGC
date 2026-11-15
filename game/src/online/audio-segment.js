// Download and decode only the START of an archive track: 10 s for a preview, 30 s for a level.
// archive.org supports cross-origin HTTP Range requests (checked: 206 + Access-Control-Allow-Origin *),
// so the browser asks for just the bytes needed, estimated from the track's bitrate. If a server
// ignores Range, the body is read only up to the byte budget and the rest is cancelled.

const DEFAULT_KBPS = 320;               // unknown bitrate: assume the highest common MP3 rate
const HEADER_SLACK = 256 * 1024;        // ID3 tags (cover art) sit before the audio

/** Bytes to request for the first `sec` seconds. */
export function segmentByteBudget(sec, bitrateKbps) {
  const kbps = bitrateKbps > 0 ? Math.min(bitrateKbps, 1500) : DEFAULT_KBPS;
  return Math.ceil(((kbps * 1000) / 8) * (sec + 2) * 1.1) + HEADER_SLACK;
}

/** Fetch at most `maxBytes` from the start of `url`. Returns { bytes: ArrayBuffer, complete: whole file? }. */
export async function fetchStart(url, maxBytes, { fetchFn = (...a) => globalThis.fetch(...a), signal } = {}) {
  const res = await fetchFn(url, { headers: { Range: `bytes=0-${maxBytes - 1}` }, signal });
  if (!res.ok) throw new Error(`audio download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-range')?.split('/')[1]) || Number(res.headers.get('content-length')) || 0;
  if (!res.body?.getReader) {   // no streams (old browsers / tests): take what arrived
    const buf = await res.arrayBuffer();
    return { bytes: buf.slice(0, maxBytes), complete: buf.byteLength <= maxBytes && (!total || buf.byteLength >= total) };
  }
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, maxBytes));
  let at = 0;
  for (const c of chunks) { const part = c.subarray(0, out.length - at); out.set(part, at); at += part.length; if (at >= out.length) break; }
  return { bytes: out.buffer, complete: total > 0 && out.length >= total };
}

/** A new AudioBuffer holding only the first `sec` seconds of `buffer`. */
export function trimBuffer(ctx, buffer, sec) {
  const frames = Math.min(buffer.length, Math.round(sec * buffer.sampleRate));
  if (frames >= buffer.length) return buffer;
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(0, frames));
  return out;
}

/**
 * Decoded first `sec` seconds of a song, cached (a few songs, so memory stays small).
 * A 30 s segment also serves later 10 s previews of the same song.
 */
export function createSegmentLoader(ctx, { fetchFn, maxEntries = 6 } = {}) {
  const cache = new Map();   // song id -> { sec, promise }

  async function load(song, sec, signal) {
    let budget = segmentByteBudget(sec, song.bitrateKbps);
    for (let attempt = 0; ; attempt++) {
      const { bytes, complete } = await fetchStart(song.audioUrl, budget, { fetchFn, signal });
      const decoded = await ctx.decodeAudioData(bytes);
      // short because the bitrate estimate was low (not because the song is short): fetch more once
      if (decoded.duration >= sec - 0.25 || complete || attempt >= 1) return trimBuffer(ctx, decoded, sec);
      budget *= 2;
    }
  }

  return {
    /** @returns Promise<AudioBuffer> */
    get(song, sec, { signal } = {}) {
      const hit = cache.get(song.id);
      if (hit && hit.sec >= sec) { cache.delete(song.id); cache.set(song.id, hit); return hit.promise.then(b => trimBuffer(ctx, b, sec)); }
      const promise = load(song, sec, signal);
      const entry = { sec, promise };
      cache.set(song.id, entry);
      promise.catch(() => { if (cache.get(song.id) === entry) cache.delete(song.id); });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return promise;
    },
  };
}
