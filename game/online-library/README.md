# online-library/ — GENERATED content (do not edit, safe to delete)

Written by the Online Library server (`npm run server`) and by `npm run ingest -- --pregenerate N`.
Nothing here is part of the built-in songs in `src/songs/`, and nothing here is committed.

- `charts/<songId>.v<generatorVersion>.json` — automatically generated levels for archive.org
  songs (first 30 s), with the song's attribution and analysis (BPM, offset, difficulty).
  Charts of older generator versions are ignored and regenerated on demand.
- `audio/` — the first 30 s of downloaded archive tracks, size-limited (`AUDIO_CACHE_MB`,
  default 200); least recently used files are deleted first.

Override the location with `ONLINE_LIBRARY_DIR`.
