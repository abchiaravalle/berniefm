// HARD REQUIREMENT check for scheduler changes.
//
// Part 1 (2026-11-06): with no featured period active, the scheduler (functions/_lib.js) must
// behave exactly like the one that was live before featured periods existed
// (test/_lib.before.js = functions/_lib.js at commit 746d492, byte-for-byte what prod ran).
//
// Part 2 (2026-11-21, the Christmas switch): featured periods that don't use the new settings
// (features.gap_min / features.pace NULL) must behave exactly like today's prod engine
// (test/_lib.e93f1fb.js = functions/_lib.js at e93f1fb, what bcradio.net ran before the switch),
// including the REAL live "Christmas" period (unlock, 3x, 14 songs) and extra active 'more' and
// 'only' rules.
//
// Both engines run against copies of the REAL prod database export, with the same seeded
// Math.random and crypto.randomUUID, through the same 72 h of simulated station life:
// listeners extending the schedule, listener requests (the request.js re-plan), DJ play
// now / play next / skip, stationState (which also prunes history at random), an idle
// gap. After every step the schedule, tracks bookkeeping, requests and every published
// state file must be identical.
//
// Part 1 variants for the new engine:
//   A  feature tables missing (code deployed before the migration)
//   B  feature tables present, empty
//   C  feature tables present with rules that are NOT active during the run
//      (paused, expired, future, yearly outside its window, unknown time zone)
//   D  as C, plus the 2026-11-21 columns, with inactive rules that USE them
//      (a paused "Christmas only", an expired "mixed in")
// Part 2 variants (new engine vs e93f1fb):
//   E  the export's real features (Christmas on now), no new columns yet
//   F  same, new columns added (NULL)
//   G  F + an active 'more' rule and an active 'only' rule during the run
//
// usage: BCRADIO_EXPORT=path/to/export.sql node manager/test/sched_equiv.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromExport, applyNewTables, d1, seedRandom, checkTimeline, makeChecker, exportPath, addSwitchColumns } from './d1shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const EXPORT = process.argv[2] || exportPath();
const OLD = await import(path.join(HERE, '_lib.before.js'));
const PROD = await import(path.join(HERE, '_lib.e93f1fb.js'));
const NEW = await import(path.join(REPO, 'functions/_lib.js'));
const { check, fails } = makeChecker();

// request.js re-plan, verbatim logic, parameterized by engine
async function requestReplan(lib, env, now) {
  const LOCK_MS = 90000;
  const cut = await env.DB.prepare(
    `SELECT seq FROM schedule WHERE start_ms >= ?1
       AND seq > COALESCE((SELECT MAX(seq) FROM schedule WHERE writer='dj'), 0)
     ORDER BY seq ASC LIMIT 1`
  ).bind(now + LOCK_MS).first();
  if (cut) {
    const { results: dropped } = await env.DB.prepare('SELECT seq, track_id, request_id FROM schedule WHERE seq >= ?1').bind(cut.seq).all();
    const stmts = [env.DB.prepare('DELETE FROM schedule WHERE seq >= ?1').bind(cut.seq)];
    for (const d of dropped) {
      if (d.request_id) stmts.push(env.DB.prepare("UPDATE requests SET status='pending', seq=NULL WHERE id=?1").bind(d.request_id));
      stmts.push(env.DB.prepare(
        `UPDATE tracks SET plays = MAX(plays-1,0), last_played_ms = COALESCE(
           (SELECT MAX(start_ms) FROM schedule WHERE track_id=?1 AND seq < ?2), 0) WHERE id=?1`
      ).bind(d.track_id, cut.seq));
    }
    await env.DB.batch(stmts);
  }
  await lib.ensureSchedule(env, now, { publish: false });
  await lib.publishState(env, now);
}

const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
function noFeatureTables(db) { db.exec('DROP TABLE IF EXISTS feature_tracks; DROP TABLE IF EXISTS features;'); return db; }
function emptyFeatureTables(db) {
  if (!hasTable(db, 'features')) applyNewTables(db, path.join(REPO, 'schema.sql'));
  db.exec('DELETE FROM feature_tracks; DELETE FROM features;');
  return db;
}

