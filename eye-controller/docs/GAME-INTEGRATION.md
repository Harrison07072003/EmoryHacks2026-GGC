# Eye-controller and the game

> **Status 2026-11-15:** the game is merged into `main` and already uses everything below:
> the engine's face view and checks in its face-check screen, the engine's calibration and
> result screens via `game/src/input/calibration-flow.js` (theme `'neon'`, `keys: false`,
> buttons pressed by the game's dwell), `cancelCalibration()`, shorter quick calibrations
> (`hops: 4`), drift straight into an in-song quick recalibration, and the mouse modes.
> Since v0.6.1 a quick calibration builds on the player's own current calibration, the pool
> is opt-in for the game (`pool: false`), and corner dots are not gaze-checked.
> The notes below explain the engine side.

## Eye-controller v0.4+: what is new for the game

Written for the game team after reading the game branch (`game/src/screens/face-check.js`,
`calibration.js`, `input/gaze-input.js`, `config/game-config.js`) on 2026-11-15. Everything
below is additive: nothing the game uses today was renamed or removed.

## 1. Calibration changes you will notice

Since v0.3 a full calibration has three phases, about 45 seconds in all:

| Phase | What the player does | `onTarget(target, index, total, info)` |
|---|---|---|
| dots | look at 16 dots (8 for `quick` once a pooled baseline exists) | `info.phase === 'dots'`; index / total count the dots |
| pursuit | follow a gliding dot (`pursuitMs`, default 10 s) | `info.phase === 'pursuit'`, `info.moving`; called every frame |
| hops | look at 8 dots jumping between the top and bottom band | `info.phase === 'hops'`, `info.hop`; **index / total count the hops (1/8 … 8/8)** |

The hops are new in v0.3. Before v0.4 your counter showed "17 / 16" during them; it now
reads "1 / 8" … "8 / 8" with no change on your side. To restyle them, branch on `info.hop`.

Why they are there: on real recordings, calibrating on play-like movement kept the
bottom-band path in the right band 98% of the time instead of 74%. The hops
measured smaller in live play (~2 points), so for a short between-songs calibration you
can drop or shorten them:

```js
eyes.startCalibration({ quick: true, pursuitMs: 5000, hops: 4 });   // or hops: 0
```

**Hops are checked against the player's gaze (v0.5).** A provisional model fitted on the
dots tells which band the player looks at; a hop only fills while the gaze is in the dot's
band and about its lane (15 frames), only those frames are used, and a hop the player never
looks at gives up after 4 s and adds nothing. Before v0.5 hops were timed and passed even
when looking elsewhere. During the hops `onProgress(p, info)` also gives `info.gaze` (the
provisional gaze point) and `info.onTarget`; the built-in screen lights the band the gaze
is in (green = the dot's band, amber = wrong) and shows "look at the dot". `info.stage` can
be `'skipped'` when a hop gave up.

**Dots are checked against the player's gaze too (v0.5.1).** From the 3rd dot a left/right
fit from the dots so far, from the 6th a provisional model of both axes, decides whether
the eyes are on the dot; a dot only completes when they are. Tolerances were set on 518
recorded dots (94-97% of real attempts pass at once; looking well away is caught ~87% of
the time). Looking away just stalls the dot: after 3.5 s it ends weak with no samples
(`offTarget: true`), so no wrong data reaches the model and the result screen offers a
top-up. During the dots `info.onTarget` (and, from the 6th dot, `info.gaze`) are reported
like in the hops; the built-in screen shows "look at the dot".

**Make the dots feel tracked, not timed.** Each dot now captures 24 frames (was 18) and
holds a 0.3 s "locked" moment before moving on. `onProgress(p, info)` gets a second
argument during the dots: `info.stage` is `'seeking'` (eyes still travelling), `'capturing'`
(p rises with steadiness and drops when the eyes wobble) or `'locked'`, and
`info.steadiness` is 0-1. The built-in screen uses it for a spinning ring while seeking, a
reticle that tightens as the eyes steady, a "hold steady" hint, and a green lock with a
burst. If you draw your own dots, using `info.stage` and `info.steadiness` the same way is
what stops calibration looking like a timer.

**Cancel a calibration** with `eyes.cancelCalibration()` instead of
`eyes.debug.engine.session?.abort()` (same effect, public and stable).

## 2. Face view: the "oval" screen, with more on it

```js
import { createFaceView } from '../../../eye-controller/src/index.js';
const view = createFaceView(gaze.eyes, canvas, { video: false, checks: false });
// ... on unmount: view.destroy();
```

It draws, mirrored like a selfie: the oval guide (turns green when the position is good),
MediaPipe's face mesh (`mesh: 'contours'` or `'full'`), HUD corners around the face with
the live tracking quality, the head direction, both eye close-ups with our pupil (red) and
MediaPipe's iris (cyan), and a 4 x 2 mini lane map with the gaze dot.

- `video: false` when your page already shows the `<video>` behind the canvas, as your
  face-check screen does. `video: true` (default) draws the camera image itself.
- The canvas follows its CSS size every frame, so give it a definite size
  (`position:absolute; inset:0` inside a sized box). Pages with a global
  `canvas { inset: 0 }` rule: set `inset` explicitly on the canvas.
- On the mock (`?input=sim`) there is no image or mesh; it draws a stylised face from the
  face box, so the screen still works in development.

The label on the face is **CONDITIONS %**: how good light, glare, eye contrast, framing and
head position are right now, naming the weakest when it drags the score down. It is not
`state.quality` (that one also includes the calibration score and is capped at 40 before
calibrating). Calibration and tracking quality are shown under the mini lane map.

`image: 'processed'` shows what the tracker actually analyses: the auto-exposed image,
cropped by the face-following zoom (the debug page uses it; press P to toggle raw).

Raw data for drawing your own version: `eyes.faceData()` →
`{ frame, video, landmarks, mesh, eyeImages, eyeMarks, processed, roi, tone, conditions }`
(null fields on the mock).

## 3. Position checks tuned on real recordings

`positionChecks(frame)` / `positionOk(checks)` return the same shape as your
`faceChecks()` (`[{ id, label, pass, hint, warnOnly }]`), so you can swap them in.
Differences, all from measured clips:

| Check | Yours | Engine | Why |
|---|---|---|---|
| min face width | 0.20 | 0.17 | a normal seat measured 0.21-0.23: 0.20 flickers; "far" clips were 0.13-0.14 |
| max face width | 0.50 | 0.42 | the closest clips that still tracked were 0.42-0.44 |
| light | exposure mean ≥ 50 | eye brightness ≥ 45 (warn below 60) | backlit clips at 53 tracked poorly but not unusably; a dark room measured 3 |
| vertical centre | ±0.20 | ±0.22 | |
| new: facing the screen | – | warn if head turned > 0.3 rad | |

## 4. Ready-made screens (optional)

If you would rather not maintain your own:

All of them take `theme` (`'default'`, `'neon'` or a partial object: font, display, bg,
panel, text, ok, accent, warn, bad, secondary) for reskins, `keys: false` to leave keys to
the page, and `buttonClass` for the page's own button style. Their buttons carry
`data-gaze`, so the game's dwell presses them with the eyes.

- `runFaceCheck(eyes)` → full-screen face check, continues by itself after 1.5 s all-green.
- `startCalibration()` without `onTarget` → the built-in calibration screen: lane grid,
  glowing dot with seeking ring, steadiness reticle and capture ring, a green lock with
  particle burst and cell flash on each capture, comet trail while following, phase header
  (Hold / Follow / Jump), and a live mini face view (no oval or text) that warns when the
  face is lost and fades out whenever a dot comes near it.
- `showCalibrationResult(result, { layout })` → score counts up in a ring, then the 4 x 2
  cells light up with their own scores and weak cells are marked. Resolves
  `'continue' | 'retry' | 'topup'` (Enter / R / T or click). These screens are keyboard and
  mouse driven; wrap them with your dwell buttons for eyes-only play.

See them all in `eye-controller`: `npm run dev`, open `/` and press V (face check) or C
(face check → calibration → result).

## 5. Things we measured that affect game design

- With glasses, band switches are the weak spot (~84% of the time on the right cell, vs
  ~94% without glasses). Telegraph band changes earlier than lane changes.
- Most remaining misses are reaction time: on target 9% in the first 300 ms after a note
  appears, 53% at 300-500 ms, 90% at 500-700 ms, 95% after. Notes that are visible before
  they must be hit hide almost all of this.
- Keep calling `confirmOnTarget` on hits (you already do): it lifted lane jumps from 78% to
  82% and band switches from 62% to 65% on target in our recordings.
- A completely dark room cannot work with a webcam; ask for light in the face check.
