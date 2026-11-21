# BC Radio (bcradio.net)

Bernie Chiaravalle's 24/7 radio station. Since 2026-10-05 it is fully serverless on
Cloudflare (replaced the AzuraCast droplet `bcradio-prod`, 192.81.216.55, on DigitalOcean).

## How it works
Every listener follows ONE shared timeline stored in D1 (`schedule` table). A browser
asks the server for the time (`/api/time`) and for the timeline (`/api/now`), then plays
the current track from R2 at the exact live position. So everyone hears the same song at
the same moment, the same way a real radio station works. Measured: listeners stay
within ~10-40 ms of each other.

```
public/            static site (Pages)            -> bcradio.net
  index.html       the player UI (green & gold, Bernie's studio, animated 8-track; 2026-10-05)
  bcsync-v5.js     sync engine (clock sync, live join, gapless handoff, drift correction; Safari seeks, never changes rate)
  dj-v1.js         hidden DJ panel (5 taps on "Upcoming in this set")
  img/             studio photo, green-gold tritone
functions/         Pages Functions
  api/time.js      server clock
  api/now.js       timeline straight from D1 (fallback; players read media.bcradio.net/state/now.json)
  api/library.js   requestable songs + availability
  api/season.js    seasonal look switch for the iPhone app + website ({theme:'christmas'} while a Christmas period is on)
  api/request.js   song requests (Turnstile + rate limits), re-plans the queue
  api/nowplaying/  AzuraCast-compatible now-playing JSON (old integrations keep working, edge cached 5 s)
  api/station/     old AzuraCast request API for pages cached from before the switch
  api/catalog.js   every song organized by album (DJ picker)
  api/dj/          DJ controls: unlock / check / play (now|next) / skip; needs DJ_CODE
  listen/          continuous MP3 stream at the old URL, same timeline
  _middleware.js   host redirects (bernieradio.acwebdev.net -> bcradio.net, stream.* root)
  _lib.js          scheduler + helpers (featured periods, replanFuture)
manager/           Control Room: private manager Worker at controlroom.amplifi.studio (see below)
schema.sql         D1 schema
wrangler.jsonc     bindings: DB (D1 bcradio), MEDIA (R2 bcradio-media)
```

Media: R2 bucket `bcradio-media`, public at `https://media.bcradio.net/`
(`t/<id>-<hash>.mp3` audio, `art/<hash>.jpg` covers, `state/now.json` the published
timeline). All audio is CBR 128 kbps MP3, loudness-matched (-16 LUFS, pure gain, no
compression) with leading/trailing silence trimmed.

