-- BC Radio synchronized station schema (Cloudflare D1)
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  grp TEXT NOT NULL DEFAULT '',   -- album/collection used to spread rotation (album, else source folder)
  genre TEXT NOT NULL DEFAULT '',
  art TEXT,                       -- R2 key, e.g. art/abcd.jpg
  file TEXT NOT NULL,             -- R2 key, e.g. t/<id>-<hash>.mp3
  dur_ms INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  source TEXT,                    -- provenance (s3:<path> or capture:<...>)
  enabled INTEGER NOT NULL DEFAULT 1,
  requestable INTEGER NOT NULL DEFAULT 1,
  last_played_ms INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  -- album picker / display (publish_catalog.py)
  cat_section TEXT,               -- Albums | Singles | Silent Partner | Collaborations | Rarities & demos
  cat_album TEXT,
  cat_no REAL,                    -- track number on that album
  cat_title TEXT,                 -- clean display title
  cat_artist TEXT,
  cat_year TEXT
);
CREATE INDEX IF NOT EXISTS tracks_rotation ON tracks(enabled, last_played_ms);

-- The single shared timeline every listener follows. seq is the optimistic-lock key:
-- two workers racing to extend the schedule collide on the PRIMARY KEY and one loses.
CREATE TABLE IF NOT EXISTS schedule (
  seq INTEGER PRIMARY KEY,
  track_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  dur_ms INTEGER NOT NULL,
  request_id INTEGER,
  created_ms INTEGER NOT NULL,
  writer TEXT                     -- random id of the call that wrote the slot (race-safe bookkeeping)
);
CREATE INDEX IF NOT EXISTS schedule_start ON schedule(start_ms);
CREATE INDEX IF NOT EXISTS schedule_track ON schedule(track_id, start_ms);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | scheduled
  seq INTEGER
);
CREATE INDEX IF NOT EXISTS requests_status ON requests(status, id);

-- fixed-window rate limiter: bucket = action:iphash:window:idx, win = expiry (ms)
CREATE TABLE IF NOT EXISTS hits (
  bucket TEXT PRIMARY KEY,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_win ON hits(win);

-- ===== Control Room manager (controlroom.amplifi.studio), added 2026-11-06. Additive only. =====
-- Featured periods: a time window (optionally every year) in which some songs play more
-- often ('more'), exclusively ('only'), or are let into rotation although switched off
-- ('unlock'). Read by ensureSchedule in functions/_lib.js. No active row = old behavior.
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'more',      -- more | only | unlock
  weight REAL NOT NULL DEFAULT 2,         -- 'more'/'unlock': how many times as often (1-10)
  start_ms INTEGER NOT NULL,              -- first window, UTC ms
  end_ms INTEGER NOT NULL,
  start_local TEXT NOT NULL,              -- same window as wall-clock 'YYYY-MM-DDTHH:MM' in tz (yearly rules repeat this)
  end_local TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  yearly INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,      -- 0 = paused or deleted (the scheduler reads active=1 only)
  deleted_ms INTEGER,                     -- set = deleted in the manager (row kept so it can be undone)
  note TEXT NOT NULL DEFAULT '',
  created_ms INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_ms INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS features_active ON features(active, start_ms);
CREATE TABLE IF NOT EXISTS feature_tracks (
  feature_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                     -- track (value = tracks.id) | album (cat_album) | section (cat_section)
  value TEXT NOT NULL,
  PRIMARY KEY (feature_id, kind, value)
);
-- Who changed what in the manager (Access email), with a snapshot for undo.
CREATE TABLE IF NOT EXISTS cr_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  summary TEXT NOT NULL,
  undo TEXT,                              -- JSON needed to reverse it, NULL = not undoable
  undone_ms INTEGER
);
CREATE INDEX IF NOT EXISTS cr_activity_at ON cr_activity(at_ms);
-- Upload sessions (R2 multipart) so a half-finished upload can be cleaned up.
CREATE TABLE IF NOT EXISTS cr_uploads (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  r2_upload_id TEXT NOT NULL,
  who TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  done_ms INTEGER
);

-- ===== Live listener count (2026-11-11). Additive only. =====
-- One row per player that is playing RIGHT NOW. sid = random code the player makes up each
-- time playback starts (kept only in the player's memory). No IP, user agent, country or
-- device id is stored. Rows go away on stop (playing:false) or after 3 minutes of silence.
CREATE TABLE IF NOT EXISTS listen_sessions (
  sid TEXT PRIMARY KEY,
  platform TEXT NOT NULL,                 -- web | ios | android
  last_seen_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listen_sessions_seen ON listen_sessions(last_seen_ms);
-- Totals only (for charts: daily peak, listening time). Written lazily by the first call in the
-- next minute; a missing minute means no player or page called in.
CREATE TABLE IF NOT EXISTS listen_minutes (
  minute_ms INTEGER PRIMARY KEY,          -- start of the minute, UTC ms
  web INTEGER NOT NULL DEFAULT 0,
  ios INTEGER NOT NULL DEFAULT 0,
  android INTEGER NOT NULL DEFAULT 0
);
