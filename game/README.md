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
- **Pause:** the Pause button (top right) freezes the song: Resume / Quick recalibrate /
  Songs / Home. Quit asks before leaving. The song pauses by itself if your face is out of
  view for 3 s. If tracking drifts (live quality below 30 for 2.5 s: you moved, the light
  changed) it pauses and, after "Recalibrating in 3…" (Cancel = resume), runs a quick
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