function inertRules(db, T0, { withNew = false } = {}) {
  const H = 3600e3, D = 24 * H;
  const ins = db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,created_ms,updated_ms)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ids = db.prepare('SELECT id FROM tracks ORDER BY id LIMIT 40').all().map(r => r.id);
  const add = (fid, kind, v) => db.prepare('INSERT INTO feature_tracks(feature_id,kind,value) VALUES (?,?,?)').run(fid, kind, v);
  const y = new Date(T0).getUTCFullYear();
  let r;
  r = ins.run('paused, would cover the whole run', 'only', 1, T0 - D, T0 + 10 * D, '2026-11-06T00:00', '2026-11-17T00:00', 'America/Los_Angeles', 0, 0, T0, T0);
  ids.slice(0, 5).forEach(id => add(r.lastInsertRowid, 'track', id));
  r = ins.run('expired yesterday', 'more', 5, T0 - 3 * D, T0 - D, '2026-11-03T00:00', '2026-11-05T00:00', 'America/Los_Angeles', 0, 1, T0, T0);
  add(r.lastInsertRowid, 'album', 'Dreamer');
  r = ins.run('starts after the run', 'only', 1, T0 + 5 * D, T0 + 6 * D, '2026-11-12T00:00', '2026-11-13T00:00', 'America/Los_Angeles', 0, 1, T0, T0);
  add(r.lastInsertRowid, 'section', 'Albums');
  r = ins.run('Christmas, yearly, not now', 'unlock', 3, Date.UTC(y, 11, 20, 8), Date.UTC(y, 11, 27, 8), `${y}-12-20T00:00`, `${y}-12-27T00:00`, 'America/Los_Angeles', 1, 1, T0, T0);
  add(r.lastInsertRowid, 'album', 'Christmas');
  r = ins.run('July 4th yearly', 'more', 3, Date.UTC(y + 1, 6, 4, 7), Date.UTC(y + 1, 6, 5, 7), `${y + 1}-07-04T00:00`, `${y + 1}-07-05T00:00`, 'America/Los_Angeles', 1, 1, T0, T0);
  add(r.lastInsertRowid, 'section', 'Singles');
  r = ins.run('bad time zone', 'only', 1, T0 - D, T0 + 10 * D, '2026-11-06T00:00', '2026-11-17T00:00', 'Mars/Olympus', 1, 1, T0, T0);
  ids.slice(5, 9).forEach(id => add(r.lastInsertRowid, 'track', id));
  if (withNew) {
    r = ins.run('Christmas only, paused', 'only', 1, T0 - D, T0 + 10 * D, '2026-11-06T00:00', '2026-11-30T00:00', 'America/New_York', 0, 0, T0, T0);
    db.prepare('UPDATE features SET gap_min=40 WHERE id=?').run(r.lastInsertRowid);
    ids.slice(10, 24).forEach(id => add(r.lastInsertRowid, 'track', id));
    r = ins.run('mixed in, expired', 'unlock', 3, T0 - 3 * D, T0 - D, '2026-11-03T00:00', '2026-11-05T00:00', 'America/New_York', 0, 1, T0, T0);
    db.prepare('UPDATE features SET gap_min=120, pace=3 WHERE id=?').run(r.lastInsertRowid);
    ids.slice(24, 38).forEach(id => add(r.lastInsertRowid, 'track', id));
  }
}

function snapshot(db) {
  return JSON.stringify({
    s: db.prepare('SELECT seq,track_id,start_ms,dur_ms,request_id,created_ms,writer FROM schedule ORDER BY seq').all(),
    t: db.prepare('SELECT id,last_played_ms,plays,enabled FROM tracks ORDER BY id').all(),
    r: db.prepare('SELECT id,track_id,status,seq FROM requests ORDER BY id').all(),
  });
}

