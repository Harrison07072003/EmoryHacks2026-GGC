# RhythmEyez — the game

An eye-controlled rhythm game. You play with a webcam and your eyes. No controller, no hands.
It is built on top of the eye-tracking engine in [`../eye-controller`](../eye-controller/README.md)
and uses only that engine's public interface.

## Run it

```bash
# once per machine: the eye engine and its face model
npm --prefix eye-controller install
npm --prefix eye-controller run fetch-model

# the game
cd game
npm install
npm run dev          # open the printed http://localhost link in Chrome
```

Open **http://localhost:5190** (the camera needs localhost or https) and allow the camera.

**Always use the same address.** The game runs on a fixed port (5190) because the browser
keeps calibration, settings and results per address. Opened on another port or through a
different forwarding URL, it looks like a brand-new player. The eye-controller's debug /
recording page (`npm --prefix eye-controller run dev`) uses the same port, so the pooled
baseline it builds is the one the game sees: **run one of the two at a time.**

**Coming back later:** the saved calibration loads automatically, so the gaze works on the
title screen straight away. Pressing Start offers a quick 15-second recalibration, with
**Use saved calibration** to skip it. Only calibrations that pass (score 60+) are saved.
`?input=sim` and `?input=mouse` never save calibrations.

**Eyes-only players:** browsers keep sound off until the first click or key press. To start
with no hands at all, launch Chrome with `--autoplay-policy=no-user-gesture-required`.
Without that, the game still plays, but silently, until someone clicks once.

| Command | Does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build into `dist/` |
| `npm test` | unit tests: judging, scoring, health, Frenzy, dwell, geometry, storage |
| `npm run songs` | re-render the three original songs and regenerate their charts |
| `npm run check-charts` | validate every chart (format, overlaps, eye-movement time) |

### Testing without a webcam (development only)

| URL | Gaze comes from |
|---|---|
| `/` | **the real webcam tracker** (default) |
| `/?input=sim` | the eye-controller **mock**: the mouse moves simulated eyes through the real smoothing pipeline, with noise and lag. Calibration runs on the simulated eyes. |
| `/?input=mouse` | the mouse pointer directly |

Shift+M toggles a mouse override in any mode. A yellow badge in the bottom-left always shows
when gaze is simulated, and results are saved with `input_source` = `sim` or `mouse` so
they never mix with real play. Mouse clicks press any button straight away. Escape opens
pause or goes back.

## How to play

- **Face check (before every calibration):** the eye-controller's face view: your mirrored
  camera image with an oval, the face mesh, both eye close-ups and a live **CONDITIONS %**.
  Move until every line is green (face found, centred, distance, lighting; brightness, glare
  and facing the screen are warnings). After 1.5 s of all-green it continues by itself.
- **Calibration** starts by itself at the beginning of every session (after the face check,
  once your face has been steady for 3 s: no button needed). It is the eye-controller's own
  screen in the game's look: look at each dot until it locks (from the 3rd dot it checks you
  are really looking at it; corners only need a steady look), follow the moving dot, then look
  at the dots hopping between the top and bottom band. A small camera view sits in the corner
  during calibration only. The result shows your score and each screen area; Continue /
  Top-up weak / Redo are pressed by looking at them (a good result continues by itself).
  **Redo is always the full calibration.** Between songs a quick version runs (8 dots on top of
  your current calibration).
- **Pause:** the Pause button (top-right corner) freezes the song and opens Resume / Quit
  (Quit goes back to song select). The song pauses by itself if your face is out of
  view for 3 s. If tracking drifts (your head stays well away from where it was at calibration
  for 2.5 s) it pauses and, after "Recalibrating in 3…" (Cancel = resume), runs a quick
  recalibration on top of the song, then the song carries on. Resume rewinds 1 s and counts in.
- **Mouse:** off by default. Settings → Mouse → *Allowed*: your eyes play, and the mouse steps
  in only while you move it or your face is lost. If calibration fails twice in a row, the
  game offers to play with the mouse until a calibration passes (the badge bottom-left says so).
- **Shared calibration pool** (Settings, off by default): start calibrations from earlier
  calibrations of other sessions / players. Helps a brand-new player; can pull an experienced one off.
