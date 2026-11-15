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
- Firestore adapter for the pooled baseline and profiles is not built.
- TypeScript is optional and not started.
