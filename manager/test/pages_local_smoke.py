"""Smoke test of the STATION's Pages Functions (with the new _lib.js) on a LOCAL `wrangler pages dev`
sharing the manager's LOCAL D1/R2. Nothing touches prod. usage: python3 pages_local_smoke.py [base]"""
import json, sys, urllib.request, urllib.error
B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8814"
assert B.startswith("http://localhost") or B.startswith("http://127.0.0.1")
fails = []
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n, x)
    if not c: fails.append(n)
def get(p, method="GET", body=None, rng=None):
    h = {"content-type": "application/json"} if body is not None else {}
    if rng: h["Range"] = rng
    r = urllib.request.Request(B + p, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        x = urllib.request.urlopen(r, timeout=20); return x.status, x.read(5000 if rng else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read()
s, b = get("/api/now"); d = json.loads(b)
it = d["items"]
gaps = [i for i in range(1, len(it)) if it[i]["start_ms"] != it[i - 1]["end_ms"]]
check("station /api/now: current song + timeline", s == 200 and d.get("current") and len(it) > 20, d["current"]["track"]["title"])
check("station /api/now: no gaps/overlaps in the published items", not gaps, str(gaps[:3]))
check("station /api/now: >= 2 h ahead", it[-1]["end_ms"] - d["now"] >= 2 * 3600e3 - 60000, f'{(it[-1]["end_ms"] - d["now"]) / 3600e3:.2f} h')
for p in ["/api/library", "/api/catalog", "/api/nowplaying", "/api/time"]:
    s, b = get(p)
    check("station " + p + " 200", s == 200, f"{len(b)}b")
s, b = get("/api/catalog"); c = json.loads(b)
check("catalog does not include switched-off songs (local Christmas stand-ins)", b"Christmas" not in b or all(a["name"] != "Christmas" for sec in c["sections"] for a in sec["albums"]))
s, b = get("/api/dj/play", "POST", {"token": "x", "id": "abc123", "mode": "next"})
check("public DJ endpoint still locked without a token", s == 403, str(s))
# /listen is not checked here: it streams library files from R2 and the LOCAL R2 has none. It is checked on prod (read-only).
print("FAILS:", fails or "none")
sys.exit(1 if fails else 0)
