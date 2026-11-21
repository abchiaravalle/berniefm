// /api/season against real SQLite (node:sqlite + the D1 shim) and a fake edge cache.
// usage: node --no-warnings manager/test/test_season.mjs
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { d1, makeChecker } from './d1shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const store = new Map();
globalThis.caches = { default: { async match(k) { return store.get(k.url)?.clone() || null; }, async put(k, r) { store.set(k.url, r); } } };
const season = await import(path.join(REPO, 'functions/api/season.js'));
const lib = await import(path.join(REPO, 'functions/_lib.js'));
const { check, fails } = makeChecker();

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(REPO, 'schema.sql'), 'utf8'));
  return { db, env: { DB: d1(db) } };
}
function rule(db, { name, start_local, end_local, tz = 'America/New_York', yearly = 0, active = 1, deleted = null, mode = 'unlock' }) {
  const [s, e] = [start_local, end_local].map(x => { const m = x.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)$/).slice(1).map(Number); return lib.zonedToUtc(...m, tz); });
  db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,deleted_ms,created_ms,updated_ms)
              VALUES (?,?,3,?,?,?,?,?,?,?,?,0,0)`).run(name, mode, s, e, start_local, end_local, tz, yearly, active, deleted);
  return { s, e };
}
const NOW = lib.zonedToUtc(2026, 11, 20, 22, 30, 'America/New_York');
const XMAS = { name: 'Christmas', start_local: '2026-11-20T00:00', end_local: '2026-12-26T23:59', yearly: 1 };

{ const { env } = fresh(); check('no periods -> theme null (channels [] since 2026-11-21)', JSON.stringify(await season.seasonNow(env, NOW)) === '{"theme":null,"channels":[]}'); }
{ const { db, env } = fresh(); const { e } = rule(db, XMAS);
  const r = await season.seasonNow(env, NOW);
  check('Christmas on now -> christmas + window end', r.theme === 'christmas' && r.until_ms === e, JSON.stringify(r));
  check('until_ms = Dec 26 23:59 New York (04:59 UTC Dec 27)', r.until_ms === Date.UTC(2026, 11, 27, 4, 59), new Date(r.until_ms).toISOString());
  check('after the window -> null', (await season.seasonNow(env, e)).theme === null);
  check('before the window -> null', (await season.seasonNow(env, lib.zonedToUtc(2026, 11, 19, 23, 59, 'America/New_York'))).theme === null);
  const n27 = lib.zonedToUtc(2027, 12, 1, 12, 0, 'America/New_York');
  const r27 = await season.seasonNow(env, n27);
  check('yearly: on again Dec 1 2027, until Dec 26 2027', r27.theme === 'christmas' && r27.until_ms === lib.zonedToUtc(2027, 12, 26, 23, 59, 'America/New_York'), JSON.stringify(r27));
  check('yearly: off in July 2027', (await season.seasonNow(env, Date.UTC(2027, 6, 4))).theme === null);
}
{ const { db, env } = fresh(); rule(db, { ...XMAS, active: 0 }); check('paused -> null', (await season.seasonNow(env, NOW)).theme === null); }
{ const { db, env } = fresh(); rule(db, { ...XMAS, active: 0, deleted: 1 }); check('deleted -> null', (await season.seasonNow(env, NOW)).theme === null); }
{ const { db, env } = fresh(); rule(db, { ...XMAS, active: 1, deleted: 1 }); check('deleted_ms set (even if active) -> null', (await season.seasonNow(env, NOW)).theme === null); }
{ const { db, env } = fresh(); rule(db, { ...XMAS, name: 'July 4th' }); check('other names -> null', (await season.seasonNow(env, NOW)).theme === null); }
{ const { db, env } = fresh(); rule(db, { ...XMAS, name: 'Holiday lights', yearly: 0 }); check('/holiday/i one-off -> christmas', (await season.seasonNow(env, NOW)).theme === 'christmas'); }
{ const { db, env } = fresh(); rule(db, { ...XMAS, name: 'xmas CHRISTMAS week', mode: 'more' }); check('any mode, case-insensitive', (await season.seasonNow(env, NOW)).theme === 'christmas'); }
{ const { db, env } = fresh();
  db.prepare(`INSERT INTO features(name,mode,weight,start_ms,end_ms,start_local,end_local,tz,yearly,active,created_ms,updated_ms)
              VALUES ('Christmas','unlock',3,0,0,'2026-11-20T00:00','2026-12-26T23:59','Not/AZone',1,1,0,0)`).run();
  check('bad time zone -> skipped, null (no crash)', (await season.seasonNow(env, NOW)).theme === null); }
{ const { db, env } = fresh(); rule(db, XMAS); const { e } = rule(db, { name: 'Holiday', start_local: '2026-11-15T00:00', end_local: '2027-01-02T00:00' });
  check('two matching periods -> the later end', (await season.seasonNow(env, NOW)).until_ms === e); }
{ const db = new DatabaseSync(':memory:'); check('no features table -> null', (await season.seasonNow({ DB: d1(db) }, NOW)).theme === null); }
// HTTP handler: headers, CORS, edge cache
{ const { db, env } = fresh(); rule(db, XMAS);
  let waits = [];
  const ctx = { request: new Request('https://bcradio.net/api/season?x=1'), env, waitUntil: (p) => waits.push(p) };
  const r1 = await season.onRequestGet(ctx); await Promise.all(waits);
  const b1 = await r1.json();
  check('GET 200 json christmas', r1.status === 200 && b1.theme === 'christmas' && (r1.headers.get('content-type') || '').startsWith('application/json'), JSON.stringify(b1));
  check('Cache-Control public, s-maxage=300', r1.headers.get('cache-control') === 'public, s-maxage=300', r1.headers.get('cache-control'));
  check('CORS open (apps + website)', r1.headers.get('access-control-allow-origin') === '*');
  db.prepare('UPDATE features SET active=0').run();
  const r2 = await season.onRequestGet({ ...ctx, request: new Request('https://bcradio.net/api/season') });
  check('second call inside 5 min served from the edge cache (one D1 read)', (await r2.json()).theme === 'christmas');
  store.clear();
  const r3 = await season.onRequestGet({ ...ctx, waitUntil() {} });
  check('after the cache expires a paused period -> null', (await r3.json()).theme === null);
  const r4 = await season.onRequest();
  check('other methods -> 405', r4.status === 405);
}
console.log(fails.length ? 'SOME FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
