# eye-controller

Turns a webcam into gaze input for a 4-lane, 2-band rhythm game. It is only the input
module: the game is built on top of the public interface below and never touches tracker
internals.

## Run

**Recording clips?** Follow [docs/START-HERE.md](docs/START-HERE.md).
**Finding the best seat / camera / screen angle?** Use the setup tester: [docs/SETUP-TESTER.md](docs/SETUP-TESTER.md).

```bash
npm install     # also copies the MediaPipe wasm runtime into public/mediapipe/
npm run fetch-model   # once: saves the face model locally so tracking works offline
npm run dev     # open the printed http://localhost link in Chrome
npm run build   # production build into dist/
npm test        # all unit and end-to-end tests, headless, no camera needed
```

- `/` is **Hello Lanes**, the example harness. It starts on the mock (move the mouse = move
  the eyes). Add `?live` to the URL, or press "Use live webcam", for real tracking.
- `/debug.html` is the tracker debug page: camera view (what the tracker analyses, after
  auto-exposure and the face-following zoom; press P for the raw camera), eye crops, camera-adjust sliders,
  calibration, session recording, baseline export / import.

## Requirements

| What | Notes |
|---|---|
| Node 20+ and npm | tested on Node 24 |
| Chrome (or Edge) | webcam permission; must be opened from `http://localhost` or https |
| `@mediapipe/tasks-vision` | Face Landmarker, runs on-device. Installed by npm |
| Vite, Vitest, fake-indexeddb | dev server / build, tests, storage tests. Installed by npm |

