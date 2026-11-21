// The Christmas switch in the scheduler (2026-11-21): "Mixed in" (pace + gap_min), "Christmas only"
// (mode only + gap_min = on repeat), "Off" (paused). Real SQLite through the D1 shim.
// Part A: synthetic library (every effect measurable). Part B: the real prod export
// ($BCRADIO_EXPORT), starting from the real state, incl. listener requests, DJ picks and replanFuture.
// usage: BCRADIO_EXPORT=path/to/export.sql node --no-warnings manager/test/sched_switch.mjs
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { d1, seedRandom, checkTimeline, checkBookkeeping, makeChecker, fromExport, exportPath, addSwitchColumns } from './d1shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const lib = await import(path.join(REPO, 'functions/_lib.js'));
const { check, fails } = makeChecker();
const H = 3600e3, D = 24 * H, M = 60e3;
const T0 = Date.UTC(2026, 11, 2, 18, 0);

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(REPO, 'schema.sql'), 'utf8'));
  const ins = db.prepare('INSERT INTO tracks(id,title,grp,file,dur_ms,bytes,last_played_ms,enabled,cat_section,cat_album) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 240; i++) { const alb = 'Album ' + (i % 12); ins.run('t' + i, 'Song ' + i, alb.toLowerCase(), 'x', 150000 + (i * 7919) % 200000, 1, T0 - D - i * 60000, 1, 'Albums', alb); }
  for (let i = 0; i < 12; i++) ins.run('x' + i, 'Xmas ' + i, i < 11 ? 'elf band' : 'single xmas', 'x', 120000 + i * 9000, 1, 0, 0, 'Christmas', 'Christmas');
  ins.run('r0', 'Regular xmas A', 'other a', 'x', 250000, 1, T0 - 2 * H, 1, 'Albums', 'Other A');
  ins.run('r1', 'Regular xmas B', 'other b', 'x', 260000, 1, T0 - 3 * H, 1, 'Albums', 'Other B');
  return { db, env: { DB: d1(db), MEDIA: { async put() {} } } };
}
const SET = [...Array(12).keys()].map(i => 'x' + i).concat(['r0', 'r1']);
function xmasRule(db, row) {
  const r = db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,created_ms,updated_ms,gap_min,pace)
                        VALUES ('Christmas',?,?,?,?,'x','x','America/New_York',0,?,0,?,?,?)`).run(row.mode, row.weight ?? 3, T0 - 10 * D, T0 + 30 * D, row.active ?? 1, row.updated_ms ?? 0, row.gap_min ?? null, row.pace ?? null);
  for (const id of SET) db.prepare("INSERT INTO feature_tracks(feature_id,kind,value) VALUES (?,'track',?)").run(r.lastInsertRowid, id);
  return Number(r.lastInsertRowid);
}
async function simulate(env, from, hours, stepMin = 9) {
  for (let t = from; t <= from + hours * H; t += stepMin * M) await Promise.all([lib.ensureSchedule(env, t, { publish: false }), lib.ensureSchedule(env, t + 5, { publish: false })]);
}
const slots = (db, a, b) => db.prepare('SELECT s.seq, s.start_ms, s.dur_ms, s.track_id, s.writer, s.request_id, t.grp FROM schedule s JOIN tracks t ON t.id=s.track_id WHERE s.start_ms >= ? AND s.start_ms < ? ORDER BY s.seq').all(a, b);
const X = new Set(SET);
function measure(s) {
  const xs = s.filter(x => X.has(x.track_id));
  let run = 0, maxRun = 0, b2b = 0;
  for (let i = 0; i < s.length; i++) { if (X.has(s[i].track_id)) { if (i && X.has(s[i - 1].track_id)) b2b++; run = 0; } else maxRun = Math.max(maxRun, ++run); }
  let maxHour = 0;
  for (let i = 0; i < xs.length; i++) { let n = 0; for (let j = i; j < xs.length && xs[j].start_ms < xs[i].start_ms + H; j++) n++; maxHour = Math.max(maxHour, n); }
  const last = {}; let minRep = Infinity;
  for (const x of xs) { if (last[x.track_id] != null) minRep = Math.min(minRep, x.start_ms - last[x.track_id]); last[x.track_id] = x.start_ms; }
  return { n: s.length, x: xs.length, share: xs.length / s.length, maxRun, b2b, maxHour, minRep, songs: new Set(xs.map(x => x.track_id)).size };
}

// ---- A1 Mixed in: ~1 in 3, never two in a row, <= 3 others in a row, per-song gap >= 120 min
{
  const { db, env } = fresh();
  xmasRule(db, { mode: 'unlock', pace: 3, gap_min: 120 });
  seedRandom(31); await simulate(env, T0, 48);
  const m = measure(slots(db, T0, T0 + 48 * H));
  check(`mixed: Christmas share about 1 in 3 (${(100 * m.share).toFixed(1)}%, ${m.x}/${m.n})`, m.share > 0.27 && m.share < 0.37);
  check('mixed: never two Christmas songs back to back', m.b2b === 0, 'b2b=' + m.b2b);
  check(`mixed: never more than 3 other songs in a row (max ${m.maxRun})`, m.maxRun <= 3);
  check(`mixed: one song never repeats within 120 min (shortest ${(m.minRep / M).toFixed(0)} min)`, m.minRep >= 120 * M);
  check(`mixed: all 14 songs take part (${m.songs})`, m.songs === 14);
  check(`mixed: no burst (max ${m.maxHour} Christmas songs in any hour)`, m.maxHour <= 8);
  check('mixed: switched-off songs stay off in the library', db.prepare("SELECT SUM(enabled) n FROM tracks WHERE cat_section='Christmas'").get().n === 0);
  check('mixed: timeline contiguous, bookkeeping exact', !checkTimeline(db).length && !checkBookkeeping(db).length, checkTimeline(db).concat(checkBookkeeping(db).map(JSON.stringify)).slice(0, 3).join(';'));
  const s = slots(db, T0, T0 + 48 * H); let adjAlb = 0;
  for (let i = 1; i < s.length; i++) if (!X.has(s[i].track_id) && !X.has(s[i - 1].track_id) && s[i].grp === s[i - 1].grp) adjAlb++;
  check('mixed: the other songs keep the album spread (no same album back to back)', adjAlb === 0, 'adjacent=' + adjAlb);
}
// ---- A2 Mixed in from a burst state (all 14 played at once): spreads at once, no new burst
{
  const { db, env } = fresh();
  db.prepare(`UPDATE tracks SET last_played_ms=? WHERE id IN (${SET.map(() => '?').join(',')})`).run(T0 - 8 * H, ...SET);
  xmasRule(db, { mode: 'unlock', pace: 3, gap_min: 120 });
  seedRandom(5); await simulate(env, T0, 24);
  const m = measure(slots(db, T0, T0 + 24 * H));
  check(`mixed after a burst: share ${(100 * m.share).toFixed(1)}%, max ${m.maxRun} others in a row, max ${m.maxHour}/h`, m.share > 0.27 && m.maxRun <= 3 && m.maxHour <= 8);
}
// ---- A3 Christmas only: only the set, full shuffled cycles, no same song twice in a row
{
  const { db, env } = fresh();
  seedRandom(8); await simulate(env, T0 - 2 * H, 2);
  const now = T0;
  xmasRule(db, { mode: 'only', weight: 1, gap_min: 30, updated_ms: now });
  const r = await lib.replanFuture(env, now);
  check('only: replanFuture says from when it is heard (the first slot after the 90 s lock)', r.from_ms >= now + lib.REPLAN_LOCK_MS && r.from_ms < now + lib.REPLAN_LOCK_MS + 6 * M, `${((r.from_ms - now) / 1000).toFixed(0)} s`);
  seedRandom(9); await simulate(env, now, 24);
  const s = slots(db, r.from_ms, now + 24 * H);
  const non = s.filter(x => !X.has(x.track_id));
  check(`only: nothing else plays (${non.length} other songs in ${s.length} slots)`, non.length === 0);
  const xs = s;
  let bad = 0; const lens = [];
  const all = slots(db, now, now + 24 * H).filter(x => X.has(x.track_id));
  for (let i = 0; i + 14 <= all.length; i += 14) { const c = all.slice(i, i + 14); if (new Set(c.map(x => x.track_id)).size !== 14) bad++; lens.push((c[13].start_ms + c[13].dur_ms - c[0].start_ms) / M); }
  check(`only: every cycle of 14 plays has 14 different songs (${lens.length} cycles, ${bad} bad)`, bad === 0 && lens.length >= 20);
  let same = 0; for (let i = 1; i < xs.length; i++) if (xs[i].track_id === xs[i - 1].track_id) same++;
  check('only: never the same song twice in a row, across cycles too', same === 0);
  const m = measure(all);
  check(`only: a song never comes back inside 30 min (shortest ${(m.minRep / M).toFixed(1)} min)`, m.minRep >= 30 * M - 1);
  check(`only: cycle length = the set's total length (${Math.min(...lens).toFixed(1)}-${Math.max(...lens).toFixed(1)} min)`, Math.max(...lens) - Math.min(...lens) < 1);
  check('only: timeline contiguous, bookkeeping exact', !checkTimeline(db).length && !checkBookkeeping(db).length);
  // requests + DJ picks still go first
  const t1 = now + 24 * H + 5 * M;
  db.prepare("INSERT INTO requests(track_id, ip_hash, created_ms, status) VALUES ('t17', 'x', ?, 'pending')").run(t1);
  await lib.replanFuture(env, t1);
  const rq = db.prepare("SELECT s.start_ms FROM schedule s JOIN requests r ON r.seq=s.seq WHERE r.track_id='t17' AND r.status='scheduled'").get();
  check('only: a pending listener request still plays, in its turn (first slot after the lock)', rq && rq.start_ms - t1 < lib.REPLAN_LOCK_MS + 6 * M, rq ? `${((rq.start_ms - t1) / M).toFixed(1)} min` : 'not scheduled');
  await lib.djPlace(env, 't40', 'next', t1 + 1000);
  const dj = db.prepare("SELECT track_id FROM schedule WHERE writer='dj' ORDER BY seq DESC LIMIT 1").get();
  check('only: a DJ pick still plays', dj && dj.track_id === 't40');
  await simulate(env, t1, 3);
  const after = slots(db, t1 + 20 * M, t1 + 3 * H).filter(x => !X.has(x.track_id) && !x.request_id && x.writer !== 'dj');
  check('only: after the request and the pick, back to only the set', after.length === 0, 'others=' + after.length);
  check('only: timeline still contiguous', !checkTimeline(db).length);
}
// ---- A4 Christmas only while 5 of the songs are within their gap: still never normal rotation
{
  const { db, env } = fresh();
  db.prepare(`UPDATE tracks SET last_played_ms=? WHERE id IN ('x0','x1','x2','x3','x4')`).run(T0 - 1 * M);
  xmasRule(db, { mode: 'only', weight: 1, gap_min: 60, updated_ms: T0 });
  seedRandom(12); await simulate(env, T0, 3);
  const s = slots(db, T0, T0 + 3 * H);
  check('only: songs inside their gap are played later, never replaced by normal rotation', s.every(x => X.has(x.track_id)), s.filter(x => !X.has(x.track_id)).length + ' others');
  const first9 = s.slice(0, 9).map(x => x.track_id);
  check('only: the 9 songs outside their gap come first', first9.every(id => !['x0', 'x1', 'x2', 'x3', 'x4'].includes(id)), first9.join(','));
  check('only: then the 5 inside their gap (the gap gives way rather than letting normal rotation in)', s.slice(9, 14).every(x => ['x0', 'x1', 'x2', 'x3', 'x4'].includes(x.track_id)), s.slice(9, 14).map(x => x.track_id).join(','));
}
// ---- A5 Off (paused): no switched-off songs, the two regular ones play normally
{
  const { db, env } = fresh();
  xmasRule(db, { mode: 'unlock', pace: 3, gap_min: 120, active: 0 });
  seedRandom(4); await simulate(env, T0, 24);
  const s = slots(db, T0, T0 + 24 * H);
  check('off: no switched-off Christmas song in 24 h', !s.some(x => x.track_id.startsWith('x')));
  const r = s.filter(x => x.track_id === 'r0' || x.track_id === 'r1').length;
  check(`off: the two regular songs play at their normal rate (${r} plays in 24 h, 242 songs in rotation)`, r <= 4);
}
// ---- A6 switching: mixed -> only -> off -> mixed, each through replanFuture; on-air + 90 s untouched
{
  const { db, env } = fresh();
  const fid = xmasRule(db, { mode: 'unlock', pace: 3, gap_min: 120 });
  seedRandom(21); await simulate(env, T0, 2);
  let now = T0 + 2 * H + 30 * 1000;
  for (const [name, row] of [['only', { mode: 'only', pace: null, gap_min: 30, active: 1 }], ['off', { active: 0 }], ['mixed', { mode: 'unlock', pace: 3, gap_min: 120, active: 1 }]]) {
    const locked = db.prepare('SELECT seq, track_id, start_ms FROM schedule WHERE start_ms < ? ORDER BY seq').all(now + lib.REPLAN_LOCK_MS);
    const cols = Object.keys(row);
    db.prepare(`UPDATE features SET ${cols.map(c => c + '=?').join(',')}, updated_ms=? WHERE id=?`).run(...cols.map(c => row[c]), now, fid);
    const r = await lib.replanFuture(env, now);
    const locked2 = db.prepare('SELECT seq, track_id, start_ms FROM schedule WHERE start_ms < ? ORDER BY seq').all(now + lib.REPLAN_LOCK_MS);
    check(`switch to ${name}: the song on air and the next 90 s are untouched`, JSON.stringify(locked) === JSON.stringify(locked2.slice(0, locked.length)));
    check(`switch to ${name}: heard from ${((r.from_ms - now) / 1000).toFixed(0)} s later (next song after the lock)`, r.from_ms >= now + lib.REPLAN_LOCK_MS);
    const s = slots(db, r.from_ms, now + 2 * H);
    const ok = name === 'only' ? s.every(x => X.has(x.track_id)) : name === 'off' ? !s.some(x => x.track_id.startsWith('x')) : measure(s).share > 0.2;
    check(`switch to ${name}: the re-planned part follows it`, ok);
    now += 2 * H + 13 * M;
    await simulate(env, now - 2 * H, 2);
  }
  check('switching: timeline contiguous, bookkeeping exact', !checkTimeline(db).length && !checkBookkeeping(db).length);
}

