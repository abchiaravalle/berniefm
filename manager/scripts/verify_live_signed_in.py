#!/usr/bin/env python3
"""Signed-in check of the LIVE Control Room without anyone's mailbox, and READ-ONLY on the station:
a TEMPORARY Access service token + a temporary non_identity policy + a temporary Worker secret
(TEST_SERVICE_CLIENT_ID); read the API, check a wrong-origin write is refused (by the CSRF check,
before anything happens), take real-Chrome screenshots at 1280 and 430 px of the four main screens.
Every non-GET request the browser tries is BLOCKED by the test (nothing can change on the live
station), and the token, policy and secret are removed in `finally`, then checked gone.
Run in the background (Access + secret propagation takes a little while)."""
import json, os, subprocess, sys, time, urllib.request, urllib.error, pathlib
MAN = pathlib.Path(__file__).resolve().parent.parent
env = {}
for line in open(os.path.expanduser("~/.hermes/secrets/cloudflare.env")):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k.replace("export ", "")] = v.strip().strip('"').strip("'")
T = env["CLOUDFLARE_API_TOKEN"]; A = env["CLOUDFLARE_ACCOUNT_ID"]
APP = [l.split("=", 1)[1].strip() for l in open(os.path.expanduser("~/.hermes/secrets/controlroom-access.txt")) if l.startswith("APP_ID=")][0]
WR = str(MAN.parent / "node_modules/.bin/wrangler")
WENV = {**os.environ, "CLOUDFLARE_API_TOKEN": T, "CLOUDFLARE_ACCOUNT_ID": A}
H = "https://controlroom.amplifi.studio"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
SHOTS = pathlib.Path(os.path.expanduser("~/.hermes/state/controlroom/shots")); SHOTS.mkdir(parents=True, exist_ok=True)

def cf(method, path, body=None):
    req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + T, "Content-Type": "application/json"})
    try: return json.loads(urllib.request.urlopen(req, timeout=40).read())
    except urllib.error.HTTPError as e: return json.loads(e.read())
def secret(name, value=None):
    if value is None:
        r = subprocess.run([WR, "secret", "delete", name, "--force"], cwd=MAN, env=WENV, capture_output=True, text=True, input="y\n")
    else:
        r = subprocess.run([WR, "secret", "put", name], cwd=MAN, env=WENV, capture_output=True, text=True, input=value)
    out = r.stdout + r.stderr
    return ("Success" in out) or ("deleted" in out.lower())
def secret_names():
    r = subprocess.run([WR, "secret", "list", "--format", "json"], cwd=MAN, env=WENV, capture_output=True, text=True)
    try: return [x["name"] for x in json.loads(r.stdout)]
    except Exception: return ["?" + r.stdout[:80]]
def req(path, cid, csec, method="GET", body=None, extra=None):
    h = {"User-Agent": UA, "CF-Access-Client-Id": cid, "CF-Access-Client-Secret": csec, **(extra or {})}
    data = None
    if body is not None: h["content-type"] = "application/json"; data = json.dumps(body).encode()
    r = urllib.request.Request(H + path, method=method, headers=h, data=data)
    try:
        x = urllib.request.urlopen(r, timeout=40); return x.status, x.read()
    except urllib.error.HTTPError as e: return e.code, e.read()

fails = []
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n, x, flush=True)
    if not c: fails.append(n)

