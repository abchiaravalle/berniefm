-- BC Radio synchronized station schema (Cloudflare D1)
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  art TEXT,                       -- R2 key, e.g. art/abcd.jpg
  file TEXT NOT NULL,             -- R2 key, e.g. t/<id>-<hash>.mp3
  dur_ms INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  source TEXT,                    -- provenance (s3:<path> or capture:<...>)
  enabled INTEGER NOT NULL DEFAULT 1,
  requestable INTEGER NOT NULL DEFAULT 1,
  last_played_ms INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0
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
  created_ms INTEGER NOT NULL
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
