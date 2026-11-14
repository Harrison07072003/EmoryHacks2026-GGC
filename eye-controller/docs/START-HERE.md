# Start here: recording session checklist

Everything you need to start up, record clips and hand them over, in order.
Commands assume the terminal is in the repo folder `EmoryHacks2026-GGC`.

## 1. Start up (every time)

1. Open the folder `EmoryHacks2026-GGC` in VS Code.
2. Open a terminal: **Terminal → New Terminal** (Ctrl+`).
3. If a dev server is already running in a terminal, stop it with **Ctrl+C** first.
4. Start it:

   ```bash
   npm --prefix eye-controller run dev
   ```

5. Cmd+click the `http://localhost:5173` link, make sure it opens in **Chrome**, then go to
   `http://localhost:5173/debug.html`.
6. Allow the camera. The camera view and eye close-ups should appear on the left.
7. Type your player name: **jonathan zaharia** (always the same, so the counter tracks you).

Leave that terminal running the whole session.

**First time on a new computer only**, before step 4:

```bash
npm --prefix eye-controller install
```

```bash
npm --prefix eye-controller run fetch-model
```

## 2. Before each clip (10 seconds)

- Face centred in the camera view, eye close-ups visible on the left.
- `face yes` in the stats under the camera.
- Set up the room for the condition selected in the checklist (click it to read what to do).
- Sit how you would to play. Don't move your head unless the condition says so.

## 3. Record a clip (about 75 seconds)

1. Press **Record clip** (or Enter).
2. **Calibration:** look at each dot until its ring fills (16 dots).
3. **Countdown**, then the test run:
   - **Jumps:** a note lights up in the top half. Look at its centre dot until the next one.
   - **Path:** a dot glides along the bottom half. Follow it with your eyes.
   - **Switch:** notes alternate top and bottom. Look at each one.
4. It saves by itself. The scores appear under the button and the counter goes up.

Something went wrong (sneezed, looked away, someone walked in front)? Press **Escape**;
nothing is saved. Then record it again.

## 4. Your task list

Do these in order. The checklist on the page tracks the counts for you.

### Now: 5 baseline clips (priority, needed for the vertical fix)

- [ ] new baseline 1
- [ ] new baseline 2
- [ ] new baseline 3
- [ ] new baseline 4
- [ ] new baseline 5

Same room, same light, same seat, back to back. Normal setup, glasses as you usually wear them.
Your existing baseline clip was recorded before the new up/down data existed, so it does not
count toward these five: the page counter will read 6/5 when you are done, which is correct.

**Then tell Claude:** "baselines are in". That unlocks the vertical fix.

### Next: the conditions (when you have time, any order)

| Condition | Clips | What to do |
|---|---|---|
| bright | 2 | strong light in front of you |
| dim | 2 | room lights low or off |
| backlit | 2 | window or lamp behind you |
| busy | 2 | people moving behind you |
| noglasses | 2 | glasses off |
| close | 2 | face about 40 cm from the screen |
| far | 2 | lean back, about 80 cm |
| headmove | 2 | move your head naturally during the test run |
| drift5 | 2 | record a baseline, use the computer normally 5 min, then record this (it skips calibration) |

## 5. After a batch: score everything

Open a **second** terminal (the + in the terminal panel; leave the server running in the first):

```bash
npm --prefix eye-controller run replay
```

You get two tables (calibration dots and test run) and `eye-controller/recordings/scores.csv`.
What the columns mean is in [data-collection.md](data-collection.md).

## 6. Save your work to git

When you finish a session, in the second terminal:

```bash
git add eye-controller/recordings
```

```bash
git commit -m "Add recording clips"
```

```bash
git push
```

Clips are numbers only (no video), about 1.5 MB each, so they are fine to commit.

## Quick fixes

| Problem | Fix |
|---|---|
| Counter didn't go up | Reload the page. Check the player name is spelled exactly the same. |
| "could not start: Permission denied" | Click the camera icon in Chrome's address bar → Allow, then reload. |
| Camera busy | Close Zoom / FaceTime / other tabs using the camera, reload. |
| Page looks old or a button is missing | Stop the server (Ctrl+C), start it again, hard-reload (Cmd+Shift+R). |
| Calibration score shows "TOO LOW" | Still save it (it saves anyway), then improve the light and record again. |
| `npm: command not found` | Install Node.js 20+ from nodejs.org, reopen VS Code. |
| Port already in use | Another dev server is running: find its terminal and press Ctrl+C. |

## What you do NOT need to do

- Rename, move or download files: clips save themselves into `eye-controller/recordings/`.
- Press Save profile: Record clip does it when the calibration is good.
- Export / Import baseline: not needed for recording.