tok = pol = None
try:
    t = cf("POST", f"/accounts/{A}/access/service_tokens", {"name": "controlroom check (temp)", "duration": "8760h"})
    tok = t["result"]; cid, csec = tok["client_id"], tok["client_secret"]
    print("temp token", tok["id"][:8], flush=True)
    p = cf("POST", f"/accounts/{A}/access/apps/{APP}/policies", {"name": "temp automated check", "decision": "non_identity", "precedence": 2,
                                                                  "include": [{"service_token": {"token_id": tok["id"]}}]})
    pol = p["result"]; print("temp policy", pol["id"][:8], flush=True)
    check("temp worker secret set", secret("TEST_SERVICE_CLIENT_ID", cid))
    body = b""; s = 0
    for i in range(40):
        s, body = req("/api/me", cid, csec)
        if s == 200 and b'"email":"automated-check"' in body: break
        time.sleep(4)
    check("signed in through Access (service token) and the Worker's own JWT check", b'"email":"automated-check"' in body, f"{s} {body[:60]!r}")
    me = json.loads(body) if s == 200 else {}
    check("app name from the one config constant", me.get("app") == "Control Room", me.get("app"))
    s, b = req("/api/songs", cid, csec)
    songs = json.loads(b).get("songs", []) if s == 200 else []
    on = sum(1 for x in songs if x["enabled"])
    check(f"live library lists every song ({len(songs)}, {on} on the air)", len(songs) >= 333 and on >= 333)
    s, b = req("/api/booth", cid, csec)
    bo = json.loads(b) if s == 200 else {}
    check("live booth: song on air + 10 coming up", bool(bo.get("current")) and len(bo.get("next", [])) == 10, (bo.get("current") or {}).get("track", {}).get("title", ""))
    pub = json.loads(urllib.request.urlopen(urllib.request.Request("https://bcradio.net/api/now", headers={"User-Agent": UA}), timeout=30).read())
    check("booth shows the same song as bcradio.net", pub.get("current") and bo.get("current") and pub["current"]["track"]["id"] == bo["current"]["track"]["id"])
    s, b = req("/api/features", cid, csec)
    check("live featured times readable (none yet)", s == 200 and json.loads(b).get("features") == [], b[:80].decode(errors="replace"))
    s, b = req("/api/activity", cid, csec)
    check("live history readable", s == 200 and "activity" in json.loads(b))
    # wrong origin: refused by the CSRF check before the handler runs (body would be a no-op anyway)
    s, b = req("/api/songs/bulk", cid, csec, "POST", {"action": "nothing", "ids": []}, {"origin": "https://evil.example"})
    check("signed in but wrong origin -> refused", s == 403, str(s))
    s, b = req("/api/songs/bulk", cid, csec, "POST", {"action": "nothing", "ids": []})
    check("signed in, no origin and no x-cr header -> refused", s == 403, str(s))
    s, b = req("/assets/ff/0.12.10/core/manifest.json", cid, csec)
    check("self-hosted converter served behind sign-in", s == 200 and b'"sha256"' in b)

    from playwright.sync_api import sync_playwright
    blocked = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True)
        for label, w, hgt, mob in [("desktop", 1280, 900, False), ("phone", 430, 932, True)]:
            ctx = br.new_context(viewport={"width": w, "height": hgt}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob,
                                 extra_http_headers={"CF-Access-Client-Id": cid, "CF-Access-Client-Secret": csec})
            # READ-ONLY guard: any write the page tries is blocked here, before it leaves the browser
            ctx.route("**/*", lambda route: (blocked.append(route.request.method + " " + route.request.url), route.abort()) if route.request.method not in ("GET", "HEAD") else route.continue_())
            pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.goto(H + "/#booth", wait_until="domcontentloaded")
            pg.wait_for_function("() => document.querySelectorAll('#up-list li img').length >= 5", timeout=40000)
            pg.wait_for_function("() => document.querySelector('#now-art').complete && document.querySelector('#now-art').naturalWidth > 0", timeout=20000)
            time.sleep(1.5)
            check(f"live {label}: booth renders", "Loading" not in pg.inner_text("#now-title"), pg.inner_text("#now-title"))
            pg.screenshot(path=str(SHOTS / f"live_{label}_1_booth.png"))
            pg.click("[data-tab=songs]"); pg.wait_for_selector("#rows .lrow")
            pg.wait_for_function("() => [...document.querySelectorAll('#rows img.l-thumb')].slice(0,6).every(i=>i.complete && i.naturalWidth>0)", timeout=20000)
            check(f"live {label}: library renders", pg.locator("#rows .lrow").count() >= 100)
            pg.screenshot(path=str(SHOTS / f"live_{label}_2_library.png"))
            pg.locator("#rows .lrow").first.click(); pg.wait_for_selector("#drawer.open"); time.sleep(0.8)
            pg.screenshot(path=str(SHOTS / f"live_{label}_2b_song.png"))
            pg.click("#dr-close"); time.sleep(0.3)
            pg.click("[data-tab=upload]"); pg.wait_for_selector("#drop"); time.sleep(0.5)
            pg.screenshot(path=str(SHOTS / f"live_{label}_3_upload.png"))
            pg.click("[data-tab=featured]"); pg.wait_for_selector("#cal .cal-in"); time.sleep(0.5)
            pg.screenshot(path=str(SHOTS / f"live_{label}_4_featured.png"))
            pg.click("#feat-new"); pg.wait_for_selector("#fdrawer.open")
            pg.locator("#fd-presets button", has_text="Christmas").click(); time.sleep(0.6)   # fills the form only; nothing is saved
            pg.screenshot(path=str(SHOTS / f"live_{label}_5_featured_editor.png"))
            pg.click("#fd-cancel"); time.sleep(0.3)
            pg.click("[data-tab=activity]"); time.sleep(1.2)
            pg.screenshot(path=str(SHOTS / f"live_{label}_6_history.png"))
            ow = pg.evaluate("() => document.documentElement.scrollWidth - innerWidth")
            check(f"live {label}: no sideways scroll", ow <= 0, f"{ow}px")
            check(f"live {label}: no JS errors", not errs, str(errs[:2]))
            ctx.close()
        br.close()
    check("read-only: the browser made no write requests", not blocked, str(blocked[:3]))
finally:
    if pol: print("delete temp policy", cf("DELETE", f"/accounts/{A}/access/apps/{APP}/policies/{pol['id']}").get("success"), flush=True)
    if tok: print("delete temp token", cf("DELETE", f"/accounts/{A}/access/service_tokens/{tok['id']}").get("success"), flush=True)
    print("delete temp worker secret", secret("TEST_SERVICE_CLIENT_ID"), flush=True)
    pols = cf("GET", f"/accounts/{A}/access/apps/{APP}/policies").get("result") or []
    left = [(x["name"], x["decision"]) for x in pols]
    check("only the people policy remains on the Access app", left == [("allowed people", "allow")], str(left))
    toks = [x["name"] for x in cf("GET", f"/accounts/{A}/access/service_tokens").get("result") or [] if "controlroom check" in x["name"]]
    check("no temp service tokens left", not toks, str(toks))
    names = secret_names()
    check("temp Worker secret gone (only ACCESS_AUD left)", names == ["ACCESS_AUD"], str(names))
print("FAILS:", fails or "none")
sys.exit(1 if fails else 0)
