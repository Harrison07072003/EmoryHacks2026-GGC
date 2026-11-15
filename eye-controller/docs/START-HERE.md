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

## 3. Record a clip (about 100 seconds)

1. Press **Record clip** (or Enter).
2. **Calibration:** look at each dot until its ring fills (16 dots), then **follow the moving
   dot** for about 11 seconds, then **look at each dot as it hops** between top and bottom
   (8 hops, about 10 seconds).
3. **Countdown**, then the test run:
   - **Jumps:** a note lights up in the top half. Look at its centre dot until the next one.
   - **Path:** a dot glides along the bottom half. Follow it with your eyes.
   - **Switch:** notes alternate top and bottom. Look at each one.
4. It saves by itself. The scores appear under the button and the counter goes up.

Something went wrong (sneezed, looked away, someone walked in front)? Press **Escape**;
nothing is saved. Then record it again.

## 4. Your task list

Rounds 1 (v0.1) and 2 (v0.2) are done and scored.

### Now: round 3 on version 0.3 (about 6 minutes)

Version 0.3 ends calibration with dots that **hop between the top and bottom band**
(look at each one), and the test run now **learns from your hits** like the game will.

1. Restart the dev server (section 1) so 0.3 loads.
2. Type `v3` in the note box.
3. Record **3 baseline clips** (glasses on, normal setup, back to back).

Calibration is now about 40 seconds: 16 dots, then follow the gliding dot, then look at
each hopping dot. Each clip is about 100 seconds in all.

Optional: 2 noglasses clips with `v3` in the note.

Then run the scoring (section 5) and tell Claude: "round 3 is in".

Rest your eyes between clips: look at something far away for 20 seconds every 3-4 clips.

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
