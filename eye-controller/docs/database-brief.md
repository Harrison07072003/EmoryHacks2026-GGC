# Database brief: what the eye tracker actually produces

For whoever builds the Supabase integration. This replaces the assumptions in the original
database prompt with what the code really does. Written 2026-11-14; the tracker lives in
`eye-controller/` (the older code in `app/` is a separate, earlier prototype).

## Corrections to the original brief

| The brief says | What is true |
|---|---|
| Several games (osu!-style, piano, DDR) | One game: 4 lanes x 2 bands ("top" and "bottom"). The tracker reports a gaze point, a lane 0-3 and a band. |
| "Inspect our existing implementation" | Inspect `eye-controller/`, not `app/`. Plain JavaScript ES modules, Vite, runs entirely in the browser. No backend exists yet. |
| MediaPipe gives landmarks and blendshapes | Correct, and it gives no gaze. Gaze comes from our own per-player ridge-regression model on top of 19 numbers derived from the landmarks. |
| Expected target coordinates | Known during calibration (the dot on screen). During play the game supplies it with `eyes.setTarget({ x, y }, noteId)`; until the game does, play samples have no target. |
| "Accurate or inaccurate" | Not a value we produce. Define it as: predicted lane and band equal the target's lane and band. Compute it, do not expect it. |
| Head rotation (pitch, yaw, roll) | Yaw and pitch only. Roll is not calculated. We also have face centre x, y and face width. |
| Eye visibility / tracking status | Not available. Per eye we have openness, glare fraction, pupil contrast and brightness. |
| Detection confidence | Ours, not MediaPipe's: `quality` 0-100 (calibration score scaled down by light, glare, framing, head drift). |
| Blendshape scores | Only the two blink scores are used, and only as one boolean `blink`. No blendshape values are kept. |
| Raw landmark information | Not kept. 478 points per frame is too much and not needed; the 19 features are what the model consumes. |
| Frame processing time | Measured per frame on the live camera (`process_ms`: detector + eye crops + pupil finder). |
| 30-60 samples per second | 30 measured on our laptops. |

## The one thing that matters most

**Store the 19-number feature vector `f` and the target for every frame.** With those two
we can refit and compare any future gaze model offline. With only the gaze output we can
measure the current model but never improve on it. Everything else is secondary.

## What one frame contains

Every camera frame the tracker emits one "feature frame". This is the exact shape, and it
is already what our recorder saves to disk:

| Field | Type | Meaning |
|---|---|---|
| `t` | number | milliseconds from `performance.now()`. Not wall-clock time: store the session's wall-clock start separately. |
| `face` | boolean | a face was found. When false, none of the fields below exist. |
| `blink` | boolean | eyes closed this frame (gaze is held, not updated) |
| `f` | 19 numbers | the model input. 0-3 right eye (iris u, v; pupil u, v), 4-7 left eye, 8-12 head (yaw, pitch, face x, face y, face width), 13-18 curvature terms |
| `eyes.R`, `eyes.L` | objects | `open` (eyelid opening), `glare` (0-1 fraction of blown-out pixels), `conf` (0-1 pupil contrast), `lum` (0-255 brightness) |
| `head` | 5 numbers | same as `f[8..12]` |
| `box` | `{x, y, w, h}` | face bounding box, 0-1 of the camera frame |
| `exposure` | object | `mean`, `p5`, `p95`, `dark`, `clipped` for the face region (live camera only) |
| `target` | `{x, y}` or null | the calibration dot on screen, when there is one |

Produced by the model for the same frame (read from `eyes.state`):

| Field | Meaning |
|---|---|
| `gaze.x`, `gaze.y` | smoothed gaze, 0-1 of the play area (0,0 = top left) |
| `lane`, `band` | 0-3 or null; `'top'`, `'bottom'` or null |
| `quality` | 0-100 |
| `faceVisible`, `ready`, `calibrationScore` | face present; calibration good enough to play; score 0-100 |

All coordinates are normalized 0-1, never pixels.

## Store versus compute

| Store | Compute when analysing |
|---|---|
| `f`, `target`, `t`, `face`, `blink` | distance error (from gaze and target) |
| gaze x, y, lane, band, quality | accurate / inaccurate (lane and band match) |
| per-eye `open`, `glare`, `conf`, `lum` | lane and band of the target (from its x, y) |
| `box`, `exposure` (optional, small) | averages per session |

`head` duplicates `f[8..12]` and can be dropped.

## Size

Measured on real clips: about 640 bytes per frame as JSON, 30 frames a second, so roughly
1.1 MB and 1,800 frames per player-minute. Rounding numbers to 5 decimals is already done.
One row per frame works; one row per 1-2 second batch holding a JSON array is much cheaper
and is enough for analysis.

## Versions to record per session

- App version: `0.1.0` (`package.json`)
- Feature layout: `FEATURE_VERSION = 2` (`src/cv/features.js`). Frames with different
  versions must never be mixed in one model fit, so this must be on every session.
