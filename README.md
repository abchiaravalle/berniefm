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
  api/request.js   song requests (Turnstile + rate limits), re-plans the queue
  api/nowplaying/  AzuraCast-compatible now-playing JSON (old integrations keep working, edge cached 5 s)
  api/station/     old AzuraCast request API for pages cached from before the switch
  api/catalog.js   every song organized by album (DJ picker)
  api/dj/          DJ controls: unlock / check / play (now|next) / skip; needs DJ_CODE
  listen/          continuous MP3 stream at the old URL, same timeline
  _middleware.js   host redirects (bernieradio.acwebdev.net -> bcradio.net, stream.* root)
  _lib.js          scheduler + helpers
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
catalog (241 tracks, 38 releases) is covered except his Christmas album (held back).
Expansion tooling: `expansion_plan.py`, `build_expansion.py` -> `expansion_lib.json`.

## Endpoints
- `https://bcradio.net/` player
- `https://bcradio.net/api/now` timeline
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

## Old design
The pre-2026-10-05 page (with the holiday mode toggles) is kept in `legacy/` for reference.
It is not deployed.
