// Explicit-content detection for archive songs. Archive metadata has no reliable "explicit"
// flag, so this checks titles, artist, album, tags and description against a configurable
// blocklist (src/config/content-blocklist.json). It errs on the side of excluding.

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile a blocklist ({ words, phrases, artists, ids }) once. */
export function compileBlocklist({ words = [], phrases = [], artists = [], ids = [] } = {}) {
  const parts = words.map(w => {
    const stem = w.endsWith('*');
    return `${escapeRe(norm(stem ? w.slice(0, -1) : w))}${stem ? '[a-z]*' : ''}`;
  });
  // whole words: not preceded/followed by a letter or digit (so "Sextet", "Dickens" pass)
  const wordRe = parts.length ? new RegExp(`(?<![a-z0-9])(?:${parts.join('|')})(?![a-z0-9])`) : null;
  return {
    wordRe,
    phrases: phrases.map(norm),
    artists: new Set(artists.map(a => norm(a).trim())),
    ids: new Set(ids),
  };
}

/**
 * @param fields  { title, artist, album, tags: string[], description, id }
 * @param list    compileBlocklist() result
 * @returns {{ explicit: boolean, reason: string }}
 */
export function checkExplicit(fields, list) {
  if (fields.id && list.ids.has(fields.id)) return { explicit: true, reason: 'excluded by id' };
  if (fields.artist && list.artists.has(norm(fields.artist).trim())) return { explicit: true, reason: `blocked artist ${fields.artist}` };
  const text = norm([fields.title, fields.artist, fields.album, ...(fields.tags ?? []), stripHtml(fields.description)].filter(Boolean).join(' \n '));
  const phrase = list.phrases.find(p => text.includes(p));
  if (phrase) return { explicit: true, reason: `phrase "${phrase}"` };
  const word = list.wordRe && text.match(list.wordRe);
  if (word) return { explicit: true, reason: `word "${word[0]}"` };
  return { explicit: false, reason: '' };
}

const stripHtml = s => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