- MediaPipe runtime: `@mediapipe/tasks-vision` 1.2.3
- MediaPipe model: `face_landmarker` float16, version 1
- Camera settings in use (brightness, contrast, gamma, equalize, crop): `eyes.camera.settings`

## Calibration information

`startCalibration()` resolves with `{ score, ok, weakCells, points }`. Each point has its
target, a 0-100 score, steadiness, held-out error (`residual`) and whether it was kept.
The full profile (`src/storage/profiles.js`) also holds the 18 feature vectors captured
for each of the 16 dots: about 80 KB per player.

## Where to hook in: you only write `send`

The buffering, batching, retry and de-duplication you were asked for already exist and are
tested (`src/telemetry/telemetry.js`, `test/telemetry.test.js`). It is database-agnostic.
Your part is one async function that writes a message to Supabase:

```js
import { createEyeController, createTelemetry } from './eye-controller/src/index.js';

const eyes = createEyeController();
const telemetry = createTelemetry(eyes, {
  session: { player: 'jon', game: 'rhythm' },     // any extra session fields you want
  send: async message => {
    // upsert on message.id; throw on any error so it is retried
    if (message.type === 'session')     { /* -> sessions */ }
    if (message.type === 'calibration') { /* -> calibrations */ }
    if (message.type === 'samples')     { /* -> sample batches, or one row per message.samples[i] */ }
  },
});
await eyes.init();
// ... play ...
await telemetry.stop();     // final upload
```

What it guarantees:

- The frame handler only pushes to an array; it never waits on the network.
- One upload about every 1.5 seconds (`flushMs`), never one per frame.
- Messages arrive in order: the session first, then calibrations and sample batches.
- If `send` throws, the message stays queued and is retried with the **same `id`**, so an
  upsert on `id` cannot create duplicates. Sample batch ids are `<session id>:<sequence>`.
- While offline the queue is capped (50,000 rows, about 25 minutes). Beyond that the oldest
  batches are dropped and counted in `telemetry.stats.dropped`, never silently.
- `telemetry.stats` = `{ sent, queued, dropped, failures, lastError }`.

The three messages:

| `type` | Fields |
|---|---|
| `session` | `id`, `started_at`, `clock_offset_ms`, `app_version`, `feature_version`, `mediapipe_runtime`, `mediapipe_model`, `layout`, `camera_settings`, plus your own |
| `calibration` | `id`, `session_id`, `t`, `score`, `ok`, `weak_cells`, `points[]` (`x`, `y`, `score`, `kept`, `steadiness`, `residual`) |
| `samples` | `id`, `session_id`, `seq`, `samples[]` (rows below) |

One sample row (one per camera frame; fields are null when there is no face):

| Field | Meaning |
|---|---|
| `t` | ms since page load; wall-clock time = `t + session.clock_offset_ms` |
| `face`, `blink` | booleans |
| `features` | the 19 model inputs |
| `gaze_x`, `gaze_y` | model output for this same frame, 0-1 |
| `lane`, `band`, `quality` | as reported to the game |
| `target_x`, `target_y`, `target_id`, `target_source` | where the player should be looking; source is `'calibration'`, `'game'` or null |
| `r_open`, `r_glare`, `r_contrast`, `r_light` and `l_...` | per-eye measurements |
| `process_ms` | frame processing time (live camera only) |

You can develop against the mock with no camera: swap `createEyeController()` for
`createMockEyeController()`; the messages are identical.

To read data back for analysis, the useful queries are: all sample rows for a session in
`t` order, and all sessions for a player / app version / feature version.

## Two other kinds of data that already exist

The tracking samples above are new. These two are already implemented and stored in the
browser, and may also want a home in the database:

- **Player profiles**: one per player name, the calibration points described above.
- **Pooled baseline**: summed statistics across players (a 20x20 matrix and two vectors, a
  few KB, no raw samples) that warm-starts a new player's model. `exportBaseline()` and
  `importBaseline()` exchange it as plain JSON.

Both go through one small async interface in `src/storage/kv.js`: `get(key)`,
`set(key, value)`, `delete(key)`, `keys(prefix)`. A Supabase adapter with those four
methods, passed as `createEyeController({ storage })`, moves profiles and the baseline to
the database with no other code change. Keys in use: `profile:<id>` and `baseline`.

## Requirements from the original brief that still stand

- Never one request per frame; buffer and flush every 1-2 seconds.
- Never `await` the network in the frame handler.
- Keep failed batches and retry them; give each batch a client-made id (session id plus a
  sequence number) and upsert on it so retries cannot duplicate.
- Numbers only. No images or video are produced anywhere in the pipeline.

## Privacy note

The data is numerical but derived from a face, and profiles are keyed by a player name.
Decide who can read it before turning on public access rules in Supabase.
