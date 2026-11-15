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
different forwarding URL, it looks like a brand-new player.

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

- **Face check (before every calibration):** you see yourself in a mirrored camera view with an
  oval. Move until every line is green (face found, centered, distance, lighting; glasses glare
  is only a warning). After 1.5 s of all-green it continues by itself.
- **Pause:** the Pause button (top right) freezes the song: Resume / Songs / Home. Quit asks
  before leaving. The song also pauses by itself if your face is out of view for 3 s. Resume
  rewinds 1 s and counts in.
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

Status: steps 2–3 of 5 done (search index, ingestion, search screens, voice). Step 4 adds the
level generator and the game server; until then, choosing a song shows a placeholder.

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
[step 4] game/server: first 30 s → chart generator → cache → play; writes bpm/difficulty back
```

### Playing it

1. Song select → **🔍 Search** (dwell 2 s, or click).
2. **🎤 Say Genre**: say a genre ("ambient", "drum and bass"), "search <words>", "back",
   "clear" or "stop listening". What is heard appears live in the search field.
   **⌨ Keyboard**: a gaze keyboard (each key is a dwell button) that also takes a physical
   keyboard (Enter searches, Escape goes back).
3. The **top 5 songs by popularity** appear. Rest your eyes (or the mouse) on a song to hear
   its first 10 seconds; look away to stop.
4. Hold your gaze on a song's **Choose** area for 2 seconds (it fills up), or say
   "choose 3" and then "yes".

The mic button (top right, also **Alt+M**) turns voice on and off and shows when it is
listening. Voice stops automatically outside the search screens, so it never listens during
a song.

**Voice needs Chrome or Edge and an internet connection** (Chrome sends speech to Google's
recognition service). Firefox has no speech recognition: the voice buttons are disabled with
a note, and the keyboard works as usual. A blocked microphone is reported the same way.

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

### Run it locally

Two ways to run Typesense:

**A. Standalone (no Docker; used in the Coder workspace)**

```bash
cd game
cp .env.example .env              # set TYPESENSE_ADMIN_API_KEY to a long random string
npm run typesense                 # downloads Typesense 30.2 once, starts it on :8108; no-op if running
npm run typesense:setup           # creates the songs collection + prints the search-only key
#   copy the printed TYPESENSE_SEARCH_API_KEY / VITE_TYPESENSE_SEARCH_API_KEY lines into .env
npm run ingest -- --limit 300     # index the most-downloaded allowed tracks
npm run dev                       # the game; Vite proxies /typesense to Typesense
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
1000), `--min-sec / --max-sec` (track length, default 30–600), `--scrape`. `npm run ingest -- -h`
prints them.

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

### Deployment (planned; nothing is deployed yet)

| Part | Where | Needs |
|---|---|---|
| Game (static files) | GitHub Pages | build-time: `VITE_BASE_PATH=/<repo-name>/`, `VITE_TYPESENSE_URL=https://<cluster>.typesense.net`, `VITE_TYPESENSE_SEARCH_API_KEY=<scoped search key>`, `VITE_SERVER_URL=https://<server host>` |
| Search | Typesense Cloud (or any Typesense) | run `typesense:setup` and `ingest` from a dev machine with `TYPESENSE_HOST/PORT=443/PROTOCOL=https/ADMIN_API_KEY` |
| Game server (step 4) | Render / Railway / Fly.io | `TYPESENSE_*` incl. the admin key, `CORS_ORIGINS=https://<user>.github.io`, rate limits; never in the front end |

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
| npm packages | none | the Typesense and archive.org clients use plain `fetch`, like `data/supabase.js`; no lockfile changes |
| Service | Typesense 30.2, standalone | `npm run typesense`; binary + data in `~/.local/share/rhythmeyez/typesense/` (port `TYPESENSE_PORT`, default 8108) |
| Service (optional) | Typesense 30.2, Docker | `docker-compose.yml`, image `typesense/typesense:30.2`, named volume `typesense-data` |
| API | Typesense | search engine holding the song metadata; the game only gets a scoped search-only key |
| API | Internet Archive advancedsearch / Scrape / Metadata / download | catalogue paging, per-item file lists, Range downloads of the first seconds |
| API | Web Speech API (`SpeechRecognition`) | voice search in Chrome/Edge (needs internet) |
| Folder | `src/services/archive/` | licenses, content filter, metadata → documents, polite HTTP, IA client, ingestion loop |
| Folder | `src/services/search/` | Typesense REST client, `songs` schema, search parameter builder |
| Folder | `src/online/` | Online Library client: config, the one search path, partial audio download, voice session, shared UI |
| Folder | `src/voice/` | speech recognizer wrapper (auto-restart, errors) and the command parser |
| Screens | `src/screens/online-search.js`, `online-keyboard.js`, `online-results.js` | screens 2–4; `src/styles/online.css` |
| Config | `src/config/content-blocklist.json` | explicit words/phrases/artists and hand-excluded ids |
| Scripts | `tools/ingest.mjs`, `tools/typesense-setup.mjs`, `tools/exclude-song.mjs`, `tools/env.mjs`, `tools/blocklist.mjs`, `server/scripts/start-typesense.sh`, `server/scripts/stop-typesense.sh` | |
| npm scripts | `typesense`, `typesense:stop`, `typesense:up` (Docker), `typesense:setup`, `ingest`, `exclude-song` | |
| Config files | `.env.example`, `docker-compose.yml`; `.cache/` in `.gitignore` | |
| Env vars (server/tools) | `TYPESENSE_HOST`, `TYPESENSE_PORT`, `TYPESENSE_PROTOCOL`, `TYPESENSE_COLLECTION`, `TYPESENSE_ADMIN_API_KEY`, `TYPESENSE_SEARCH_API_KEY`, `ALLOW_NONCOMMERCIAL`, `SERVER_PORT`, `INGEST_USER_AGENT` (optional), `TYPESENSE_HOME` / `TYPESENSE_DATA_DIR` (optional) | |
| Env vars (browser, public) | `VITE_TYPESENSE_URL`, `VITE_TYPESENSE_SEARCH_API_KEY`, `VITE_TYPESENSE_COLLECTION` (optional), `VITE_SERVER_URL`, `VITE_BASE_PATH` | |
| Existing files changed | `main.js` (3 screens registered), `screens/songs.js` (Search button), `index.html` (online.css), `vite.config.js` (`base`, dev proxies, admin-key guard), `package.json` (scripts) | built-in songs, charts and the rest of the flow are untouched |
| Tests | `archive-licenses`, `archive-metadata`, `content-filter`, `search-and-ingest`, `voice-commands`, `online-ui` | |

**Teammate setup**

```bash
cd game && npm install
cp .env.example .env                       # set TYPESENSE_ADMIN_API_KEY
npm run typesense                          # or: npm run typesense:up (Docker)
npm run typesense:setup                    # paste the two printed key lines into .env
npm run ingest -- --limit 300
npm run dev
```
