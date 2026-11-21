-- 2026-11-21 Christmas channels. ADDITIVE ONLY: three new tables + one nullable column.
-- While the Christmas period is on, listeners pick a channel. 'mixed' (the default) IS the station's
-- normal timeline (table `schedule`, unchanged). The two other channels keep their own timeline,
-- their own rotation memory and their own request line in these tables, so they can never change
-- what the normal timeline plays.
CREATE TABLE IF NOT EXISTS ch_schedule (
  channel TEXT NOT NULL,                  -- christmas | classic
  seq INTEGER NOT NULL,                   -- counts per channel (optimistic-lock key, like schedule.seq)
  track_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  dur_ms INTEGER NOT NULL,
  request_id INTEGER,                     -- ch_requests.id
  created_ms INTEGER NOT NULL,
  writer TEXT,                            -- random id of the call that wrote the slot, 'dj' for DJ picks
  PRIMARY KEY (channel, seq)
);
CREATE INDEX IF NOT EXISTS ch_schedule_start ON ch_schedule(channel, start_ms);
CREATE INDEX IF NOT EXISTS ch_schedule_track ON ch_schedule(channel, track_id, start_ms);
-- Each channel's own "last played" and play count per song (the normal timeline keeps using
-- tracks.last_played_ms / tracks.plays). No row yet = never played on that channel.
CREATE TABLE IF NOT EXISTS ch_plays (
  channel TEXT NOT NULL,
  track_id TEXT NOT NULL,
  last_played_ms INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel, track_id)
);
-- Listener requests for a channel (requests for the normal timeline stay in `requests`).
CREATE TABLE IF NOT EXISTS ch_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  track_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | scheduled | cancelled
  seq INTEGER
);
CREATE INDEX IF NOT EXISTS ch_requests_status ON ch_requests(channel, status, id);
-- Which channel a playing listener is on (NULL = the normal timeline). Live listener count only.
ALTER TABLE listen_sessions ADD COLUMN ch TEXT;
