// Generated archive-song levels, kept apart from the built-in songs in src/songs/ and only in
// memory: a level exists while its stage is played (play, results, retry, recalibration) and is
// dropped when the player leaves (src/online/level.js). songs/index.js asks here only when an id
// is not a built-in song.
const levels = new Map();

export const registerOnlineSong = song => { levels.set(song.id, song); return song; };
export const onlineSongById = id => levels.get(id);

/** Remove every generated level; returns the removed songs. */
export function clearOnlineSongs() {
  const removed = [...levels.values()];
  levels.clear();
  return removed;
}
