// Local API test for the live listener count. LOCAL ONLY (wrangler pages dev, --local D1).
// Usage: BASE=http://127.0.0.1:8820 node test_listen_local.mjs
// Uses wrangler d1 execute --local to age rows / inspect tables (never --remote).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const BASE = process.env.BASE || 'http://127.0.0.1:8820';
const REPO = process.env.REPO || process.env.HOME + '/gits/berniefm-listeners';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) { console.error('LOCAL ONLY'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log('PASS', m, extra); } else { fail++; console.log('FAIL', m, extra); } };
const sid = () => crypto.randomBytes(18).toString('base64url');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ipN = 1;
async function listen(body, { ip, origin, raw } = {}) {
  const h = { 'content-type': 'application/json', 'cf-connecting-ip': ip || `10.0.0.${ipN}` };
  if (origin) h.origin = origin;
  const r = await fetch(BASE + '/api/listen', { method: 'POST', headers: h, body: raw ?? JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
function d1(sql) {
  const out = execFileSync(REPO + '/node_modules/.bin/wrangler', ['d1', 'execute', 'bcradio', '--local', '--json', '--command', sql],
    { cwd: REPO, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' }, encoding: 'utf8' });
  return JSON.parse(out)[0].results;
}

d1('DELETE FROM listen_sessions; DELETE FROM listen_minutes;');
// 1. three web + two ios
const web = [sid(), sid(), sid()], ios = [sid(), sid()];
let last;
for (const s of web) last = await listen({ sid: s, platform: 'web', playing: true });
for (const s of ios) last = await listen({ sid: s, platform: 'ios', playing: true });
ok(last.status === 200 && last.j.total === 5 && last.j.web === 3 && last.j.ios === 2 && last.j.android === 0, '3 web + 2 ios -> total 5', JSON.stringify(last.j));
// repeat ping of the same sid doesn't double count
last = await listen({ sid: web[0], platform: 'web', playing: true });
ok(last.j.total === 5, 'repeat ping of the same session still 5', String(last.j.total));
// GET /api/listeners (edge cache may serve a fresh copy: first call is a miss)
let g = await fetch(BASE + '/api/listeners');
let gj = await g.json();
ok(g.status === 200 && gj.total === 5 && gj.web === 3 && gj.ios === 2, 'GET /api/listeners total 5', JSON.stringify(gj) + ' cc=' + g.headers.get('cache-control'));
ok(/s-maxage=15/.test(g.headers.get('cache-control') || ''), 'GET is edge-cacheable (s-maxage=15)');
// 2. stop one
last = await listen({ sid: web[1], platform: 'web', playing: false });
ok(last.status === 200 && last.j.total === 4 && last.j.web === 2, 'stop one web -> 4', JSON.stringify(last.j));
ok(d1(`SELECT COUNT(*) n FROM listen_sessions WHERE sid='${web[1]}'`)[0].n === 0, 'stopped session row deleted at once');
// stop again (unknown sid) is harmless
last = await listen({ sid: web[1], platform: 'web', playing: false });
ok(last.status === 200 && last.j.total === 4, 'second stop is a no-op');
// 3. stale: age one ios row past the 150 s window -> not counted; past 180 s -> deleted by cleanup
d1(`UPDATE listen_sessions SET last_seen_ms = last_seen_ms - 160000 WHERE sid='${ios[0]}'`);
last = await listen({ sid: web[0], platform: 'web', playing: true });
ok(last.j.total === 3 && last.j.ios === 1, 'session silent for 160 s drops out of the count -> 3', JSON.stringify(last.j));
d1(`UPDATE listen_sessions SET last_seen_ms = last_seen_ms - 30000 WHERE sid='${ios[0]}'`);   // now 190 s old
// cleanup runs on a 10% of pings or on a GET cache miss; drive GETs with a cache-busting path variant is not possible, so ping until it's gone
let gone = false;
for (let i = 0; i < 40 && !gone; i++) {
  await listen({ sid: web[0], platform: 'web', playing: true }, { ip: `10.1.${i}.1` });
  gone = d1(`SELECT COUNT(*) n FROM listen_sessions WHERE sid='${ios[0]}'`)[0].n === 0;
}
ok(gone, 'session silent for > 180 s deleted by lazy cleanup');
// 4. bad input
const bad = [
  ['short sid', { sid: 'abc', platform: 'web', playing: true }],
  ['sid with bad chars', { sid: 'x'.repeat(10) + "';DROP--", platform: 'web', playing: true }],
  ['sid too long', { sid: 'a'.repeat(65), platform: 'web', playing: true }],
  ['sid not a string', { sid: 1234567890123456789, platform: 'web', playing: true }],
  ['bad platform', { sid: sid(), platform: 'windows', playing: true }],
  ['platform missing', { sid: sid(), playing: true }],
  ['playing not boolean', { sid: sid(), platform: 'web', playing: 'yes' }],
];
for (const [name, body] of bad) {
  const r = await listen(body, { ip: '10.2.0.1' });
  ok(r.status === 400, 'rejected: ' + name, String(r.status));
}
let r = await listen(null, { raw: 'not json', ip: '10.2.0.2' });
ok(r.status === 400, 'rejected: not JSON', String(r.status));
r = await listen(null, { raw: JSON.stringify({ sid: sid(), platform: 'web', playing: true, pad: 'x'.repeat(600) }), ip: '10.2.0.3' });
ok(r.status === 413, 'rejected: oversized body (>512 B)', String(r.status));
r = await listen({ sid: sid(), platform: 'web', playing: true }, { origin: 'https://evil.example', ip: '10.2.0.4' });
ok(r.status === 403, 'rejected: foreign Origin', String(r.status));
r = await listen({ sid: sid(), platform: 'web', playing: true }, { origin: 'https://bcradio.net', ip: '10.2.0.5' });
ok(r.status === 200, 'accepted: Origin https://bcradio.net', String(r.status));
r = await listen({ sid: sid(), platform: 'web', playing: true }, { origin: 'https://bcradio.net.evil.example', ip: '10.2.0.6' });
ok(r.status === 403, 'rejected: lookalike Origin', String(r.status));
r = await listen({ sid: sid(), platform: 'ios', playing: true }, { ip: '10.2.0.7' });
ok(r.status === 200, 'accepted: app request with no Origin', String(r.status));
const g2 = await fetch(BASE + '/api/listen');
ok(g2.status === 405, 'GET /api/listen -> 405');
const p2 = await fetch(BASE + '/api/listeners', { method: 'POST' });
ok(p2.status === 405, 'POST /api/listeners -> 405');
// 5. rate limit: 30/min per IP
const rl = [];
for (let i = 0; i < 33; i++) rl.push((await listen({ sid: web[2], platform: 'web', playing: true }, { ip: '10.9.9.9' })).status);
const first429 = rl.indexOf(429);
ok(first429 === 30 && rl.slice(0, 30).every(s => s === 200), 'rate limit trips on the 31st ping in a minute', `first 429 at #${first429 + 1}`);
r = await listen({ sid: web[2], platform: 'web', playing: true }, { ip: '10.9.9.10' });
ok(r.status === 200, 'other IP still fine while one is limited');
// 6. nothing but sid/platform/last_seen in the table; hits buckets hold no raw IP
const cols = d1("SELECT name FROM pragma_table_info('listen_sessions')").map(c => c.name);
ok(JSON.stringify(cols) === '["sid","platform","last_seen_ms"]', 'listen_sessions columns are only sid, platform, last_seen_ms', JSON.stringify(cols));
const hits = d1("SELECT bucket FROM hits WHERE bucket LIKE 'listen:%'");
ok(hits.length > 0 && hits.every(h => /^listen:[0-9a-f]{16}:60:\d+$/.test(h.bucket) && !h.bucket.includes('10.')), 'rate-limit buckets carry only a per-minute hash', hits.slice(0, 2).map(h => h.bucket).join(' '));
// 7. listen_minutes snapshots: wait into the next minute, ping, expect a row for the previous minute
const now = Date.now();
const waitMs = 60000 - (now % 60000) + 1500;
console.log(`waiting ${Math.round(waitMs / 1000)} s for the next minute...`);
await sleep(waitMs);
const before = d1('SELECT COUNT(*) n FROM listen_sessions WHERE last_seen_ms >= ' + (Date.now() - 150000))[0].n;
last = await listen({ sid: web[0], platform: 'web', playing: true }, { ip: '10.3.0.1' });
const prevMin = Math.floor(Date.now() / 60000) * 60000 - 60000;
const rows = d1('SELECT * FROM listen_minutes ORDER BY minute_ms');
const snap = rows.find(x => x.minute_ms === prevMin);
ok(!!snap && snap.web + snap.ios + snap.android === before, 'listen_minutes got the previous minute snapshot', JSON.stringify(snap) + ' live=' + before);
const cols2 = d1("SELECT name FROM pragma_table_info('listen_minutes')").map(c => c.name);
ok(JSON.stringify(cols2) === '["minute_ms","web","ios","android"]', 'listen_minutes holds totals only', JSON.stringify(cols2));
// second ping in the same minute doesn't add a row
await listen({ sid: web[0], platform: 'web', playing: true }, { ip: '10.3.0.2' });
ok(d1('SELECT COUNT(*) n FROM listen_minutes')[0].n === rows.length, 'one snapshot per minute');
console.log(`\n${pass} passed, ${fail} failed`);
d1('DELETE FROM listen_sessions;');
process.exit(fail ? 1 : 0);
