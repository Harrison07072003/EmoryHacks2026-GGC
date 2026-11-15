# Collecting data

We are not training a gaze model that ships: every player gets their own model from their
own calibration. Clips are test data for tuning the engine around it (calibration scoring,
smoothing, lane switching, bad-light handling). Get it near-perfect on one person first,
then check on others.

## Setup (once per machine)

```bash
cd eye-controller
npm install
npm run fetch-model
```

## One session (about 15 minutes for the first pass)

1. `npm run dev`, open `http://localhost:5190/debug.html` in Chrome, allow the camera.
2. Type your **player name** (e.g. `jon`). It is remembered.
3. The checklist selects the first condition that still needs clips. Click a condition to
   read what to change; set the room up for it.
4. Press **Record clip** (or Enter). Each clip is about 90 seconds:
   - calibration: 16 dots, look at each until it fills, then follow a moving dot (~11 s)
   - 1.5 s countdown, then the test run:
     - **jumps**: notes hop between lanes in the top band. Look at each one.
     - **path**: a dot glides along the bottom band. Follow it with your eyes.
     - **switch**: notes alternate between top and bottom. Look at each one.
   - Escape at any point cancels the clip; nothing is saved.
5. The clip saves to `recordings/<player>-<condition>_<date-time>.json`, the scores appear
   under the button, the counter goes up, and the next condition is selected.
6. Repeat. Use the optional note box for anything unusual (`-sunset`, `-tired`).

Tips:

- Keep your head as still as a normal player would, except in `headmove`.
- Do the `baseline` repeats first, back to back. They show how much scores move by chance;
  a change smaller than that is noise.
- `drift5` records only the test run, on the calibration from your last clip. Record a
  baseline, use the computer normally for 5 minutes, then record `drift5`.
- The checklist lives in `harness/protocol.js`. Add or change conditions there.

## Scoring everything

```bash
npm run replay
```

prints two tables and writes `recordings/scores.csv`:

**Calibration dots** (accuracy while holding still; calibrated on half the dots, tested on
the other half):

| Column | Good |
|---|---|
| `score` | 0-100 calibration score; play is refused below 60 |
| `x err %`, `y err %` | distance from the dot, % of screen. A lane is 25% wide, a band 50% tall |
| `lanes %`, `bands %` | frames in the right lane / band |

**Test run** (the game situations, pushed through the current code):

| Column | Meaning |
|---|---|
| `jump hit %` | notes where the reported lane reached the right one |
| `jump ms` | median time from a note appearing to the right lane being reported (includes your own reaction, about 200-250 ms) |
| `jump on %` | after the first 400 ms of a note, share of the time on the right cell |
| `path err %` | distance from the moving dot once the delay is removed |
| `path lag ms` | how far the reported gaze trails the dot (your eyes plus smoothing) |
| `path lane %` | right lane while following the path |
| `switch ...` | the same as jumps, for top/bottom switches |

Light, pupil contrast, glare and frame rate are listed per clip so bad conditions are
visible next to bad scores.

`npm run replay -- recordings/<clip>.json` shows one clip in detail, including every
held-out dot and the test run as reported live versus replayed.

## Improving the engine with the clips

The test-run numbers are recomputed by pushing every recorded frame through the current
code. So the loop is:

1. `npm run replay`, keep the averages.
2. Change something (a smoothing setting, a scoring threshold, a feature).
3. `npm run replay` again and compare. Compare against the spread of the baseline repeats.
4. `npm test` to make sure nothing else broke.

No re-recording is needed to try a change.

## What "good enough" looks like

First targets for one player in normal light. These are a starting point; adjust once the
baseline repeats show the natural spread.

- calibration score 75+
- jump and switch hit 100%, on target 90%+
- jump time under 450 ms (most of it is the player's own reaction)
- path lane 90%+, path lag under 300 ms

## Clips from other people

Same steps, with their name in the player box. Clips are numbers only, no images or video,
and can be committed and shared. Ask before recording someone, and use a first name or
nickname.
