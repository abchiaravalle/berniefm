// The Christmas channels (2026-11-21): engine + endpoints, real SQLite through the D1 shim, on the REAL
// prod export ($BCRADIO_EXPORT, taken right before the channels work; Christmas period on, "Mixed in").
//
// Part 1, HARD GATE: the default channel ('mixed' = the normal timeline) stays byte-identical.
//   Today's prod engine (test/_lib.9c8f7f9.js = functions/_lib.js at 9c8f7f9, what bcradio.net runs) and the
//   new engine run the same 72 h of station life (listeners, requests, DJ now/next/skip, stationState,
//   an idle gap) from the real export with the live Christmas period. The new run ALSO drives both extra
//   channels at every step (listeners, requests, DJ picks, skips, re-plans, Control Room changes) with
//   their own random stream. schedule + tracks + requests + every main published file must be identical.
// Part 2: what each channel plays (christmas rounds, classic without Christmas songs, no repeats,
//   extension on demand, the window end, off/paused/'only').
// Part 3: the endpoints in-process (/api/now, /api/season, /api/request, /api/library, /api/catalog,
//   /api/dj, /api/listen, /api/listeners) with a mocked Turnstile + edge cache.
// usage: BCRADIO_EXPORT=path/to/export.sql node --no-warnings manager/test/sched_channels.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromExport, d1, seedRandom, checkTimeline, makeChecker, exportPath } from './d1shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const EXPORT = process.argv[2] || exportPath();
const PROD = await import(path.join(HERE, '_lib.9c8f7f9.js'));
const NEW = await import(path.join(REPO, 'functions/_lib.js'));
const CH = await import(path.join(REPO, 'functions/_channels.js'));
const MIG = fs.readFileSync(path.join(REPO, 'manager/migrations/0004_channels.sql'), 'utf8');
const { check, fails } = makeChecker();
const H = 3600e3, M = 60e3;
const fmt = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