- **Results** show **Tracking**: the time the tracker had your gaze on the right lane and band
  (timing not included), the same measure as the eye-controller's test run.
- **Menus:** look at a button. A pie fills clockwise; after **2 seconds** it presses.
  Look away and it drains back down.
- **Straight notes** slide down the perspective highway to the **upper glowing line**. Look at
  that note's **column** (one quarter of the top half of the screen) as it arrives. Keep
  looking at the same column and every note there is hit. No blinking or looking away needed.
- **Curved notes** are ribbons that flow on down to the **lower glowing line**. Follow the
  glowing head with your eyes as it slides left and right.
- **Frenzy:** hits fill the bar at the bottom. When it is full you get 5 seconds of double
  points and no damage, and your character's eyes glow.
- **Danger:** misses drain the HP bar on the right. Below 60% the screen edges glow pink;
  below 30% they turn dark red. At 0 the song ends (F). Hitting notes brings you back.
  Practice mode has no HP and always finishes.

## Code map

```
src/main.js               services + frame loop + screen switching
src/config/game-config.js ALL tunable numbers (timing windows, points, health, Frenzy, grades, dwell, layout)
src/gameplay/             pure logic, unit-tested: chart.js (format, curve paths), judge.js,
                          scoring.js (score/health/danger/Frenzy/grades), zones.js, tracking-stats.js
src/render/               geometry.js (perspective maths, tested) and highway.js (canvas drawing)
src/input/                gaze-input.js (live / sim / mouse), dwell.js (2 s dwell buttons)
src/audio/                audio-engine.js (context + volume buses), music.js (songs, previews), sfx.js (effects)
src/characters/           characters.js (data) and portrait.js (SVG placeholder art)
src/screens/              title, calibration, modes, characters, songs, play, results, settings
src/songs/<id>/           song.json + audio + chart.<difficulty>.json   (see docs/CHARTS.md)
src/data/                 game-store.js (results, calibrations, opt-in tracking), supabase.js, settings.js
src/styles/               theme.css (colour tokens), ui.css, play.css
tools/compose/            offline composer and chart generator for the original songs
db/schema.sql             Supabase/PostgreSQL schema (optional remote database)
docs/DESIGN.md            design decisions, the sketch read-through, scoring rules
docs/CHARTS.md            song and chart formats, adding songs
```

## Data

- **Always (in this browser, IndexedDB):** song results (score, grade, accuracy, counts,
  combo, Frenzy count, a per-song gaze-accuracy summary) and calibration metadata (score,
  error per dot). Numbers only.
- **Opt-in** (Settings → Help improve eye tracking, off by default): the engine's per-frame
  measurements (19 features, gaze, target) during songs, through the eye-controller's
  telemetry module. Kept for the last 3 sessions locally, or sent to the database.
- **Never:** camera images or video.
- **Remote database (optional):** run `db/schema.sql` in Supabase, then create
  `game/.env.local` with `VITE_SUPABASE_URL=…` and `VITE_SUPABASE_ANON_KEY=…`. Settings shows
  where results are going. Failed uploads wait locally and retry.

## Online Library (archive music search)

Players can search a large catalogue of openly licensed music and play a track as an
automatically generated level. **Built-in songs are unchanged**: the Online Library is added on
top, behind a **🔍 Search** button on the song select screen.

Status: done (steps 1–5). Not built yet, on purpose: saving archive songs ("My Songs").

```
archive.org (netlabels + FMA mirror)
   │  tools/ingest.mjs  (admin key, throttled, resumable, licence + explicit filters)
   ▼
Typesense "songs" collection
   ▲  search-only scoped key (filters is_explicit:false && is_commercial_ok:true built in)
   │
game client: Search → Say Genre / Keyboard → top 5 results → hover preview → Choose (2 s)
   │  preview: HTTP Range request for the first 10 s, straight from archive.org (CORS ok)
   ▼
Downloading (first 30 s, Range request) → Analyzing → Ready → normal play screen
   │  GET /api/charts/<id>
   ▼
game/server (admin key): Typesense lookup + checks → audio cache → decode → chart generator
   → online-library/charts/<id>.v<version>.json → writes bpm/difficulty/chart_status to Typesense
   (server unreachable? the same generator runs in the browser)
```

