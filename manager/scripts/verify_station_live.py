#!/usr/bin/env python3
"""READ-ONLY check of the live station after a berniefm deploy: /api/now has a current slot,
media.bcradio.net/state/now.json is fresh, and the timeline has no gaps/overlaps for the next
2 h. /api/now itself extends the schedule (as every listener's player does), nothing else is
written. usage: python3 verify_station_live.py"""
import json, sys, time, urllib.request
UA = "Mozilla/5.0 (Macintosh) Chrome/141.0 controlroom-check"
def get(u):
    return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA, "Cache-Control": "no-cache"}), timeout=30).read())
fails = []
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n, x, flush=True)
    if not c: fails.append(n)
d = get("https://bcradio.net/api/now?cb=%d" % time.time())
now = d["now"]; it = d["items"]
check("bcradio.net/api/now: a song is on the air now", bool(d.get("current")) and d["current"]["start_ms"] <= now < d["current"]["end_ms"],
      (d.get("current") or {}).get("track", {}).get("title", ""))
fut = [i for i in it if i["end_ms"] > now]
gaps = [(fut[k - 1]["end_ms"], fut[k]["start_ms"]) for k in range(1, len(fut)) if fut[k]["start_ms"] != fut[k - 1]["end_ms"]]
check("timeline: no gaps or overlaps from now on", not gaps, str(gaps[:3]))
ahead = (fut[-1]["end_ms"] - now) / 3600e3 if fut else 0
check(f"timeline: planned {ahead:.2f} h ahead (>= 2 h)", ahead >= 1.98)
seqs = [i["seq"] for i in it]
check("timeline: seq numbers consecutive", all(seqs[k] == seqs[k - 1] + 1 for k in range(1, len(seqs))))
s = get("https://media.bcradio.net/state/now.json?cb=%d" % time.time())
age = (time.time() * 1000 - s["generated_ms"]) / 1000
check(f"media.bcradio.net/state/now.json was rewritten {age:.0f} s ago", age < 120)
cur = [i for i in s["items"] if i["start_ms"] <= now < i["end_ms"]]
check("published file agrees on the song on air", cur and cur[0]["track"]["id"] == d["current"]["track"]["id"])
rev = get("https://media.bcradio.net/state/rev.json?cb=%d" % time.time())
check("state/rev.json matches the published file", rev["rev"] == s["generated_ms"], f'{rev["rev"]} vs {s["generated_ms"]}')
mp3 = urllib.request.urlopen(urllib.request.Request(d["current"]["track"]["url"], method="HEAD", headers={"User-Agent": UA}), timeout=30)
check("the song on air's file is served", mp3.status == 200 and mp3.headers.get("content-type") == "audio/mpeg")
for p in ["https://bcradio.net/api/library", "https://bcradio.net/api/catalog", "https://stream.bcradio.net/api/nowplaying"]:
    r = urllib.request.urlopen(urllib.request.Request(p, headers={"User-Agent": UA}), timeout=30)
    check(p.replace("https://", "") + " 200", r.status == 200)
cat = get("https://bcradio.net/api/catalog?cb=%d" % time.time())
check(f"catalog still lists {cat['count']} songs", cat["count"] >= 333)
r = urllib.request.urlopen(urllib.request.Request("https://stream.bcradio.net/listen/bcradio/radio.mp3", headers={"User-Agent": UA}), timeout=30)
first = r.read(2048); r.close()
check("legacy stream /listen sends MP3 bytes", r.status == 200 and len(first) == 2048)
print("FAILS:", fails or "none")
sys.exit(1 if fails else 0)
