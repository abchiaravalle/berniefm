// Local test of ensureSchedule against a real SQLite (node:sqlite) wrapped in a
// minimal D1-compatible shim. Covers: cold start, idle gap restart, two racing
// writers, a request re-plan racing a rotation writer. Asserts the timeline is
// contiguous, has no overlaps, and that last_played/plays/request status match
// exactly what landed.
// usage: node sched_test.mjs
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const lib = await import(process.env.LIB);

function d1(db) {
  const prep = (sql) => {
    const mk = (args) => ({
      sql, args,
      bind: (...a) => mk(a),
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    });
    return mk([]);
  };
  return {
    prepare: prep,
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          const st = db.prepare(s.sql);
          if (/^\s*(SELECT|WITH)/i.test(s.sql)) out.push({ results: st.all(...s.args) });
          else { const r = st.run(...s.args); out.push({ meta: { changes: Number(r.changes) }, results: [] }); }
        }
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
const published = [];
const MEDIA = { async put(k, v) { published.push(JSON.parse(v)); } };

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(process.env.SCHEMA, 'utf8'));
  const ins = db.prepare('INSERT INTO tracks(id,title,grp,file,dur_ms,bytes,last_played_ms) VALUES (?,?,?,?,?,?,?)');
  for (let i = 0; i < 240; i++) ins.run('t' + i, 'Song ' + i, 'g' + (i % 12), 'x', 150000 + (i * 7919) % 200000, 1, 1000 + i);
  return { db, env: { DB: d1(db), MEDIA } };
}
function check(db, label) {
  const rows = db.prepare('SELECT seq,start_ms,dur_ms,track_id,request_id FROM schedule ORDER BY seq').all();
  let ok = true, msg = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.seq !== a.seq + 1) { ok = false; msg.push('seq gap ' + a.seq + '->' + b.seq); }
    if (b.start_ms < a.start_ms + a.dur_ms) { ok = false; msg.push('overlap at seq ' + b.seq); }
  }
  // bookkeeping: every track's last_played must equal its latest scheduled start
  const bad = db.prepare(`SELECT t.id, t.last_played_ms lp, (SELECT MAX(start_ms) FROM schedule s WHERE s.track_id=t.id) mx,
     t.plays, (SELECT COUNT(*) FROM schedule s WHERE s.track_id=t.id) n FROM tracks t
     WHERE (SELECT COUNT(*) FROM schedule s WHERE s.track_id=t.id) > 0 AND (t.last_played_ms != (SELECT MAX(start_ms) FROM schedule s WHERE s.track_id=t.id) OR t.plays != (SELECT COUNT(*) FROM schedule s WHERE s.track_id=t.id))`).all();
  if (bad.length) { ok = false; msg.push('bookkeeping mismatch ' + JSON.stringify(bad.slice(0, 3))); }
  const reqBad = db.prepare(`SELECT r.id FROM requests r WHERE (r.status='scheduled') != EXISTS (SELECT 1 FROM schedule s WHERE s.request_id=r.id AND s.seq=r.seq)`).all();
  if (reqBad.length) { ok = false; msg.push('request status mismatch ' + JSON.stringify(reqBad)); }
  const span = rows.length ? (rows.at(-1).start_ms + rows.at(-1).dur_ms - rows[0].start_ms) / 60000 : 0;
  // album spread: same grp back to back?
  const g = db.prepare('SELECT t.grp FROM schedule s JOIN tracks t ON t.id=s.track_id ORDER BY s.seq').all().map(r => r.grp);
  let adj = 0; for (let i = 1; i < g.length; i++) if (g[i] === g[i - 1]) adj++;
  // repeats within schedule
  const ids = rows.map(r => r.track_id); const rep = ids.length - new Set(ids).size;
  console.log((ok ? 'PASS ' : 'FAIL ') + label, `slots=${rows.length} span=${span.toFixed(0)}min sameAlbumBackToBack=${adj} repeats=${rep}`, msg.join('; '));
  return ok;
}
let all = true;
const T0 = 1_800_000_000_000;