### Playing it

1. Song select → **🔍 Search** (dwell 2 s, or click).
2. **🎤 Say Genre**: say a genre ("ambient", "drum and bass"), "search <words>", "back",
   "clear" or "stop listening". What is heard appears live in the search field.
   **⌨ Keyboard**: a gaze keyboard (each key is a dwell button) that also takes a physical
   keyboard (Enter searches, Escape goes back).
3. The **top 5 songs by popularity** appear, each from a different release (album) when
   possible. Rest your eyes (or the mouse) on a song to hear
   its first 10 seconds; look away to stop.
4. Hold your gaze on a song's **Choose** area for 2 seconds (it fills up), or say
   "choose 3" and then "yes".
5. **Downloading… → Analyzing… → Ready**, then the level starts like any other song (same
   modes, scoring, results). It uses the **first 30 seconds** of the song and ends with a short
   fade-out. Artist and license are shown while playing and on the results screen.

**Archive songs are played, not kept.** The level, its audio and the download exist while the
stage is played (play, its results screen, Retry, recalibration between songs) and are dropped
as soon as the player leaves for anything else. Results of archive songs are not saved to the
score history (IndexedDB or Supabase). Saving songs to "My Songs" is a later feature. The
server's shared chart cache is not per player: it only makes the next request for the same song
fast.

Keyboard keys press after **1 second** of dwell (the cooldown between keys is 0.3 s); Clear,
Back and every other button keep the normal 2 seconds. Set in `DWELL.keyActivateMs` /
`keyCooldownMs` (`src/config/game-config.js`); any element can use `data-dwell-ms`.

The mic button (top right, also **Alt+M**) turns voice on and off and shows when it is
listening. Voice stops automatically outside the search screens, so it never listens during
a song.

**Voice needs Chrome or Edge and an internet connection** (Chrome sends speech to Google's
recognition service). Firefox has no speech recognition: the voice buttons are disabled with
a note, and the keyboard works as usual. A blocked microphone is reported the same way.

### Only songs: music with a beat

The library is meant for music that makes a playable level, so tracks are checked twice
before they become searchable (rules in [`src/config/music-filter.json`](src/config/music-filter.json)):

1. **Tags (no download):** items tagged as non-music are skipped: spoken word, poetry,
   audiobooks, podcasts, lectures, interviews, readings, field recordings, found sounds,
   sound effects, soundscapes, drones, meditation...
2. **Audio:** every other track's **first 30 seconds** (exactly the part the level uses) are
   downloaded and analyzed like the level generator does. It is a song when the hits repeat at
   a clear beat period (pulse contrast ≥ 0.30), there is at least 1 hit per second, and at
   least 60% of the beats have sound. Measured on real archive audio: spoken word, drones and
   choral music scored ≤ 0.11; beat-driven music ≥ 0.40. If an album's first 3 tracks fail,
   the rest of it is skipped without downloading.

Songs that pass get `is_song: true` and `rhythm_score` (the pulse contrast) in Typesense; every
search, the scoped key and the server require `is_song:true`. The server checks again when it
generates a level; audio without a clear beat is refused (and hidden from search), and the
player sees "This track does not have a clear enough beat". Verdicts are cached in
`.cache/ingest/audio-checks.json` (re-checked when the thresholds change) and the downloaded
audio goes into the server's cache, so generating the level later does not download it again.
`--verbose` shows every rejected track with its reason.

### Content rules

- **NoDerivatives (ND) tracks are always excluded.** CC 4.0 counts music synced to moving
  images as an adaptation, and a note highway synced to a song arguably is one.
- **NonCommercial (NC) tracks are excluded** unless `ALLOW_NONCOMMERCIAL=true`.
- **Explicit songs never appear.** Ingestion checks titles, artist, album, tags and item
  descriptions against [`src/config/content-blocklist.json`](src/config/content-blocklist.json)
  (words, phrases, artists, ids) and does not index matches (and removes them if an earlier
  run did). As backups, every search filters `is_explicit:false` and the listed ids, and the
  client's scoped key has `is_explicit:false` built in. Run `npm run ingest -- --verbose` to
  see every skipped track and why.