function withChannels(db) { db.exec(MIG); return db; }
const mainKeys = new Set(['state/now.json', 'state/rev.json']);
function mediaLog() {
  const files = new Map(), log = [];
  return { files, log, MEDIA: { async put(k, v) { log.push(k + ' ' + v); files.set(k, v); } } };
}
function snapshot(db) {
  return JSON.stringify({
    s: db.prepare('SELECT seq,track_id,start_ms,dur_ms,request_id,created_ms,writer FROM schedule ORDER BY seq').all(),
    t: db.prepare('SELECT id,last_played_ms,plays,enabled FROM tracks ORDER BY id').all(),
    r: db.prepare('SELECT id,track_id,status,seq FROM requests ORDER BY id').all(),
  });
}
// request.js re-plan (main timeline), verbatim logic, parameterized by engine (as in sched_equiv.mjs)
async function requestReplan(lib, env, now) {
  const cut = await env.DB.prepare(`SELECT seq FROM schedule WHERE start_ms >= ?1 AND seq > COALESCE((SELECT MAX(seq) FROM schedule WHERE writer='dj'), 0) ORDER BY seq ASC LIMIT 1`).bind(now + 90000).first();
  if (cut) {
    const { results: dropped } = await env.DB.prepare('SELECT seq, track_id, request_id FROM schedule WHERE seq >= ?1').bind(cut.seq).all();
    const stmts = [env.DB.prepare('DELETE FROM schedule WHERE seq >= ?1').bind(cut.seq)];
    for (const d of dropped) {
      if (d.request_id) stmts.push(env.DB.prepare("UPDATE requests SET status='pending', seq=NULL WHERE id=?1").bind(d.request_id));
      stmts.push(env.DB.prepare(`UPDATE tracks SET plays = MAX(plays-1,0), last_played_ms = COALESCE((SELECT MAX(start_ms) FROM schedule WHERE track_id=?1 AND seq < ?2), 0) WHERE id=?1`).bind(d.track_id, cut.seq));
    }
    await env.DB.batch(stmts);
  }
  await lib.ensureSchedule(env, now, { publish: false });
  await lib.publishState(env, now);
}
// A second, independent random stream for everything the channels do, so the main engine sees exactly
// the same random numbers as in the reference run (the only way the two could still differ is through
// the database or the published files, which is what this test is about).
function sideRandom(seed) {
  let a = seed >>> 0, n = 0;
  return {
    rnd() { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
    uuid() { return 'c-' + (++n).toString(16).padStart(8, '0'); },
  };
}
async function isolated(side, fn) {
  const mr = Math.random, mu = crypto.randomUUID;
  Math.random = side.rnd; Object.defineProperty(globalThis.crypto, 'randomUUID', { value: side.uuid, configurable: true, writable: true });
  try { return await fn(); } finally { Math.random = mr; Object.defineProperty(globalThis.crypto, 'randomUUID', { value: mu, configurable: true, writable: true }); }
}

async function run(lib, db, T0, seed, { channels = false } = {}) {
  seedRandom(seed);
  const side = sideRandom(seed ^ 0x5eed);
  const media = mediaLog();
  const env = { DB: d1(db), MEDIA: media.MEDIA };
  const snaps = [];
  const trackIds = db.prepare('SELECT id FROM tracks WHERE enabled=1 ORDER BY id').all().map(r => r.id);
  const xmasIds = db.prepare("SELECT value FROM feature_tracks WHERE feature_id=1 AND kind='track' ORDER BY value").all().map(r => r.value);
  let now = T0, step = 0, chOps = 0;
  const pickId = () => trackIds[Math.floor(Math.random() * trackIds.length)];
  const end = T0 + 72 * H;
  while (now < end) {
    step++;
    const k = step % 23;
    if (k === 5) {
      const id = pickId();
      db.prepare("INSERT INTO requests(track_id, ip_hash, created_ms, status) VALUES (?, 'x', ?, 'pending')").run(id, now);
      await requestReplan(lib, env, now);
    } else if (k === 9) await lib.djPlace(env, pickId(), 'now', now);
    else if (k === 13) await lib.djPlace(env, pickId(), 'next', now);
    else if (k === 17) await lib.djPlace(env, null, 'now', now);
    else if (k === 19) await lib.stationState(env, now);
    else await lib.ensureSchedule(env, now, { publish: step % 2 === 0 });
    if (channels) {
      await isolated(side, async () => {
        const j = step % 11, t = now + 3000;
        await CH.channelState(env, 'christmas', t);
        await CH.channelState(env, 'classic', t + 1);
        if (j === 2) await CH.requestOnChannel(env, 'christmas', xmasIds[Math.floor(Math.random() * xmasIds.length)], 'side', t + 2);
        if (j === 4) await CH.requestOnChannel(env, 'classic', trackIds[Math.floor(Math.random() * trackIds.length)], 'side', t + 2);
        if (j === 6) await CH.djPlaceChannel(env, 'christmas', xmasIds[Math.floor(Math.random() * xmasIds.length)], step % 2 ? 'now' : 'next', t + 2);
        if (j === 7) await CH.djPlaceChannel(env, 'classic', null, 'now', t + 2);
        if (j === 8) await CH.djPlaceChannel(env, 'classic', trackIds[Math.floor(Math.random() * trackIds.length)], 'next', t + 2);
        if (j === 10) await CH.channelsChanged(env, t + 2);
        chOps++;
      });
    }
    snaps.push(snapshot(db));
    now += step === 300 ? 5 * H : 7 * M + (step * 7919) % 120000;
  }
  return { snaps, published: media.log.filter(l => mainKeys.has(l.split(' ')[0])), all: media.log, files: media.files, steps: step, chOps };
}

console.log('export:', EXPORT);
const base = fromExport(EXPORT);
const T0 = base.prepare('SELECT MAX(created_ms) m FROM schedule').get().m + 1000;
const xf = base.prepare("SELECT id, name, mode, active, pace, gap_min FROM features WHERE deleted_ms IS NULL").all();
const XIDS = base.prepare("SELECT value FROM feature_tracks WHERE feature_id=1 AND kind='track'").all().map(r => r.value);
const XSET = new Set(XIDS);
const XDUR = base.prepare(`SELECT SUM(dur_ms) s FROM tracks WHERE id IN (${XIDS.map(() => '?').join(',')})`).get(...XIDS).s;
console.log('T0', new Date(T0).toISOString(), 'features', JSON.stringify(xf), 'christmas songs', XIDS.length, 'one round', (XDUR / M).toFixed(1), 'min');
base.close();
check('export: the live Christmas period is on, Mixed in (unlock, pace 3, gap 120)', xf.some(f => f.id === 1 && f.active === 1 && f.mode === 'unlock' && f.pace === 3 && f.gap_min === 120), JSON.stringify(xf));

// ===================== Part 1: the default channel is byte-identical =====================
for (const seed of [1, 1225, 20261121]) {
  const ref = await run(PROD, fromExport(EXPORT), T0, seed);
  const dbN = withChannels(fromExport(EXPORT));
  const got = await run(NEW, dbN, T0, seed, { channels: true });
  let firstDiff = -1;
  for (let i = 0; i < Math.max(ref.snaps.length, got.snaps.length); i++) if (ref.snaps[i] !== got.snaps[i]) { firstDiff = i; break; }
  const slots = JSON.parse(got.snaps.at(-1)).s.length;
  check(`seed ${seed}: mixed (main timeline) identical to prod 9c8f7f9 after every one of ${got.steps} steps, with ${got.chOps} rounds of channel activity`, firstDiff < 0, firstDiff >= 0 ? 'first difference at step ' + (firstDiff + 1) : `${slots} schedule rows`);
  const pubSame = ref.published.length === got.published.length && ref.published.every((p, i) => p === got.published[i]);
  check(`seed ${seed}: state/now.json + state/rev.json identical (${got.published.length} writes)`, pubSame);
  const chFiles = got.all.filter(l => /^state\/(now|rev)-(christmas|classic)\.json /.test(l)).length;
  check(`seed ${seed}: the channels did publish their own files (${chFiles} writes) and nothing else`, chFiles > 100 && got.all.every(l => mainKeys.has(l.split(' ')[0]) || /^state\/(now|rev)-(christmas|classic)\.json /.test(l)));
  // channel timelines produced during that run
  for (const ch of ['christmas', 'classic']) {
    const rows = dbN.prepare('SELECT seq, start_ms, dur_ms, track_id, request_id, writer FROM ch_schedule WHERE channel=? ORDER BY seq').all(ch);
    let seqGap = 0, overlap = 0;
    for (let i = 1; i < rows.length; i++) { if (rows[i].seq !== rows[i - 1].seq + 1) seqGap++; if (rows[i].start_ms < rows[i - 1].start_ms + rows[i - 1].dur_ms) overlap++; }
    const xm = rows.filter(r => XSET.has(r.track_id)).length;
    const ok = ch === 'christmas' ? xm === rows.length : xm === 0;
    check(`seed ${seed}: ${ch}: ${rows.length} slots incl. DJ picks + requests, contiguous seq, no overlaps, ${ch === 'christmas' ? 'only Christmas songs' : 'no Christmas songs'}`, rows.length > 300 && !seqGap && !overlap && ok, `gaps ${seqGap} overlaps ${overlap} xmas ${xm}`);
    const reqBad = dbN.prepare(`SELECT r.id FROM ch_requests r WHERE r.channel=? AND (r.status='scheduled') != EXISTS (SELECT 1 FROM ch_schedule s WHERE s.channel=r.channel AND s.request_id=r.id AND s.seq=r.seq)`).all(ch);
    const nreq = dbN.prepare("SELECT COUNT(*) n FROM ch_requests WHERE channel=? AND status='scheduled'").get(ch).n;
    check(`seed ${seed}: ${ch}: request bookkeeping exact (${nreq} scheduled)`, !reqBad.length && nreq > 0, JSON.stringify(reqBad.slice(0, 3)));
    const bk = dbN.prepare(`SELECT p.track_id, p.plays, p.last_played_ms lp, (SELECT COUNT(*) FROM ch_schedule s WHERE s.channel=p.channel AND s.track_id=p.track_id) n,
        (SELECT MAX(start_ms) FROM ch_schedule s WHERE s.channel=p.channel AND s.track_id=p.track_id) mx FROM ch_plays p WHERE p.channel=?`).all(ch);
    const bad = bk.filter(b => b.plays !== b.n || (b.n && b.lp !== b.mx));
    check(`seed ${seed}: ${ch}: its own plays + last played match its timeline exactly (${bk.length} songs)`, !bad.length, JSON.stringify(bad.slice(0, 2)));
  }
  dbN.close();
}

// ===================== Part 2: what each channel plays =====================
function measure(rows) {
  const last = {}; let minRep = Infinity, b2b = 0, sameAlb = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (last[r.track_id] != null) minRep = Math.min(minRep, r.start_ms - last[r.track_id]);
    last[r.track_id] = r.start_ms;
    if (i && rows[i - 1].track_id === r.track_id) b2b++;
    if (i && r.grp && rows[i - 1].grp === r.grp) sameAlb++;
  }
  return { n: rows.length, minRep, b2b, sameAlb, songs: Object.keys(last).length };
}
const chRows = (db, ch, a = 0, b = 9e15) => db.prepare('SELECT s.seq, s.start_ms, s.dur_ms, s.track_id, s.request_id, s.writer, t.grp FROM ch_schedule s JOIN tracks t ON t.id=s.track_id WHERE s.channel=? AND s.start_ms >= ? AND s.start_ms < ? ORDER BY s.seq').all(ch, a, b);
async function listen(env, ch, from, hours, stepMin = 9) {
  for (let t = from; t <= from + hours * H; t += stepMin * M) await Promise.all([CH.channelState(env, ch, t), CH.channelState(env, ch, t + 5)]);   // two listeners racing
}
{
  const db = withChannels(fromExport(EXPORT));
  const media = mediaLog();
  const env = { DB: d1(db), MEDIA: media.MEDIA };
  const before = snapshot(db);
  check('on demand: nobody asked yet -> no channel rows, no files', db.prepare('SELECT COUNT(*) n FROM ch_schedule').get().n === 0 && media.files.size === 0);
  seedRandom(77);
  const t1 = T0 + 123456;
  const st = await CH.channelState(env, 'christmas', t1);
  check('on demand: the first listener starts the christmas channel at that very second (offset 0)', st && st.current && st.current.start_ms === t1 && st.ch === 'christmas', st && st.current && `${st.current.start_ms - t1} ms`);
  check('on demand: it plans 2 h ahead and publishes state/now-christmas.json + rev-christmas.json', st.items.at(-1).end_ms - t1 >= 2 * H && media.files.has('state/now-christmas.json') && media.files.has('state/rev-christmas.json'));
  const f = JSON.parse(media.files.get('state/now-christmas.json'));
  check('published channel file: same shape as now.json plus ch', f.ch === 'christmas' && Array.isArray(f.items) && f.generated_ms === t1 && f.items[0].track && f.items[0].track.url && 'is_request' in f.items[0] && !('_dj' in f));
  check('on demand: the classic channel still has nothing (it costs nothing until someone listens)', db.prepare("SELECT COUNT(*) n FROM ch_schedule WHERE channel='classic'").get().n === 0 && !media.files.has('state/now-classic.json'));

  await listen(env, 'christmas', t1, 24);
  const rows = chRows(db, 'christmas', t1, t1 + 24 * H);
  const m = measure(rows);
  check(`christmas: only the ${XIDS.length} Christmas songs (${rows.length} slots in 24 h)`, rows.every(r => XSET.has(r.track_id)) && m.songs === XIDS.length);
  let roundsOk = 0, roundsBad = 0; const lens = [];
  for (let i = 0; i + XIDS.length <= rows.length; i += XIDS.length) {
    const w = rows.slice(i, i + XIDS.length);
    if (new Set(w.map(r => r.track_id)).size === XIDS.length) roundsOk++; else roundsBad++;
    lens.push((w.at(-1).start_ms + w.at(-1).dur_ms - w[0].start_ms) / M);
  }
  check(`christmas: every song once before any repeats (${roundsOk} full rounds, ${roundsBad} broken)`, roundsOk >= 25 && roundsBad === 0);
  check(`christmas: a round lasts ${Math.min(...lens).toFixed(1)}-${Math.max(...lens).toFixed(1)} min (~45)`, lens.every(l => Math.abs(l - XDUR / M) < 0.1) && XDUR / M > 40 && XDUR / M < 50);
  check(`christmas: never the same song twice in a row; shortest repeat ${(m.minRep / M).toFixed(0)} min`, m.b2b === 0 && m.minRep >= 20 * M);
  const all = chRows(db, 'christmas');
  let holes = 0;
  for (let i = 1; i < all.length; i++) if (all[i].seq !== all[i - 1].seq + 1 || all[i].start_ms !== all[i - 1].start_ms + all[i - 1].dur_ms) holes++;
  check(`christmas: timeline contiguous with 2 listeners racing every 9 min (${all.length} slots, no gap, no overlap)`, holes === 0, 'holes ' + holes);

  seedRandom(78);
  await listen(env, 'classic', t1, 24);
  const rc = chRows(db, 'classic', t1, t1 + 24 * H);
  const mc = measure(rc);
  check(`classic: 0 Christmas songs in ${rc.length} slots (24 h)`, rc.length > 250 && rc.every(r => !XSET.has(r.track_id)));
  check(`classic: no song repeats within 6 h (shortest ${(mc.minRep / H).toFixed(1)} h), ${mc.songs} different songs`, mc.minRep >= 6 * H && mc.songs > 250);
  check(`classic: album spread holds (same album back to back: ${mc.sameAlb})`, mc.sameAlb === 0);
  const firstSong = rc[0];
  const stationLp = db.prepare('SELECT last_played_ms FROM tracks WHERE id=?').get(firstSong.track_id).last_played_ms;
  check(`classic: a fresh channel starts from long-unplayed songs (first song last aired on the station ${((t1 - stationLp) / H).toFixed(1)} h before)`, t1 - stationLp > 6 * H);
  check('isolation: 48 h of both channels left schedule, tracks and requests byte-identical', snapshot(db) === before);
  check('isolation: no main files were written by the channels', !media.files.has('state/now.json') && !media.files.has('state/rev.json'));

  // idle channel: nobody for 5 h -> next listener starts it again at that second, no catch-up
  const lastEnd = db.prepare("SELECT MAX(start_ms+dur_ms) e FROM ch_schedule WHERE channel='classic'").get().e;
  const t2 = lastEnd + 5 * H;
  const nBefore = db.prepare("SELECT MAX(seq) s FROM ch_schedule WHERE channel='classic'").get().s;
  const s2 = await CH.channelState(env, 'classic', t2);
  const first2 = db.prepare("SELECT seq, start_ms FROM ch_schedule WHERE channel='classic' AND seq=?").get(nBefore + 1);
  check('idle channel: after 5 h with nobody, the next listener starts a song at that second (no catch-up slots)', first2 && first2.start_ms === t2 && s2.current.start_ms === t2, first2 && `${first2.start_ms - t2} ms`);
  db.close();
}
// window end + off / paused / 'only'
{
  const db = withChannels(fromExport(EXPORT));
  const env = { DB: d1(db), MEDIA: mediaLog().MEDIA };
  const f = db.prepare('SELECT * FROM features WHERE id=1').get();
  const P = await CH.xmasNow(env, T0);
  check('xmasNow: on, 14 songs, until = Dec 26 23:59 Eastern', P && P.songs.length === 14 && P.until === Date.UTC(2026, 11, 27, 4, 59), P && new Date(P.until).toISOString());
  // a short window ending 50 min after T0 (not yearly)
  db.prepare("UPDATE features SET yearly=0, start_ms=?, end_ms=? WHERE id=1").run(T0 - H, T0 + 50 * M);
  seedRandom(5);
  await CH.channelState(env, 'christmas', T0);
  const last = db.prepare("SELECT MAX(start_ms) s FROM ch_schedule WHERE channel='christmas'").get().s;
  check('window end: nothing is planned to start after the Christmas window ends', last <= T0 + 50 * M, `${((T0 + 50 * M - last) / M).toFixed(1)} min before the end`);
  check('window end: after it, the channel answers null (callers fall back to the main timeline)', (await CH.channelState(env, 'christmas', T0 + 51 * M)) === null && (await CH.ensureChannel(env, 'classic', T0 + 51 * M)) === 0);
  db.prepare("UPDATE features SET yearly=?, start_ms=?, end_ms=?, active=0 WHERE id=1").run(f.yearly, f.start_ms, f.end_ms);
  check('Off (paused): no channels', (await CH.xmasNow(env, T0)) === null);
  db.prepare("UPDATE features SET active=1, mode='only', pace=NULL, gap_min=30 WHERE id=1").run();
  check("older whole-station 'Christmas only' (mode only): no channels (nothing to choose)", (await CH.xmasNow(env, T0)) === null);
  db.prepare("UPDATE features SET mode='unlock', pace=NULL, gap_min=NULL, weight=3 WHERE id=1").run();
  check("a custom unlock setting (no pace): channels on", !!(await CH.xmasNow(env, T0)));
  db.prepare("UPDATE features SET deleted_ms=1, active=0 WHERE id=1").run();
  check('deleted period: no channels', (await CH.xmasNow(env, T0)) === null);
  db.close();
}
// channelsChanged: Off -> files say "moved to mixed"; On again -> re-planned and published
{
  const db = withChannels(fromExport(EXPORT));
  const media = mediaLog();
  const env = { DB: d1(db), MEDIA: media.MEDIA };
  seedRandom(9);
  await CH.channelState(env, 'christmas', T0);
  db.prepare('UPDATE features SET active=0 WHERE id=1').run();
  const r1 = await CH.channelsChanged(env, T0 + 60e3);
  const g = JSON.parse(media.files.get('state/now-christmas.json'));
  check('Christmas Off: a live channel file switches to {ch:"mixed", items:[]} at once; an idle one is left alone', r1.christmas === 'gone' && r1.classic === 'idle' && g.ch === 'mixed' && g.items.length === 0 && !media.files.has('state/now-classic.json'), JSON.stringify(r1));
  db.prepare('UPDATE features SET active=1 WHERE id=1').run();
  const r2 = await CH.channelsChanged(env, T0 + 120e3);
  const g2 = JSON.parse(media.files.get('state/now-christmas.json'));
  check('Christmas On again: the channel is re-planned and its file is back', (r2.christmas === 'replanned' || r2.christmas === 'kept') && g2.ch === 'christmas' && g2.items.some(i => i.start_ms <= T0 + 120e3 && T0 + 120e3 < i.end_ms), JSON.stringify(r2));
  db.close();
}

