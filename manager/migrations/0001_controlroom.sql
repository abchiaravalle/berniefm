-- Control Room manager, 2026-11-06. ADDITIVE ONLY: new tables + indexes, nothing existing is touched.
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
