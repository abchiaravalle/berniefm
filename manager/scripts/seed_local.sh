#!/bin/bash
# Build a LOCAL copy of the station database (from the real prod export) for the manager's
# `wrangler dev --local`. Nothing here touches prod. Usage: bash scripts/seed_local.sh [export.sql]
set -euo pipefail
cd "$(dirname "$0")/.."
EXP="${1:-$(ls -1 /Volumes/6154577230/client-backups/bcradio-d1-2026-11-06/*.sql | head -1)}"
WR=../node_modules/.bin/wrangler
rm -rf .wrangler/state
# the export starts with PRAGMA defer_foreign_keys which local D1 rejects inside its transaction
grep -v '^PRAGMA defer_foreign_keys' "$EXP" > /tmp/cr_seed.sql
$WR d1 execute bcradio --local --file /tmp/cr_seed.sql > /dev/null
$WR d1 execute bcradio --local --file ../schema.sql > /dev/null
# a stand-in for the held-back Christmas album: 4 real songs copied as switched-off "Christmas" tracks
# (LOCAL ONLY, so the unlock feature can be exercised end to end)
$WR d1 execute bcradio --local --command "INSERT INTO tracks (id,title,artist,album,genre,art,file,dur_ms,bytes,source,enabled,requestable,last_played_ms,plays,grp,cat_section,cat_album,cat_no,cat_title,cat_artist,cat_year)
  SELECT lower('c0ffee' || substr(hex(id),1,6)), 'Xmas ' || COALESCE(cat_title,title), artist, 'Christmas', '', art, file, dur_ms, bytes, 'localtest', 0, 1, 0, 0, 'christmas', 'Albums', 'Christmas', rowid % 14, 'Xmas ' || COALESCE(cat_title,title), 'Bernie Chiaravalle', '2013'
  FROM tracks WHERE cat_album='Dreamer' LIMIT 4" > /dev/null
$WR d1 execute bcradio --local --json --command "SELECT COUNT(*) n, SUM(enabled) on_air FROM tracks" | grep -E '"n"|on_air'
