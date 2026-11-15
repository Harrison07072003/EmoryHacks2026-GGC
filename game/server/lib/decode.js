// Decode the start of an MP3 or Ogg Vorbis file in Node (WASM decoders, no ffmpeg needed).
// Works on a truncated file (only the first seconds were downloaded): decoding stops at the
// last complete frame.
import { MPEGDecoder } from 'mpg123-decoder';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';

/** 'mp3' | 'ogg' | null, from the first bytes (falls back to the file name). */
export function sniffFormat(bytes, name = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';           // "OggS"
  if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';   // "ID3" or frame sync
  if (/\.ogg$/i.test(name)) return 'ogg';
  if (/\.mp3$/i.test(name)) return 'mp3';
  return null;
}

/**
 * @returns {{ channels: Float32Array[], sampleRate: number, duration: number }}
 */
export async function decodeStart(bytes, { name = '', maxSec = 30 } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = sniffFormat(data, name);
  if (!format) throw new Error('unsupported audio format (expected MP3 or Ogg Vorbis)');
  const decoder = format === 'ogg' ? new OggVorbisDecoder() : new MPEGDecoder();
  await decoder.ready;
  try {
    const out = format === 'ogg' ? await decoder.decodeFile(data) : decoder.decode(data);
    if (!out.samplesDecoded || !out.channelData?.length) throw new Error('no audio could be decoded');
    const keep = Math.min(out.samplesDecoded, Math.round(maxSec * out.sampleRate));
    const channels = out.channelData.map(ch => ch.subarray(0, keep));
    return { channels, sampleRate: out.sampleRate, duration: keep / out.sampleRate };
  } finally {
    decoder.free();
  }
}
