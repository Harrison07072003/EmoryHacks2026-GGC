# RhythmEyez - eye-controlled party games

Party games you play with your eyes, using only a laptop webcam. No special hardware and no
cloud: everything runs in the browser, and no video ever leaves the laptop.
Built for players with limited hand or arm use, and fun for everyone else.

## Run it
```bash
cd app
npm install      # first time only
npm run dev      # open the localhost link it prints (Chrome)
```
Click or press a key once (browsers block sound until you interact with the page).
After that, everything works with your eyes or head.

Check the bottom-left corner shows **build 6**. If not, you're on old files: hard-reload with Cmd+Shift+R.

## Folder layout
```
app/
  index.html  piano.html  echo.html  drums.html  horn.html   <- one page per game, index = hub
  core/
    gaze-engine.js   <- THE EYE TRACKER (don't edit without telling the team)
    shell.js         <- shared by every page: startup, face check, calibration, menus, preview, debug
  games/
    piano.js  echo.js  drums.js  horn.js                    <- one file per game, one owner each
  vite.config.js     <- lists the pages for the build
```

## What happens when you open a page
1. **Start**: one click or keypress. Can be skipped if Chrome is started with
   `--autoplay-policy=no-user-gesture-required` (demo machine / eyes-only players).
2. **Face check**: live camera with face box, eye boxes and eye close-ups. It checks face found,
   centered, distance, lighting and glasses glare, and continues by itself after 1.5 s of all-green.
3. **Calibration** (first time only, about 25 s): 13 dots that play notes, then follow a moving dot
   with small head movements, then a 9-dot accuracy check. Saved in the browser.
4. **Re-anchor** (every later page/game): look at one dot for 1 s. This removes drift.
5. **Play**: menus are big buttons. Look at one for 0.9 s (the gold ring fills) to press it.

## How the eye tracker works (core/gaze-engine.js)
Every camera frame (~30-60 per second):
1. **Face landmarks**: Google's MediaPipe Face Landmarker, a small neural network running on-device,
   finds 478 face points (eye corners, eyelids, irises), the 3D head angle, and expressions
   (blink, mouth open).
2. **Eye crops + our pupil finder**: each eye is cut out, rotated level (handles head tilt), and
   our own code finds the pupil as the darkest blob (2 passes). It also measures glare (glasses) and
   contrast. Pupil and iris estimates are blended by confidence.
3. **Features**: per eye, iris + pupil position (plus curved terms), plus head angle and position.
   22 numbers.
4. **Personal gaze model**: ridge regression (a machine-learning model) trained on YOUR calibration,
   with outliers (blinks, glances) removed. Three versions (both eyes / left / right); it fades
   toward whichever eye is cleaner, e.g. when one lens has glare.
5. **Corrections**: re-anchor offset + a correction map built from the accuracy check.
6. **Smoothing**: median filter kills one-frame spikes; steady-gaze lock holds still when your eyes
   rest; One Euro filter when they move. The pointer freezes during blinks.
7. **Learns while you play**: every confirmed hit (we know where you looked) becomes training data;
   the model retrains every 6 hits, but only keeps the update if it doesn't make things worse.

Head mode (no calibration): the pointer follows your nose. It's a fallback and a real
accessibility input method.

## Games
| Page | Game | Control |
|---|---|---|
| piano.html | **Eye Piano**: notes fall onto 5 keys (Ode to Joy) | look at the key as the note lands; aim assist helps |
| echo.html | **Echo**: musical Simon Says, no time pressure | settle your eyes on a pad for 0.7 s (only fills when steady) |
| drums.html | **Drum Duel**: answer the rival's 4-beat pattern | TOM / REST / SNARE zones; a hit = eyes *arrive* on a pad; go back to REST between hits |
| horn.html | **Horn**: follow the melody path (When the Saints...) | gaze sets pitch, open mouth / puff cheeks to blow (or Auto-blow) |

## Keys (for testing; nobody NEEDS them)
| Key | Does |
|---|---|
| R | re-anchor (look at the dot) |
| space | recenter head pointer |
| K | recalibrate |
| C | skip the face check |
| S | smoothing (higher = steadier, more lag) |
| H | head penalty (higher = head turns move the pointer less) |
| G | head pointer sensitivity |
| V | toggle the corner camera preview |
| M | back to hub |

**Eye debug** (hub): big eye crops (red = our pupil, blue = MediaPipe iris), live stats, and
green/red dots showing calibration accuracy (green = target, red = where your gaze landed).

## Add a new game (about 10 minutes of setup)
1. Copy `games/echo.js` to `games/mygame.js`. A game is an object:
   ```js
   export default {
     name: 'My Game',
     start(c) { /* c.W, c.H, c.P() = pointer {x,y}, c.actx = audio, c.note(), c.perc(), c.finish(msg) */ },
     update(dt) { /* game logic, dt in seconds */ },
     draw() { /* draw on c.g (canvas 2D) */ },
     stop() {},
   };
   ```
   Useful helpers: `c.lane(x, c.W, n, current)` (which of n columns, with anti-flicker),
   `c.E.addHit(x, y)` (tell the tracker "the player was definitely looking here" = it learns).
2. Copy `echo.html` to `mygame.html` and change the title + import line.
3. Add the page to `vite.config.js` and to `GAMES` at the top of `core/shell.js` (hub button).

Design rules that work with webcam gaze: big targets, mostly left/right, 2-5 zones,
telegraph everything early, reward *arriving* or *settling*, never punish blinking.

## Team workflow
- `git pull` before you start; commit + push small changes often.
- Each person owns their game file. Announce in chat before touching `core/`.
- Branch for big changes: `git checkout -b my-feature`, then push and open a PR.

## Troubleshooting
| Problem | Fix |
|---|---|
| Blank / "did not start" | missing file; check the layout above; Cmd+Option+J for the error |
| No camera | use the localhost link (not the Network IP); allow camera; close FaceTime/Zoom |
| Old behavior | hard-reload Cmd+Shift+R; check "build 6" bottom-left |
| Pointer drifts | press R (or it re-anchors at every game start) |
| Jittery | face a light, no window behind you; press S for more smoothing; check Eye debug glare % |
| Slow / laggy over time | MacBook Air heats up: plug in, close tabs |

## Roadmap
- Party games: memory card match, Laser Eyes Defense, trivia (Typesense-powered song search)
- 3D hub (Three.js) + medal podium
- Collect calibration data from volunteers to train a stronger cross-player model (see below)
- Self-host the MediaPipe model files for fully offline demos
