// HARD REQUIREMENT check for the Control Room change: with no featured period active, the
// new scheduler (functions/_lib.js) must behave exactly like the one that was live before
// (test/_lib.before.js = functions/_lib.js at commit 746d492, byte-for-byte what prod ran).
//
// Both engines run against copies of the REAL prod database export, with the same seeded
// Math.random and crypto.randomUUID, through the same 72 h of simulated station life:
// listeners extending the schedule, listener requests (the request.js re-plan), DJ play
// now / play next / skip, stationState (which also prunes history at random), an idle
// gap. After every step the schedule, tracks bookkeeping, requests and every published
// state file must be identical.
//
// Variants for the new engine:
//   A  feature tables missing (code deployed before the migration)
//   B  feature tables present, empty
//   C  feature tables present with rules that are NOT active during the run
//      (paused, expired, future, yearly outside its window, unknown time zone)
//
// usage: node manager/test/sched_equiv.mjs [path/to/export.sql]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromExport, applyNewTables, d1, seedRandom, checkTimeline, makeChecker } from './d1shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const EXPORT = process.argv[2] || fs.readdirSync('/Volumes/6154577230/client-backups/bcradio-d1-2026-11-06').filter(f => f.endsWith('.sql')).map(f => '/Volumes/6154577230/client-backups/bcradio-d1-2026-11-06/' + f)[0];
const OLD = await import(path.join(HERE, '_lib.before.js'));
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

function inertRules(db, T0) {
  const H = 3600e3, D = 24 * H;
  const ins = db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,created_ms,updated_ms)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ids = db.prepare('SELECT id FROM tracks ORDER BY id LIMIT 40').all().map(r => r.id);
  const add = (fid, kind, v) => db.prepare('INSERT INTO feature_tracks(feature_id,kind,value) VALUES (?,?,?)').run(fid, kind, v);
  let r;
  r = ins.run('paused, would cover the whole run', 'only', 1, T0 - D, T0 + 10 * D, '2026-11-06T00:00', '2026-11-17T00:00', 'America/Los_Angeles', 0, 0, T0, T0);
  ids.slice(0, 5).forEach(id => add(r.lastInsertRowid, 'track', id));
  r = ins.run('expired yesterday', 'more', 5, T0 - 3 * D, T0 - D, '2026-11-03T00:00', '2026-11-05T00:00', 'America/Los_Angeles', 0, 1, T0, T0);
  add(r.lastInsertRowid, 'album', 'Dreamer');
  r = ins.run('starts after the run', 'only', 1, T0 + 5 * D, T0 + 6 * D, '2026-11-12T00:00', '2026-11-13T00:00', 'America/Los_Angeles', 0, 1, T0, T0);
  add(r.lastInsertRowid, 'section', 'Albums');
  r = ins.run('Christmas, yearly, not now', 'unlock', 3, Date.UTC(2026, 11, 1, 8), Date.UTC(2026, 11, 27, 8), '2026-12-01T00:00', '2026-12-27T00:00', 'America/Los_Angeles', 1, 1, T0, T0);
  add(r.lastInsertRowid, 'album', 'Christmas');
  r = ins.run('July 4th yearly', 'more', 3, Date.UTC(2027, 6, 4, 7), Date.UTC(2027, 6, 5, 7), '2027-07-04T00:00', '2027-07-05T00:00', 'America/Los_Angeles', 1, 1, T0, T0);
  add(r.lastInsertRowid, 'section', 'Singles');
  r = ins.run('bad time zone', 'only', 1, T0 - D, T0 + 10 * D, '2026-11-06T00:00', '2026-11-17T00:00', 'Mars/Olympus', 1, 1, T0, T0);
  ids.slice(5, 9).forEach(id => add(r.lastInsertRowid, 'track', id));
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

console.log('export:', EXPORT);
const base = fromExport(EXPORT);
const T0 = base.prepare('SELECT MAX(created_ms) m FROM schedule').get().m + 1000;   // the moment of the export
console.log('T0', new Date(T0).toISOString(), 'tracks', base.prepare('SELECT COUNT(*) n FROM tracks').get().n,
  'slots', base.prepare('SELECT COUNT(*) n FROM schedule').get().n);
base.close();

for (const seed of [1, 20261106, 424242]) {
  const dbOld = fromExport(EXPORT);
  const ref = await run(OLD, dbOld, T0, seed);
  check(`seed ${seed}: old engine timeline valid (${ref.steps} steps)`, checkTimeline(dbOld, { allowIdleGaps: true }).length === 0, checkTimeline(dbOld, { allowIdleGaps: true }).join('; '));
  const variants = {
    'A no feature tables': () => fromExport(EXPORT),
    'B empty feature tables': () => { const d = fromExport(EXPORT); applyNewTables(d, path.join(REPO, 'schema.sql')); return d; },
    'C inactive rules only': () => { const d = fromExport(EXPORT); applyNewTables(d, path.join(REPO, 'schema.sql')); inertRules(d, T0); return d; },
  };
  for (const [name, mk] of Object.entries(variants)) {
    const db = mk();
    const got = await run(NEW, db, T0, seed);
    let firstDiff = -1;
    for (let i = 0; i < Math.max(ref.snaps.length, got.snaps.length); i++) if (ref.snaps[i] !== got.snaps[i]) { firstDiff = i; break; }
    const pubSame = ref.published.length === got.published.length && ref.published.every((p, i) => p === got.published[i]);
    const slots = JSON.parse(got.snaps.at(-1)).s.length;
    check(`seed ${seed}: ${name}: identical after every one of ${got.steps} steps`, firstDiff < 0, firstDiff >= 0 ? 'first difference at step ' + (firstDiff + 1) : `${slots} schedule rows compared`);
    check(`seed ${seed}: ${name}: identical published state files (${got.published.length})`, pubSame);
    db.close();
  }
  // negative control: an ACTIVE rule must change the output, otherwise this test proves nothing
  {
    const db = fromExport(EXPORT); applyNewTables(db, path.join(REPO, 'schema.sql'));
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
console.log(fails.length ? 'SOME FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