Library: 333 tracks, 24.2 h. 242 from the original S3 files, 22 recorded off the old
AzuraCast stream (songs or versions that existed only on the droplet), 1 from the original
file Bernie sent (Man Who Would Be King 2025), and 68 added 2026-10-05 that the old station
never had: All or Nothing, Dreamer, This Is What I See (from album files on Navajo) and
Maybe One Day, Standing in the Shadows, the Driven by Desire 2025 versions and recent
singles (from the official releases on Bernie's YouTube channel). Every track is matched
to its exact recording by audio fingerprint, not by title; Bernie's full Apple Music
catalog (241 tracks, 38 releases) is covered. His Christmas songs (the Elf Band album, 12 more
songs) joined on 2026-11-20 switched off: they only play inside the Christmas featured period
(see "Christmas mode" below), so the library reads 346 songs, 334 of them in everyday rotation.
Expansion tooling: `expansion_plan.py`, `build_expansion.py` -> `expansion_lib.json`.

## Endpoints
- `https://bcradio.net/` player
- `https://bcradio.net/api/now` timeline
- `https://bcradio.net/api/season` seasonal look switch (`{"theme":"christmas","until_ms":...}` or `{"theme":null}`)
- `https://stream.bcradio.net/listen/bcradio/radio.mp3` legacy continuous stream (VLC, apps)
- `https://stream.bcradio.net/api/nowplaying` legacy AzuraCast-shaped JSON

## Scheduler
`ensureSchedule` plans the next 2 h in memory and writes it in one D1 transaction. Each
slot insert only lands if its predecessor is exactly the row it was planned from, so
concurrent writers can never leave a gap or overlap. `writer` tags which call wrote a
slot so play counts and request status are only updated for slots that really landed.
Idle station (no listeners for hours): the timeline restarts at "now". Tests:
`~/.hermes/claude-code/bcradio/sched_test.mjs` (real SQLite, racing writers).

## Rotation
Least-recently-played first, random among the stalest 10, never the same album/collection
as the last 3 slots, nothing repeated within the upcoming window. Requests jump the queue
(FIFO) but never interrupt the song on air or anything starting within 60 s.
Request limits: 1 per listener per 2 min, 8 per hour, 15 pending max, a song can't be
requested within 4 h of its last play.

## Deploy
```
npm install
set -a; source ~/.hermes/secrets/cloudflare.env; set +a
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
./node_modules/.bin/wrangler pages deploy --project-name=berniefm --branch=main --commit-dirty=true
```
Deploy from the repo ROOT with no directory argument (otherwise Functions are skipped).
Preview: `--branch=sync-preview` -> https://sync-preview.berniefm.pages.dev

## Adding songs
Library tooling lives outside the repo (audio masters are large):
`/Volumes/6154577230/bcradio-work/` (`transcode2.py`, `publish.py`, `d1tool.py`).
Add the file + metadata, run transcode2 then publish; new tracks enter rotation shuffled.

## DJ mode
Tap "Upcoming in this set" 5 times within 3 seconds. The first time on a device it asks
for the DJ code (secret env `DJ_CODE`; the value lives in `~/.hermes/secrets/bcradio.txt`).
Changing `DJ_CODE` signs every device out. "Play now" switches every listener in 10 s,
"Next" plays after the current song, "Skip" moves everyone on.

## iPhone app
Native app in `~/gits/ios-apps/BCRadio` (installed from the tailnet install page). It follows the same
timeline as the website. Two small server pieces exist for it:
- `art_hd` on every song in `/api/now`, `/api/library`, `/api/catalog`: big covers at `art/hd/<file>` on R2
  (built by `art_hd.py` in the work folder; re-run it after adding new covers).
- `public/app/turnstile.html` (`/app/turnstile`): the request check shown inside the app (same sitekey and action).

## Live listener count
"12 listening now" on the website (under the headline) and in the iPhone app.
- `POST /api/listen {sid, platform: web|ios|android, playing}`: sent by a player when play starts and every
  60 s while it plays; `playing:false` on stop / page close (sendBeacon) deletes the row at once. `sid` is a
  random code the player makes up each time play starts and keeps only in memory.
- `GET /api/listeners` -> `{now, total, web, ios, android}` = sessions seen in the last 150 s (edge-cached 15 s).
- D1 keeps only `listen_sessions(sid, platform, last_seen_ms)` (rows older than 3 min are deleted) and
  per-minute totals `listen_minutes(minute_ms, web, ios, android)`. No IP, user agent, country or device id.
  Rate limit 30 pings/min per IP via `hits` with a per-minute salted hash, deleted after its minute.
- Code: `functions/_listeners.js`, `functions/api/listen.js`, `functions/api/listeners.js`,
  `public/listeners-v1.js`. Schema: `manager/migrations/0002_listeners.sql` (also at the end of `schema.sql`).
- Local test (local D1 only): `wrangler pages dev --port 8820`, then
  `BASE=http://127.0.0.1:8820 node manager/test/test_listen_local.mjs` (31 checks).

## Christmas mode (/api/season)
One switch drives the Christmas songs, the iPhone app look and the website look: a featured
period in the Control Room whose name contains "Christmas" or "Holiday".
- **The songs.** Period "Christmas" (id 1, added 2026-11-20): Nov 20 00:00 to Dec 26 23:59
  **Eastern time** (America/New_York), every year, mode *let switched-off songs play*, 3x as often.
  Songs: the 12 Elf Band songs (switched off, so they never play outside the window) plus
  On This Night (BC mix) and Winnie's Song (always on; inside the window they come round 3x as often).
  In a 24 h dry run on the prod data that came to about 1 slot in 12, every song twice a day,
  never the same song within 9 h, no two Elf Band songs back to back.
- **The look.** `GET /api/season` answers `{"theme":"christmas","until_ms":<end of the window>}`
  while such a period is ON right now (active, not deleted, inside a window; yearly repeats),
  otherwise `{"theme":null}`. Public, CORS open, `Cache-Control: public, s-maxage=300` (one D1
  read per data center every 5 minutes). The iPhone app switches its snow + lights on this; the
  website's snow + lights (`public/season-v1.js`, one script tag) live on branch `christmas-web`
  and are on the preview only (https://christmas-web.berniefm.pages.dev) until Adam says ship it.
  Forcing it for testing: `?season=christmas` / `?season=off` on the website.
- **Turn it off early:** Control Room > On the air > Christmas > **Off** (or Featured times > Christmas > Pause,
  or History > Undo). The schedule re-plans at once and the apps drop the look within 5 minutes.
- Requests: the request list (`/api/library`) and the album browser (`/api/catalog`) only show
  switched-on songs, so the 12 Elf Band songs can't be requested or picked from the website DJ
  panel even in December; the Control Room booth can play them while the period is on.
- Tests: `node --no-warnings manager/test/test_season.mjs` (22 checks).
- Adding the songs used the work-folder recipe (`christmas_transcode.py` runs transcode.py +
  transcode2.py, `christmas_publish.py` uploads and inserts switched off, `christmas_verify.py
  --remote` checks the stored files). Backup + rollback:
  `/Volumes/6154577230/client-backups/bcradio-d1-2026-11-20-christmas/`.
- **Cover (2026-11-21):** all 12 Elf Band songs (Christmas Time Again too) use Adam's photo of the
  real CD, Christmas 2000: `art/f982bb0a2abbf539.jpg` (600 px) + `art/hd/` (1400 px), square crop of
  1 px off the left and 5 px off the right, nothing else changed. Set through the Control Room (History
  has 12 "Changed the cover" entries with undo); the old placeholder `art/fae5fd5920505a3a.jpg` and the
  2013 Christmas Time Again cover `art/f9f8361927d673db.jpg` stay in R2 for undo.

### The Christmas switch (Control Room, 2026-11-21)
At the top of **On the air**: a card called **Christmas** with three choices. It drives the Christmas
featured period (the first period named like /christmas|holiday/i, the same rule `/api/season` uses).
Featured times > Christmas > Edit shows the same three choices, so the two never disagree. Every
change asks first, is logged in History with undo, and re-plans the part of the schedule that hasn't
started (`replanFuture`: the song on air, the next 90 s, DJ picks and listener requests stay). It is
heard from the first song that starts after that 90 s lock: 2-5 minutes in tests, never mid-song.
The yearly window (Nov 20 to Dec 26, Eastern) doesn't change; outside it the switch has no effect.

| Choice | What listeners hear | The period's row |
|---|---|---|
| **Off** | no switched-off Christmas songs; On This Night and Winnie's Song at their normal rate; `/api/season` = `{theme:null}` so the app + website drop the Christmas look | `active=0` (the existing pause; the last setting is kept) |
| **Mixed in** | about 1 in 3 songs is a Christmas song, spread out: never two in a row, never more than 3 other songs in a row, one song never again within 2 h | `mode=unlock, pace=3, gap_min=120` |
| **Christmas only** | only the 14 songs, shuffled: every one plays before any repeats (a cycle is ~45 min), never the same song twice in a row, never normal rotation; a pending listener request or DJ pick still plays in its turn | `mode=only, gap_min=30` |

Engine (`functions/_lib.js`): two additive, nullable columns on `features`
(`manager/migrations/0003_christmas_switch.sql`). NULL on both = the rules from before, byte for byte
(`manager/test/sched_equiv.mjs` runs today's prod engine e93f1fb against the new one on the real export,
with the live Christmas period on, plus active 'more' and 'only' rules: identical).
- `pace` (with `unlock`/`more`): the period's songs are kept out of the normal pick. After k other songs
  the next slot is a Christmas song with chance 0 below pace-2, 25 % at pace-2, 60 % at pace-1, always
  from pace on. Which one: the least recently played whose own gap has passed (random among the 3
  stalest), avoiding the album of the song before. Replaces the old "3x as staler" boost, which on
  2026-11-20 played all 14 in one burst (22:19-01:59 ET) and then none for ~8 h.
- `gap_min`: the period's own repeat gap in minutes instead of the station-wide 6 h. With `mode=only`
  it also switches on the shuffled cycle (plays since the period was last changed, counted in D1).
- Only for such a period the planner reads 2 more things (the last 40 slots and, for "only", one
  count), so other plans cost the same D1 calls as before.

24 h dry run on the prod export of 2026-11-21 09:44 ET, from the real state (all 14 played last night),
3 seeds (`~/.hermes/workspace/bcradio-christmas/switch/sim_switch.mjs`):

| | before (unlock 3x) | Mixed in |
|---|---|---|
| Christmas share | 8.2-8.3 % (1 in 12) | 31.3-32.8 % (1 in 3.1) |
| longest stretch with no Christmas song | 338-459 min (77-104 songs) | 16-17 min (3 songs) |
| most Christmas songs in any hour | 5-6 (in a burst) | 6-7 (spread) |
| shortest repeat of one song | 630-640 min | 122-139 min |
| Christmas back to back | 1-4 | 0 |

Christmas only (gap 30 min): 31 full cycles in 24 h, each 45.0 min (49.6 when a listener request
slots in), every cycle 14 different songs, the same song never twice in a row, nothing else plays.

Tests (all on the fresh export, `BCRADIO_EXPORT=<export.sql>` picks it):
`sched_equiv.mjs` (61, the hard gate), `sched_switch.mjs` (38), `sched_features.mjs` (42),
`test_season.mjs` (22), `sched_test_orig.mjs` (10), `test_api_local.mjs` (55),
`verify_ui_local.py` (original UI suite), and `~/.hermes/workspace/bcradio-christmas/switch/11_local_ui.py`
(the switch in real Chrome, every state + confirm + History undo + the editor, desktop 1280 + phone 430).
Backup + rollback from before the switch: `~/.hermes/backups/bcradio-d1-2026-11-21-christmas-switch/`
(the aux drive hung that morning).

## Old design
The pre-2026-10-05 page (with the holiday mode toggles) is kept in `legacy/` for reference.
It is not deployed.

## Control Room (the manager)
Private, amplifi-branded manager for the station: **https://controlroom.amplifi.studio**
(Worker `bcradio-controlroom`, code in `manager/`, added 2026-11-06). The name lives in ONE place:
`APP_NAME` in `manager/src/config.js` (the page title and header read it).

**Who can sign in.** Cloudflare Access app "BC Radio Control Room" covers the WHOLE hostname
(there is no public page): One-time PIN (emailed code), 30-day session. The allowed list is kept
out of this public repo in `~/.hermes/secrets/controlroom-emails.txt` (Adam's two addresses and
Bernie's). To change it: edit that file (one email per line), then run
`python3 manager/scripts/setup_access.py`. App id + audience tag: `~/.hermes/secrets/controlroom-access.txt`.
Defense in depth: the Worker verifies the Access JWT itself on every request (RS256 signature,
exp, nbf, aud, iss), answers an empty 403 without it, refuses any other hostname (workers.dev and
preview URLs are off), and refuses writes from another origin.

**What it does.**
- *On the air*: the song playing now with live progress (same shared timeline as the site),
  the next 10, the last 5. Play now (everyone switches in 10 s, `djPlace` 'now'), Play next,
  Skip, a search-to-play picker. Every one of these asks first, in plain words.
- *Songs*: every song with cover, title, album, section, length, plays, last played, on/off,
  requests on/off. Search, filters, sorting, bulk switch on/off and requests on/off. Edit display
  title/album/artist/year/section/track number, replace the cover (saved to `art/<sha1>.jpg` +
  `art/hd/`). Switching off a song that is coming up re-plans the future part of the schedule.
- *Add songs*: drop MP3/WAV/AIFF/M4A/FLAC. The browser converts each one with ffmpeg.wasm
  (self-hosted in the Worker's assets, `manager/public/assets/ff/`, checksum-verified; no CDN) using
  the library recipe: pure gain to -16 LUFS (true peak kept under -1 dBTP), leading/trailing
  silence trimmed (-50 dBFS, 0.15 s / 0.6 s, short fades), CBR 128 kbps 44.1 kHz stereo MP3, no
  tags, Info header. `dur_ms` = decoded sample count, cross-checked against the Info header; the
  Worker re-checks the stored file (format, size, length, SHA-1) before adding it. Upload goes in
  8 MiB parts (R2 multipart). Title/album/artist/year/track/cover come from the file's tags.
  New songs stay switched off until **Publish** (then they get a shuffled rotation spot).
- *Featured times*: a name, start/end (time zone shown, Pacific by default), songs/albums/sections,
  and a mode: *more often* (2x/3x/5x), *only these* (normal rotation fills in when they run out
  under the no-repeat rules), or *let switched-off songs play* (e.g. the Christmas album joins the
  mix only inside the window). Optional yearly repeat. Calendar of the next 6 months. When a
  rule touches the next 2 h it re-plans the not-yet-started part (`replanFuture` in `_lib.js`:
  keeps the song on air, the next 90 s, DJ picks and listener requests).
- *History*: who (Access email) did what and when; undo for edits, on/off, publish, bulk changes,
  removals of never-aired uploads, and featured times. Play now / skip are logged only.

**How featured times work in the engine** (`functions/_lib.js`). `ensureSchedule` loads the
rules whose window touches the stretch it is planning (tables `features` + `feature_tracks`) and
checks each planned slot's start time: no active rule = the old `pickRotation`, byte for byte;
an active rule widens or narrows the candidate pool and makes boosted songs look `weight` times
"staler", so they come round more often while the 6 h no-repeat and album-spread rules still hold.

**Tests** (run before any engine change; the first one is the hard gate):
```
cd manager && npm install && npm run assets          # ffmpeg.wasm into public/assets/ff/
node --no-warnings test/sched_equiv.mjs              # old vs new engine on the real prod export, same seeded random: identical (27 checks)
node --no-warnings test/sched_features.mjs           # more/only/unlock, windows, DST, yearly, replanFuture (42 checks)
LIB=$PWD/../functions/_lib.js SCHEMA=$PWD/../schema.sql node --no-warnings test/sched_test_orig.mjs   # the 2026-10-05 scheduler test
bash scripts/seed_local.sh && bash scripts/dev_local.sh    # LOCAL D1/R2 only (background), http://localhost:8813
BASE=http://localhost:8813 node --no-warnings test/test_api_local.mjs                  # API, 41 checks
~/.hermes/hermes-agent/venv313/bin/python test/verify_ui_local.py http://localhost:8813   # real Chrome, upload->publish->feature->play->skip->undo, 50 checks
python3 scripts/verify_gate_live.py                  # live: every path refuses anonymous + forged tokens
~/.hermes/hermes-agent/venv313/bin/python scripts/verify_live_signed_in.py   # live, READ-ONLY, temp service token (removed after)
python3 scripts/verify_station_live.py               # live station health (read-only)
```
Never test writes on a Pages preview URL: previews share the prod D1.

**Deploy the manager**
```
set -a; source ~/.hermes/secrets/cloudflare.env; set +a; export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
cd manager && npm install && npm run assets
umask 077; printf '{"ACCESS_AUD":"%s"}' "$(sed -n 's/^AUD=//p' ~/.hermes/secrets/controlroom-access.txt)" > /tmp/cr.secrets.json
../node_modules/.bin/wrangler deploy --secrets-file /tmp/cr.secrets.json; rm /tmp/cr.secrets.json
python3 scripts/verify_gate_live.py
```
Schema changes for the manager are additive only (`manager/migrations/0001_controlroom.sql`, same
block as the end of `schema.sql`). Backup + rollback from before the first prod change:
`/Volumes/6154577230/client-backups/bcradio-d1-2026-11-06/` (MANIFEST.md, ROLLBACK.md).