The MediaPipe **model file** (about 4 MB) is served from `public/mediapipe/face_landmarker.task`
when `npm run fetch-model` has been run (it downloads from Google's official model storage).
If the file is not there, the app falls back to fetching it from that same URL at runtime.
`public/mediapipe/` is git-ignored, so each machine runs the script once.

## Build the game on top

```js
import { createMockEyeController, createEyeController } from './eye-controller/src/index.js';

const eyes = createMockEyeController();   // <- change to createEyeController() for the live webcam
await eyes.init();

eyes.onLaneChange((lane, band) => { /* a discrete move: lane 0-3 or null, band 'top' | 'bottom' | null */ });
eyes.onPathSample(({ x, y }, t) => { /* every frame: score smooth pursuit in the lower band */ });

function frame() {
  const { gaze, lane, band, quality, faceVisible } = eyes.state;   // read any time
  requestAnimationFrame(frame);
}
```

That one line is the whole switch between mock and real. `harness/hello-lanes.js` is the
copy-paste pattern (about 70 lines).

### Public interface

Coordinates are normalized: `x` 0 = left edge, 1 = right edge; `y` 0 = top, 1 = bottom.
Lanes split `x` into 4 equal columns; `y < 0.5` is the `top` band. Timestamps `t` are
`performance.now()` milliseconds.

**State** — `eyes.state`, one object updated in place every frame:

| Field | Type | Meaning |
|---|---|---|
| `gaze` | `{ x, y }` | smoothed gaze point, 0-1 |
| `lane` | `0 \| 1 \| 2 \| 3 \| null` | null when no face, or not calibrated well enough |
| `band` | `'top' \| 'bottom' \| null` | |
| `quality` | `0-100` | calibration score scaled down by live problems (light, glare, face leaving frame, head moved) |
| `faceVisible` | `boolean` | |
| `ready` | `boolean` | extra: calibration cleared the threshold, lanes are being reported |
| `calibrationScore` | `0-100 \| null` | extra: score of the current calibration |

**Events** — each returns an unsubscribe function:

`onLaneChange(lane, band)` · `onPathSample({ x, y }, t)` · `onFaceLost()` · `onFaceFound()` ·
`onQualityChange(score)` · `onCalibrationComplete(score)`

**Lifecycle**

| Call | Does |
|---|---|
| `await init(videoEl?)` | start camera + tracking (a hidden `<video>` is created if you pass none) |
| `await startCalibration(options?)` | run calibration; resolves `{ score, ok, weakCells, points }` |
| `stop()` | stop the camera and any running calibration |
| `await loadProfile(id?)` | load a saved player; resolves `false` if there is none |
| `await saveProfile(id?)` | save the current calibration and add it to the pooled baseline |
| `await exportBaseline()` / `await importBaseline(data)` | move the pooled baseline between machines |

Extras outside the frozen contract: `eyes.faceData()` (camera image, face mesh, eye close-ups,
latest frame: for drawing the player's face), `eyes.cancelCalibration()`, `eyes.setTarget({ x, y }, id)` (tell the tracker where
the player should be looking, so collected data can be scored), `eyes.onSample(cb)` (one
object per frame with measurements, gaze and target; see `docs/database-brief.md`),
`eyes.confirmOnTarget({ x, y })` (online refinement: call
it when the player has certainly hit a known spot), `eyes.weakCells()`, `eyes.listProfiles()`,
`eyes.layout`, and on the mock `eyes.mock.step(ms) / lookAt(point) / setConditions(...)`.

Options for both constructors: `{ layout: { lanes, bandSplit }, minScore, storage, profileId }`.

### Using the mock

`createMockEyeController(options)` runs the real pipeline on simulated eye data, so events,
smoothing, lane hysteresis, quality and calibration all behave like the live module.

- In a browser the fake eyes follow the mouse (a scripted demo plays until it moves).
- It is calibrated the moment `init()` resolves; pass `autoCalibrate: false` to test your
  calibration screens.
- `noise: 'ideal'` gives perfect eyes; the default `'realistic'` adds jitter, head drift and blinks.
- For game tests without a browser: `{ clock: 'manual' }`, then `eyes.mock.lookAt({ x, y })`
  and `eyes.mock.step(ms)`. See `test/controller.test.js`.
- `eyes.mock.setConditions({ faceLost: true })` or `{ light: 'bad', glare: true }` to see how
  your game reacts.

## Calibration flow

1. `startCalibration()` shows a dot that walks 16 targets (every lane on three rows, plus
   corners). Each dot stays until the last 18 frames are steady, so there is no fixed
   duration: about a second per dot for a calm player, up to 4 s for a shaky one.
   Then two play-like phases: a dot that glides through both bands (~11 s, follow it) and
   8 dots that hop between the top and bottom band (~10 s). They are never scored, only
   added as training data; on real clips they fixed most of the bottom-band path errors
   and raised band switches. Turn them off with `{ pursuitMs: 0, hops: 0 }`.
2. Every dot is scored 0-100 from steadiness during capture and its held-out error after
   fitting. Clear outliers are dropped (never more than a quarter).
3. The overall score comes back in the result and in `onCalibrationComplete`. Below
   `minScore` (default 60) `ok` is false, `ready` stays false and no lanes are reported.
4. Offer `startCalibration({ topUp: true })`: it re-captures only `weakCells` (two dots
   each) and merges them with the existing data.
5. `startCalibration({ quick: true })` uses one dot per cell on top of the player's current
   calibration (or the pooled baseline); with neither it is a full calibration.
   `createEyeController({ pool: false })` never warm-starts from the pool.

Draw the dots yourself with `startCalibration({ onTarget(target, index, total, info), onProgress(p) })`
(`info.moving` during the gliding dot, called every frame; `info.hop` during the band hops).

**Learning during play:** call `eyes.confirmOnTarget({ x, y })` whenever the player hits a
note (the reported lane and band match it). The tracker then keeps adapting to the player.
On real clips this lifted lane jumps from 78% to 82% on target and band switches from 62%
to 65%. Hello Lanes does not do it; the debug page's test run does.
Otherwise a built-in full-screen overlay is used; Escape cancels it.

**Keys in Hello Lanes:** `C` face check → calibrate → result screen, `V` face check only, `T` top-up weak cells, and on the mock `F` hide the
face, `B` bad light.

## Camera adjust (bad light / glare)

`eyes.camera.set({ ... })` on the live controller, or the sliders on `/debug.html`:
`auto` (meter the face and correct exposure), `brightness`, `contrast`, `gamma`,
`equalize` (histogram equalization strength), `autoCenter` (virtual pan/zoom that follows
the face), `zoom`, `panX`, `panY`.

## Recording and scoring real sessions

See **[docs/data-collection.md](docs/data-collection.md)**. In short: on `/debug.html`
enter a player name, pick a condition, press **Record clip** (calibration + a 47 s test run
of lane jumps, a moving path and band switches). Clips land in `recordings/`;
`npm run replay` scores them all and writes `recordings/scores.csv`.

## Players and the pooled baseline

- **Save profile** stores the current calibration under the name in the "player name" box,
  in this browser. Use one name per person; saving the same name again replaces it.
- Every saved profile with a passing score is also added to the **pooled baseline**: summed
  statistics across players (no raw samples) that warm-start a new player's model.
- **Export** writes the pool to `baselines/baseline-<n>-players_<date-time>.json`.
  **Import** merges a pool file from another machine into this browser's pool.

## Storage

Profiles and the pooled baseline go through a four-method key-value interface
(`src/storage/kv.js`). localStorage is the default; IndexedDB is already implemented and
tested:

```js
import { createEyeController, indexedDbStore } from './src/index.js';
const eyes = createEyeController({ storage: indexedDbStore() });
```

**Adding a remote database** (cross-device training data) means writing one more adapter
with the same four async methods and passing it as `storage`; nothing else changes:

```js
const remoteStore = {
  async get(key) { /* -> stored JSON value, or null */ },
  async set(key, value) { /* value is plain JSON */ },
  async delete(key) {},
  async keys(prefix) { /* -> array of keys starting with prefix */ },
};
```

Keys in use: `profile:<id>` (one player's calibration points) and `baseline` (the pool).
`exportBaseline()` returns plain JSON and `importBaseline(data)` merges it into the local
pool, so that pair is the sync payload if you would rather sync only the pool.

## Code map

```
src/index.js          public entry point
src/controller.js     the seam: contract on top, any frame source below
src/mock.js           mock controller (simulator as the frame source)
src/core/             engine: feature frames -> state + events
src/capture/          webcam, MediaPipe, preprocessing, virtual crop
src/cv/               pupil finder, feature vector
src/model/            ridge regression, per-player gaze model
src/calibration/      targets, adaptive capture, scoring, fitting
src/smoothing/        median, saccade snap, One Euro, steady-gaze lock
src/signals/          lanes/bands, face presence, quality score
src/storage/          key-value adapters, profiles, pooled baseline
scripts/              copy-mediapipe (postinstall), fetch-model, replay, dev-server save plugin
recordings/           recorded clips (written by the debug page)
baselines/            exported pooled baselines
src/setup/            setup tester maths: distance, camera height, eye range, setup score
src/simulator/        fake eye, synthetic source, record / replay / evaluate
src/telemetry/        buffered, retrying upload of per-frame samples to a database
src/testrun/          scripted test run (jumps, path, band switches) and its full-screen player
docs/                 data-collection.md (how to record and score clips), database-brief.md
harness/protocol.js   the data-collection checklist
src/ui/               face view, face check, calibration overlay, score reveal (ready-made screens)
docs/GAME-INTEGRATION.md   what is new for the game team, and how to use the screens
harness/              hello-lanes (example game) and the debug page
test/                 Vitest suites
```