- **Exclude one song by hand:** `npm run exclude-song -- <song id>` (ids look like
  `ia_<identifier>_<key>` or `fma_…`; each result row has a `data-song-id` attribute in dev tools, and they are in the
  Typesense documents). It adds the id to the blocklist and deletes the song from the index.
  Commit the JSON change to share it.
- Only `netlabels` (labels publishing their own catalogues) and the FMA mirror are ingested
  by default. `opensource_audio` / `audio_music` are open user uploads with unreliable license
  claims (commercial soundtracks marked "public domain" were found). Opt in with
  `--ia-collections` only after checking.
- Every song carries `attribution` ("Title" by Artist · License · source link); the game
  shows artist and license on every result and in every confirmation.
- Not legal advice: review the licenses before selling the game.

FMA's public API is discontinued. Its catalogue is mirrored on archive.org in the
`freemusicarchive` collection; `--source fma` reads it and tags tracks `source: fma`.

### How a level is made from audio (`src/services/chartgen/`)

Pure JavaScript, no randomness, identical on the server and in the browser:

1. **Decode** the first 30 s (server: WASM MP3/Ogg decoders; browser: Web Audio), downmix to
   mono, resample to 22,050 Hz, normalize.
2. **Onsets** by spectral flux in three bands (low/kick, mid/snare, high/hats), each band
   weighted equally so hi-hats do not swamp kicks.
3. **Tempo** from the autocorrelation of the onset envelope (70–180 BPM, preferring ~120);
   **beats** by dynamic programming (follow the onsets, keep the tempo); the first unsettled
   beats are re-extrapolated from the first run of beats that sit on real hits; the **offset**
   is the first beat on a hit.
4. **Snap** onsets to a 1/16-note grid. Grid position gives the importance: bar downbeats,
   beats, eighths, sixteenths. Strong hits and loud sections move up, weak hits and quiet
   sections move down, so intros are sparse and choruses dense.
5. **Columns** follow the melody (dominant pitch 100–2000 Hz at each hit), nudged left for
   kicks and right for hats.
6. **Sustained passages** (sound without clear hits for 2+ beats) become **curves** the eyes
   follow along the pitch contour, at most 2 bars (5 s) each, alternating with a bar of beat
   taps. This game has no hold notes; curves are its equivalent.
7. The existing chart builder (`tools/compose/chartgen.mjs`, the same one the built-in songs
   use) turns these events into **practice / normal / hard** charts with its per-difficulty
   gaps, column-jump limits and curve speeds. Too-sparse charts are densified (up to twice),
   then every chart is checked against the same rules as `npm run check-charts`.
