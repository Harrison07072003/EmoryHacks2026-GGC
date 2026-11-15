# Search service on Render (free)

The website (GitHub Pages) searches songs through Typesense. This folder runs Typesense on
Render's free tier. Free Render keeps no data and sleeps after ~15 min idle, so on every start
`boot.mjs` starts Typesense, loads the songs from `songs.jsonl` and recreates the search key with
a fixed value. The first search after it sleeps waits ~30-60 s while it wakes up: open the site a
minute before a demo.

## One-time setup

1. **Make the keys** (on your laptop, in `game/`):
   ```bash
   npm run render:keys
   ```
   Keep the terminal open: it prints 2 secret values for Render and 1 public value for GitHub.

2. **Create the service** at https://dashboard.render.com → **New** → **Web Service** →
   connect the GitHub repo `EmoryHacks2026-GGC`, then:
   - Name: `rhythmeyez-search` (becomes `https://rhythmeyez-search.onrender.com`)
   - Language: **Docker**
   - Branch: `main`
   - Root Directory: `game`
   - Dockerfile Path: `server/typesense/Dockerfile`
   - Instance type: **Free**
   - Environment variables: `TYPESENSE_ADMIN_API_KEY` and `TYPESENSE_SEARCH_PARENT_KEY` from step 1
   - Advanced → Health Check Path: `/health`

   Create it. The first build takes a few minutes. Done when the log shows
   `[boot] loaded 40/40 songs` and `[boot] search key ready`.

3. **Point the website at it**: GitHub repo → **Settings** → **Secrets and variables** →
   **Actions** → **Variables** tab → **New repository variable**, twice:
   - `VITE_TYPESENSE_URL` = `https://rhythmeyez-search.onrender.com` (your service's URL, no slash at the end)
   - `VITE_TYPESENSE_SEARCH_API_KEY` = the public key from step 1

4. **Redeploy the website**: Actions → **Deploy game to GitHub Pages** → **Run workflow**.
   Search on the live site now works.

## Adding songs later

```bash
npm run ingest -- --limit 300     # into your local Typesense (npm run typesense first)
npm run typesense:seed            # export them to server/typesense/songs.jsonl
```
Commit and push `songs.jsonl`; Render redeploys and loads the new list.
