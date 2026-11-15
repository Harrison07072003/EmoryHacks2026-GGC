# RhythmEyez — notes for the coding agent

One eye-tracked rhythm game: 4 lanes x 2 bands (top = discrete notes, bottom = smooth-pursuit path).
We own the **eye-controller** (webcam -> gaze/lane/band signals). The game is built on top by teammates.

## Layout
- `eye-controller/` — the engine. All our work happens here. Read `eye-controller/README.md` first:
  it has the public interface, calibration flow, storage, recording/replay, and a **Code map**.
- `app/` — legacy minigames plus teammates' in-progress work (voice input in `app/core/voice.js`,
  possibly a database). **Do not edit, move, or delete anything in `app/`** unless the user asks.

## Commands (run inside `eye-controller/`)
- `npm install` then `npm run fetch-model` (face model is gitignored, stored in `public/mediapipe/`)
- `npm run dev` — `index.html` = hello-lanes harness (mock by default), `debug.html` = live tracker + sliders + recorder
- `npm test` — must stay green before every commit; `npm run build` must succeed
- `npm run replay -- <recording.json>` — score a recorded real session

## Rules
- The public interface in the README (state fields, events, lifecycle) is a contract with the game
  team. Additive changes only; never rename or remove a field without asking the user.
- The mock (`src/mock.js`) must keep implementing the same contract as the real controller.
- Engine code under `src/` stays DOM-free except `capture/`, `ui/`, and the harness. Pure math gets a
  Vitest test in `test/`.
- Everything is in normalized 0-1 coordinates. No pixels in models, profiles, or signals.
- Changing the feature layout in `src/cv/features.js` requires bumping `FEATURE_VERSION`
  (it invalidates saved profiles and the pooled baseline).
- Storage goes through the async key-value interface in `src/storage/kv.js`. A remote database
  (Firestore is the current plan, for cross-device pooled training) is a new adapter, not a rewrite.
  Store one document per player contribution and sum them client-side; never one shared mutable doc.
- Small focused modules, short functions, comments only where intent is not obvious.
- Commit or push only when the user asks. Commit only files you changed; teammates share this repo.

## How to improve accuracy (the main ongoing job)
Tune against real recordings, not guesses: record on `debug.html`, score with `npm run replay`,
change one thing, re-score. Thresholds in `src/calibration/scoring.js`, `src/signals/quality.js`
and `src/smoothing/gaze-smoother.js` are first estimates and are expected to move.

## Known open items
- Vertical (top/bottom band) accuracy on real faces is the biggest risk. Measured on one player
  (2026-11-15): band switches on target ~60% with glasses, ~85% without; lane jumps ~75% / ~95%.
- Calibration ends with an ~11 s moving-dot phase (v0.2). On real clips it raised the path
  staying in the bottom band from 74% to 98%; it did not change jumps or switches.
- Tried and reverted: 128x64 eye crops (no gain on a 720p webcam, 30 -> 25 fps). MediaPipe
  eyeLook* blendshapes barely move vertically (recorded in clips, not used).
- Using a player's past clips as a prior makes an 8-dot calibration usable but still well
  below 16 dots; not shipped.
- v0.3: calibration ends with 8 top/bottom band hops. Offline estimate was switches 60% -> 70%;
  on live v0.3 clips the hops added ~0-2 points (the v0.3 session was already at 83% without
  them). Round 3 live, glasses: jumps 91%, switches 84%; no glasses: 95% / 94% on target.
- Remaining misses are mostly latency: on target 9% at 0-300 ms after a note, 53% at
  300-500 ms, 90% at 500-700 ms, 95% after 700 ms. Steady-state accuracy in good conditions
  is near the ceiling; the open gains are latency and robustness (head movement, distance,
  backlight, other players), not more calibration in ideal conditions. Online
  refinement retuned (REFINE in core/engine.js); the test run and replay confirm hits, which
  lifted jumps 78% -> 82% and switches 62% -> 65% on target.
- A one-dot re-anchor was tested offline and not built: the vertical error is a scale error
  (top band reads low, bottom is fine), so a single offset fixes one band and breaks the other.
- v0.4 (2026-11-15): face view (`src/ui/face-view.js`), face check, calibration overlay with
  phases and mini face view, score reveal, `positionChecks` tuned on clips, `faceData()` and
  `cancelCalibration()`. Live camera rendering of the mesh / eye close-ups not yet seen on a real webcam.
  Notes for the game team: `eye-controller/docs/GAME-INTEGRATION.md`.
- The `rhythmeyez-game` branch is the game team's (a Coder commit-attribution workaround):
  read it for intent, never write to it. All our work goes on `main`.
- Firestore adapter for the pooled baseline and profiles is not built.
- TypeScript is optional and not started.
