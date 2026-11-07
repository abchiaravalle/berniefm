"""Control Room in real Chrome against the LOCAL dev server (local D1/R2 only).
Desktop 1280 + phone 430. End to end: upload a generated test tone (made with desktop ffmpeg),
the browser converts it (self-hosted ffmpeg.wasm), check the stored file is 128k CBR 44.1 kHz
at -16 LUFS with the exact dur_ms in LOCAL D1/R2; edit it, publish it, feature it, play now,
skip, undo. Plus layout checks + screenshots.
usage: ~/.hermes/hermes-agent/venv313/bin/python test/verify_ui_local.py [http://localhost:8813]"""
import json, os, re, subprocess, sys, time, pathlib, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8813"
assert re.match(r"^http://(localhost|127\.0\.0\.1)", BASE), "LOCAL ONLY"
OUT = pathlib.Path("/tmp/crtest/ui"); OUT.mkdir(parents=True, exist_ok=True)
SHOTS = pathlib.Path(os.path.expanduser("~/.hermes/state/controlroom/shots/local")); SHOTS.mkdir(parents=True, exist_ok=True)
MAN = pathlib.Path(__file__).resolve().parent.parent
RUN = time.strftime("%H%M%S")   # unique per run so leftovers from earlier local runs never match
fails = []
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n, x, flush=True)
    if not c: fails.append(n)
def d1(sql):
    env = {**os.environ, "CLOUDFLARE_API_TOKEN": "", "CLOUDFLARE_ACCOUNT_ID": ""}
    r = subprocess.run([str(MAN.parent / "node_modules/.bin/wrangler"), "d1", "execute", "bcradio", "--local", "--json", "--command", sql], cwd=MAN, env=env, capture_output=True, text=True)
    return json.loads(r.stdout)[0]["results"]
def ff(*a): subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)

# Test tone: 1.5 s silence, 20 s of a 440 Hz + 660 Hz chord at about -30 LUFS, 2 s silence;
# 48 kHz 24-bit WAV with tags + an embedded cover in a second copy (M4A/FLAC paths too).
tone = OUT / "Test Tone Song.wav"
ff("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=1.5", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=20", "-f", "lavfi", "-i", "sine=f=660:r=48000:d=20",
   "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=2",
   "-filter_complex", "[1][2]amix=inputs=2,volume=-8dB,aformat=channel_layouts=stereo[t];[0][t][3]concat=n=3:v=0:a=1[o]", "-map", "[o]",
   "-c:a", "pcm_s24le", "-metadata", f"title=Control Room Test Tone {RUN}", "-metadata", "album=Test Album", "-metadata", "artist=Test Artist", "-metadata", "date=2026", "-metadata", "track=7",
   str(tone))
