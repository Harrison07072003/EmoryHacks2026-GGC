// Internet Archive item metadata (https://archive.org/metadata/{identifier}) -> one Typesense
// document per playable TRACK. Pure functions; the network lives in ia-client.js.
import { attributionText, isCommercialOk, isLicenseAllowed, parseLicense } from './licenses.js';
import { checkExplicit, compileBlocklist } from './content-filter.js';

const NO_BLOCKLIST = compileBlocklist();

// Playable formats in order of preference. Derivatives are fine (IA makes MP3/OGG from FLAC).
const FORMAT_RANK = [
  [/^vbr mp3$/i, 0], [/^(128|160|192|256|320)kbps mp3$/i, 1], [/^(64|96)kbps mp3$/i, 2], [/mp3/i, 3],
  [/^ogg vorbis$/i, 4], [/ogg/i, 5],
];
const EXT_OK = /\.(mp3|ogg)$/i;

const one = v => (Array.isArray(v) ? v[0] : v);
const list = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const tidy = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "913.24" | "15:13" | "1:02:03" -> whole seconds, or 0 when unknown. */
export function parseLength(v) {
  const s = String(one(v) ?? '').trim();
  if (!s) return 0;
  if (s.includes(':')) return s.split(':').reduce((acc, p) => acc * 60 + (Number(p) || 0), 0) | 0;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function formatRank(file) {
  if (!EXT_OK.test(file.name ?? '')) return -1;
  for (const [re, rank] of FORMAT_RANK) if (re.test(file.format ?? '')) return rank;
  return 9;
}

/**
 * Pick one playable file per track. IA lists the original (often FLAC) plus derivatives;
 * files that share an `original` (or are that original) are the same track.
 */
export function pickAudioFiles(files = []) {
  const best = new Map();   // track key -> { file, rank }
  for (const file of files) {
    const rank = formatRank(file);
    if (rank < 0) continue;
    const key = file.source === 'derivative' && file.original ? file.original : file.name;
    const cur = best.get(key);
    if (!cur || rank < cur.rank) best.set(key, { file, rank });
  }
  return [...best.values()].map(v => v.file).sort((a, b) => (Number(one(a.track)) || 0) - (Number(one(b.track)) || 0) || a.name.localeCompare(b.name));
}

/** Stable short id for a file name (survives files being added to the item). */
export function fileKey(name) {
  let h = 0x811c9dc5;   // FNV-1a 32-bit
  for (const ch of String(name)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Tags worth faceting on: file genre first, then item subjects minus artist/label/noise. */
export function cleanGenres({ fileGenre, subjects, artist, collections }, max = 5) {
  const skip = new Set([artist, ...list(collections)].map(s => tidy(s).toLowerCase()).filter(Boolean));
  const noise = /^(audio|music|netlabels?|mp3|ogg|flac|free|creative ?commons|cc[- ]?by.*|album|ep|single|default recordings|various artists|\d+)$/i;
  const out = [];
  for (const raw of [...list(fileGenre), ...list(subjects).flatMap(s => String(s).split(/[;,]/))]) {
    const g = tidy(raw).toLowerCase();
    if (!g || g.length > 32 || skip.has(g) || noise.test(g) || out.includes(g)) continue;
    out.push(g);
    if (out.length >= max) break;
  }
  return out;
}

/** Strip a leading "01 " / "01 - " track number from a file title. */
const stripTrackNo = s => tidy(s).replace(/^\d{1,3}\s*[-._)]?\s+/, '');

const titleFromName = name => stripTrackNo(name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '));

/**
 * Map one archive.org metadata response to Typesense documents.
 * @param meta    the JSON from /metadata/{identifier}
 * @param opts    { source: 'internet_archive'|'fma', allowNonCommercial, minSec, maxSec, popularity,
 *                  blocklist: compileBlocklist() result }
 * @returns {{ docs: object[], skipped: { name: string, reason: string }[], excludedIds: string[] }}
 *          excludedIds = tracks dropped as explicit, so a re-run can remove them from the index
 */
export function itemToDocuments(meta, { source = 'internet_archive', allowNonCommercial = false, minSec = 30, maxSec = 600, popularity, blocklist = NO_BLOCKLIST } = {}) {
  const m = meta?.metadata ?? {}, identifier = one(m.identifier);
  const skipped = [];
  if (!identifier) return { docs: [], skipped: [{ name: '?', reason: 'no identifier' }], excludedIds: [] };
  const license = parseLicense(one(m.licenseurl));
  if (!isLicenseAllowed(license, { allowNonCommercial })) {
    return { docs: [], skipped: [{ name: identifier, reason: `license ${license.ok ? license.name : one(m.licenseurl) || 'missing'}` }], excludedIds: [] };
  }
  const itemArtist = tidy(one(m.creator)), itemAlbum = tidy(one(m.title));
  const itemUrl = `https://archive.org/details/${identifier}`;
  const fmaUrl = source === 'fma' ? tidy(one(m.source)) : '';
  const prefix = source === 'fma' ? 'fma' : 'ia';
  const docs = [], excludedIds = [];

  for (const file of pickAudioFiles(meta.files)) {
    const duration = parseLength(file.length);
    if (!duration) { skipped.push({ name: file.name, reason: 'unknown duration' }); continue; }
    if (duration < minSec || duration > maxSec) { skipped.push({ name: file.name, reason: `duration ${duration}s` }); continue; }
    const title = stripTrackNo(one(file.title)) || titleFromName(file.name);
    const artist = tidy(one(file.creator) ?? one(file.artist)) || itemArtist || 'Unknown artist';
    const album = tidy(one(file.album)) || itemAlbum;
    const id = `${prefix}_${identifier}_${fileKey(file.name)}`.replace(/[^\w.-]/g, '_');
    const genre = cleanGenres({ fileGenre: file.genre, subjects: m.subject, artist, collections: m.collection });
    const explicit = checkExplicit({ id, title, artist, album, tags: [...genre, ...list(m.subject), ...list(file.genre)], description: [one(m.description), itemAlbum].join(' ') }, blocklist);
    if (explicit.explicit) { skipped.push({ name: file.name, reason: `explicit (${explicit.reason})` }); excludedIds.push(id); continue; }
    const seconds = Number(one(file.length)) || duration, size = Number(one(file.size)) || 0;
    docs.push({
      id,
      title, artist, album, genre,
      source,
      source_id: `${identifier}/${file.name}`,
      license_url: license.url,
      license_name: license.name,
      is_commercial_ok: isCommercialOk(license),
      is_explicit: false,
      attribution: attributionText({ title, artist, licenseName: license.name, sourceUrl: fmaUrl || itemUrl }),
      item_url: itemUrl,
      duration,
      popularity: Math.max(0, Math.round(Number(popularity ?? one(m.downloads)) || 0)),
      // used to download only the first seconds (preview / 30 s level) with an HTTP Range request
      bitrate_kbps: size && seconds ? Math.round((size * 8) / 1000 / seconds) : 0,
      audio_url: `https://archive.org/download/${encodeURIComponent(identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`,
    });
  }
  if (!docs.length && !skipped.length) skipped.push({ name: identifier, reason: 'no mp3/ogg files' });
  return { docs, skipped, excludedIds };
}
