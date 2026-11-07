#!/usr/bin/env python3
"""Anonymous probe of the LIVE Control Room gate. Every path on controlroom.amplifi.studio must
refuse (Access login redirect, or the Worker's own empty 403/404), forged tokens included, and
nothing from the manager may leak. Write probes only use requests that would change NOTHING even
if a gate failed (unknown ids, empty bodies), so this can never touch the live station.
Also checks the station itself still answers."""
import json, sys, urllib.request, urllib.error
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NoRedirect)
def get(url, method="GET", headers=None, data=None):
    req = urllib.request.Request(url, method=method, data=data, headers={"User-Agent": UA, **(headers or {})})
    try:
        r = op.open(req, timeout=30); return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()
MARKERS = [b"Control Room", b'"songs":[', b'"email":', b"dr-form", b"convert.js", b"ffmpeg", b'"activity":', b'"features":', b"amplifi-logo", b'"current":']
fails = 0
def show(name, ok, info=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name, info, flush=True)
    if not ok: fails += 1
LOGIN = "falling-brook-6a64.cloudflareaccess.com"
H = "https://controlroom.amplifi.studio"
J = {"content-type": "application/json", "x-cr": "1"}
probes = [("/", "GET", None), ("/index.html", "GET", None), ("/app.js", "GET", None), ("/app.css", "GET", None), ("/convert.js", "GET", None), ("/mp3.js", "GET", None),
          ("/api/me", "GET", None), ("/api/songs", "GET", None), ("/API/songs", "GET", None), ("/api/booth", "GET", None), ("/api/features", "GET", None), ("/api/activity", "GET", None),
          ("/assets/amplifi-logo-color-dark.svg", "GET", None), ("/assets/ff/0.12.10/core/manifest.json", "GET", None), ("/assets/ff/0.12.10/core/ffmpeg-core.wasm.0", "HEAD", None),
          ("/media/state/now.json", "GET", None), ("/api/../api/songs", "GET", None), ("/api%2Fsongs", "GET", None), ("/nope", "GET", None),
          # harmless writes: would do nothing even if they got through
          ("/api/booth/play", "POST", b'{"id":"notarealsong0","mode":"next"}'), ("/api/songs/zzzzzzzzzzzz", "PATCH", b'{}'), ("/api/features/999999999", "PUT", b'{}'),
          ("/api/activity/999999999/undo", "POST", b''), ("/api/uploads", "POST", b'{}'), ("/api/songs/bulk", "POST", b'{"action":"nothing","ids":[]}')]
for path, method, body in probes:
    s, h, b = get(H + path, method, J if body is not None else None, body)
    loc = h.get("Location") or h.get("location") or ""
    leaked = [m.decode() for m in MARKERS if m in b]
    ok = s in (302, 401, 403, 404) and not leaked and (s != 302 or LOGIN in loc)
    show(f"{method} {path}", ok, f"-> {s} {loc[:60]} leaked={leaked}")

FORGED = "eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJlbWFpbCI6ImFkYW1AYW1wbGlmaS5zdHVkaW8iLCJhdWQiOlsieCJdLCJleHAiOjQxMDI0NDQ4MDB9.c2ln"
for name, hdr in [("forged CF_Authorization cookie", {"Cookie": "CF_Authorization=" + FORGED}), ("forged Cf-Access-Jwt-Assertion header", {"Cf-Access-Jwt-Assertion": FORGED}),
                  ("both forged", {"Cookie": "CF_Authorization=" + FORGED, "Cf-Access-Jwt-Assertion": FORGED}), ("junk token", {"Cookie": "CF_Authorization=a.b.c"})]:
    s, h, b = get(H + "/api/songs", headers=hdr)
    show(name, s in (302, 401, 403) and not any(m in b for m in MARKERS), f"-> {s}")
s, h, b = get(H + "/api/booth/play", "POST", {**J, "Cookie": "CF_Authorization=" + FORGED}, b'{"id":"notarealsong0","mode":"next"}')
show("forged cookie on a (harmless) write", s in (302, 401, 403), f"-> {s}")

# the same Worker on any other hostname must not exist / not serve
for alt in ["https://bcradio-controlroom.adamchiaravalle.workers.dev/api/songs", "https://bcradio-controlroom.adamchiaravalle.workers.dev/"]:
    s, h, b = get(alt)
    show("no workers.dev: " + alt.split("/", 3)[-1], s in (0, 403, 404) or (s >= 400 and not any(m in b for m in MARKERS)), f"-> {s} {b[:50]!r}")

s, h, b = get(H + "/")
loc = h.get("Location") or h.get("location") or ""
show("/ goes to the amplifi Access login (One-time PIN)", s == 302 and LOGIN in loc, loc[:100])

# station still fine (read-only)
s, h, b = get("https://bcradio.net/api/now")
st = json.loads(b) if s == 200 else {}
show("station: bcradio.net/api/now has a current song", s == 200 and bool(st.get("current")), (st.get("current") or {}).get("track", {}).get("title", ""))
s, h, b = get("https://bcradio.net/")
show("station: bcradio.net home page 200", s == 200, f"{len(b)}b")
print("FAILS:", fails)
sys.exit(1 if fails else 0)