// ---- B real prod export: from the real state (all 14 played in one burst last night)
let EXP = null;
try { EXP = exportPath(); } catch { /* no export available */ }
if (EXP) {
  const db = fromExport(EXP); addSwitchColumns(db);
  const env = { DB: d1(db), MEDIA: { async put() {} } };
  const t0 = db.prepare('SELECT MAX(created_ms) m FROM schedule').get().m + 1000;
  const seq0 = db.prepare('SELECT MAX(seq) m FROM schedule').get().m;
  const f = db.prepare("SELECT id FROM features WHERE name LIKE '%Christmas%'").get();
  if (f) {
    const PX = new Set(db.prepare('SELECT value FROM feature_tracks WHERE feature_id=?').all(f.id).map(r => r.value));
    db.prepare('UPDATE features SET pace=3, gap_min=120, updated_ms=? WHERE id=?').run(t0, f.id);
    seedRandom(1225);
    const r = await lib.replanFuture(env, t0);
    for (let t = t0; t < t0 + 24 * H; t += 9 * M) await Promise.all([lib.ensureSchedule(env, t, { publish: false }), lib.ensureSchedule(env, t + 7, { publish: false })]);
    const s = db.prepare('SELECT s.track_id, s.start_ms, s.dur_ms FROM schedule s WHERE s.start_ms >= ? AND s.start_ms < ? ORDER BY seq').all(r.from_ms, t0 + 24 * H);
    const xs = s.filter(x => PX.has(x.track_id));
    let run = 0, maxRun = 0; for (const x of s) { if (PX.has(x.track_id)) run = 0; else maxRun = Math.max(maxRun, ++run); }
    check(`prod export, mixed in: share ${(100 * xs.length / s.length).toFixed(1)}% (${xs.length}/${s.length}), max ${maxRun} others in a row`, xs.length / s.length > 0.27 && maxRun <= 3);
    check('prod export, mixed in: timeline contiguous with two racing writers', !checkTimeline(db, { fromSeq: seq0 }).length, checkTimeline(db, { fromSeq: seq0 }).slice(0, 3).join(';'));
  } else check('prod export has the Christmas period', false);
} else console.log('SKIP part B: no prod export (set BCRADIO_EXPORT)');

console.log(fails.length ? 'SOME FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