8. BPM, offset and a difficulty rating (1–5, from the hard chart's density) are saved and
   written back to Typesense.

`GENERATOR_VERSION` (`src/services/chartgen/generate.js`) is part of every cache key: bump it
whenever the output can change, and old levels are regenerated on demand (older files of a
song are deleted when its new level is written).

### The game server (`game/server/`)

Plain `node:http`, no framework. It holds the Typesense **admin** key; the browser never does.

| Endpoint | Does |
|---|---|
| `GET /health` | `{ ok, typesense, generatorVersion }` |
| `GET /charts/<songId>` | the song's level: from `online-library/charts/`, or generated now (1–3 s). Also writes `chart_status` (`generating` → `ready`/`failed`), `chart_url`, `chart_version`, `bpm`, `difficulty` to Typesense |
| `GET /audio/<songId>` | the first 30 s of the audio, cached; the client uses it only if downloading from archive.org directly fails (CORS/network) |

Protection: only song ids are accepted (validated, then looked up in Typesense; never a
client-supplied URL); explicit, blocklisted, ND, NC (unless allowed) and non-archive.org songs
get 404; per-IP rate limits (all requests, new generations — refused songs do not count —
and audio); at most `MAX_CONCURRENT_JOBS` generations at once and `MAX_QUEUED_JOBS` waiting
(then 503); a 60 s job timeout; CORS only for `CORS_ORIGINS`; GET/OPTIONS only.

**Caches** (`online-library/`, generated, gitignored; see its README): `charts/` per song and
generator version (charts of other versions are deleted when the server starts), `audio/`
limited to `AUDIO_CACHE_MB` (default 200) with least-recently-used eviction.

**Pre-generate** levels for popular songs so they start instantly:
`npm run ingest -- --limit 0 --pregenerate 50` (`--limit 0` skips ingestion; without it,
ingestion runs first).

**Server down?** Search still works (it talks to Typesense), and the game generates the level
in the browser instead, from the 30 s it already downloaded. Built-in songs never need the server.

### Run it locally

Two ways to run Typesense:

**A. Standalone (no Docker; used in the Coder workspace)**

```bash
cd game
cp .env.example .env              # set TYPESENSE_ADMIN_API_KEY to a long random string
npm run typesense                 # downloads Typesense 30.2 once, starts it on :8108; no-op if running
npm run typesense:setup           # creates the songs collection + prints the search-only key
#   copy the printed TYPESENSE_SEARCH_API_KEY / VITE_TYPESENSE_SEARCH_API_KEY lines into .env
npm run server:install            # once: the decoder packages (the ingest audio check needs them too)
npm run ingest -- --limit 300     # index the most-downloaded allowed SONGS (downloads 30 s of each to check:
                                  #   about 1 track per second, so a few minutes; re-runs reuse the checks)
npm run server                    # the game server on :8787 (separate terminal)
npm run dev                       # the game; Vite proxies /typesense and /api
```

The binary, log and pid live in `~/.local/share/rhythmeyez/typesense/`, the data in
`~/.local/share/rhythmeyez/typesense/data` (outside the repo, so it survives restarts;
override with `TYPESENSE_HOME` / `TYPESENSE_DATA_DIR`). After a workspace restart, run
`npm run typesense` again; the index is still there. `npm run typesense:stop` stops it.

**B. Docker (if your machine has Docker)**: `npm run typesense:up` instead of
`npm run typesense` (image `typesense/typesense:30.2`, port 8108, named volume
`typesense-data`). Everything else is the same.

Ingestion options: `--source internet_archive|fma|all`, `--limit N`, `--collection NAME`,
`--dry-run`, `--restart` (forget progress), `--verbose` (log skipped tracks),
`--ia-collections a,b`, `--batch N`, `--rate MS` (gap between archive.org requests, default
1000), `--min-sec / --max-sec` (track length, default 30–600), `--scrape`,
`--skip-audio-check` (index without the song check; those tracks stay hidden from search),
`--pregenerate N`. `npm run ingest -- -h` prints them. After changing the song or explicit
rules, re-run with `--restart` so indexed tracks are checked again.

- **Resumable:** progress is saved in `game/.cache/ingest/` after every batch; run the same
  command again to continue.
- **Idempotent:** stable ids, imported with `action=emplace`. A plain `upsert` would replace
  whole documents and wipe the `bpm`, `difficulty` and `chart_*` fields written later.
- **Polite:** one request at a time, at least 1 s apart, retries with backoff (respecting
  `Retry-After`), a descriptive User-Agent.
- **Paging:** archive.org's `advancedsearch.php`, most downloaded first. It stops at 10,000
  items per query (archive.org's limit). The Scrape API has no limit, but in testing it
  returned results for other queries and repeated pages, so it is opt-in (`--scrape`) and
  validated; a page of already-seen items always ends the run instead of looping.

### Troubleshooting

- **Blank page or "Eye tracking could not start" mentioning `.vite/deps` / "Outdated Optimize
  Dep":** Vite's dependency cache changed under a running dev server. Stop `npm run dev` and
  start it again. Run only one dev server per checkout (they share `node_modules/.vite`).
  MediaPipe is now pre-bundled at start (`optimizeDeps.include`), which avoids the usual cause.
- **Search says "unavailable":** `npm run typesense` (and check the two search-key lines in `.env`).
- **"Downloading" never finishes / levels made "on this device":** `npm run server` is not running.

### Deployment (planned; nothing is deployed yet)

| Part | Where | Needs |
|---|---|---|
| Game (static files) | GitHub Pages | build-time: `VITE_BASE_PATH=/<repo-name>/`, `VITE_TYPESENSE_URL=https://<cluster>.typesense.net`, `VITE_TYPESENSE_SEARCH_API_KEY=<scoped search key>`, `VITE_SERVER_URL=https://<server host>` |
| Search | Typesense Cloud (or any Typesense) | run `typesense:setup` and `ingest` from a dev machine with `TYPESENSE_HOST/PORT=443/PROTOCOL=https/ADMIN_API_KEY` |
| Game server | Render / Railway / Fly.io (root dir `game/`, build `npm run server:install`, start `npm run server`) | `TYPESENSE_HOST/PORT/PROTOCOL/COLLECTION/ADMIN_API_KEY`, `CORS_ORIGINS=https://<user>.github.io`, `TRUST_PROXY=true`, optional `RATE_LIMIT_PER_MIN`, `GENERATION_LIMIT_PER_MIN`, `AUDIO_LIMIT_PER_MIN`, `MAX_CONCURRENT_JOBS`, `MAX_QUEUED_JOBS`, `JOB_TIMEOUT_MS`, `AUDIO_CACHE_MB`, `ONLINE_LIBRARY_DIR` (a persistent disk; without one the caches are rebuilt after restarts); `PORT` is set by the host |

- The front end contains **no secrets**: only the scoped search-only key and public URLs.
  The build fails if a `VITE_` variable holds the admin key.
- The game works from a subpath: all asset paths go through Vite's `base`
  (`VITE_BASE_PATH`), including the face-tracking model.
- Without `VITE_TYPESENSE_*` (or when the services are down), built-in songs play normally
  and Search shows "Online search is unavailable right now".
- Build: `cd game && VITE_BASE_PATH=/<repo>/ VITE_TYPESENSE_URL=… VITE_TYPESENSE_SEARCH_API_KEY=… npm run build`,
  then publish `game/dist/`.

### Installed & Added

| Kind | What | Notes |
|---|---|---|
| npm packages (front end) | none | `game/package.json` dependencies unchanged |
| npm packages (server) | `mpg123-decoder@1.0.3`, `@wasm-audio-decoders/ogg-vorbis@0.1.20` (MIT, exact versions) | in `game/server/package.json` + `server/package-lock.json`: decode MP3/Ogg in Node with WebAssembly (no ffmpeg) |
| Service | Typesense 30.2, standalone | `npm run typesense`; binary + data in `~/.local/share/rhythmeyez/typesense/` (port `TYPESENSE_PORT`, default 8108) |
| Service (optional) | Typesense 30.2, Docker | `docker-compose.yml`, image `typesense/typesense:30.2`, named volume `typesense-data` |
| API | Typesense | search engine holding the song metadata; the game only gets a scoped search-only key |
| API | Internet Archive advancedsearch / Scrape / Metadata / download | catalogue paging, per-item file lists, Range downloads of the first seconds |
| API | Web Speech API (`SpeechRecognition`) | voice search in Chrome/Edge (needs internet) |
| Service | the game server (`npm run server`, port `SERVER_PORT` 8787) | levels, shared chart cache, audio proxy/cache, Typesense write-back |
| Technology | audio analysis in plain JS (`src/services/chartgen/`) | spectral-flux onsets, autocorrelation tempo, DP beat tracking, grid snapping |
| Folder | `src/services/archive/` | licenses, content filter, metadata → documents, polite HTTP, IA client, ingestion loop |
| Folder | `src/services/search/` | Typesense REST client, `songs` schema, search parameter builder |
| Folder | `src/online/` | Online Library client: config, the one search path, partial audio download, voice session, shared UI |
| Folder | `src/voice/` | speech recognizer wrapper (auto-restart, errors) and the command parser |
| Folder | `src/services/chartgen/` | audio → charts (dsp, analyze, events, validate, generate) |
| Folder | `server/` | `index.js`, `app.js` (routes), `lib/` (config, decode, limits, stores, pipeline, setup, audio-check), `scripts/` (Typesense start/stop) |
| Folder | `online-library/` | GENERATED levels and audio cache (gitignored, only its README is committed) |
| Files | `src/online/level.js`, `src/online/registry.js`, `src/screens/online-prepare.js` | Downloading → Analyzing → Ready; generated levels kept apart from `src/songs/` |
| Screens | `src/screens/online-search.js`, `online-keyboard.js`, `online-results.js` | screens 2–4; `src/styles/online.css` |
| Config | `src/config/content-blocklist.json` | explicit words/phrases/artists and hand-excluded ids |
| Config | `src/config/music-filter.json` | what counts as a song: non-music tags and the audio thresholds |
| Files | `src/services/chartgen/musicality.js` | the song check (pulse contrast, hit rate, activity; non-music tags) |
| Typesense fields | `is_song` (bool, facet), `rhythm_score` (float, sortable), `item_id` (string, facet: one result per release) | added by `typesense:setup` (which also backfills `item_id`) / ingestion |
| Scripts | `tools/ingest.mjs`, `tools/typesense-setup.mjs`, `tools/exclude-song.mjs`, `tools/env.mjs`, `tools/blocklist.mjs`, `server/scripts/start-typesense.sh`, `server/scripts/stop-typesense.sh` | |
| npm scripts | `typesense`, `typesense:stop`, `typesense:up` (Docker), `typesense:setup`, `ingest` (now with `--pregenerate N`), `exclude-song`, `server`, `server:install`, `test:online` | |
| Config files | `.env.example`, `docker-compose.yml`; `.cache/` in `.gitignore` | |
| Env vars (server/tools) | `TYPESENSE_HOST`, `TYPESENSE_PORT`, `TYPESENSE_PROTOCOL`, `TYPESENSE_COLLECTION`, `TYPESENSE_ADMIN_API_KEY`, `TYPESENSE_SEARCH_API_KEY`, `ALLOW_NONCOMMERCIAL`, `SERVER_PORT`, `CORS_ORIGINS`, `TRUST_PROXY`, `AUDIO_CACHE_MB`, `ONLINE_LIBRARY_DIR`, `RATE_LIMIT_PER_MIN`, `GENERATION_LIMIT_PER_MIN`, `AUDIO_LIMIT_PER_MIN`, `MAX_CONCURRENT_JOBS`, `MAX_QUEUED_JOBS`, `JOB_TIMEOUT_MS` (all optional except the Typesense ones), `INGEST_USER_AGENT`, `TYPESENSE_HOME` / `TYPESENSE_DATA_DIR` (optional) | |
| Env vars (browser, public) | `VITE_TYPESENSE_URL`, `VITE_TYPESENSE_SEARCH_API_KEY`, `VITE_TYPESENSE_COLLECTION` (optional), `VITE_SERVER_URL`, `VITE_BASE_PATH` | |
| Existing files changed | `main.js` (4 screens registered; `app.onScreen` hook), `screens/songs.js` (Search button), `songs/index.js` (generated-level fallback after built-ins), `audio/music.js` (`preload`, `forget`), `input/dwell.js` (optional per-button timing), `config/game-config.js` (key dwell), `screens/play.js` (attribution line; ends at `levelEndSec` when a song has one; results of archive songs are not saved), `screens/results.js` (credit line when a song has an attribution), `index.html` (online.css), `vite.config.js` (`base`, dev proxies, admin-key guard), `package.json` (scripts) | built-in songs and charts are unchanged; `test/builtin-songs-regression.test.js` checks it |
| Tests | `archive-licenses`, `archive-metadata`, `content-filter`, `search-and-ingest`, `voice-commands`, `online-ui`, `chartgen`, `online-level`, `server`, `dwell-timing`, `builtin-songs-regression`; live: `online-integration` (`npm run test:online`) | |

**Teammate setup**

```bash
cd game && npm install
cp .env.example .env                       # set TYPESENSE_ADMIN_API_KEY
npm run typesense                          # or: npm run typesense:up (Docker)
npm run typesense:setup                    # paste the two printed key lines into .env
npm run server:install                     # decoders, used by ingestion and the server
npm run ingest -- --limit 300
npm run server                             # in a second terminal
npm run dev
```
