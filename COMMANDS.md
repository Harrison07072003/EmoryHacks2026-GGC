# Commands cheat sheet

Run from the repo folder `EmoryHacks2026-GGC`. Chrome only. Allow the camera.

## First time on a computer

| Command | Does |
|---|---|
| `npm --prefix eye-controller install` | installs the eye engine (also copies MediaPipe files) |
| `npm --prefix eye-controller run fetch-model` | downloads the face model so tracking works offline |
| `npm --prefix game install` | installs the game |
| `npm --prefix game run fetch-voice-model` | downloads the offline voice model (41 MB) so voice works without Google |

## Play the game

| Command | Does |
|---|---|
| `npm --prefix game run dev` | starts the game → open **http://localhost:5190** |

Only one dev server at a time: the game and the engine's debug page both use port 5190.
Stop a running one with **Ctrl+C** in its terminal.

| Add to the game URL | Does |
|---|---|
| *(nothing)* | real webcam eye tracking |
| `?input=sim` | dev: simulated eyes, the mouse moves them |
| `?input=mouse` | dev: the mouse is the gaze, no tracking |

| Key in the game | Does |
|---|---|
| look at a button 2 s | presses it (or click it) |
| **P** or **Escape** (in a song) | pause |
| **Escape** (elsewhere) | back / cancel calibration / skip face check |
| **Shift+M** | dev: toggle mouse instead of eyes |

Settings → **Mouse**: Off (eyes only) or Allowed (mouse steps in while you move it).
Sit close: face about a quarter of the camera width (closer with glasses).

## Online Library (song search by eye keyboard or voice)

Built-in songs never need any of this. Run inside `game/` (`cd game`):

| Command | Does |
|---|---|
| `cp .env.example .env` | once: then set `TYPESENSE_ADMIN_API_KEY` to any long random string |
| `npm run typesense` | starts the song search engine on port 8108 (downloads it once) |
| `npm run typesense:setup` | once: creates the song index, prints the search key: paste both printed lines into `.env` |
| `npm run server:install` | once: installs the level-generator server |
| `npm run ingest -- --limit 300` | adds songs from archive.org to the index (about 1 per second) |
| `npm run server` | level-generator server on port 8787 (own terminal, keep running) |
| `npm run dev` | the game (restart it after editing `.env`) |
| `npm run typesense:stop` | stops the search engine |

In the game: song select → **🔍 Search** → *Say genre* (voice) or *Keyboard* (type with your
eyes). **Alt+M** toggles the mic. Voice runs offline in the browser (Vosk model, any browser,
microphone permission only); the first use loads the model (about 1 s locally). Add
`?voice=google` to the URL to use Google's speech service instead (Chrome/Edge + internet).
No other keys or accounts needed (archive.org is free). If the server is down, the game builds
the level in the browser.

## Engine pages (debug, recording)

| Command | Does |
|---|---|
| `npm --prefix eye-controller run dev` | starts the engine pages on port 5190 |

| Page | Does |
|---|---|
| `http://localhost:5190/` | Hello Lanes: test the tracker on lanes (mock by default) |
| `http://localhost:5190/?live` | Hello Lanes with your webcam |
| `http://localhost:5190/debug.html` | camera view, sliders, record clips, profiles |

| Key | Where | Does |
|---|---|---|
| **C** | Hello Lanes | face check → calibrate → result |
| **V** | Hello Lanes | face check only |
| **T** | Hello Lanes | top-up weak areas |
| **F** / **B** | Hello Lanes (mock) | hide face / bad light |
| **Enter** | debug page | record a clip (calibration + test run) |
| **P** | debug page | toggle processed / raw camera image |

## Tests and data

| Command | Does |
|---|---|
| `npm --prefix game test` | game tests |
| `npm --prefix eye-controller test` | engine tests |
| `npm --prefix eye-controller run replay` | scores every recorded clip in `eye-controller/recordings/` |
| `npm --prefix eye-controller run replay -- eye-controller/recordings/<file>.json` | one clip in detail |
| `npm --prefix game run build` | production build of the game |
| `npm --prefix game run songs` | rebuild the songs and their charts |
| `npm --prefix game run check-charts` | check every chart is valid |

## Trouble

| Problem | Fix |
|---|---|
| "Port 5190 is already in use" | another dev server is running: Ctrl+C it |
| no camera / permission denied | camera icon in Chrome's address bar → Allow, reload |
| face tracking files missing | run the two first-time engine commands above |
| "Outdated Optimize Dep" / start-up error in webcam mode | reload once (it now does this by itself); fixed in `game/vite.config.js` |
| "Online search is unavailable" | `npm run typesense` (and check the keys in `game/.env`), then restart `npm run dev` |
| voice does nothing | read the red line under the search field; the mic button retries. Mac: System Settings → Privacy & Security → Microphone → your browser on. Console lines start with `[voice]` |
| "offline voice model did not load" | `npm --prefix game run fetch-voice-model`, restart `npm run dev` (without it the game downloads the model from the internet) |
| "can't reach the speech service" | only with `?voice=google`: Google is blocked on this network or browser; drop `?voice=google` |
| old behaviour after a pull | stop the server, start it again, hard-reload (Cmd+Shift+R) |
