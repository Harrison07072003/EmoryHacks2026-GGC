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

## Online Library (archive music search) — in progress

Players will be able to search a large catalogue of openly licensed music and play any track
as an automatically generated level. **Built-in songs are unchanged**; this is added on top.
Status: step 2 of 5 done (search index + ingestion). The in-game UI, chart generator and server
come next.

```
archive.org (netlabels + FMA mirror)
   │  tools/ingest.mjs  (admin key, throttled, resumable)
   ▼
Typesense "songs" collection ◄── game client searches it with a SEARCH-ONLY scoped key   [step 3]
   ▲
   └── game/server: downloads audio, generates charts, writes bpm/difficulty/chart_status  [step 4]
```

### Licensing rules (enforced at ingestion and in the search key)

- **NoDerivatives (ND) tracks are always excluded.** CC 4.0 counts music synced to moving
  images as an adaptation, and a note highway synced to a song arguably is one.
- **NonCommercial (NC) tracks are excluded** unless `ALLOW_NONCOMMERCIAL=true`. The client
  search key also has `is_commercial_ok:true` built in, so NC tracks stay hidden even if some
  were indexed earlier.
- Only `netlabels` (labels publishing their own catalogues) and the FMA mirror are ingested
  by default. `opensource_audio` / `audio_music` are open user uploads with unreliable license
  claims (commercial soundtracks marked "public domain" were found). Opt in with
  `--ia-collections` only after checking.
- Every document carries `attribution` ("Title" by Artist · License · source link), which the
  game shows wherever an archive song is shown or played.
- Not legal advice: review the licenses before selling the game.

### Free Music Archive

FMA's public API is discontinued. FMA's catalogue is mirrored on archive.org in the
`freemusicarchive` collection, with a link back to FMA on each item; `--source fma` reads that
collection and tags tracks `source: fma`.

### Set up Typesense and ingest

```bash
cd game
cp .env.example .env              # set TYPESENSE_ADMIN_API_KEY to a long random string
npm run typesense:up              # docker compose: typesense/typesense:30.2 on :8108, volume typesense-data
npm run typesense:setup           # creates the songs collection + prints the search-only key
#   copy the printed TYPESENSE_SEARCH_API_KEY / VITE_TYPESENSE_SEARCH_API_KEY lines into .env
npm run ingest -- --limit 200     # index the 200 most-downloaded allowed tracks
```

Ingestion options: `--source internet_archive|fma|all`, `--limit N`, `--collection NAME`,
`--dry-run` (fetch and print, write nothing), `--restart` (forget progress),
`--ia-collections a,b`, `--batch N`, `--rate MS` (gap between archive.org requests, default
1000), `--min-sec / --max-sec` (accepted track length, default 30–600). `npm run ingest -- -h`
prints them.

- **Resumable:** progress is saved in `game/.cache/ingest/` after every batch; run the same
  command again to continue. Stopping with Ctrl+C is safe.
- **Idempotent:** documents use stable ids (`ia_<identifier>_<filekey>` / `fma_…`) and are
  imported with `action=emplace`. A plain `upsert` would replace whole documents and wipe the
  `bpm`, `difficulty` and `chart_*` fields written by chart generation.
- **Polite:** one request at a time, at least 1 s apart, retries with exponential backoff
  (respecting `Retry-After`) on 429/5xx, and a descriptive User-Agent.
- **Robust:** items with broken metadata, no MP3/OGG file, an unknown duration or a disallowed
  license are skipped and counted in the summary. The archive.org Scrape API was seen returning
  stale results for unrelated queries; the client detects this and falls back to
  `advancedsearch.php` paging.

Typesense Cloud: set `TYPESENSE_HOST` (e.g. `xxx.a1.typesense.net`), `TYPESENSE_PORT=443`,
`TYPESENSE_PROTOCOL=https` and the cluster's admin key, then run the same commands except `typesense:up`.

### Installed & Added

| Kind | What | Notes |
|---|---|---|
| npm packages | none so far | the Typesense and archive.org clients use plain `fetch`, like `data/supabase.js` |
| Service | Typesense 30.2 (`typesense/typesense:30.2`) | `docker-compose.yml`, port `8108` (`TYPESENSE_PORT`), data in the named Docker volume `typesense-data` |
| API | Typesense | search engine holding the song metadata; the game only gets a search-only key |
| API | Internet Archive Scrape / advancedsearch / Metadata | catalogue paging and per-item file lists |
| Folder | `src/services/archive/` | licenses, metadata → document mapping, polite HTTP, IA client, ingestion loop |
| Folder | `src/services/search/` | Typesense REST client, `songs` schema, search parameter builder |
| Scripts | `tools/ingest.mjs`, `tools/typesense-setup.mjs`, `tools/env.mjs` | ingestion CLI, collection + key setup, `.env` loader |
| npm scripts | `typesense:up`, `typesense:setup`, `ingest` | |
| Config | `.env.example`, `docker-compose.yml` | `.cache/` added to `.gitignore` |
| Env vars | `TYPESENSE_HOST`, `TYPESENSE_PORT`, `TYPESENSE_PROTOCOL`, `TYPESENSE_COLLECTION`, `TYPESENSE_ADMIN_API_KEY` (scripts/server only), `TYPESENSE_SEARCH_API_KEY`, `VITE_TYPESENSE_URL`, `VITE_TYPESENSE_SEARCH_API_KEY`, `ALLOW_NONCOMMERCIAL`, `INGEST_USER_AGENT` (optional) | |
| Tests | `test/archive-licenses.test.js`, `test/archive-metadata.test.js`, `test/search-and-ingest.test.js` | |
