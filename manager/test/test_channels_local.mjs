// LOCAL ONLY: the Christmas channels over real HTTP on `wrangler pages dev` (station, :8820) + `wrangler dev`
// (Control Room, :8813), both on the SAME local D1 seeded from the fresh prod export. Never prod.
// usage: STATION=http://127.0.0.1:8820 CR=http://localhost:8813 node test_channels_local.mjs
import { execFileSync } from 'node:child_process';
const ST = process.env.STATION || 'http://127.0.0.1:8820';
const CR = process.env.CR || 'http://localhost:8813';
const REPO = process.env.REPO || process.env.HOME + '/gits/berniefm-channels';
for (const b of [ST, CR]) if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(b)) { console.error('LOCAL ONLY'); process.exit(2); }
let pass = 0, fail = 0;
const fails = [];
const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')); if (c) pass++; else { fail++; fails.push(m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(base, p, h = {}) { const r = await fetch(base + p, { headers: h }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; }
async function post(base, p, body, h = {}) { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; }
const cr = (p, body) => body === undefined ? get(CR, '/api' + p, { 'x-cr': '1' }) : post(CR, '/api' + p, body, { 'x-cr': '1' });
function d1(sql) {
  const out = execFileSync(REPO + '/node_modules/.bin/wrangler', ['d1', 'execute', 'bcradio', '--local', '--persist-to', REPO + '/manager/.wrangler/state', '--json', '--command', sql],
    { cwd: REPO, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' }, encoding: 'utf8' });
  return JSON.parse(out)[0].results;
}
const fmt = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const mainSnap = () => JSON.stringify(d1('SELECT seq, track_id, start_ms, dur_ms FROM schedule ORDER BY seq DESC LIMIT 60'));

// --- season (pages dev keeps an edge cache up to 5 min: poll)
let s;
for (let i = 0; i < 40; i++) { s = await get(ST, '/api/season?x'); if (s.j && s.j.channels && s.j.channels.length) break; s = await get(ST, '/api/season'); if (s.j && s.j.channels && s.j.channels.length) break; await sleep(10000); }
ok('/api/season lists the 3 channels (period on, Mixed in)', s.j && s.j.theme === 'christmas' && s.j.channels.map(c => c.id).join() === 'mixed,christmas,classic' && s.j.channels[0].default === true, JSON.stringify(s.j));
const X = new Set(d1("SELECT value FROM feature_tracks WHERE feature_id=1 AND kind='track'").map(r => r.value));
ok('local DB has the 14 Christmas songs in period 1', X.size === 14, String(X.size));

// --- /api/now per channel (first call starts the channel)
let r = await get(ST, '/api/now');
ok('/api/now (no ch) unchanged shape', r.s === 200 && r.j.current && !('ch' in r.j));
const before = mainSnap();
const t0 = Date.now();
r = await get(ST, '/api/now?ch=christmas');
ok('/api/now?ch=christmas: starts the channel now, only Christmas songs, 2 h ahead', r.s === 200 && r.j.ch === 'christmas' && r.j.current && Math.abs(r.j.current.start_ms - t0) < 5000 && r.j.items.every(i => X.has(i.track.id)) && r.j.items.at(-1).end_ms - t0 > 2 * 3600e3 - 60e3,
  r.j.current && `${r.j.current.track.title} from ${fmt(r.j.current.start_ms)}`);
r = await get(ST, '/api/now?ch=classic');
ok('/api/now?ch=classic: no Christmas songs, 2 h ahead', r.s === 200 && r.j.ch === 'classic' && r.j.items.every(i => !X.has(i.track.id)) && r.j.items.at(-1).end_ms - Date.now() > 2 * 3600e3 - 60e3);
ok('channels did not touch the main timeline', mainSnap() === before);
// published files land in the local R2
const objs = execFileSync(REPO + '/node_modules/.bin/wrangler', ['r2', 'object', 'get', 'bcradio-media/state/now-christmas.json', '--local', '--persist-to', REPO + '/manager/.wrangler/state', '--pipe'], { cwd: REPO, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' }, encoding: 'utf8' });
const pub = JSON.parse(objs);
ok('state/now-christmas.json published to (local) R2 with ch', pub.ch === 'christmas' && pub.items.length > 10 && pub.generated_ms > t0 - 1000);
// a second listener joins the same timeline
const a1 = await get(ST, '/api/now?ch=christmas'), a2 = await get(ST, '/api/now?ch=christmas');
ok('two listeners on christmas: identical current song + start', a1.j.current.seq === a2.j.current.seq && a1.j.current.start_ms === a2.j.current.start_ms && a1.j.current.track.id === a2.j.current.track.id);

// --- library per channel
r = await get(ST, '/api/library?ch=christmas&_=' + Date.now());
ok('/api/library?ch=christmas: the 14 songs', r.j.ch === 'christmas' && r.j.songs.length === 14);
r = await get(ST, '/api/library?ch=classic&_=' + Date.now());
ok('/api/library?ch=classic: no Christmas songs', r.j.ch === 'classic' && r.j.songs.length > 300 && r.j.songs.every(x => !X.has(x.id)));

// --- requests need Turnstile: local pages dev has no TURNSTILE_SECRET -> refused before anything happens
r = await post(ST, '/api/request', { id: [...X][0], token: 'x', ch: 'christmas' });
ok('request without a real Turnstile token is refused (spam check comes first, also with ch)', r.s === 400, r.j && r.j.message);

// --- listen + listeners
const sid = () => 'loc' + Math.random().toString(36).slice(2).padEnd(16, 'q');
d1('DELETE FROM listen_sessions');
await post(ST, '/api/listen', { sid: sid(), platform: 'web', playing: true });
await post(ST, '/api/listen', { sid: sid(), platform: 'web', playing: true, ch: 'christmas' });
r = await post(ST, '/api/listen', { sid: sid(), platform: 'ios', playing: true, ch: 'classic' });
ok('/api/listen with ch: totals + channels', r.s === 200 && r.j.total === 3 && r.j.web === 2 && r.j.ios === 1 && JSON.stringify(r.j.channels) === '{"mixed":1,"christmas":1,"classic":1}', JSON.stringify(r.j));

// --- Control Room booth per channel
r = await cr('/booth');
ok('booth (no ch): main timeline, channels on with the list + listener counts', r.s === 200 && r.j.ch === 'mixed' && r.j.channels.on && r.j.channels.list.length === 3 && r.j.channels.listening.christmas === 1 && r.j.channels.songs.length === 14, JSON.stringify(r.j.channels && r.j.channels.listening));
r = await cr('/booth?ch=christmas');
ok('booth ?ch=christmas: the christmas channel timeline', r.s === 200 && r.j.ch === 'christmas' && r.j.current && X.has(r.j.current.track.id) && r.j.next.every(i => X.has(i.track.id)));
const mainBefore2 = mainSnap();
const xpick = [...X].find(id => !r.j.next.slice(0, 3).some(i => i.track.id === id) && r.j.current.track.id !== id);
let p = await cr('/booth/play', { id: xpick, mode: 'next', ch: 'christmas' });
ok('booth play next on christmas', p.s === 200 && p.j.ch === 'christmas', p.j.error || '');
r = await cr('/booth?ch=christmas');
ok('booth ?ch=christmas: the pick is next, marked as your pick', r.j.next[0].track.id === xpick && r.j.next[0].is_dj);
p = await cr('/booth/play', { id: d1('SELECT id FROM tracks WHERE enabled=1 ORDER BY id LIMIT 1')[0].id, mode: 'next', ch: 'christmas' });
ok('booth play a regular song on christmas: refused in plain words', p.s === 400 && /isn't on this channel/.test(p.j.error), p.j.error);
p = await cr('/booth/skip', { ch: 'classic' });
ok('booth skip on classic', p.s === 200 && p.j.ch === 'classic', p.j.error || p.j.message || '');
ok('booth actions on channels leave the main timeline alone', mainSnap() === mainBefore2);
const act = (await cr('/activity')).j.activity;
ok('History says which channel', act.some(a => a.action === 'play_next' && /on Christmas only/.test(a.summary)) && act.some(a => a.action === 'skip' && /on No Christmas/.test(a.summary)), act.slice(0, 2).map(a => a.summary).join(' | '));

// --- the switch: Off -> channels gone; On -> back
p = await cr('/christmas', { setting: 'off' });
ok('switch Off: saved + re-planned', p.s === 200 && p.j.to === 'off', p.j.error || '');
r = await cr('/booth');
ok('switch Off: booth says channels off', r.j.channels.on === false && r.j.ch === 'mixed');
const gone = JSON.parse(execFileSync(REPO + '/node_modules/.bin/wrangler', ['r2', 'object', 'get', 'bcradio-media/state/now-christmas.json', '--local', '--persist-to', REPO + '/manager/.wrangler/state', '--pipe'], { cwd: REPO, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' }, encoding: 'utf8' }));
ok('switch Off: state/now-christmas.json now says ch:"mixed" with no items (players move to the main timeline)', gone.ch === 'mixed' && gone.items.length === 0);
r = await get(ST, '/api/now?ch=christmas');
ok('switch Off: /api/now?ch=christmas answers the main timeline with ch:"mixed"', r.j.ch === 'mixed' && r.j.current);
p = await cr('/booth/skip', { ch: 'christmas' });
ok('switch Off: booth skip on a channel refused in plain words', p.s === 400 && /off right now/.test(p.j.error), p.j.error);
p = await cr('/christmas', { setting: 'only' });
r = await cr('/booth');
ok('switch "Christmas for everyone": no channels (one station, all Christmas)', p.s === 200 && r.j.channels.on === false);
p = await cr('/christmas', { setting: 'mixed' });
r = await cr('/booth?ch=christmas');
ok('switch On: channels back; christmas channel answers again', p.s === 200 && r.j.channels.on && r.j.ch === 'christmas' && r.j.current && X.has(r.j.current.track.id), p.j.error || '');
const la = (await cr('/activity')).j.activity[0];
ok('History: "Christmas switched from Christmas for everyone to On (listeners can pick a channel)"', /to On \(listeners can pick a channel\)/.test(la.summary), la.summary);

// next 2 h of each channel (local)
for (const ch of ['christmas', 'classic']) {
  const n = await get(ST, '/api/now?ch=' + ch);
  console.log(`  local ${ch} now: ${n.j.current.track.title} (${fmt(n.j.current.start_ms)}), next: ${n.j.next.slice(0, 3).map(i => fmt(i.start_ms) + ' ' + i.track.title).join(' | ')}`);
}
console.log(`pass=${pass} fail=${fail}`, fails.length ? 'FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fail ? 1 : 0);