// One engine through the scripted 72 h. Returns per-step snapshots + published files.
async function run(lib, db, T0, seed) {
  seedRandom(seed);
  const published = [];
  const env = { DB: d1(db), MEDIA: { async put(k, v) { published.push(k + ' ' + v); } } };
  const snaps = [];
  const trackIds = db.prepare('SELECT id FROM tracks WHERE enabled=1 ORDER BY id').all().map(r => r.id);
  let now = T0, step = 0;
  const pickId = () => trackIds[Math.floor(Math.random() * trackIds.length)];
  const end = T0 + 72 * 3600e3;
  while (now < end) {
    step++;
    const k = step % 23;
    if (k === 5) {                                   // listener request
      const id = pickId();
      db.prepare("INSERT INTO requests(track_id, ip_hash, created_ms, status) VALUES (?, 'x', ?, 'pending')").run(id, now);
      await requestReplan(lib, env, now);
    } else if (k === 9) {
      await lib.djPlace(env, pickId(), 'now', now);
    } else if (k === 13) {
      await lib.djPlace(env, pickId(), 'next', now);
    } else if (k === 17) {
      await lib.djPlace(env, null, 'now', now);      // skip
    } else if (k === 19) {
      await lib.stationState(env, now);
    } else {
      await lib.ensureSchedule(env, now, { publish: step % 2 === 0 });
    }
    snaps.push(snapshot(db));
    // ~7 min between events, with one 5 h idle gap on day 2
    now += step === 300 ? 5 * 3600e3 : 7 * 60e3 + (step * 7919) % 120000;
  }
  return { snaps, published, steps: step };
}
function compare(label, ref, got) {
  let firstDiff = -1;
  for (let i = 0; i < Math.max(ref.snaps.length, got.snaps.length); i++) if (ref.snaps[i] !== got.snaps[i]) { firstDiff = i; break; }
  const pubSame = ref.published.length === got.published.length && ref.published.every((p, i) => p === got.published[i]);
  const slots = JSON.parse(got.snaps.at(-1)).s.length;
  check(`${label}: identical after every one of ${got.steps} steps`, firstDiff < 0, firstDiff >= 0 ? 'first difference at step ' + (firstDiff + 1) : `${slots} schedule rows compared`);
  check(`${label}: identical published state files (${got.published.length})`, pubSame);
}

console.log('export:', EXPORT);
const base = fromExport(EXPORT);
const T0 = base.prepare('SELECT MAX(created_ms) m FROM schedule').get().m + 1000;   // the moment of the export
const liveF = hasTable(base, 'features') ? base.prepare('SELECT id, name, mode, weight, active FROM features WHERE deleted_ms IS NULL').all() : [];
console.log('T0', new Date(T0).toISOString(), 'tracks', base.prepare('SELECT COUNT(*) n FROM tracks').get().n,
  'slots', base.prepare('SELECT COUNT(*) n FROM schedule').get().n, 'features in export', JSON.stringify(liveF));
base.close();

