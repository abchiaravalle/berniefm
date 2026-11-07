// Minimal D1-compatible shim over a real SQLite (node:sqlite), for scheduler tests.
// Taken from the original sched_test.mjs (2026-10-05) and shared by the Control Room tests.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function d1(db) {
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

// The real prod export (wrangler d1 export) loaded into an in-memory SQLite.
export function fromExport(path) {
  const db = new DatabaseSync(':memory:');
  const sql = fs.readFileSync(path, 'utf8').replace(/^PRAGMA defer_foreign_keys=TRUE;\s*/m, '');
  db.exec(sql);
  return db;
}

export function applyNewTables(db, schemaPath) {
  // only the additive Control Room part of schema.sql
  const s = fs.readFileSync(schemaPath, 'utf8');
  const i = s.indexOf('-- ===== Control Room manager');
  if (i < 0) throw new Error('Control Room schema block not found');
  db.exec(s.slice(i));
}

// Deterministic Math.random + crypto.randomUUID so two engines can be compared slot by slot.
export function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let n = 0;
  const uuid = () => 'w-' + (++n).toString(16).padStart(8, '0');
  try { crypto.randomUUID = uuid; } catch { /* ignore */ }
  if (crypto.randomUUID !== uuid) Object.defineProperty(globalThis.crypto, 'randomUUID', { value: uuid, configurable: true, writable: true });
}

// Timeline sanity (from the original sched_test): contiguous seq, no overlaps, plays and
// last_played match the schedule exactly, request status matches its slot.
export function checkTimeline(db, { allowIdleGaps = false, fromSeq = 0 } = {}) {
  const rows = db.prepare('SELECT seq,start_ms,dur_ms,track_id,request_id FROM schedule WHERE seq >= ? ORDER BY seq').all(fromSeq);
  const msg = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.seq !== a.seq + 1) msg.push('seq gap ' + a.seq + '->' + b.seq);
    if (b.start_ms < a.start_ms + a.dur_ms) msg.push('overlap at seq ' + b.seq);
    if (!allowIdleGaps && b.start_ms !== a.start_ms + a.dur_ms) msg.push('time gap at seq ' + b.seq);
  }
  const reqBad = db.prepare(`SELECT r.id FROM requests r WHERE (r.status='scheduled') != EXISTS (SELECT 1 FROM schedule s WHERE s.request_id=r.id AND s.seq=r.seq)`).all();
  if (reqBad.length) msg.push('request status mismatch ' + JSON.stringify(reqBad.slice(0, 3)));
  return msg;
}
// last_played == latest scheduled start for every track that has slots (only valid when
// the whole history is in the table, i.e. synthetic test databases).
export function checkBookkeeping(db) {
  return db.prepare(`SELECT t.id, t.last_played_ms lp, (SELECT MAX(start_ms) FROM schedule s WHERE s.track_id=t.id) mx,
     t.plays, (SELECT COUNT(*) FROM schedule s WHERE s.track_id=t.id) n FROM tracks t
     WHERE (SELECT COUNT(*) FROM schedule s WHERE s.track_id=t.id) > 0 AND (t.last_played_ms != (SELECT MAX(start_ms) FROM schedule s WHERE s.track_id=t.id) OR t.plays != (SELECT COUNT(*) FROM schedule s WHERE s.track_id=t.id))`).all();
}

export function makeChecker() {
  const fails = [];
  let passes = 0;
  const check = (name, ok, extra = '') => {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
    if (ok) passes++; else fails.push(name);
    return ok;
  };
  return { check, fails, get passes() { return passes; } };
}
