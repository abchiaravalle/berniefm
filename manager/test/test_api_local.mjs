// Control Room API checks against the LOCAL dev server (local D1/R2 only).
// usage: BASE=http://localhost:8813 node test/test_api_local.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeChecker } from './d1shim.mjs';

const BASE = process.env.BASE || 'http://localhost:8813';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) { console.error('LOCAL ONLY'); process.exit(2); }
const { check, fails } = makeChecker();
const H = { 'x-cr': '1' };
async function api(path, { method = 'GET', body, type, headers = {} } = {}) {
  const h = { ...H, ...headers };
  let b = body;
  if (body && !(body instanceof Uint8Array) && !(body instanceof Buffer)) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
  if (type) h['content-type'] = type;
  const r = await fetch(BASE + '/api' + path, { method, headers: h, body: b });
  let j = {}; try { j = await r.json(); } catch { /* empty */ }
  return { s: r.status, j };
}
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const OUT = '/tmp/crtest/api'; fs.mkdirSync(OUT, { recursive: true });
function ff(args) { execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]); }

// --- basics
let r = await api('/me');
check('me: signed in as the local tester', r.s === 200 && r.j.email === 'tester@local.test', r.j.email);
r = await api('/songs');
const songs = r.j.songs;
const d1n = JSON.parse(execFileSync('../node_modules/.bin/wrangler', ['d1', 'execute', 'bcradio', '--local', '--json', '--command', 'SELECT COUNT(*) n FROM tracks'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' } }).toString())[0].results[0].n;
check(`songs: every local track listed (${d1n} in local D1)`, songs.length === d1n && d1n >= 337, String(songs.length));
const s0 = songs.find((s) => s.enabled && s.album === 'Dreamer');
check('songs: fields (cover, title, album, section, duration, plays, last played, flags)', s0 && s0.art && s0.title && s0.album && s0.section && s0.dur_ms > 0 && 'plays' in s0 && 'last_played_ms' in s0 && s0.requestable === true);

// --- CSRF
let x = await fetch(BASE + '/api/songs/' + s0.id, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"year":"1999"}' });
check('write from another origin is refused', x.status === 403, String(x.status));
x = await fetch(BASE + '/api/songs/' + s0.id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"year":"1999"}' });
check('write without origin or x-cr header is refused', x.status === 403, String(x.status));

// --- edit + undo
r = await api('/songs/' + s0.id, { method: 'PATCH', body: { title: s0.title + ' (edit test)', year: '1999' } });
check('edit: title + year saved', r.s === 200 && r.j.song.title === s0.title + ' (edit test)' && r.j.song.year === '1999', JSON.stringify(r.j.changed));
r = await api('/songs/' + s0.id, { method: 'PATCH', body: { year: 'abcd' } });
check('edit: bad year refused with a plain message', r.s === 400 && /Year/.test(r.j.error), r.j.error);
let act = (await api('/activity')).j.activity;
const editAct = act.find((a) => a.target === s0.id && a.action === 'edit');
check('activity: edit logged with who + undo', editAct && editAct.who === 'tester@local.test' && editAct.undoable === 1, editAct && editAct.summary);
r = await api('/activity/' + editAct.id + '/undo', { method: 'POST' });
const back = (await api('/songs')).j.songs.find((s) => s.id === s0.id);
check('undo: title + year back to before', r.s === 200 && back.title === s0.title && back.year === s0.year, back.title + ' ' + back.year);
r = await api('/activity/' + editAct.id + '/undo', { method: 'POST' });
check('undo twice is refused', r.s === 400 || r.s === 409, String(r.s));

// --- switch off a song that is coming up -> re-plan; booth no longer has it after the lock
let b = (await api('/booth')).j;
const upcoming = b.next.filter((i) => i.start_ms > Date.now() + 120000 && !i.is_dj && !i.is_request);
const victim = upcoming[upcoming.length - 1];
r = await api('/songs/' + victim.track.id, { method: 'PATCH', body: { enabled: false } });
check('switching off a song that is coming up re-plans', r.s === 200 && r.j.replanned === true, victim.track.title);
b = (await api('/booth')).j;
check('it is gone from "coming up" (after the 90 s lock)', !b.next.some((i) => i.track.id === victim.track.id && i.start_ms > Date.now() + 95000));
act = (await api('/activity')).j.activity;
r = await api('/activity/' + act.find((a) => a.target === victim.track.id).id + '/undo', { method: 'POST' });
check('undo switch-off: back on', r.s === 200 && (await api('/songs')).j.songs.find((s) => s.id === victim.track.id).enabled === true);

// --- bulk
const two = songs.filter((s) => s.enabled).slice(10, 12).map((s) => s.id);
r = await api('/songs/bulk', { method: 'POST', body: { action: 'requests_off', ids: two } });
check('bulk: requests off for 2', r.s === 200 && r.j.changed === 2);
act = (await api('/activity')).j.activity;
r = await api('/activity/' + act[0].id + '/undo', { method: 'POST' });
const after2 = (await api('/songs')).j.songs.filter((s) => two.includes(s.id));
check('bulk undo restores both', after2.every((s) => s.requestable));

// --- upload through the API with an MP3 made by desktop ffmpeg (browser conversion is tested in Chrome)
ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=12:sample_rate=44100', '-af', 'volume=-12dB', '-ac', '2', `${OUT}/t.wav`]);
ff(['-i', `${OUT}/t.wav`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '1', `${OUT}/good.mp3`]);
ff(['-i', `${OUT}/t.wav`, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2', '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', `${OUT}/vbr.mp3`]);
async function uploadFile(path, dur_ms, meta = {}) {
  const buf = fs.readFileSync(path);
  const u = await api('/uploads', { method: 'POST', body: { size: buf.length, sha1: sha1(buf) } });
  if (u.s !== 201) return u;
  const parts = [];
  for (let i = 0, n = 1; i < buf.length; i += u.j.part_size, n++) {
    const p = await api(`/uploads/${u.j.upload}/parts/${n}`, { method: 'PUT', body: buf.subarray(i, i + u.j.part_size), type: 'application/octet-stream' });
    parts.push(p.j);
  }
  return api(`/uploads/${u.j.upload}/complete`, { method: 'POST', body: { parts, dur_ms, meta: { title: 'API test tone', album: '', ...meta, filename: 'tone.wav' } } });
}
const goodDur = Math.round(Number(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${OUT}/good.mp3`]).toString()) * 1000);
r = await uploadFile(`${OUT}/vbr.mp3`, goodDur);
check('upload: a VBR file is refused', r.s === 400 && /not in the station format/.test(r.j.error), r.j.error);
r = await uploadFile(`${OUT}/good.mp3`, goodDur + 40);
check('upload: wrong measured length is refused', r.s === 400 && /Length/.test(r.j.error), r.j.error);
r = await uploadFile(`${OUT}/good.mp3`, goodDur);
check('upload: station-format file accepted, starts switched off', r.s === 201 && r.j.song.enabled === false && r.j.song.dur_ms === goodDur && r.j.song.uploaded, `${r.s} ${r.j.error || r.j.song.dur_ms}`);
const up = r.j.song;
const fileBack = Buffer.from(await (await fetch(up.url)).arrayBuffer());
check('upload: stored file is byte-identical', sha1(fileBack) === sha1(fs.readFileSync(`${OUT}/good.mp3`)), up.url);
r = await api('/booth/play', { method: 'POST', body: { id: up.id, mode: 'now' } });
check('play now refuses a switched-off (unpublished) song', r.s === 400, r.j.error);
r = await api('/songs/' + up.id + '/publish', { method: 'POST' });
check('publish: switched on, given a shuffled rotation spot', r.s === 200 && r.j.song.enabled && r.j.song.last_played_ms > 0 && r.j.song.last_played_ms < Date.now());
act = (await api('/activity')).j.activity;
r = await api('/activity/' + act.find((a) => a.action === 'publish' && a.target === up.id).id + '/undo', { method: 'POST' });
check('undo publish: off again', (await api('/songs')).j.songs.find((s) => s.id === up.id).enabled === false);
r = await api('/songs/' + up.id, { method: 'DELETE' });
check('remove a never-aired upload', r.s === 200);
r = await api('/songs/' + s0.id, { method: 'DELETE' });
check('removing a library song is refused', r.s === 400, r.j.error);

// --- featured periods
const now = Date.now();
const fmt = (ms, tz = 'America/Los_Angeles') => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; }); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
r = await api('/features', { method: 'POST', body: { name: 'Future test', mode: 'more', weight: 3, start_local: fmt(now + 30 * 864e5), end_local: fmt(now + 31 * 864e5), tz: 'America/Los_Angeles', items: [{ kind: 'album', value: 'Dreamer' }] } });
check('feature in the future: saved, no re-plan', r.s === 201 && r.j.replanned === false && r.j.feature.song_count === 13 && !r.j.feature.on_now, `${r.s} ${r.j.error || ''}`);
const futureId = r.j.feature.id;
r = await api('/features', { method: 'POST', body: { name: 'bad', mode: 'more', weight: 3, start_local: fmt(now + 864e5), end_local: fmt(now), items: [{ kind: 'album', value: 'Dreamer' }] } });
check('feature: end before start refused in plain words', r.s === 400 && /after the start/.test(r.j.error), r.j.error);
r = await api('/features', { method: 'POST', body: { name: 'Xmas now', mode: 'unlock', weight: 3, start_local: fmt(now - 3600e3), end_local: fmt(now + 864e5), tz: 'America/Los_Angeles', yearly: false, items: [{ kind: 'album', value: 'Christmas' }] } });
check('unlock feature active now: saved and re-planned', r.s === 201 && r.j.replanned === true && r.j.feature.on_now && r.j.feature.off_count === 4, `${r.s} ${r.j.error || JSON.stringify(r.j.feature && { on: r.j.feature.on_now, off: r.j.feature.off_count })}`);
const xmasId = r.j.feature.id;
b = (await api('/booth')).j;
const xmasUp = b.next.filter((i) => i.track.id.startsWith('c0ffee'));
check('booth: Christmas stand-ins now in "coming up"', xmasUp.length >= 1, `${xmasUp.length} of next ${b.next.length}`);
check('booth: shows the active featured time', b.features_now.some((f) => f.name === 'Xmas now'));
const xid = (await api('/songs')).j.songs.find((s) => s.id.startsWith('c0ffee')).id;
r = await api('/booth/play', { method: 'POST', body: { id: xid, mode: 'next' } });
check('play next works for a switched-off song while its featured time unlocks it', r.s === 200 && r.j.at > Date.now(), r.j.error || '');
r = await api('/features/' + xmasId, { method: 'DELETE' });
check('delete the active feature: re-planned', r.s === 200 && r.j.replanned === true);
b = (await api('/booth')).j;
const xLeft = b.next.filter((i) => i.track.id.startsWith('c0ffee') && !i.is_dj && i.start_ms > Date.now() + 95000);
check('after delete: no Christmas songs left in rotation slots after the lock', xLeft.length === 0, String(xLeft.length));
check('after delete: the DJ pick stays', b.next.some((i) => i.is_dj && i.track.id === xid) || (b.current && b.current.track.id === xid));
act = (await api('/activity')).j.activity;
r = await api('/activity/' + act.find((a) => a.action === 'feature_delete').id + '/undo', { method: 'POST' });
const fl = (await api('/features')).j.features;
check('undo delete: feature back and on now', r.s === 200 && fl.some((f) => f.id === xmasId && f.on_now) && r.j.replanned === true);
r = await api('/features/' + xmasId + '/pause', { method: 'POST' });
check('pause: re-planned', r.s === 200 && r.j.replanned);
r = await api('/features/' + futureId, { method: 'PUT', body: { name: 'Future test 2', mode: 'only', weight: 1, start_local: fmt(now + 40 * 864e5), end_local: fmt(now + 41 * 864e5), tz: 'America/New_York', yearly: true, items: [{ kind: 'section', value: 'Singles' }] } });
check('edit future feature (yearly, other time zone)', r.s === 200 && r.j.feature.yearly && r.j.feature.tz === 'America/New_York' && r.j.feature.mode === 'only' && r.j.replanned === false, r.j.error || '');
for (const id of [futureId, xmasId]) await api('/features/' + id, { method: 'DELETE' });

// --- booth: play now + skip
b = (await api('/booth')).j;
const pick = songs.find((s) => s.enabled && !b.next.some((i) => i.track.id === s.id) && s.id !== b.current.track.id);
const t0 = Date.now();
r = await api('/booth/play', { method: 'POST', body: { id: pick.id, mode: 'now' } });
check('play now: starts in ~10 s', r.s === 200 && r.j.at - t0 >= 9000 && r.j.at - t0 <= 12000, String(r.j.at - t0));
b = (await api('/booth')).j;
check('play now: it is next, marked as your pick', b.next[0].track.id === pick.id && b.next[0].is_dj);
const curEnd = b.current.end_ms;
r = await api('/booth/skip', { method: 'POST' });
check('skip: refused politely or done', r.s === 200, r.j.message || '');
act = (await api('/activity')).j.activity;
check('activity: play now + skip logged (no undo)', act.some((a) => a.action === 'play_now' && !a.undoable) && act.some((a) => a.action === 'skip' && !a.undoable));

// --- timeline sanity after all that (local D1)
const rows = JSON.parse(execFileSync('../node_modules/.bin/wrangler', ['d1', 'execute', 'bcradio', '--local', '--json', '--command', `SELECT seq, start_ms, dur_ms FROM schedule WHERE start_ms + dur_ms > ${Date.now() - 600000} ORDER BY seq`], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' } }).toString())[0].results;
let gaps = 0;
for (let i = 1; i < rows.length; i++) if (rows[i].start_ms !== rows[i - 1].start_ms + rows[i - 1].dur_ms || rows[i].seq !== rows[i - 1].seq + 1) gaps++;
const reach = rows.length ? rows.at(-1).start_ms + rows.at(-1).dur_ms - Date.now() : 0;
check(`local timeline: no gaps/overlaps (${rows.length} slots) and >= 2 h ahead (${(reach / 3600e3).toFixed(2)} h)`, gaps === 0 && reach >= 2 * 3600e3 - 60000, 'gaps=' + gaps);

console.log(fails.length ? 'SOME FAILED: ' + fails.join(' | ') : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
