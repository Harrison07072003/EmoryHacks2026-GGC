// Generated archive-song levels for this session, kept apart from the built-in songs in
// src/songs/. songs/index.js asks here only when an id is not a built-in song.
const levels = new Map();

export const registerOnlineSong = song => { levels.set(song.id, song); return song; };
export const onlineSongById = id => levels.get(id);
