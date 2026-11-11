-- Live listener count (2026-11-11). Additive only: two new tables, nothing else changes.
-- Same block as the end of schema.sql. Apply: wrangler d1 execute bcradio --remote --file manager/migrations/0002_listeners.sql
--
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