// 1) cold start
{ const { db, env } = fresh(); const n = await lib.ensureSchedule(env, T0);
  all &= check(db, 'cold start (added ' + n + ')');
  const st = db.prepare('SELECT MIN(start_ms) a, MAX(start_ms+dur_ms) b FROM schedule').get();
  if (st.a !== T0 || st.b < T0 + lib.HORIZON_MS) { all = false; console.log('FAIL horizon', st); } else console.log('PASS horizon reached', ((st.b - T0) / 60000).toFixed(0), 'min');
  // calling again right away adds nothing
  const n2 = await lib.ensureSchedule(env, T0 + 1000); if (n2 !== 0) { all = false; console.log('FAIL second call added', n2); } else console.log('PASS idempotent');
  // 2) idle for 5 hours -> restart at now, no catch-up slots
  const T1 = T0 + 5 * 3600e3; const n3 = await lib.ensureSchedule(env, T1);
  const after = db.prepare('SELECT start_ms FROM schedule WHERE start_ms >= ? ORDER BY seq LIMIT 1').get(T0 + 3 * 3600e3);
  if (!after || after.start_ms !== T1) { all = false; console.log('FAIL idle restart', after, T1); } else console.log('PASS idle restart starts exactly at now (added ' + n3 + ')');
  // contiguity check excluding the intentional idle gap
  const rows = db.prepare('SELECT seq,start_ms,dur_ms FROM schedule ORDER BY seq').all();
  let gaps = 0; for (let i = 1; i < rows.length; i++) if (rows[i].start_ms !== rows[i - 1].start_ms + rows[i - 1].dur_ms) gaps++;
  console.log((gaps === 1 ? 'PASS' : 'FAIL') + ' exactly one gap (the idle period), found', gaps); all &= gaps === 1;
}

// 3) two writers racing from the same tail (interleaved at the batch boundary)
{ const { db, env } = fresh();
  await lib.ensureSchedule(env, T0);
  // advance 90 minutes so both want to extend
  const T = T0 + 90 * 60e3;
  await Promise.all([lib.ensureSchedule(env, T), lib.ensureSchedule(env, T), lib.ensureSchedule(env, T + 5)]);
  all &= check(db, 'three racing writers');
  const end = db.prepare('SELECT MAX(start_ms+dur_ms) b FROM schedule').get().b;
  console.log((end >= T + lib.HORIZON_MS ? 'PASS' : 'FAIL') + ' horizon after race', ((end - T) / 60000).toFixed(0), 'min ahead'); all &= end >= T + lib.HORIZON_MS;
}

// 4) requests: queued requests go first, in order, and get marked scheduled
{ const { db, env } = fresh();
  await lib.ensureSchedule(env, T0);
  // simulate request.js replan: delete future slots from cut, restore bookkeeping, add 3 requests
  const now = T0 + 60e3;
  for (const t of ['t200', 't201', 't202']) db.prepare("INSERT INTO requests(track_id, ip_hash, created_ms, status) VALUES (?, 'x', ?, 'pending')").run(t, now);
  const cut = db.prepare('SELECT seq FROM schedule WHERE start_ms >= ? ORDER BY seq LIMIT 1').get(now + 90000);
  const dropped = db.prepare('SELECT seq, track_id FROM schedule WHERE seq >= ?').all(cut.seq);
  db.prepare('DELETE FROM schedule WHERE seq >= ?').run(cut.seq);
  for (const d of dropped) db.prepare(`UPDATE tracks SET plays = MAX(plays-1,0), last_played_ms = COALESCE((SELECT MAX(start_ms) FROM schedule WHERE track_id=?1 AND seq < ?2), 0) WHERE id=?1`).run(d.track_id, cut.seq);
  await Promise.all([lib.ensureSchedule(env, now, { publish: false }), lib.ensureSchedule(env, now)]);
  all &= check(db, 'request replan + racing writer');
  const order = db.prepare('SELECT track_id FROM schedule WHERE seq >= ? ORDER BY seq LIMIT 3').all(cut.seq).map(r => r.track_id).join(',');
  console.log((order === 't200,t201,t202' ? 'PASS' : 'FAIL') + ' requests play next in order:', order); all &= order === 't200,t201,t202';
}
console.log('published state files:', published.length, '| last has', published.at(-1)?.items?.length, 'items');
console.log(all ? 'ALL PASS' : 'SOME FAILED');
process.exit(all ? 0 : 1);
