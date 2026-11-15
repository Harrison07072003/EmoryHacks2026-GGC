# Songs and charts

## Folder layout

Every folder in `src/songs/` is a song. The menu picks it up automatically.

```
src/songs/<song-id>/
  song.json            metadata, palette, licence
  audio.wav            the music (wav, mp3, ogg or m4a)
  chart.practice.json  one chart per difficulty
  chart.normal.json
  chart.hard.json
```

## song.json

```json
{
  "id": "pulse-runner",
  "title": "Pulse Runner",
  "subtitle": "Upbeat EDM",
  "artist": "…",
  "bpm": 124,                       // drives the scrolling floor and the character's bounce
  "durationSec": 32.47,
  "previewStart": 15.5,             // where the song-select preview starts (seconds)
  "previewSec": 8,
  "audio": "audio.wav",             // file name inside this folder
  "palette": { "bg1": "#04121c", "bg2": "#062c3a", "lane": "#39f3ff", "accent": "#ff3fd2",
               "straight": "#3dffb8", "curve": "#ff5bd6", "glow": "#39f3ff" },
  "license": { "name": "…", "notes": "…", "source": "…" }
}
```

## Chart format (format 1)

Times are **seconds from the start of the audio file**. One note per line so hand edits diff cleanly.

```json
{
  "format": 1,
  "song": "pulse-runner",
  "difficulty": "normal",
  "notes": [
    {"type":"straight","t":2.419,"lane":1},
    {"type":"curve","t":11.613,"end":15.242,"path":[{"t":11.613,"x":0.31},{"t":12.097,"x":0.62}]}
  ]
}
```

| Field | Meaning |
|---|---|
| `straight.t` | when the note reaches the upper line |
| `straight.lane` | column 0-3, left to right. The player looks at that quarter of the top half of the screen. |
| `curve.t`, `curve.end` | when the ribbon's head reaches and leaves the lower line |
| `curve.path` | points `{ t, x }`. `x` is 0-1 across the screen (clamped to 0.06-0.94). The game draws a smooth Catmull-Rom curve through them, and the player follows that x along the lower line. |

Rules the checker enforces (`npm run check-charts`):
- no straight note while a curve is on the lower line
- enough time between notes in different columns for the eyes to move (0.7 s practice,
  0.35 s normal, 0.24 s hard)
- no notes after the audio ends

## How the current charts were made

The three songs are original. They are composed in code in `tools/compose/songs/*.mjs` and
rendered by a small offline synthesizer (`tools/compose/synth.mjs`). The same note list
produces both the audio and the charts (`tools/compose/chartgen.mjs`), so they are in sync
to the sample.

- Staccato melody phrases (`melody('tap', …)`) become straight notes. Pitch sets the column,
  low to high = left to right. The beat position decides which notes each difficulty keeps:
  practice keeps beats only, normal adds eighths, hard keeps everything.
- Legato phrases (`melody('flow', …)`) become curves. The pitch contour becomes the x path,
  with a per-difficulty width and maximum eye speed.

```bash
npm run songs                   # re-render every song and rewrite its charts
npm run songs -- pulse-runner   # only one
npm run check-charts
```

`npm run songs` overwrites the chart files. To keep hand edits, change the song file
instead, or save the edited chart and stop regenerating that song.

## Adding a licensed track instead

1. Check the licence allows use **in a game** and **redistribution** in this repository (CC0 is
   simplest; CC-BY works if attribution is shown). Put the source URL and licence in
   `song.json`.
2. Make the folder with `song.json` + the audio file.
3. Write the charts by hand, or produce note onsets with any offline tool and convert them to
   the format above. A future automatic "upload a song" generator would output exactly this
   format: detect onsets and pitch offline, feed them to `chartgen.mjs` as events
   (`{ t, dur, midi, role, accent }`), and nothing in the game changes.
4. `npm run check-charts`, then play it in `?input=mouse` to check the feel.
