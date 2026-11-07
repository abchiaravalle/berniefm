// Featured periods + replanFuture, against real SQLite. Synthetic library (so every
// effect is measurable) plus one run on the real prod export.
// usage: node manager/test/sched_features.mjs
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { d1, seedRandom, checkTimeline, checkBookkeeping, makeChecker, fromExport, applyNewTables } from './d1shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const lib = await import(path.join(REPO, 'functions/_lib.js'));
const { check, fails } = makeChecker();
const H = 3600e3, D = 24 * H;
const T0 = Date.UTC(2026, 10, 10, 18, 0);  // Tue 2026-11-10 10:00 PST

function fresh({ disabledXmas = 14 } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(REPO, 'schema.sql'), 'utf8'));
  const ins = db.prepare('INSERT INTO tracks(id,title,grp,file,dur_ms,bytes,last_played_ms,enabled,cat_section,cat_album) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 240; i++) {
    const alb = 'Album ' + (i % 12);
    ins.run('t' + i, 'Song ' + i, alb.toLowerCase(), 'x', 150000 + (i * 7919) % 200000, 1, T0 - D - i * 60000, 1, i % 12 === 11 ? 'Singles' : 'Albums', alb);
  }
  for (let i = 0; i < disabledXmas; i++) ins.run('x' + i, 'Xmas ' + i, 'christmas', 'x', 180000 + i * 1000, 1, 0, 0, 'Albums', 'Christmas');
  const published = [];
  return { db, env: { DB: d1(db), MEDIA: { async put(k, v) { if (k.endsWith('now.json')) published.push(JSON.parse(v)); } } }, published };
}
function rule(db, { name = 'r', mode, weight = 1, start, end, yearly = 0, startLocal = 'x', endLocal = 'x', active = 1, items }) {
  const r = db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,created_ms,updated_ms)
                        VALUES (?,?,?,?,?,?,?,'America/Los_Angeles',?,?,0,0)`).run(name, mode, weight, start, end, startLocal, endLocal, yearly, active);
  for (const [k, v] of items) db.prepare('INSERT INTO feature_tracks(feature_id,kind,value) VALUES (?,?,?)').run(r.lastInsertRowid, k, v);
  return Number(r.lastInsertRowid);
}
async function simulate(env, from, hours, stepMin = 10) {
  for (let t = from; t <= from + hours * H; t += stepMin * 60e3) await lib.ensureSchedule(env, t, { publish: false });
}
const slots = (db, a, b) => db.prepare('SELECT s.seq, s.start_ms, s.track_id, s.writer, s.request_id, t.cat_album alb FROM schedule s JOIN tracks t ON t.id=s.track_id WHERE s.start_ms >= ? AND s.start_ms < ? ORDER BY s.seq').all(a, b);

// ---- 1. time zones / yearly windows
{
  const a = lib.zonedToUtc(2026, 12, 1, 0, 0);
  check('zonedToUtc: Dec 1 00:00 Los Angeles = 08:00 UTC (PST)', a === Date.UTC(2026, 11, 1, 8, 0), new Date(a).toISOString());
  const b = lib.zonedToUtc(2027, 7, 4, 0, 0);
  check('zonedToUtc: Jul 4 00:00 Los Angeles = 07:00 UTC (PDT)', b === Date.UTC(2027, 6, 4, 7, 0), new Date(b).toISOString());
  const c = lib.zonedToUtc(2027, 3, 14, 3, 0);
  check('zonedToUtc: day DST starts, 03:00 PDT = 10:00 UTC', c === Date.UTC(2027, 2, 14, 10, 0), new Date(c).toISOString());
  const ny = lib.zonedToUtc(2026, 12, 25, 9, 0, 'America/New_York');
  check('zonedToUtc: other zone (New York 09:00 = 14:00 UTC)', ny === Date.UTC(2026, 11, 25, 14, 0), new Date(ny).toISOString());
  const f = { yearly: 1, start_local: '2026-12-01T00:00', end_local: '2026-12-26T23:59', tz: 'America/Los_Angeles' };
  const w = lib.featureWindows(f, Date.UTC(2029, 0, 1), Date.UTC(2030, 0, 1));
  check('yearly: repeats in 2029 (Dec 1 - Dec 26)', w.length === 1 && w[0][0] === Date.UTC(2029, 11, 1, 8, 0), JSON.stringify(w.map(x => x.map(y => new Date(y).toISOString()))));
  const w0 = lib.featureWindows(f, Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1));
  check('yearly: never before the year it was set for', w0.length === 0);
  const nye = { yearly: 1, start_local: '2026-12-31T18:00', end_local: '2027-01-01T06:00', tz: 'America/Los_Angeles' };
  const wn = lib.featureWindows(nye, Date.UTC(2028, 0, 1, 0), Date.UTC(2028, 0, 1, 12));
  check('yearly: window crossing New Year (2027-12-31 18:00 -> 2028-01-01 06:00) found', wn.length === 1 && wn[0][0] === Date.UTC(2028, 0, 1, 2, 0) && wn[0][1] === Date.UTC(2028, 0, 1, 14, 0));
  const once = { yearly: 0, start_ms: 100, end_ms: 200 };
  check('one-off: overlap test', lib.featureWindows(once, 150, 300).length === 1 && lib.featureWindows(once, 200, 300).length === 0);
}

// ---- 2. 'more' 3x on one album: plays share goes up, timeline stays valid
{
  const base = fresh(), feat = fresh();
  seedRandom(7); await simulate(base.env, T0, 48);
  rule(feat.db, { mode: 'more', weight: 3, start: T0 - H, end: T0 + 49 * H, items: [['album', 'Album 3']] });
  seedRandom(7); await simulate(feat.env, T0, 48);
  const count = (db, a, b) => slots(db, a, b).filter(s => s.alb === 'Album 3').length;
  const nb = count(base.db, T0, T0 + 48 * H), nf = count(feat.db, T0, T0 + 48 * H), total = slots(feat.db, T0, T0 + 48 * H).length;
  const nb2 = count(base.db, T0 + 24 * H, T0 + 48 * H), nf2 = count(feat.db, T0 + 24 * H, T0 + 48 * H);
  // A song never repeats within 6 h (the "upcoming" exclude) and the plan runs 2 h ahead, so
  // a single song can't come round more than every ~8 h (3 a day). That caps a boost: here
  // 20 songs x 3 = 60 a day. Assert: day 2 reaches min(3x normal, 85% of that cap).
  const cap = 20 * 3;
  check(`more x3: "Album 3" plays go up (48 h: normal ${nb} -> featured ${nf} of ${total}; day 2: ${nb2} -> ${nf2}, no-repeat cap ${cap})`, nf2 >= Math.min(3 * nb2, 0.85 * cap) && nf > nb);
  const gaps = feat.db.prepare("SELECT s.track_id, s.start_ms FROM schedule s JOIN tracks t ON t.id=s.track_id WHERE t.cat_album='Album 3' ORDER BY s.track_id, s.start_ms").all();
  let minGap = Infinity;
  for (let i = 1; i < gaps.length; i++) if (gaps[i].track_id === gaps[i - 1].track_id) minGap = Math.min(minGap, gaps[i].start_ms - gaps[i - 1].start_ms);
  check(`more x3: a boosted song still waits >= 6 h between plays (shortest ${(minGap / H).toFixed(1)} h)`, minGap >= 6 * H);
  check('more x3: timeline contiguous, bookkeeping exact', !checkTimeline(feat.db).length && !checkBookkeeping(feat.db).length, checkTimeline(feat.db).join(';'));
  const ids = slots(feat.db, T0, T0 + 48 * H).map(s => s.track_id);
  let rep = 0; const seen = new Map();
  ids.forEach((id, i) => { if (seen.has(id) && i - seen.get(id) < 20) rep++; seen.set(id, i); });
  check('more x3: no song repeats within 20 slots', rep === 0, 'close repeats=' + rep);
  const ad = slots(feat.db, T0, T0 + 48 * H); let adj = 0;
  for (let i = 1; i < ad.length; i++) if (ad[i].alb === ad[i - 1].alb) adj++;
  check('more x3: never the same album back to back', adj === 0, 'adjacent=' + adj);
  const xm = slots(feat.db, T0, T0 + 48 * H).filter(s => s.alb === 'Christmas').length;
  check('more x3: switched-off songs stay off', xm === 0);
}

// ---- 3. 'unlock' Christmas (disabled) only inside its window, with the boundary mid-horizon
{
  const { db, env } = fresh();
  const start = T0 + 50 * 60e3, end = T0 + 26 * H;
  rule(db, { mode: 'unlock', weight: 3, start, end, items: [['album', 'Christmas']] });
  seedRandom(11); await simulate(env, T0, 40);
  const before = slots(db, 0, start).filter(s => s.alb === 'Christmas').length;
  const inside = slots(db, start, end).filter(s => s.alb === 'Christmas');
  const after = slots(db, end, T0 + 50 * H).filter(s => s.alb === 'Christmas').length;
  check('unlock: no Christmas song starts before the window (window starts 50 min into the 2 h plan)', before === 0, 'before=' + before);
  check(`unlock: Christmas songs play inside the window (${inside.length} slots, ${new Set(inside.map(s => s.track_id)).size} different songs)`, inside.length >= 14);
  check('unlock: none after the window ends', after === 0, 'after=' + after);
  check('unlock: songs are still switched off in the library', db.prepare("SELECT SUM(enabled) n FROM tracks WHERE cat_album='Christmas'").get().n === 0);
  check('unlock: timeline contiguous, bookkeeping exact', !checkTimeline(db).length && !checkBookkeeping(db).length, checkTimeline(db).join(';'));
}

// ---- 4. 'only' a small set: plays only them, normal rotation fills in when used up
{
  const { db, env } = fresh();
  rule(db, { mode: 'only', start: T0, end: T0 + 30 * H, items: [['album', 'Album 5'], ['track', 'x0'], ['track', 'x1']] });
  seedRandom(5); await simulate(env, T0, 3);
  const s = slots(db, T0, T0 + 2 * H);
  const setIds = new Set(db.prepare("SELECT id FROM tracks WHERE cat_album='Album 5'").all().map(r => r.id).concat(['x0', 'x1']));
  const firstN = s.slice(0, setIds.size);
  const inSet = firstN.filter(x => setIds.has(x.track_id)).length;
  check(`only: the first ${setIds.size} songs are all from the set (incl. 2 switched-off ones)`, inSet === setIds.size, `${inSet}/${setIds.size}`);
  check('only: after the set is used up, normal rotation fills in (no repeats, no silence)', s.length > setIds.size && new Set(s.map(x => x.track_id)).size === s.length);
  check('only: timeline contiguous', !checkTimeline(db).length && !checkBookkeeping(db).length);
  // a big set (a whole section) never runs out inside the window
  const b = fresh();
  rule(b.db, { mode: 'only', start: T0, end: T0 + 12 * H, items: [['section', 'Singles']] });
  seedRandom(5); await simulate(b.env, T0, 14);
  const win = slots(b.db, T0, T0 + 12 * H);
  const singles = new Set(b.db.prepare("SELECT id FROM tracks WHERE cat_section='Singles'").all().map(r => r.id));
  const firstPass = win.slice(0, singles.size);
  check(`only (section of ${singles.size}): first ${singles.size} slots all from the section`, firstPass.every(x => singles.has(x.track_id)));
  const outside = slots(b.db, T0 + 12 * H, T0 + 14 * H);
  check('only: after the window, the whole library is back', outside.some(x => !singles.has(x.track_id)));
}

// ---- 5. replanFuture: keeps on-air, the next 90 s, DJ picks and request order
{
  const { db, env, published } = fresh();
  seedRandom(3); await simulate(env, T0, 1);
  const now = T0 + H + 30000;
  await lib.ensureSchedule(env, now);
  await lib.djPlace(env, 't100', 'next', now);
  for (const id of ['t200', 't201']) db.prepare("INSERT INTO requests(track_id, ip_hash, created_ms, status) VALUES (?, 'x', ?, 'pending')").run(id, now);
  await lib.ensureSchedule(env, now + 1000, { publish: false });  // (requests get slotted at the tail)
  const onAir = db.prepare('SELECT seq, track_id, start_ms, dur_ms FROM schedule WHERE start_ms <= ? AND start_ms + dur_ms > ?').get(now + 2000, now + 2000);
  const djRow = db.prepare("SELECT seq, track_id, start_ms FROM schedule WHERE writer='dj' ORDER BY seq DESC LIMIT 1").get();
  const locked = db.prepare('SELECT seq, track_id, start_ms FROM schedule WHERE start_ms < ? ORDER BY seq').all(now + 2000 + lib.REPLAN_LOCK_MS);
  rule(db, { mode: 'unlock', weight: 5, start: now, end: now + 10 * H, items: [['album', 'Christmas']] });
  const n0 = published.length;
  const r = await lib.replanFuture(env, now + 2000);
  check('replan: returns ok and dropped/added counts', r.ok && r.dropped > 0 && r.added > 0, `dropped=${r.dropped} added=${r.added}`);
  const onAir2 = db.prepare('SELECT seq, track_id, start_ms, dur_ms FROM schedule WHERE seq=?').get(onAir.seq);
  check('replan: the song on air is untouched', JSON.stringify(onAir) === JSON.stringify(onAir2));
  const locked2 = db.prepare('SELECT seq, track_id, start_ms FROM schedule WHERE start_ms < ? ORDER BY seq').all(now + 2000 + lib.REPLAN_LOCK_MS);
  check('replan: everything starting in the next 90 s is untouched', JSON.stringify(locked) === JSON.stringify(locked2.slice(0, locked.length)));
  const dj2 = db.prepare('SELECT seq, track_id, start_ms FROM schedule WHERE seq=?').get(djRow.seq);
  check('replan: the DJ\'s queued pick keeps its place', JSON.stringify(djRow) === JSON.stringify(dj2));
  const after = db.prepare('SELECT track_id, request_id FROM schedule WHERE seq > ? ORDER BY seq').all(djRow.seq);
  check('replan: listener requests come first after it, in order', after[0]?.track_id === 't200' && after[1]?.track_id === 't201', after.slice(0, 3).map(x => x.track_id).join(','));
  check('replan: the new rule shows up in the re-planned part', after.slice(2, 10).some(x => x.track_id.startsWith('x')));
  check('replan: timeline contiguous, bookkeeping + requests exact', !checkTimeline(db).length && !checkBookkeeping(db).length, checkTimeline(db).concat(checkBookkeeping(db).map(JSON.stringify)).join(';'));
  check('replan: published a new state file', published.length === n0 + 1 && published.at(-1).items.length > 5);
  const reach = db.prepare('SELECT MAX(start_ms + dur_ms) e FROM schedule').get().e;
  check('replan: still planned >= 2 h ahead', reach >= now + 2000 + lib.HORIZON_MS);
  // ending the rule early + replan: Christmas songs leave the future
  db.prepare('UPDATE features SET active=0').run();
  await lib.replanFuture(env, now + 5000);
  const xAfter = db.prepare("SELECT COUNT(*) n FROM schedule s JOIN tracks t ON t.id=s.track_id WHERE t.cat_album='Christmas' AND s.start_ms >= ?").get(now + 5000 + lib.REPLAN_LOCK_MS + 600000).n;
  check('replan after pausing the rule: no Christmas songs left in the future plan', xAfter === 0, 'left=' + xAfter);
  check('replan after pausing: timeline + bookkeeping still exact', !checkTimeline(db).length && !checkBookkeeping(db).length);
}

// ---- 6. djPlace allowDisabled (play an unlocked song now)
{
  const { db, env } = fresh();
  seedRandom(9); await simulate(env, T0, 1);
  const now = T0 + H;
  const no = await lib.djPlace(env, 'x3', 'now', now);
  check('djPlace refuses a switched-off song by default (the public DJ panel)', no.ok === false);
  const yes = await lib.djPlace(env, 'x3', 'now', now, { allowDisabled: true });
  const row = db.prepare("SELECT track_id, start_ms FROM schedule WHERE writer='dj' ORDER BY seq DESC LIMIT 1").get();
  check('djPlace allowDisabled plays it in 10 s', yes.ok && row.track_id === 'x3' && row.start_ms === now + lib.DJ_LEAD_MS);
  check('djPlace: timeline still contiguous', !checkTimeline(db).length);
}

// ---- 7. real prod export with the Christmas-style unlock + a 'more' rule, 24 h, racing writers
{
  const exp = fs.readdirSync('/Volumes/6154577230/client-backups/bcradio-d1-2026-11-06').find(f => f.endsWith('.sql'));
  const db = fromExport('/Volumes/6154577230/client-backups/bcradio-d1-2026-11-06/' + exp);
  applyNewTables(db, path.join(REPO, 'schema.sql'));
  const env = { DB: d1(db), MEDIA: { async put() {} } };
  const t0 = db.prepare('SELECT MAX(created_ms) m FROM schedule').get().m + 1000;
  const seq0 = db.prepare('SELECT MAX(seq) m FROM schedule').get().m;   // older rows hold real idle gaps from before
  // pretend 6 Dreamer songs were switched off and unlocked, and Albums boosted 2x
  db.prepare("UPDATE tracks SET enabled=0 WHERE id IN (SELECT id FROM tracks WHERE cat_album='Dreamer' LIMIT 6)").run();
  rule(db, { mode: 'unlock', weight: 2, start: t0 + 3 * H, end: t0 + 20 * H, items: [['album', 'Dreamer']] });
  rule(db, { mode: 'more', weight: 2, start: t0, end: t0 + 24 * H, items: [['section', 'Albums']] });
  seedRandom(77);
  for (let t = t0; t < t0 + 24 * H; t += 9 * 60e3) await Promise.all([lib.ensureSchedule(env, t, { publish: false }), lib.ensureSchedule(env, t + 5, { publish: false })]);
  const off = new Set(db.prepare("SELECT id FROM tracks WHERE enabled=0").all().map(r => r.id));
  const s = db.prepare('SELECT track_id, start_ms FROM schedule WHERE start_ms >= ? ORDER BY seq').all(t0);
  const offBefore = s.filter(x => off.has(x.track_id) && x.start_ms < t0 + 3 * H).length;
  const offIn = s.filter(x => off.has(x.track_id) && x.start_ms >= t0 + 3 * H && x.start_ms < t0 + 20 * H);
  check('prod data: unlocked songs absent before the window', offBefore === 0, 'n=' + offBefore);
  check(`prod data: unlocked songs play inside it (${offIn.length} plays, ${new Set(offIn.map(x => x.track_id)).size} of 6 songs)`, new Set(offIn.map(x => x.track_id)).size >= 4);
  const offAfter = s.filter(x => off.has(x.track_id) && x.start_ms >= t0 + 20 * H).length;
  check('prod data: unlocked songs absent after it', offAfter === 0, 'n=' + offAfter);
  check('prod data: new timeline contiguous with two racing writers', !checkTimeline(db, { fromSeq: seq0 }).length, checkTimeline(db, { fromSeq: seq0 }).slice(0, 3).join(';'));
}

console.log(fails.length ? 'SOME FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
