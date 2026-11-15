-- RhythmEyez database schema (Supabase / PostgreSQL).
-- Run once in the Supabase SQL editor, then set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
-- in game/.env.local. Without those variables the game stores everything in the browser
-- (IndexedDB) and this file is not used.
--
-- Every row id is made by the client and every write is an insert that ignores an existing
-- id (ON CONFLICT DO NOTHING), so retries can never create duplicates. Rows are never updated. No images or video exist anywhere in the pipeline.

-- ---------------------------------------------------------------------------------------
-- Game results: one row per finished or failed song.
create table if not exists game_results (
  id                text primary key,
  created_at        timestamptz not null default now(),
  player_id         text,
  song_id           text not null,
  difficulty        text not null check (difficulty in ('practice', 'normal', 'hard')),
  character_id      text,
  score             integer not null,
  grade             text not null,          -- S A B C, or F when failed
  accuracy          real not null,          -- percent, see SCORING.goodWeight
  perfect           integer not null,
  good              integer not null,
  miss              integer not null,
  max_combo         integer not null,
  frenzy_count      integer not null,
  failed            boolean not null,
  completed_pct     real,                   -- how far into the song the player got
  input_source      text not null,          -- 'live' | 'sim' | 'mouse' (sim/mouse are dev testing, never real play)
  calibration_score real,
  tracking          jsonb,                  -- per-song gaze accuracy summary (see play screen)
  game_version      text,
  engine_version    text,
  feature_version   integer
);
create index if not exists game_results_song on game_results (song_id, difficulty, score desc);

-- Calibration metadata: one row per calibration run (full, quick or between songs).
create table if not exists calibrations (
  id                text primary key,
  created_at        timestamptz not null default now(),
  player_id         text,
  kind              text,                   -- 'full' | 'quick'
  score             real,
  ok                boolean,
  kept              boolean,                -- false when a worse between-song calibration was discarded
  weak_cells        jsonb,
  points            jsonb,                  -- [{ x, y, score, kept, steadiness, residual }]
  input_source      text,
  engine_version    text,
  feature_version   integer
);

-- ---------------------------------------------------------------------------------------
-- Opt-in gaze-tracking data for improving the engine (Settings > Help improve eye tracking).
-- These match the messages of eye-controller/src/telemetry/telemetry.js; see
-- eye-controller/docs/database-brief.md for every field.
create table if not exists tracking_sessions (
  id                 text primary key,
  started_at         timestamptz,
  clock_offset_ms    double precision,
  app_version        text,
  feature_version    integer,
  mediapipe_runtime  text,
  mediapipe_model    text,
  layout             jsonb,
  camera_settings    jsonb,
  player_id          text,
  song_id            text,
  difficulty         text,
  game_version       text,
  consent            boolean not null default false
);

create table if not exists tracking_calibrations (
  id          text primary key,
  session_id  text references tracking_sessions (id) on delete cascade,
  t           double precision,
  score       real,
  ok          boolean,
  weak_cells  jsonb,
  points      jsonb
);

-- One row per ~1.5 s batch; `samples` is an array of per-frame rows:
-- t, face, blink, features[19], gaze_x/y, lane, band, quality, target_x/y, target_id,
-- target_source, per-eye open/glare/contrast/light, eye_shapes, process_ms.
create table if not exists tracking_samples (
  id          text primary key,                -- <session id>:<seq>
  session_id  text references tracking_sessions (id) on delete cascade,
  seq         integer not null,
  samples     jsonb not null
);
create index if not exists tracking_samples_session on tracking_samples (session_id, seq);

-- ---------------------------------------------------------------------------------------
-- Access: the browser uses the anon key, so it may only insert (no read, no update). Reading the
-- collected data is for the team (service role / dashboard). Decide this before a public demo.
alter table game_results enable row level security;
alter table calibrations enable row level security;
alter table tracking_sessions enable row level security;
alter table tracking_calibrations enable row level security;
alter table tracking_samples enable row level security;

create policy "anon insert" on game_results for insert to anon with check (true);
create policy "anon insert" on calibrations for insert to anon with check (true);
create policy "anon insert" on tracking_sessions for insert to anon with check (consent);
create policy "anon insert" on tracking_calibrations for insert to anon with check (true);
create policy "anon insert" on tracking_samples for insert to anon with check (true);