// ===================== Part 3: endpoints in-process =====================
const store = new Map();
globalThis.caches = { default: { async match(k) { return store.get(k.url)?.clone() || null; }, async put(k, r) { store.set(k.url, r); } } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).includes('challenges.cloudflare.com')) return new Response(JSON.stringify({ success: true, hostname: 'bcradio.net', action: 'bcradio-request', challenge_ts: new Date().toISOString() }));
  return realFetch(u, o);
};
const api = {
  now: await import(path.join(REPO, 'functions/api/now.js')),
  season: await import(path.join(REPO, 'functions/api/season.js')),
  request: await import(path.join(REPO, 'functions/api/request.js')),
  library: await import(path.join(REPO, 'functions/api/library.js')),
  catalog: await import(path.join(REPO, 'functions/api/catalog.js')),
  dj: await import(path.join(REPO, 'functions/api/dj/[[path]].js')),
  listen: await import(path.join(REPO, 'functions/api/listen.js')),
  listeners: await import(path.join(REPO, 'functions/api/listeners.js')),
};
let ipn = 0;
const req = (url, body, extra = {}) => new Request('https://bcradio.net' + url, body === undefined ? { headers: extra } : { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.' + (++ipn >> 8) + '.' + (ipn & 255), ...extra }, body: JSON.stringify(body) });
const ctx = (env, r, params = {}) => ({ request: r, env, params, waitUntil: p => p && p.catch && p.catch(() => {}) });
const J = async res => ({ s: res.status, j: await res.json() });
{
  const db = withChannels(fromExport(EXPORT));
  const media = mediaLog();
  const env = { DB: d1(db), MEDIA: media.MEDIA, TURNSTILE_SECRET: 'test', DJ_CODE: 'test-dj-code-123', IP_SALT: 's' };
  seedRandom(31);
  // the endpoints use the real clock: start the main timeline at "now" from the export's state
  const nowTrue = Date.now();
  // /api/now
  let r = await J(await api.now.onRequestGet(ctx(env, req('/api/now'))));
  check('/api/now (no ch): the old answer, no ch field', r.s === 200 && r.j.current && !('ch' in r.j) && r.j.items.length > 10);
  const mainBefore = snapshot(db);
  r = await J(await api.now.onRequestGet(ctx(env, req('/api/now?ch=christmas'))));
  check('/api/now?ch=christmas: the christmas channel (ch, current, next, history), only Christmas songs', r.j.ch === 'christmas' && r.j.current && XSET.has(r.j.current.track.id) && r.j.next.length >= 4 && r.j.items.every(i => XSET.has(i.track.id)), r.j.current && r.j.current.track.title);
  check('/api/now?ch=christmas: published state/now-christmas.json', JSON.parse(media.files.get('state/now-christmas.json')).ch === 'christmas');
  r = await J(await api.now.onRequestGet(ctx(env, req('/api/now?ch=classic'))));
  check('/api/now?ch=classic: no Christmas songs', r.j.ch === 'classic' && r.j.items.length > 10 && r.j.items.every(i => !XSET.has(i.track.id)));
  check('/api/now?ch=christmas|classic did not touch the main timeline', snapshot(db) === mainBefore);
  r = await J(await api.now.onRequestGet(ctx(env, req('/api/now?ch=mixed'))));
  check('/api/now?ch=mixed: the main timeline with ch:"mixed"', r.j.ch === 'mixed' && r.j.current && r.j.items.length > 10);
  r = await J(await api.now.onRequestGet(ctx(env, req('/api/now?ch=bogus'))));
  check('/api/now?ch=bogus: the main timeline with ch:"mixed"', r.j.ch === 'mixed' && r.j.current);
  // /api/season
  store.clear();
  r = await J(await api.season.onRequestGet(ctx(env, req('/api/season'))));
  check('/api/season: theme + until_ms unchanged, channels = Mixed (default) / Christmas only / No Christmas', r.j.theme === 'christmas' && r.j.until_ms === Date.UTC(2026, 11, 27, 4, 59) &&
    JSON.stringify(r.j.channels) === JSON.stringify([{ id: 'mixed', label: 'Mixed', default: true }, { id: 'christmas', label: 'Christmas only' }, { id: 'classic', label: 'No Christmas' }]), JSON.stringify(r.j));
  // /api/library + /api/catalog
  store.clear();
  r = await J(await api.library.onRequestGet(ctx(env, req('/api/library'))));
  const plainCount = r.j.songs.length;
  check('/api/library (no ch): unchanged (no ch field, no switched-off Christmas songs)', !('ch' in r.j) && plainCount === db.prepare('SELECT COUNT(*) n FROM tracks WHERE enabled=1 AND requestable=1').get().n);
  r = await J(await api.library.onRequestGet(ctx(env, req('/api/library?ch=christmas'))));
  check(`/api/library?ch=christmas: the ${XIDS.length} Christmas songs, with status on that channel`, r.j.ch === 'christmas' && r.j.songs.length === XIDS.length && r.j.songs.every(s => XSET.has(s.id) && ['ok', 'upcoming', 'recent'].includes(s.status)) && r.j.songs.some(s => s.status !== 'ok'));
  r = await J(await api.library.onRequestGet(ctx(env, req('/api/library?ch=classic'))));
  check('/api/library?ch=classic: everything requestable except the Christmas songs', r.j.ch === 'classic' && r.j.songs.every(s => !XSET.has(s.id)) && r.j.songs.length === plainCount - XIDS.filter(id => db.prepare('SELECT enabled FROM tracks WHERE id=?').get(id).enabled).length, String(r.j.songs.length));
  r = await J(await api.catalog.onRequestGet(ctx(env, req('/api/catalog?ch=christmas'))));
  check('/api/catalog?ch=christmas: the Christmas songs only (incl. switched-off ones)', r.j.ch === 'christmas' && r.j.count === XIDS.length);
  r = await J(await api.catalog.onRequestGet(ctx(env, req('/api/catalog?ch=classic'))));
  const flat = r.j.sections.flatMap(s => s.albums.flatMap(a => a.tracks.map(t => t.id)));
  check('/api/catalog?ch=classic: no Christmas songs', r.j.ch === 'classic' && flat.length === r.j.count && flat.every(id => !XSET.has(id)));
  // /api/request
  // regular songs nobody has near them: not on the main timeline's or the classic channel's last/next 4 h
  const busy = new Set(db.prepare("SELECT track_id FROM ch_schedule WHERE channel='classic' UNION SELECT track_id FROM schedule WHERE start_ms > ?").all(nowTrue - 5 * H).map(x => x.track_id));
  const regular = db.prepare(`SELECT id FROM tracks WHERE enabled=1 AND requestable=1 AND last_played_ms < ? AND id NOT IN (${XIDS.map(() => '?').join(',')}) ORDER BY id`).all(nowTrue - 5 * H, ...XIDS).map(x => x.id).filter(id => !busy.has(id)).slice(0, 6);
  check('test setup: 6 regular songs free on every timeline', regular.length === 6, String(regular.length));
  const reqsBefore = db.prepare('SELECT COUNT(*) n FROM requests').get().n;
  r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: regular[0], token: 't', ch: 'christmas' }))));
  check('request ch=christmas, a regular song: refused in plain words', r.s === 404 && /Only Christmas songs/.test(r.j.message), r.j.message);
  r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: XIDS[0], token: 't', ch: 'classic' }))));
  check('request ch=classic, a Christmas song: refused in plain words', r.s === 404 && /no Christmas songs/.test(r.j.message), r.j.message);
  const xst = await CH.channelStatus(env, 'christmas', Date.now());
  const xfree = XIDS.filter(id => !xst.has(id));
  check(`christmas request availability: about a third of the songs are requestable (${xfree.length} of ${XIDS.length}), the rest coming up / played in the last 15 min`, xfree.length >= 2 && xfree.length <= 9, JSON.stringify([...xst.values()].reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {})));
  const xreq = xfree[0] || null;
  if (xreq) {
    r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: xreq, token: 't', ch: 'christmas' }))));
    const row = db.prepare("SELECT * FROM ch_requests WHERE track_id=? AND channel='christmas'").get(xreq);
    const slot = row && db.prepare("SELECT start_ms FROM ch_schedule WHERE channel='christmas' AND seq=?").get(row.seq);
    check('request ch=christmas: accepted on the christmas channel, scheduled as the first song after the 90 s lock', r.s === 200 && r.j.ok && r.j.ch === 'christmas' && r.j.state && r.j.state.ch === 'christmas' && row && row.status === 'scheduled' && slot && slot.start_ms >= Date.now() + 85000 && slot.start_ms < Date.now() + 90000 + 6 * M, r.j.message + ' / ' + (slot && Math.round((slot.start_ms - Date.now()) / 1000) + ' s'));
    const nx = (await CH.buildChannelState(env, 'christmas', Date.now())).items.filter(i => i.start_ms > slot.start_ms);
    check('christmas after a request: the request plays once, never back to back with itself', nx[0] && nx[0].track.id !== xreq);
    r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: xreq, token: 't', ch: 'christmas' }))));
    check('request the same song again on the channel: "already coming up"', r.s === 409 && /coming up/.test(r.j.message), r.j.message);
  } else check('request ch=christmas: a free Christmas song exists to request', false, 'none free');
  r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: regular[1], token: 't', ch: 'classic' }))));
  const crow = db.prepare("SELECT * FROM ch_requests WHERE track_id=? AND channel='classic'").get(regular[1]);
  check('request ch=classic, a regular song: accepted on the classic channel', r.s === 200 && r.j.ch === 'classic' && crow && crow.status === 'scheduled', r.j.message);
  check('channel requests never touch the main request line or timeline', db.prepare('SELECT COUNT(*) n FROM requests').get().n === reqsBefore && snapshot(db) === mainBefore);
  r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: regular[1], token: 't', ch: 'classic' }))));
  check('request the same song again on classic: "already coming up"', r.s === 409 && /coming up/.test(r.j.message), r.j.message);
  r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: regular[2], token: 't' }))));
  check('request with no ch: the main request line, as before', r.s === 200 && !('ch' in r.j) && db.prepare('SELECT COUNT(*) n FROM requests').get().n === reqsBefore + 1, r.j.message);
  const fixedIp = { 'cf-connecting-ip': '10.200.0.1' };
  r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: regular[3], token: 't', ch: 'classic' }, fixedIp))));
  const r2 = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: regular[4], token: 't' }, fixedIp))));
  const r3 = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: xfree[1] || XIDS[1], token: 't', ch: 'christmas' }, fixedIp))));
  check('rate limit is shared across channels (1 per 2 min per listener)', r.s === 200 && r2.s === 429 && r3.s === 429, [r.j.message, r2.j.message, r3.j.message].join(' / '));
  // /api/dj
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/unlock', { code: 'test-dj-code-123' }), { path: ['unlock'] })));
  const token = r.j.token;
  const mainBefore2 = snapshot(db);
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/play', { token, id: regular[0], mode: 'now', ch: 'christmas' }), { path: ['play'] })));
  check('DJ play on christmas with a regular song: refused', r.s === 400 && /isn't on this channel/.test(r.j.message), r.j.message);
  const xpick = XIDS.find(id => id !== xreq);
  const t0 = Date.now();
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/play', { token, id: xpick, mode: 'now', ch: 'christmas' }), { path: ['play'] })));
  const djRow = db.prepare("SELECT * FROM ch_schedule WHERE channel='christmas' AND writer='dj' ORDER BY seq DESC LIMIT 1").get();
  check('DJ play now on christmas: every christmas listener switches in ~10 s; the pick is a DJ slot', r.s === 200 && r.j.ok && r.j.at - t0 >= 8000 && r.j.at - t0 <= 12000 && djRow && djRow.track_id === xpick && r.j.state.ch === 'christmas', `${r.j.at - t0} ms`);
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/play', { token, id: regular[0], mode: 'next', ch: 'classic' }), { path: ['play'] })));
  check('DJ play next on classic', r.s === 200 && r.j.ok && r.j.state.ch === 'classic' && r.j.state.items.some(i => i.track.id === regular[0]));
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/play', { token, id: XIDS[2], mode: 'next', ch: 'classic' }), { path: ['play'] })));
  check('DJ play on classic with a Christmas song: refused', r.s === 400, r.j.message);
  const curC = (await CH.buildChannelState(env, 'classic', Date.now())).items.find(i => i.start_ms <= Date.now() && Date.now() < i.end_ms);
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/skip', { token, ch: 'classic' }), { path: ['skip'] })));
  check('DJ skip on classic: done (or "about to start")', r.s === 200 && r.j.ok, r.j.message || `at +${Math.round((r.j.at - Date.now()) / 1000)} s, was ${curC && curC.track.title}`);
  check('DJ actions on channels never touch the main timeline', snapshot(db) === mainBefore2);
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/skip', { token: 'bad', ch: 'classic' }), { path: ['skip'] })));
  check('DJ on a channel still needs the token', r.s === 403);
  // /api/listen + /api/listeners
  const sid = () => 'test' + Math.random().toString(36).slice(2).padEnd(14, 'x') + 'abcd';
  const ping = async (b) => J(await api.listen.onRequestPost(ctx(env, req('/api/listen', b))));
  await ping({ sid: sid(), platform: 'web', playing: true });
  await ping({ sid: sid(), platform: 'web', playing: true, ch: 'mixed' });
  await ping({ sid: sid(), platform: 'ios', playing: true, ch: 'christmas' });
  const s4 = sid();
  r = await ping({ sid: s4, platform: 'android', playing: true, ch: 'classic' });
  check('/api/listen: totals keep their fields and add channels', r.s === 200 && r.j.total === 4 && r.j.web === 2 && r.j.ios === 1 && r.j.android === 1 && JSON.stringify(r.j.channels) === '{"mixed":2,"christmas":1,"classic":1}', JSON.stringify(r.j));
  r = await ping({ sid: s4, platform: 'android', playing: true, ch: 'christmas' });
  check('/api/listen: switching channel moves the session', r.j.total === 4 && r.j.channels.christmas === 2 && r.j.channels.classic === 0, JSON.stringify(r.j.channels));
  r = await ping({ sid: sid(), platform: 'web', playing: true, ch: 'party' });
  check('/api/listen: unknown ch refused', r.s === 400);
  store.clear();
  r = await J(await api.listeners.onRequestGet(ctx(env, req('/api/listeners'))));
  check('/api/listeners: {now,total,web,ios,android} + channels', r.j.total === 4 && r.j.web === 2 && typeof r.j.now === 'number' && r.j.channels && r.j.channels.mixed === 2 && r.j.channels.christmas === 2, JSON.stringify(r.j));
  // channels off: everything falls back to the main timeline
  db.prepare('UPDATE features SET active=0 WHERE id=1').run();
  store.clear();
  r = await J(await api.season.onRequestGet(ctx(env, req('/api/season'))));
  check('/api/season with Christmas Off: {theme:null, channels:[]}', r.j.theme === null && Array.isArray(r.j.channels) && r.j.channels.length === 0, JSON.stringify(r.j));
  r = await J(await api.now.onRequestGet(ctx(env, req('/api/now?ch=christmas'))));
  check('/api/now?ch=christmas with Christmas Off: the main timeline, ch:"mixed"', r.j.ch === 'mixed' && r.j.current && r.j.items.every(i => !XSET.has(i.track.id) || db.prepare('SELECT enabled FROM tracks WHERE id=?').get(i.track.id).enabled || i.start_ms < Date.now() + 2 * H));
  r = await J(await api.request.onRequestPost(ctx(env, req('/api/request', { id: XIDS.find(id => !db.prepare('SELECT enabled FROM tracks WHERE id=?').get(id).enabled), token: 't', ch: 'christmas' }))));
  check('request ch=christmas with Christmas Off: the old rules (switched-off song = unknown)', r.s === 404, r.j.message);
  r = await J(await api.dj.onRequestPost(ctx(env, req('/api/dj/skip', { token, ch: 'christmas' }), { path: ['skip'] })));
  check('DJ on a channel with Christmas Off: refused in plain words', r.s === 400 && /off right now/.test(r.j.message), r.j.message);
  db.close();
}
globalThis.fetch = realFetch;
console.log(fails.length ? 'SOME FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