// ---------- Part 1: no active featured period == the pre-featured-periods engine ----------
for (const seed of [1, 20261106, 424242]) {
  const dbOld = noFeatureTables(fromExport(EXPORT));
  const ref = await run(OLD, dbOld, T0, seed);
  check(`seed ${seed}: old engine timeline valid (${ref.steps} steps)`, checkTimeline(dbOld, { allowIdleGaps: true }).length === 0, checkTimeline(dbOld, { allowIdleGaps: true }).join('; '));
  const variants = {
    'A no feature tables': () => noFeatureTables(fromExport(EXPORT)),
    'B empty feature tables': () => emptyFeatureTables(fromExport(EXPORT)),
    'C inactive rules only': () => { const d = emptyFeatureTables(fromExport(EXPORT)); inertRules(d, T0); return d; },
    'D inactive rules incl. new settings (new columns)': () => { const d = emptyFeatureTables(fromExport(EXPORT)); addSwitchColumns(d); inertRules(d, T0, { withNew: true }); return d; },
  };
  for (const [name, mk] of Object.entries(variants)) {
    const db = mk();
    compare(`seed ${seed}: ${name}`, ref, await run(NEW, db, T0, seed));
    db.close();
  }
  // negative control: an ACTIVE rule must change the output, otherwise this test proves nothing
  {
    const db = emptyFeatureTables(fromExport(EXPORT));
    const r = db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,created_ms,updated_ms)
                          VALUES ('control: active','more',5,?,?,'x','x','America/Los_Angeles',0,1,?,?)`).run(T0 - 3600e3, T0 + 100 * 3600e3, T0, T0);
    db.prepare("INSERT INTO feature_tracks(feature_id,kind,value) VALUES (?,'section','Albums')").run(r.lastInsertRowid);
    const got = await run(NEW, db, T0, seed);
    const differs = got.snaps.some((s, i) => s !== ref.snaps[i]);
    check(`seed ${seed}: negative control: an active rule DOES change the schedule`, differs);
    check(`seed ${seed}: negative control timeline still valid`, checkTimeline(db, { allowIdleGaps: true }).length === 0, checkTimeline(db, { allowIdleGaps: true }).join('; '));
    db.close();
  }
  dbOld.close();
}

// ---------- Part 2: periods without the new settings == today's prod engine (e93f1fb) ----------
function extraRules(db) {
  const H = 3600e3;
  const ins = db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,created_ms,updated_ms)
                          VALUES (?,?,?,?,?,'x','x','America/Los_Angeles',0,1,?,?)`);
  let r = ins.run('more, day 1-2', 'more', 3, T0 + 6 * H, T0 + 40 * H, T0, T0);
  db.prepare("INSERT INTO feature_tracks(feature_id,kind,value) VALUES (?,'album','Dreamer')").run(r.lastInsertRowid);
  r = ins.run('only, 3 h on day 3', 'only', 1, T0 + 50 * H, T0 + 53 * H, T0, T0);
  db.prepare("INSERT INTO feature_tracks(feature_id,kind,value) VALUES (?,'section','Singles')").run(r.lastInsertRowid);
  return db;
}
const xmasOn = liveF.some(f => /christmas/i.test(f.name) && f.active);
check('part 2: the export carries the live Christmas period (on)', xmasOn, JSON.stringify(liveF));
for (const seed of [1, 1225, 424242]) {
  const dbRef = fromExport(EXPORT);
  const ref = await run(PROD, dbRef, T0, seed);
  check(`seed ${seed}: e93f1fb engine timeline valid with Christmas on (${ref.steps} steps)`, checkTimeline(dbRef, { allowIdleGaps: true }).length === 0);
  compare(`seed ${seed}: E real Christmas period, no new columns`, ref, await run(NEW, fromExport(EXPORT), T0, seed));
  { const d = fromExport(EXPORT); addSwitchColumns(d); compare(`seed ${seed}: F real Christmas period, new columns NULL`, ref, await run(NEW, d, T0, seed)); d.close(); }
  {
    const dRef = extraRules(fromExport(EXPORT));
    const ref2 = await run(PROD, dRef, T0, seed);
    const d = extraRules(fromExport(EXPORT)); addSwitchColumns(d);
    compare(`seed ${seed}: G Christmas + active 'more' + active 'only', new columns NULL`, ref2, await run(NEW, d, T0, seed));
    dRef.close(); d.close();
  }
  // negative control: setting the new pace on the Christmas period DOES change things
  {
    const d = fromExport(EXPORT); addSwitchColumns(d);
    d.prepare("UPDATE features SET pace=3, gap_min=120 WHERE name LIKE '%Christmas%'").run();
    const got = await run(NEW, d, T0, seed);
    check(`seed ${seed}: negative control: 'mixed in' on the Christmas period DOES change the schedule`, got.snaps.some((s, i) => s !== ref.snaps[i]));
    check(`seed ${seed}: negative control timeline still valid`, checkTimeline(d, { allowIdleGaps: true }).length === 0, checkTimeline(d, { allowIdleGaps: true }).join('; '));
    d.close();
  }
  dbRef.close();
}
console.log(fails.length ? 'SOME FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