cover = OUT / "cover.png"
ff("-f", "lavfi", "-i", "color=c=0x78ea78:s=800x800:d=1", "-frames:v", "1", str(cover))
real = OUT / "Real Music Sample.m4a"
ff("-i", "/Volumes/6154577230/bcradio-work/src_nav/Backups/Dropbox-account-2026-10-02/files/Elf Band Remastered mp3 version/01 Jingle Bells.mp3", "-t", "45", "-c:a", "aac", "-b:a", "256k", "-metadata", "title=Real Music Sample", str(real))
flac = OUT / "Second Song.flac"
ff("-i", str(tone), "-i", str(cover), "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-c:v", "png", "-disposition:v", "attached_pic", "-metadata", "title=Flac Song With Cover", "-metadata", "album=", str(flac))
src_I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(tone), "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True).stderr).group(1))
print("source loudness", src_I, "LUFS")

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    for label, w, h, mob in [("desktop", 1280, 900, False), ("phone", 430, 932, True)]:
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "favicon" not in m.text else None)
        pg.goto(BASE + "/#booth", wait_until="domcontentloaded")
        pg.wait_for_function("() => document.querySelector('#now-title').textContent !== 'Loading…'", timeout=20000)
        pg.wait_for_function("() => document.querySelectorAll('#up-list li img').length >= 5", timeout=20000)
        check(f"{label}: title", pg.title().startswith("Control Room"), pg.title())
        check(f"{label}: amplifi logo + Outfit font", pg.evaluate("() => { const i=document.querySelector('.brand-logo'); return i.complete && i.naturalWidth>0 && document.fonts.check('16px Outfit') }"))
        check(f"{label}: on the air shows a song + 10 coming up", pg.locator("#up-list li").count() == 10, pg.inner_text("#now-title"))
        ow = pg.evaluate("() => document.documentElement.scrollWidth - innerWidth")
        check(f"{label}: booth has no sideways scroll", ow <= 0, f"{ow}px")
        time.sleep(1.2); pg.screenshot(path=str(SHOTS / f"{label}_1_booth.png"))
        pg.click("[data-tab=songs]"); pg.wait_for_selector("#rows .lrow")
        check(f"{label}: songs list renders", pg.locator("#rows .lrow").count() >= 100)
        pg.fill("#q", "dreamer"); time.sleep(0.3)
        nq = pg.locator("#rows .lrow").count()
        check(f"{label}: search filters", 0 < nq < 60, str(nq))
        pg.fill("#q", ""); pg.select_option("#f-show", "off"); time.sleep(0.2)
        n_off = d1("SELECT COUNT(*) n FROM tracks WHERE enabled=0")[0]["n"]
        check(f"{label}: filter 'switched off' matches D1 ({n_off})", pg.locator("#rows .lrow").count() == n_off, str(pg.locator("#rows .lrow").count()))
        pg.select_option("#f-show", ""); time.sleep(0.2)
        ow = pg.evaluate("() => document.documentElement.scrollWidth - innerWidth")
        check(f"{label}: songs has no sideways scroll", ow <= 0, f"{ow}px")
        pg.wait_for_function("() => [...document.querySelectorAll('#rows img.l-thumb')].slice(0,6).every(i=>i.complete && i.naturalWidth>0)", timeout=20000)
        pg.screenshot(path=str(SHOTS / f"{label}_2_songs.png"))
        ctx.close()

    # ---------- end to end (desktop) ----------
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(BASE + "/#upload", wait_until="domcontentloaded")
    pg.wait_for_selector("#drop")
    pg.set_input_files("#files", [str(tone), str(flac), str(real)])
    t0 = time.time()
    pg.wait_for_function("() => [...document.querySelectorAll('.upc')].every(c => ['ready','error'].includes(c.getAttribute('data-state'))) && document.querySelectorAll('.upc').length === 3", timeout=300000)
    print("conversion + upload of 3 files took", round(time.time() - t0, 1), "s")
    states = pg.evaluate("() => [...document.querySelectorAll('.upc')].map(c => [c.getAttribute('data-file'), c.getAttribute('data-state'), c.getAttribute('data-id'), c.querySelector('.upc-step').textContent])")
    print(states)
    check("upload: both files converted + uploaded", all(s[1] == "ready" for s in states), str(states))
    pg.screenshot(path=str(SHOTS / "desktop_3_upload.png"), full_page=True)
    ids = {s[0]: s[2] for s in states}
    tid = ids.get("Test Tone Song.wav"); fid = ids.get("Second Song.flac")
    rows = d1(f"SELECT id, title, cat_title, cat_album, cat_artist, cat_year, cat_no, cat_section, art, file, dur_ms, bytes, enabled, source FROM tracks WHERE id IN ('{tid}','{fid}')")
    row = {r["id"]: r for r in rows}
    t = row.get(tid, {}); f2 = row.get(fid, {})
    check("upload: tags prefilled (title, album, artist, year, track)", t.get("cat_title") == f"Control Room Test Tone {RUN}" and t.get("cat_album") == "Test Album" and t.get("cat_artist") == "Test Artist" and t.get("cat_year") == "2026" and t.get("cat_no") == 7, json.dumps({k: t.get(k) for k in ("cat_title", "cat_album", "cat_artist", "cat_year", "cat_no")}))
    check("upload: new songs start switched off", t.get("enabled") == 0 and f2.get("enabled") == 0)
    check("upload: embedded cover extracted to art/", bool(f2.get("art")) and re.match(r"^art/[0-9a-f]{16}\.jpg$", f2.get("art") or "") is not None, str(f2.get("art")))
    # pull the stored file from LOCAL R2 and measure it with desktop ffprobe/ffmpeg
    mp3 = OUT / "stored.mp3"
    urllib.request.urlretrieve(BASE + "/media/" + t["file"], mp3)
    pr = json.loads(subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(mp3)], capture_output=True, text=True).stdout)
    st = pr["streams"][0]
    check("stored file: MP3, 44.1 kHz, stereo", st["codec_name"] == "mp3" and st["sample_rate"] == "44100" and st["channels"] == 2, f'{st["codec_name"]} {st["sample_rate"]} {st["channels"]}')
    brs = subprocess.run(["ffprobe", "-v", "quiet", "-select_streams", "a", "-show_entries", "packet=size", "-of", "csv=p=0", str(mp3)], capture_output=True, text=True).stdout.split()
    sizes = set(int(x.strip(",")) for x in brs if x.strip(","))
    check("stored file: constant 128 kbps (every frame 417/418 bytes)", sizes <= {417, 418}, str(sorted(sizes)[:6]))
    check("stored file: no ID3 tag", open(mp3, "rb").read(3) != b"ID3")
    I = float(re.search(r"I:\s+(-?[\d.]+) LUFS", subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(mp3), "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True).stderr).group(1))
    check(f"stored file: loudness -16 LUFS (measured {I}, source was {src_I})", abs(I + 16) <= 0.5)
    ns = int(re.search(r"Number of samples:\s+(\d+)", subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(mp3), "-af", "astats=measure_perchannel=none", "-f", "null", "-"], capture_output=True, text=True).stderr).group(1))
    exact = round(ns * 1000 / 44100)
    check(f"stored file: dur_ms in D1 = decoded length ({t.get('dur_ms')} vs {exact} ms from {ns} samples)", t.get("dur_ms") == exact)
    check(f"silence trimmed (20 s of tone + 0.75 s; got {t.get('dur_ms')/1000:.2f} s from a 23.5 s file)", 20500 <= t.get("dur_ms", 0) <= 21000)
    check("stored file size matches D1 bytes", os.path.getsize(mp3) == t.get("bytes"))
    rid = ids.get("Real Music Sample.m4a")
    rr = d1(f"SELECT file, dur_ms FROM tracks WHERE id='{rid}'")[0]
    rmp3 = OUT / "stored_real.mp3"
    urllib.request.urlretrieve(BASE + "/media/" + rr["file"], rmp3)
    rI = float(re.search(r"I:\s+(-?[\d.]+) LUFS", subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(rmp3), "-af", "ebur128=framelog=quiet", "-f", "null", "-"], capture_output=True, text=True).stderr).group(1))
    rns = int(re.search(r"Number of samples:\s+(\d+)", subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(rmp3), "-af", "astats=measure_perchannel=none", "-f", "null", "-"], capture_output=True, text=True).stderr).group(1))
    check(f"real music (M4A): -16 LUFS (measured {rI}) and exact dur_ms ({rr['dur_ms']} vs {round(rns*1000/44100)})", abs(rI + 16) <= 0.5 and rr["dur_ms"] == round(rns * 1000 / 44100))

    # edit details in the upload card, then publish
    card = pg.locator(f".upc[data-id='{tid}']")
    card.locator("input[name=title]").fill(f"Control Room Test Tone {RUN} (edited)")
    card.locator("input[name=year]").fill("2025")
    card.locator("text=Publish (add to the rotation)").click()
    pg.wait_for_selector(f".upc[data-id='{tid}'][data-state=published]", timeout=15000)
    r = d1(f"SELECT cat_title, cat_year, enabled, last_played_ms FROM tracks WHERE id='{tid}'")[0]
    check("edit + publish from the upload card", r["cat_title"] == f"Control Room Test Tone {RUN} (edited)" and r["cat_year"] == "2025" and r["enabled"] == 1 and r["last_played_ms"] > 0, json.dumps(r))

    # edit in the song drawer + cover replace
    pg.click("[data-tab=songs]"); pg.fill("#q", f"Control Room Test Tone {RUN}"); time.sleep(0.4)
    pg.locator(f"#rows .lrow[data-id='{tid}']").click(); pg.wait_for_selector("#drawer.open")
    pg.fill("#dr-form [name=album]", "Control Room Tests")
    pg.set_input_files("#dr-cover", str(cover))
    pg.wait_for_function("() => /New cover saved/.test(document.querySelector('#dr-msg').textContent)", timeout=20000)
    pg.screenshot(path=str(SHOTS / "desktop_4_song_drawer.png"))
    pg.click("#dr-save"); pg.wait_for_selector("#drawer:not(.open)", timeout=10000)
    r = d1(f"SELECT cat_album, art FROM tracks WHERE id='{tid}'")[0]
    check("drawer: album saved + new cover (art/ key)", r["cat_album"] == "Control Room Tests" and re.match(r"^art/[0-9a-f]{16}\.jpg$", r["art"] or "") is not None, json.dumps(r))
    hd = urllib.request.urlopen(BASE + "/media/" + r["art"].replace("art/", "art/hd/")).status
    check("drawer: big cover saved to art/hd/ too", hd == 200)

    # feature it ("only these" right now, the tone alone) -> rotation should plan it after the lock
    pg.click("[data-tab=featured]"); pg.click("#feat-new"); pg.wait_for_selector("#fdrawer.open")
    pg.fill("#fd-form [name=name]", "UI test feature")
    pg.click("text=Just today")
    pg.check("#fd-form input[name=mode][value=more]")
    pg.locator("#fd-weights .seg label", has_text="5×").click()
    check("weight 5x selected", pg.is_checked("#fd-form input[name=weight][value='5']"))
    pg.click(".ptab[data-ptab=songs]"); pg.fill("#fd-q", f"Control Room Test Tone {RUN} (edited)"); time.sleep(0.3)
    pg.locator("#fd-pick .pick-item", has_text="Control Room Tests").first.locator("input").check()
    fw = pg.evaluate("() => { const b=document.querySelector('#fd-form'); return [b.scrollWidth, b.clientWidth] }")
    check("feature editor: nothing wider than the drawer", fw[0] <= fw[1] + 1, str(fw))
    radio = pg.evaluate("() => document.querySelector('#fd-form input[name=mode]').getBoundingClientRect().width")
    check("feature editor: radio buttons are normal size", radio <= 24, str(radio))
    pg.screenshot(path=str(SHOTS / "desktop_5_feature_editor.png"))
    pg.click("#fd-save")
    pg.wait_for_selector("#cf-scrim:not([hidden])", timeout=5000)
    check("feature starting now asks to confirm first", "changes what plays now" in pg.inner_text("#cf-title"))
    pg.click("#cf-yes")
    pg.wait_for_selector(".fcard", timeout=10000)
    check("feature card shows 'On now'", "On now" in pg.inner_text(".fcard"))
    pg.wait_for_selector("#fdrawer:not(.open)"); time.sleep(0.5)
    pg.screenshot(path=str(SHOTS / "desktop_6_featured.png"), full_page=True)

    # play now from the booth picker, then skip, then undo the feature from History
    pg.click("[data-tab=booth]"); pg.fill("#pick-q", f"Control Room Test Tone {RUN} (edited)"); time.sleep(0.3)
    check("booth picker finds exactly the published test tone", pg.locator("#pick-results .pick-row").count() == 1, str(pg.locator("#pick-results .pick-row").count()))
    pg.locator("#pick-results .pick-row button", has_text="Play now").first.click()
    pg.wait_for_selector("#cf-scrim:not([hidden])")
    check("play now asks to confirm in plain words", "10 seconds" in pg.inner_text("#cf-body"))
    pg.click("#cf-yes")
    pg.wait_for_function("() => /starts for everyone/.test(document.querySelector('#toast').textContent)", timeout=10000)
    pg.wait_for_function("(run) => document.querySelector('#up-list li .t') && document.querySelector('#up-list li .t').textContent.includes('Control Room Test Tone ' + run)", arg=RUN, timeout=10000)
    check("play now: test tone is next for everyone", True)
    pg.screenshot(path=str(SHOTS / "desktop_7_booth_after_play.png"))
    time.sleep(11)   # let it go on air (local clock)
    pg.evaluate("() => document.querySelector('[data-tab=booth]').click()"); time.sleep(1.5)
    check("play now: test tone on air after 10 s", f"Control Room Test Tone {RUN}" in pg.inner_text("#now-title"), pg.inner_text("#now-title"))
    pg.click("#btn-skip"); pg.wait_for_selector("#cf-scrim:not([hidden])"); pg.click("#cf-yes")
    pg.wait_for_function("() => /Skipped|about to start/.test(document.querySelector('#toast').textContent)", timeout=10000)
    sk = d1("SELECT s.track_id, s.dur_ms FROM schedule s WHERE s.track_id='%s' ORDER BY seq DESC LIMIT 1" % tid)[0]
    check("skip: the tone's slot was cut short", sk["dur_ms"] < t["dur_ms"], f'{sk["dur_ms"]} < {t["dur_ms"]}')
    pg.click("[data-tab=activity]"); pg.wait_for_selector(".act")
    acts = pg.evaluate("() => [...document.querySelectorAll('.act')].map(a => [a.getAttribute('data-action'), a.textContent])")
    have = {a[0] for a in acts}
    check("history: upload, publish, edit, feature, play now, skip all logged", {"upload", "publish", "edit", "feature_add", "play_now", "skip"} <= have, str(sorted(have)))
    check("history: shows who", "tester@local.test" in pg.inner_text("#act"))
    pg.screenshot(path=str(SHOTS / "desktop_8_history.png"))
    pg.locator(".act[data-action=feature_add] button", has_text="Undo").first.click()
    pg.wait_for_selector("#cf-scrim:not([hidden])"); pg.click("#cf-yes")
    pg.wait_for_function("() => /Undone/.test(document.querySelector('#toast').textContent)", timeout=15000)
    left = d1("SELECT COUNT(*) n FROM features WHERE active=1 AND deleted_ms IS NULL")[0]["n"]
    check("undo the feature from History: no active featured time left", left == 0, str(left))
    check("desktop end to end: no JS errors", not errs, str(errs[:3]))
    ctx.close()

    # ---------- phone: upload + featured + booth screens ----------
    ctx = b.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "/#upload", wait_until="domcontentloaded"); pg.wait_for_selector("#drop"); time.sleep(0.5)
    pg.screenshot(path=str(SHOTS / "phone_3_upload.png"))
    pg.goto(BASE + "/#featured", wait_until="domcontentloaded"); pg.wait_for_selector("#feat-new"); time.sleep(0.8)
    pg.click("#feat-new"); pg.wait_for_selector("#fdrawer.open"); pg.locator("#fd-presets button", has_text="Christmas").click(); time.sleep(0.5)
    dw = pg.evaluate("() => document.querySelector('#fdrawer').getBoundingClientRect().width")
    check("phone: feature editor fits the screen", dw <= 430, str(dw))
    pg.screenshot(path=str(SHOTS / "phone_5_feature_editor.png"))
    check("phone: Christmas preset picks the Christmas album + yearly + unlock", "Christmas" in pg.inner_text("#fd-sum") and pg.is_checked("#fd-form [name=yearly]") and pg.is_checked("#fd-form input[name=mode][value=unlock]"), pg.inner_text("#fd-sum"))
    ow = pg.evaluate("() => document.documentElement.scrollWidth - innerWidth")
    check("phone: no sideways scroll", ow <= 0, f"{ow}px")
    big = pg.evaluate("() => [...document.querySelectorAll('#fdrawer .btn, #fdrawer .seg span, #fdrawer .mode')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().height).filter(h => h < 34).length")
    check("phone: buttons are big enough to tap (>= 34 px)", big == 0, str(big))
    check("phone: no JS errors", not errs, str(errs[:3]))
    ctx.close()
    b.close()
print("FAILS:", fails or "none")
sys.exit(1 if fails else 0)
