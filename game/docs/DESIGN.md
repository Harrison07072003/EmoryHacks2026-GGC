# RhythmEyez: design decisions

How the paper sketches were read, what was decided where they were unclear, and why. Every
number mentioned here lives in `src/config/game-config.js`.

## Reading the sketches

| Sketch | Implemented as |
|---|---|
| Perspective highway, semi-transparent, notes coming toward the player | Canvas highway with a vanishing point just above the screen. The surface is a translucent gradient and the floor lines scroll on the beat. |
| Two "shiny lines": straight notes end at the upper one, curved notes at the lower one | Upper line at 36% of the screen height (inside the top half), lower line at 80% (inside the bottom half). |
| "4 target zones left to right" + "2 target zones up to down" | 4 columns × 2 bands. These are the same cells the eye-controller is calibrated on (`lanes: 4`, `bandSplit: 0.5`), so the targets match where tracking is most accurate. |
| Frenzy meter at the bottom | Bar along the bottom of the play screen. |
| Character in the background, upper left | Character portrait at the upper left, bouncing to the beat. |
| Note made → glows / "Perfect!"; missed → keeps going, "MISS" | Hits burst and vanish with a PERFECT/GOOD pop-up. Misses turn red and keep sliding past the line for 0.45 s before fading. |
| Modes: practice (song won't end, no lose), normal & hard (too many misses → song ends) | `failEnabled` per mode. |
| Danger mode levels 1/2/3 | Level 1: pink/red edge glow. Level 2: darker red with a slow pulse. Level 3: song ends, F. |
| Mint hair = normal, pink hair = hard, black hair = practice | Each mode brings its character by default. They can be changed on the Character screen. |
| Menu flow 1st title → 2nd modes + multiplayer (just for show) → 3rd choose song, preview 5-10 s, YES/NO | Implemented as drawn. Multiplayer is a greyed card marked COMING SOON and cannot be selected. |
| Eyes gleam / glow in Frenzy | The portrait's eyes are their own SVG layer, with a glow and a flare animation in Frenzy. |

**Judgement calls (easy to change):**
- The straight-note highway is in perspective only **above** the upper line. Below it the
  track is flat, so a column on screen is exactly its gaze zone and a curve's x on the lower
  line is exactly where to look. The flat part scrolls at the same speed, so nothing jumps.
- Character names (VOLT, NOVA, ONYX) are placeholders.
- The game recalibrates between songs with the engine's **quick** calibration (8 dots + 5 s of
  following a moving dot). If that run scores clearly worse than the saved calibration, the
  saved one is kept. A Skip button exists. `CALIBRATION.betweenSongs` can be `'full'` or `'off'`.
- A returning player's saved calibration loads at startup. Start then offers the quick
  recalibration, with "Use saved calibration" to skip it (the intro waits 4.5 s so there is
  time to dwell on it).
- Before any calibration exists, the gaze cannot press buttons yet. The title screen therefore
  starts calibration by itself once a face has been in view for 3 s (a click also works).
  After calibration everything is gaze-only.
- Pause and Quit sit in the upper right. Pause offers Resume / Songs / Home. Quit asks before
  leaving, because a stray 2 s glance should not throw away a run. Resume rewinds 1 s and
  counts in. The song also auto-pauses after 3 s without a face (`PAUSE` in the config).
- The face check from the prototype (app/core/shell.js) was rebuilt on the eye-controller's
  frame data (`src/input/face-check.js`, thresholds in `FACE_CHECK`) and runs before every
  calibration.

## Judging

### Straight notes
The gaze is "in the zone" when it is inside the note's column of the top band, plus a small
per-mode tolerance (`zoneTolerance`, `bandTolerance`), and has been there at least
`minDwellMs` (this filters out the gaze sweeping across a column on its way elsewhere).

- In the zone at any moment within ±`perfect` of the note time → **Perfect**. It is resolved
  as the note reaches the line.
- Arriving late, within the `good` window → **Good**.
- Arriving early inside the good window but leaving before the perfect window → **Good**.
- Not in the zone at any point in the window → **Miss**, decided once the window has closed.

Each note is judged independently from the current gaze. **Holding your eyes on one column
hits every note that arrives there**, with no blink and no look-away. That is tested in
`test/judge.test.js`.

Because the eyes cannot "press early", timing skill shows up as getting to the right column
in time. Early and holding is Perfect; late is Good or Miss.

Gaze arrives about 90 ms late (camera + smoothing). Judging therefore uses
`song time − INPUT.gazeLatencyMs`, so a player who is on time is not marked late.

### Curved notes: the scoring method
A curve is split into segments of about 1 s (`CURVE.segmentSec`). **Each segment is its own
judgment.** That gives steady feedback while following, and one lost moment only costs one
segment.

During a segment, each frame counts as **on path** when the gaze is in the bottom band
(± `bandTolerance`) and within `curve.tolerance` (15/12/10% of the screen width) of where
the path was at any moment in the last `CURVE.lagSec` (0.18 s). Eyes and smoothing always
trail a moving target, and that lag should not be punished.

**Coverage** = on-path time ÷ segment time, measured in time, not frames, so the frame rate
does not matter. Coverage ≥ `perfectCoverage` → Perfect, ≥ `goodCoverage` → Good, else
Miss. Defaults: Practice 75/45%, Normal 82/55%, Hard 85/60%.

Why this approach: it rewards smooth pursuit (what the eyes are good at), forgives normal
tracking jitter and lag, and still cannot be cheated by staring at the middle. Staring at
one spot misses most segments (tested).

## Scoring, health, Frenzy, grades
- Perfect 300, Good 120, Miss 0. A miss never removes points.
- Frenzy gauge: Perfect +7, Good +3.5, Miss +0. When full, Frenzy lasts exactly **5 s** of
  song time: double points, no health loss (misses still score nothing), then the gauge
  resets to 0.
- Health 100. A miss costs 9 (Normal) or 12 (Hard). Perfect gives back 2.5 and Good 1.2, so
  a run of hits brings you out of danger.
- Accuracy = (Perfect + 0.6 × Good) ÷ all judgments (straight notes + curve segments).
- Grades: S ≥ 95, A ≥ 85, B ≥ 70, C below. F only when failed. Practice shows the same
  grade with encouragement instead.

## Accessibility notes
- Big targets everywhere (columns are a quarter of the screen; buttons 220×92 px or more),
  and the dwell hit area extends 3% beyond each button, with "sticky" hysteresis.
- No gesture other than looking: no blinking, no head movement, no keyboard.
- Danger and Frenzy effects use edge glows and pulses of 1 Hz or slower, never full-screen
  flashing. `prefers-reduced-motion` turns animations off.
- The game warns when your face leaves the camera view.

## Recommended next steps
- Tune with real players: `tracking` in every result row (on-target %, mean x/y error) shows
  whether misses come from the tracker or the player.
- Vertical accuracy is the engine's weakest axis (see `eye-controller` replays). If top/bottom
  confusion shows up in play, move `upperLineY` higher and `lowerLineY` lower, or widen
  `bandTolerance`.
- A "calibration check" at the start of each song (one dot per column, 1 s) could re-anchor
  drift more cheaply than a quick recalibration.
- Commissioned character art: set `image` on a character; the eyes go on their own layer.
- Licensed tracks or automatic chart generation: see `CHARTS.md`.
