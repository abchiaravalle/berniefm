// BC Radio Control Room: private manager for bcradio.net (Adam + Bernie).
// The whole hostname is behind a Cloudflare Access app; this Worker ALSO verifies the Access
// JWT on every request (RS256 signature, exp, nbf, aud, iss) and answers nothing to anyone
// else. It shares the station's D1 (`bcradio`) and R2 (`bcradio-media`) and drives the SAME
// scheduler as the website (../../functions/_lib.js), so there is one engine.
//
//   /                 manager UI (bundled in this Worker)
//   /api/...          JSON API (see adminApi)
//   /assets/...       logo, font, self-hosted ffmpeg.wasm (served through this Worker)
import { readToken, verifiedEmail } from './auth.js';
import { parseMp3 } from './mp3.js';
import { APP_NAME, APP_TAGLINE, DEFAULT_TZ, SECTIONS, FF_VERSION, PART_SIZE, MAX_SONG_BYTES } from './config.js';
import {
  ensureSchedule, buildState, publishState, djPlace, replanFuture, featureWindows, zonedToUtc,
  HORIZON_MS, DJ_LEAD_MS, REPLAN_LOCK_MS,
} from '../../functions/_lib.js';
import INDEX_HTML from './ui/index.html';
import APP_JS from './ui/app.js.txt';
import APP_CSS from './ui/app.css.txt';
import CONVERT_JS from './ui/convert.js.txt';
import MP3_JS from './ui/mp3.js.txt';   // same source as ./mp3.js (scripts/check_mp3_copy.sh keeps them identical)

const NOINDEX = { 'x-robots-tag': 'noindex, nofollow' };
const SEC = { ...NOINDEX, 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff' };

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC, ...extra } });
}
const err = (status, message) => json({ error: message }, status);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };

// ---------- auth ----------
async function whoIs(request, env) {
  // LOCAL TESTS ONLY: `wrangler dev --var DEV_AUTH_EMAIL:... --var CANONICAL_HOST:localhost`.
  // Never set in production, and production requests can't carry a localhost hostname because
  // everything is refused unless the hostname is CANONICAL_HOST.
  const host = new URL(request.url).hostname;
  if (env.DEV_AUTH_EMAIL && (host === 'localhost' || host === '127.0.0.1') && env.CANONICAL_HOST === host) return String(env.DEV_AUTH_EMAIL);
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) throw new Error('not configured');
  // A service token (automated live check) carries common_name instead of email; accepted only
  // while TEST_SERVICE_CLIENT_ID exists (a temporary secret set and deleted by the check script).
  return verifiedEmail(readToken(request), { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, serviceId: env.TEST_SERVICE_CLIENT_ID });
}

// ---------- helpers ----------
async function body(request, max = 65536) {
  const t = await request.text();
  if (t.length > max) throw new HttpError(413, 'Too large');
  if (!t) return {};
  try { return JSON.parse(t); } catch { bad('Bad request'); }
}
const mediaBase = (env) => env.MEDIA_BASE || 'https://media.bcradio.net/';
const str = (v, max) => (v == null ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const ID_RE = /^[0-9a-z]{6,32}$/;   // library ids are hex, a few start with x (same rule as /api/dj)
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const TZ_LABEL = { 'America/Los_Angeles': 'Pacific time', 'America/Denver': 'Mountain time', 'America/Phoenix': 'Arizona time', 'America/Chicago': 'Central time', 'America/New_York': 'Eastern time', 'Pacific/Honolulu': 'Hawaii time', 'Europe/London': 'UK time', UTC: 'UTC' };
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
function fmtWhen(ms, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
}

function songOut(r, env) {
  const M = mediaBase(env);
  return {
    id: r.id,
    title: r.cat_title || r.title,
    raw_title: r.title,
    album: r.cat_album || r.album || '',
    artist: r.cat_artist || r.artist || 'Bernie Chiaravalle',
    year: r.cat_year || '',
    section: r.cat_section || '',
    no: r.cat_no ?? null,
    art_key: r.art || null,
    art: r.art ? M + r.art : M + 'art/default.jpg',
    art_hd: r.art && r.art.startsWith('art/') ? M + 'art/hd/' + r.art.slice(4) : null,
    url: M + r.file,
    dur_ms: r.dur_ms,
    plays: r.plays,
    last_played_ms: r.last_played_ms,
    enabled: !!r.enabled,
    requestable: !!r.requestable,
    uploaded: String(r.source || '').startsWith('controlroom:'),
    added: r.n,
  };
}
const SONG_COLS = 'rowid AS n, id, title, artist, album, art, file, dur_ms, bytes, source, enabled, requestable, last_played_ms, plays, grp, cat_section, cat_album, cat_no, cat_title, cat_artist, cat_year';
async function getSong(env, id) { return env.DB.prepare(`SELECT ${SONG_COLS} FROM tracks WHERE id=?1`).bind(id).first(); }

async function logActivity(env, who, action, target, summary, undo = null) {
  await env.DB.prepare('INSERT INTO cr_activity(at_ms, who, action, target, summary, undo) VALUES (?1,?2,?3,?4,?5,?6)')
    .bind(Date.now(), who, action, target, summary, undo ? JSON.stringify(undo) : null).run();
}

// Is the song on the published timeline (so a title/cover edit should refresh the website)?
async function onTimeline(env, ids, now) {
  if (!ids.length) return false;
  const r = await env.DB.prepare(`SELECT 1 FROM schedule WHERE start_ms + dur_ms > ?1 AND track_id IN (${ids.map((_, i) => '?' + (i + 2)).join(',')}) LIMIT 1`).bind(now - 3600e3, ...ids).first();
  return !!r;
}
// Is any of these songs planned to start after the lock (so switching it off should re-plan)?
async function comingUp(env, ids, now) {
  if (!ids.length) return false;
  const r = await env.DB.prepare(`SELECT 1 FROM schedule WHERE start_ms >= ?1 AND track_id IN (${ids.map((_, i) => '?' + (i + 2)).join(',')}) LIMIT 1`).bind(now + REPLAN_LOCK_MS, ...ids).first();
  return !!r;
}

// Song fields a person can edit, mapped to columns. Display (cat_*) is what the website shows.
const EDIT = {
  title: (v) => ['cat_title', str(v, 160) || bad('A title is required')],
  album: (v) => ['cat_album', str(v, 160)],
  artist: (v) => ['cat_artist', str(v, 120)],
  year: (v) => { const s = str(v, 4); if (s && !/^\d{4}$/.test(s)) bad('Year should look like 2024'); return ['cat_year', s || null]; },
  section: (v) => { const s = str(v, 40); if (s && !SECTIONS.includes(s)) bad('Unknown section'); return ['cat_section', s || null]; },
  no: (v) => { if (v === '' || v == null) return ['cat_no', null]; const n = Number(v); if (!(n >= 0 && n < 1000)) bad('Track number should be a number'); return ['cat_no', n]; },
  enabled: (v) => ['enabled', v ? 1 : 0],
  requestable: (v) => ['requestable', v ? 1 : 0],
  art: (v) => { const s = str(v, 80); if (s && !/^art\/[0-9a-f]{16}\.jpg$/.test(s)) bad('Bad cover'); return ['art', s || null]; },
};
const COL_NAME = { cat_title: 'title', cat_album: 'album', cat_artist: 'artist', cat_year: 'year', cat_section: 'section', cat_no: 'track number', enabled: 'on air', requestable: 'requests', art: 'cover', title: 'title', album: 'album', artist: 'artist', grp: 'album group', last_played_ms: 'rotation', plays: 'plays' };

// Apply {id: {col: val}} and return the previous values (for undo).
async function applySongCols(env, changes) {
  const before = {};
  const stmts = [];
  for (const [id, cols] of Object.entries(changes)) {
    const row = await getSong(env, id);
    if (!row) continue;
    const prev = {}, set = {};
    for (const [c, v] of Object.entries(cols)) {
      if (!(c in row)) continue;
      if ((row[c] ?? null) === (v ?? null)) continue;
      prev[c] = row[c] ?? null; set[c] = v;
    }
    if (!Object.keys(set).length) continue;
    before[id] = prev;
    stmts.push(env.DB.prepare(`UPDATE tracks SET ${Object.keys(set).map((c, i) => `${c}=?${i + 2}`).join(', ')} WHERE id=?1`).bind(id, ...Object.values(set)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return before;
}
// Re-plan when switching off songs that are coming up; refresh the website for title/cover edits.
async function afterSongChange(env, before, now) {
  const ids = Object.keys(before);
  const offIds = ids.filter((id) => before[id].enabled === 1);
  let replanned = false;
  if (offIds.length && await comingUp(env, offIds, now)) {
    const still = await env.DB.prepare(`SELECT id FROM tracks WHERE enabled=0 AND id IN (${offIds.map((_, i) => '?' + (i + 1)).join(',')})`).bind(...offIds).all();
    if (still.results.length) { await replanFuture(env, now); replanned = true; }
  }
  const visual = ids.filter((id) => ['cat_title', 'cat_album', 'cat_artist', 'art', 'title', 'artist', 'album'].some((c) => c in before[id]));
  if (!replanned && visual.length && await onTimeline(env, visual, now)) await publishState(env, now);
  return { replanned };
}

// ---------- featured periods ----------
const MODES = { more: 'more often', only: 'only these', unlock: 'unlock' };
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
function localToUtc(s, tz) {
  const m = LOCAL_RE.exec(s || '');
  if (!m) bad('Pick a date and time');
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) bad('Pick a real date and time');
  return zonedToUtc(y, mo, d, h, mi, tz);
}
async function featureItemsAll(env) {
  const { results } = await env.DB.prepare('SELECT feature_id, kind, value FROM feature_tracks').all();
  const by = new Map();
  for (const r of results) { if (!by.has(r.feature_id)) by.set(r.feature_id, []); by.get(r.feature_id).push({ kind: r.kind, value: r.value }); }
  return by;
}
// Song ids a set of items resolves to (same matching as the scheduler).
async function resolveItems(env, items) {
  if (!items.length) return [];
  const where = [], args = [];
  for (const it of items) {
    args.push(it.value);
    const p = '?' + args.length;
    if (it.kind === 'track') where.push(`id=${p}`);
    else if (it.kind === 'album') where.push(`COALESCE(NULLIF(cat_album,''), album)=${p}`);
    else if (it.kind === 'section') where.push(`cat_section=${p}`);
  }
  const { results } = await env.DB.prepare(`SELECT id, enabled FROM tracks WHERE ${where.join(' OR ')}`).bind(...args).all();
  return results;
}
function featureOut(f, items, songs, now) {
  const from = now - 400 * 864e5, to = now + 400 * 864e5;
  let wins = [];
  try { wins = featureWindows(f, from, to); } catch { wins = []; }
  const onNow = !!f.active && wins.some(([a, b]) => a <= now && now < b);
  const upcoming = wins.filter(([, b]) => b > now).slice(0, 3);
  const last = wins.filter(([, b]) => b <= now).slice(-1)[0] || null;
  return {
    id: f.id, name: f.name, mode: f.mode, weight: f.weight, start_local: f.start_local, end_local: f.end_local, tz: f.tz,
    tz_label: TZ_LABEL[f.tz] || f.tz, yearly: !!f.yearly, active: !!f.active, note: f.note, items,
    song_count: songs.length, off_count: songs.filter((s) => !s.enabled).length, song_ids: songs.map((s) => s.id),
    on_now: onNow, windows: upcoming, last_window: last, finished: !f.yearly && f.end_ms <= now,
    updated_ms: f.updated_ms, updated_by: f.updated_by, created_by: f.created_by,
  };
}
function cleanFeature(b) {
  const name = str(b.name, 80) || bad('Give it a name, like "Christmas"');
  const mode = MODES[b.mode] ? b.mode : bad('Choose what should happen');
  const weight = mode === 'only' ? 1 : Number(b.weight);
  if (!(weight >= 1 && weight <= 10)) bad('Choose how much more often');
  const tz = str(b.tz, 64) || DEFAULT_TZ;
  if (!validTz(tz)) bad('Unknown time zone');
  const start_local = str(b.start_local, 16), end_local = str(b.end_local, 16);
  const start_ms = localToUtc(start_local, tz), end_ms = localToUtc(end_local, tz);
  if (end_ms <= start_ms) bad('The end has to be after the start');
  const yearly = b.yearly ? 1 : 0;
  if (yearly && (end_ms - start_ms > 366 * 864e5 || +end_local.slice(0, 4) - +start_local.slice(0, 4) > 1)) bad('A yearly period can be at most a year long');
  if (end_ms - start_ms > 3 * 366 * 864e5) bad('That is longer than 3 years');
  const items = [];
  const seen = new Set();
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const kind = ['track', 'album', 'section'].includes(it && it.kind) ? it.kind : null;
    const value = str(it && it.value, 160);
    if (!kind || !value) continue;
    if (kind === 'track' && !ID_RE.test(value)) continue;
    if (kind === 'section' && !SECTIONS.includes(value)) continue;
    const k = kind + '|' + value;
    if (!seen.has(k)) { seen.add(k); items.push({ kind, value }); }
  }
  if (!items.length) bad('Pick at least one song, album or section');
  if (items.length > 600) bad('Too many picks');
  return { name, mode, weight, tz, start_local, end_local, start_ms, end_ms, yearly, note: str(b.note, 400), items };
}
// Does this rule (in either its old or new form) touch the part of the schedule that is planned?
function touchesPlan(rows, now) {
  const to = now + HORIZON_MS + 30 * 60e3;
  for (const f of rows) {
    if (!f || !f.active) continue;
    try { if (featureWindows(f, now, to).length) return true; } catch { /* ignore */ }
  }
  return false;
}
async function getFeature(env, id) { return env.DB.prepare('SELECT * FROM features WHERE id=?1 AND deleted_ms IS NULL').bind(id).first(); }
async function getFeatureAny(env, id) { return env.DB.prepare('SELECT * FROM features WHERE id=?1').bind(id).first(); }
async function itemsOf(env, id) {
  const { results } = await env.DB.prepare('SELECT kind, value FROM feature_tracks WHERE feature_id=?1 ORDER BY kind, value').bind(id).all();
  return results;
}
const F_COLS = ['name', 'mode', 'weight', 'start_ms', 'end_ms', 'start_local', 'end_local', 'tz', 'yearly', 'active', 'note', 'deleted_ms'];
async function writeFeature(env, id, row, items, who) {
  const now = Date.now();
  const stmts = [
    env.DB.prepare(`UPDATE features SET ${F_COLS.map((c, i) => `${c}=?${i + 2}`).join(', ')}, updated_ms=?${F_COLS.length + 2}, updated_by=?${F_COLS.length + 3} WHERE id=?1`)
      .bind(id, ...F_COLS.map((c) => row[c] ?? null), now, who),
    env.DB.prepare('DELETE FROM feature_tracks WHERE feature_id=?1').bind(id),
    ...items.map((it) => env.DB.prepare('INSERT OR IGNORE INTO feature_tracks(feature_id, kind, value) VALUES (?1,?2,?3)').bind(id, it.kind, it.value)),
  ];
  await env.DB.batch(stmts);
}
function describeFeature(f) {
  const what = f.mode === 'only' ? 'only these songs' : f.mode === 'unlock' ? `switched-off songs allowed${f.weight > 1 ? `, ${f.weight}x as often` : ''}` : `${f.weight}x as often`;
  return `"${f.name}" (${f.start_local.replace('T', ' ')} to ${f.end_local.replace('T', ' ')} ${TZ_LABEL[f.tz] || f.tz}${f.yearly ? ', every year' : ''}; ${what})`;
}

// ---------- undo ----------
async function applyUndo(env, u, who) {
  const now = Date.now();
  if (u.type === 'songs') {
    const before = await applySongCols(env, u.before);
    const r = await afterSongChange(env, before, now);
    return { redo: { type: 'songs', before }, replanned: r.replanned };
  }
  if (u.type === 'song_delete') {
    // put a deleted upload back
    const row = u.row;
    const cols = Object.keys(row).filter((c) => c !== 'n');
    const exists = await getSong(env, row.id);
    if (exists) bad('That song is already back');
    await env.DB.prepare(`INSERT INTO tracks(${cols.join(',')}) VALUES (${cols.map((_, i) => '?' + (i + 1)).join(',')})`).bind(...cols.map((c) => row[c])).run();
    return { redo: null };
  }
  if (u.type === 'feature') {
    const cur = await getFeatureAny(env, u.id);
    if (!cur) bad('That featured period no longer exists');
    const curItems = await itemsOf(env, u.id);
    const target = u.before ? { ...u.before } : { ...cur, active: 0, deleted_ms: now };
    await writeFeature(env, u.id, target, u.before ? u.items : curItems, who);
    let replanned = false;
    if (touchesPlan([cur, target], now)) { await replanFuture(env, now); replanned = true; }
    return { redo: { type: 'feature', id: u.id, before: cur, items: curItems }, replanned };
  }
  bad("That change can't be undone");
}

// ---------- API ----------
async function api(request, env, url, who, ctx) {
  const p = url.pathname.replace(/^\/api/, '');
  const m = request.method;
  const now = Date.now();

  if (m !== 'GET' && m !== 'HEAD') {
    // CSRF guard: writes only from this site's own pages (or a non-browser client sending x-cr).
    const origin = request.headers.get('origin');
    if (origin && origin !== `${url.protocol}//${url.host}`) return err(403, 'Wrong origin');
    if (!origin && request.headers.get('x-cr') !== '1') return err(403, 'Missing origin');
  }

  if (p === '/me' && m === 'GET') {
    return json({ email: who, app: APP_NAME, tagline: APP_TAGLINE, sections: SECTIONS, tz: DEFAULT_TZ, tz_labels: TZ_LABEL, ff: FF_VERSION, part_size: PART_SIZE, max_bytes: MAX_SONG_BYTES, lead_ms: DJ_LEAD_MS, now, media: mediaBase(env) });
  }

  // ----- library -----
  if (p === '/songs' && m === 'GET') {
    const { results } = await env.DB.prepare(`SELECT ${SONG_COLS} FROM tracks ORDER BY COALESCE(cat_title, title) COLLATE NOCASE`).all();
    return json({ now, songs: results.map((r) => songOut(r, env)) });
  }
  const one = /^\/songs\/([0-9a-z]{6,32})$/.exec(p);
  if (one && m === 'PATCH') {
    const row = await getSong(env, one[1]);
    if (!row) return err(404, 'Song not found');
    const b = await body(request);
    const cols = {};
    for (const [k, fn] of Object.entries(EDIT)) if (k in b) { const [c, v] = fn(b[k]); cols[c] = v; }
    // songs added here keep the raw columns in step (rotation spreads albums by `grp`)
    if (String(row.source || '').startsWith('controlroom:')) {
      if ('cat_title' in cols) cols.title = cols.cat_title;
      if ('cat_artist' in cols) cols.artist = cols.cat_artist || '';
      if ('cat_album' in cols) { cols.album = cols.cat_album === 'Singles' ? '' : (cols.cat_album || ''); cols.grp = (cols.album || '').toLowerCase() || 'single'; }
    }
    const before = await applySongCols(env, { [row.id]: cols });
    let replanned = false;
    if (before[row.id]) {
      const names = [...new Set(Object.keys(before[row.id]).map((c) => COL_NAME[c] || c))];
      const after = await getSong(env, row.id);
      const t = after.cat_title || after.title;
      let summary = `Edited "${t}": ${names.join(', ')}`;
      if (names.length === 1 && names[0] === 'on air') summary = `${after.enabled ? 'Switched on' : 'Switched off'} "${t}"`;
      if (names.length === 1 && names[0] === 'requests') summary = `${after.requestable ? 'Allowed requests for' : 'Stopped requests for'} "${t}"`;
      if (names.length === 1 && names[0] === 'cover') summary = `Changed the cover of "${t}"`;
      ({ replanned } = await afterSongChange(env, before, now));
      await logActivity(env, who, 'edit', row.id, summary + (replanned ? ' (the songs coming up were re-planned)' : ''), { type: 'songs', before });
    }
    return json({ song: songOut(await getSong(env, row.id), env), changed: before[row.id] ? Object.keys(before[row.id]) : [], replanned });
  }
  if (one && m === 'DELETE') {
    const row = await getSong(env, one[1]);
    if (!row) return err(404, 'Song not found');
    const used = await env.DB.prepare('SELECT 1 FROM schedule WHERE track_id=?1 LIMIT 1').bind(row.id).first();
    if (!String(row.source || '').startsWith('controlroom:') || row.enabled || row.plays || used) return err(400, 'Only songs added here that were never on the air can be removed. Switch it off instead.');
    const pend = await env.DB.prepare('SELECT 1 FROM requests WHERE track_id=?1 LIMIT 1').bind(row.id).first();
    if (pend) return err(400, 'A listener requested this song; switch it off instead.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM tracks WHERE id=?1').bind(row.id),
      env.DB.prepare("DELETE FROM feature_tracks WHERE kind='track' AND value=?1").bind(row.id),
    ]);
    const { n, ...snap } = row;
    await logActivity(env, who, 'remove', row.id, `Removed the upload "${row.cat_title || row.title}" (the file stays in storage)`, { type: 'song_delete', row: snap });
    return json({ ok: true });
  }
  const pub = /^\/songs\/([0-9a-z]{6,32})\/publish$/.exec(p);
  if (pub && m === 'POST') {
    const row = await getSong(env, pub[1]);
    if (!row) return err(404, 'Song not found');
    if (row.enabled) return json({ song: songOut(row, env), changed: [] });
    const cols = { enabled: 1 };
    // New songs enter rotation shuffled, like publish.py does for the library tooling.
    if (!row.last_played_ms && !row.plays) cols.last_played_ms = now - Math.floor(Math.random() * 7 * 864e5);
    const before = await applySongCols(env, { [row.id]: cols });
    await logActivity(env, who, 'publish', row.id, `Published "${row.cat_title || row.title}" (it joins the rotation)`, { type: 'songs', before });
    return json({ song: songOut(await getSong(env, row.id), env), changed: ['enabled'] });
  }
  if (p === '/songs/bulk' && m === 'POST') {
    const b = await body(request);
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).filter((x) => ID_RE.test(String(x))))].slice(0, 1000);
    const ops = { enable: ['enabled', 1, 'Switched on'], disable: ['enabled', 0, 'Switched off'], requests_on: ['requestable', 1, 'Allowed requests for'], requests_off: ['requestable', 0, 'Stopped requests for'] };
    const op = ops[b.action];
    if (!op) return err(400, 'Unknown action');
    if (!ids.length) return err(400, 'Nothing selected');
    const changes = {};
    for (const id of ids) changes[id] = { [op[0]]: op[1] };
    if (op[0] === 'enabled' && op[1] === 1) {
      // switching on a never-played upload = publishing it
      const { results } = await env.DB.prepare(`SELECT id FROM tracks WHERE last_played_ms=0 AND plays=0 AND id IN (${ids.map((_, i) => '?' + (i + 1)).join(',')})`).bind(...ids).all();
      for (const r of results) changes[r.id].last_played_ms = now - Math.floor(Math.random() * 7 * 864e5);
    }
    const before = await applySongCols(env, changes);
    const n = Object.keys(before).length;
    let replanned = false;
    if (n) {
      ({ replanned } = await afterSongChange(env, before, now));
      await logActivity(env, who, 'bulk', null, `${op[2]} ${n} song${n === 1 ? '' : 's'}${replanned ? ' (the songs coming up were re-planned)' : ''}`, { type: 'songs', before });
    }
    return json({ ok: true, changed: n, replanned });
  }

  // ----- cover art: art/<name>.jpg (regular) + art/hd/<name>.jpg (big, for the iPhone app) -----
  if (p === '/art' && m === 'POST') {
    const name = url.searchParams.get('name') || '';
    const v = url.searchParams.get('v') === 'hd' ? 'hd' : 'main';
    if (!/^[0-9a-f]{16}$/.test(name)) return err(400, 'Bad cover name');
    if ((request.headers.get('content-type') || '').split(';')[0].trim() !== 'image/jpeg') return err(415, 'Covers are sent as JPEG');
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 12 * 1024 * 1024) return err(413, 'Cover is over 12 MB');
    const u8 = new Uint8Array(buf);
    if (!(u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF)) return err(415, 'Not a JPEG');
    if (v === 'main') {
      const h = [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
      if (h !== name) return err(400, 'Cover name does not match its content');
    }
    const key = v === 'hd' ? `art/hd/${name}.jpg` : `art/${name}.jpg`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: 'image/jpeg', cacheControl: v === 'hd' ? 'public, max-age=86400' : 'public, max-age=31536000, immutable' }, customMetadata: { by: who } });
    return json({ key: `art/${name}.jpg`, url: mediaBase(env) + key }, 201);
  }

  // ----- song upload: browser converts to the station format, sends it in parts (R2 multipart) -----
  if (p === '/uploads' && m === 'POST') {
    const b = await body(request);
    const size = Number(b.size), sha1 = String(b.sha1 || '');
    if (!(size > 1000 && size <= MAX_SONG_BYTES)) return err(400, 'File size is not allowed');
    if (!/^[0-9a-f]{40}$/.test(sha1)) return err(400, 'Bad checksum');
    let id;
    for (let i = 0; i < 5 && !id; i++) { const c = hex(6); if (!(await getSong(env, c))) id = c; }
    const key = `t/${id}-${sha1.slice(0, 8)}.mp3`;
    const mpu = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { by: who } });
    const uid = hex(10);
    await env.DB.prepare('INSERT INTO cr_uploads(id, r2_key, r2_upload_id, who, created_ms) VALUES (?1,?2,?3,?4,?5)').bind(uid, key, mpu.uploadId, who, now).run();
    return json({ upload: uid, id, key, part_size: PART_SIZE }, 201);
  }
  const part = /^\/uploads\/([0-9a-f]{20})\/parts\/(\d{1,4})$/.exec(p);
  if (part && m === 'PUT') {
    const up = await env.DB.prepare('SELECT * FROM cr_uploads WHERE id=?1 AND done_ms IS NULL').bind(part[1]).first();
    if (!up) return err(404, 'Upload not found');
    const n = Number(part[2]);
    if (n < 1 || n > 10000) return err(400, 'Bad part');
    const len = Number(request.headers.get('content-length') || 0);
    if (len > PART_SIZE) return err(413, 'Part too large');
    const buf = await request.arrayBuffer();
    if (buf.byteLength > PART_SIZE || !buf.byteLength) return err(413, 'Part size not allowed');
    const r = await env.MEDIA.resumeMultipartUpload(up.r2_key, up.r2_upload_id).uploadPart(n, buf);
    return json({ partNumber: r.partNumber, etag: r.etag });
  }
  const done = /^\/uploads\/([0-9a-f]{20})\/(complete|abort)$/.exec(p);
  if (done && m === 'POST') {
    const up = await env.DB.prepare('SELECT * FROM cr_uploads WHERE id=?1 AND done_ms IS NULL').bind(done[1]).first();
    if (!up) return err(404, 'Upload not found');
    const mpu = env.MEDIA.resumeMultipartUpload(up.r2_key, up.r2_upload_id);
    if (done[2] === 'abort') {
      try { await mpu.abort(); } catch { /* already gone */ }
      await env.DB.prepare('UPDATE cr_uploads SET done_ms=?2 WHERE id=?1').bind(up.id, -now).run();
      return json({ ok: true });
    }
    const b = await body(request);
    const parts = (Array.isArray(b.parts) ? b.parts : []).map((x) => ({ partNumber: Number(x.partNumber), etag: String(x.etag) })).sort((a, c) => a.partNumber - c.partNumber);
    if (!parts.length) return err(400, 'No parts');
    const fail = async (msg) => {
      // our own fresh upload that failed the checks: remove it so nothing half-made stays around
      try { await env.MEDIA.delete(up.r2_key); } catch { /* ignore */ }
      await env.DB.prepare('UPDATE cr_uploads SET done_ms=?2 WHERE id=?1').bind(up.id, -now).run();
      return err(400, msg);
    };
    try { await mpu.complete(parts); } catch (e) { return fail('Upload could not be finished: ' + String(e.message || e).slice(0, 120)); }
    const obj = await env.MEDIA.head(up.r2_key);
    if (!obj) return fail('Upload not found in storage');
    const head = await env.MEDIA.get(up.r2_key, { range: { offset: 0, length: 4096 } });
    const info = parseMp3(new Uint8Array(await head.arrayBuffer()));
    if (!info.ok) return fail('The converted file is not in the station format: ' + info.why);
    if (info.bytes !== obj.size) return fail(`The file is ${obj.size} bytes but its header says ${info.bytes}`);
    if (Number(b.dur_ms) !== info.dur_ms) return fail(`Length check failed (${b.dur_ms} ms measured, ${info.dur_ms} ms in the file)`);
    // checksum of what landed = what the browser made (and what the file name says)
    const ds = new crypto.DigestStream('SHA-1');
    const full = await env.MEDIA.get(up.r2_key);
    await full.body.pipeTo(ds);
    const sha = [...new Uint8Array(await ds.digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (!up.r2_key.endsWith(`-${sha.slice(0, 8)}.mp3`)) return fail('Checksum mismatch, please try again');
    const id = /^t\/([0-9a-f]{12})-/.exec(up.r2_key)[1];
    const meta = b.meta || {};
    const title = str(meta.title, 160) || 'Untitled';
    let album = str(meta.album, 160);
    let section = SECTIONS.includes(meta.section) ? meta.section : (album ? 'Albums' : 'Singles');
    const catAlbum = album || (section === 'Singles' ? 'Singles' : '');
    if (album === 'Singles') album = '';
    const artist = str(meta.artist, 120) || 'Bernie Chiaravalle';
    const year = /^\d{4}$/.test(str(meta.year, 4)) ? str(meta.year, 4) : null;
    const no = meta.no !== '' && meta.no != null && Number(meta.no) >= 0 && Number(meta.no) < 1000 ? Number(meta.no) : null;
    const art = /^art\/[0-9a-f]{16}\.jpg$/.test(meta.art || '') ? meta.art : null;
    const src = 'controlroom:' + str(meta.filename, 200);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO tracks (id, title, artist, album, genre, art, file, dur_ms, bytes, source, enabled, requestable, last_played_ms, plays, grp,
                        cat_section, cat_album, cat_no, cat_title, cat_artist, cat_year) VALUES (?1,?2,?3,?4,'',?5,?6,?7,?8,?9,0,1,0,0,?10,?11,?12,?13,?14,?15,?16)`)
        .bind(id, title, artist, album, art, up.r2_key, info.dur_ms, obj.size, src, (album || '').toLowerCase() || 'single', section, catAlbum, no, title, artist, year),
      env.DB.prepare('UPDATE cr_uploads SET done_ms=?2 WHERE id=?1').bind(up.id, now),
    ]);
    const lufs = Number(meta.lufs);
    await logActivity(env, who, 'upload', id, `Added "${title}"${album ? ` (${album})` : ''}: ${Math.floor(info.dur_ms / 60000)}:${String(Math.round(info.dur_ms / 1000) % 60).padStart(2, '0')}, 128 kbps${Number.isFinite(lufs) ? `, ${lufs.toFixed(1)} LUFS` : ''}. Not on the air until published.`,
      { type: 'songs', before: { [id]: { enabled: 0 } } });
    return json({ song: songOut(await getSong(env, id), env), info: { dur_ms: info.dur_ms, bytes: obj.size, frames: info.frames } }, 201);
  }

  // ----- live booth -----
  if (p === '/booth' && m === 'GET') {
    await ensureSchedule(env, now);
    const st = await buildState(env, now);
    const items = st.items;
    let cur = items.findIndex((i) => i.start_ms <= now && now < i.end_ms);
    if (cur < 0) cur = items.findIndex((i) => i.start_ms > now);
    const seqs = items.map((i) => i.seq);
    const { results: w } = seqs.length ? await env.DB.prepare(`SELECT seq, writer FROM schedule WHERE seq IN (${seqs.map((_, i) => '?' + (i + 1)).join(',')})`).bind(...seqs).all() : { results: [] };
    const djSeq = new Set(w.filter((x) => x.writer === 'dj').map((x) => x.seq));
    const out = (i) => i && { seq: i.seq, start_ms: i.start_ms, end_ms: i.end_ms, is_request: i.is_request, is_dj: djSeq.has(i.seq), track: i.track };
    const feats = await featuresList(env, now);
    return json({
      now, current: out(items[cur]), next: cur >= 0 ? items.slice(cur + 1, cur + 11).map(out) : [],
      history: cur > 0 ? items.slice(Math.max(0, cur - 5), cur).reverse().map(out) : [],
      features_now: feats.filter((f) => f.on_now).map((f) => ({ id: f.id, name: f.name, mode: f.mode, weight: f.weight, song_count: f.song_count })),
      lead_ms: DJ_LEAD_MS,
    });
  }
  if (p === '/booth/play' && m === 'POST') {
    const b = await body(request);
    const id = String(b.id || '');
    if (!ID_RE.test(id)) return err(400, 'Unknown song');
    const mode = b.mode === 'next' ? 'next' : 'now';
    const row = await getSong(env, id);
    if (!row) return err(404, 'Unknown song');
    let allowDisabled = false;
    if (!row.enabled) {
      // a switched-off song may only be played while a featured period lets it in
      const feats = (await featuresList(env, now)).filter((f) => f.on_now && (f.mode === 'unlock' || f.mode === 'only'));
      allowDisabled = feats.some((f) => f.song_ids.includes(id));
      if (!allowDisabled) return err(400, 'That song is switched off. Switch it on (or publish it) first.');
    }
    const r = await djPlace(env, id, mode, now, { allowDisabled });
    if (!r.ok) return err(400, r.message || 'Could not do that');
    const t = row.cat_title || row.title;
    await logActivity(env, who, mode === 'now' ? 'play_now' : 'play_next', id, mode === 'now'
      ? `Played "${t}" now (every listener switched at ${fmtWhen(r.at)} PT)`
      : `Put "${t}" next (starts ${fmtWhen(r.at)} PT)`);
    return json({ ok: true, at: r.at, mode });
  }
  if (p === '/booth/skip' && m === 'POST') {
    const cur = await env.DB.prepare('SELECT s.track_id, t.cat_title, t.title FROM schedule s JOIN tracks t ON t.id=s.track_id WHERE s.start_ms <= ?1 AND s.start_ms + s.dur_ms > ?1 ORDER BY s.seq DESC LIMIT 1').bind(now).first();
    const r = await djPlace(env, null, 'now', now);
    if (!r.ok) return err(400, r.message || 'Could not skip');
    await logActivity(env, who, 'skip', cur ? cur.track_id : null, `Skipped "${cur ? (cur.cat_title || cur.title) : 'the song on air'}" (next song at ${fmtWhen(r.at)} PT)`);
    return json({ ok: true, at: r.at, message: r.message || null });
  }

  // ----- featured periods -----
  if (p === '/features' && m === 'GET') {
    return json({ now, features: await featuresList(env, now) });
  }
  if (p === '/features' && m === 'POST') {
    const f = cleanFeature(await body(request));
    const ins = await env.DB.prepare(`INSERT INTO features(name, mode, weight, start_ms, end_ms, start_local, end_local, tz, yearly, active, note, created_ms, created_by, updated_ms, updated_by)
                                      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?11,?12,?11,?12) RETURNING id`)
      .bind(f.name, f.mode, f.weight, f.start_ms, f.end_ms, f.start_local, f.end_local, f.tz, f.yearly, f.note, now, who).first();
    await env.DB.batch(f.items.map((it) => env.DB.prepare('INSERT OR IGNORE INTO feature_tracks(feature_id, kind, value) VALUES (?1,?2,?3)').bind(ins.id, it.kind, it.value)));
    const row = await getFeature(env, ins.id);
    let replanned = false;
    if (touchesPlan([row], now)) { await replanFuture(env, now); replanned = true; }
    await logActivity(env, who, 'feature_add', String(ins.id), `Added featured period ${describeFeature(row)}${replanned ? ' (it starts right away, the songs coming up were re-planned)' : ''}`,
      { type: 'feature', id: ins.id, before: null, items: [] });
    return json({ feature: (await featuresList(env, now)).find((x) => x.id === ins.id), replanned }, 201);
  }
  const fe = /^\/features\/(\d+)$/.exec(p);
  const fa = /^\/features\/(\d+)\/(pause|resume)$/.exec(p);
  if ((fe && (m === 'PUT' || m === 'DELETE')) || (fa && m === 'POST')) {
    const id = Number((fe || fa)[1]);
    const cur = await getFeature(env, id);
    if (!cur) return err(404, 'Featured period not found');
    const curItems = await itemsOf(env, id);
    let target, items = curItems, verb;
    if (fe && m === 'PUT') {
      const f = cleanFeature(await body(request));
      target = { ...cur, ...f }; items = f.items; verb = 'Edited';
    } else if (fe) {
      target = { ...cur, active: 0, deleted_ms: now }; verb = 'Deleted';
    } else {
      target = { ...cur, active: fa[2] === 'resume' ? 1 : 0 }; verb = fa[2] === 'resume' ? 'Turned back on' : 'Paused';
    }
    await writeFeature(env, id, target, items, who);
    let replanned = false;
    if (touchesPlan([cur, target], now)) { await replanFuture(env, now); replanned = true; }
    await logActivity(env, who, 'feature_' + (fe ? (m === 'PUT' ? 'edit' : 'delete') : fa[2]), String(id),
      `${verb} featured period ${describeFeature(target)}${replanned ? ' (the songs coming up were re-planned)' : ''}`,
      { type: 'feature', id, before: cur, items: curItems });
    return json({ ok: true, replanned, feature: (await featuresList(env, now)).find((x) => x.id === id) || null });
  }

  // ----- activity + undo -----
  if (p === '/activity' && m === 'GET') {
    const lim = Math.min(300, parseInt(url.searchParams.get('limit') || '150', 10) || 150);
    const { results } = await env.DB.prepare('SELECT id, at_ms, who, action, target, summary, undo IS NOT NULL AND undone_ms IS NULL AS undoable, undone_ms FROM cr_activity ORDER BY id DESC LIMIT ?1').bind(lim).all();
    return json({ activity: results });
  }
  const undo = /^\/activity\/(\d+)\/undo$/.exec(p);
  if (undo && m === 'POST') {
    const a = await env.DB.prepare('SELECT * FROM cr_activity WHERE id=?1').bind(Number(undo[1])).first();
    if (!a || !a.undo || a.undone_ms) return err(400, "That change can't be undone");
    const claimed = await env.DB.prepare('UPDATE cr_activity SET undone_ms=?2 WHERE id=?1 AND undone_ms IS NULL').bind(a.id, now).run();
    if (!claimed.meta.changes) return err(409, 'Already undone');
    let r;
    try { r = await applyUndo(env, JSON.parse(a.undo), who); }
    catch (e) { await env.DB.prepare('UPDATE cr_activity SET undone_ms=NULL WHERE id=?1').bind(a.id).run(); throw e; }
    await logActivity(env, who, 'undo', a.target, `Undid: ${a.summary}${r.replanned ? ' (the songs coming up were re-planned)' : ''}`, r.redo);
    return json({ ok: true, replanned: !!r.replanned });
  }

  return err(404, 'No such endpoint');
}

async function featuresList(env, now) {
  let rows;
  try { ({ results: rows } = await env.DB.prepare('SELECT * FROM features WHERE deleted_ms IS NULL ORDER BY start_ms').all()); }
  catch { return []; }
  const items = await featureItemsAll(env);
  const out = [];
  for (const f of rows) {
    const it = items.get(f.id) || [];
    out.push(featureOut(f, it, await resolveItems(env, it), now));
  }
  return out;
}

// ---------- entry ----------
const PAGE_CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self'", "font-src 'self'",
  "img-src 'self' blob: data: https://media.bcradio.net", "media-src 'self' blob: https://media.bcradio.net",
  "connect-src 'self' blob:", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
].join('; ');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Fail closed: only the canonical hostname, only with a verified Access identity.
    if (url.hostname !== env.CANONICAL_HOST) return new Response(null, { status: 404, headers: NOINDEX });
    let who;
    try { who = await whoIs(request, env); }
    catch (e) { return new Response(null, { status: 403, headers: { ...SEC, 'cache-control': 'no-store', 'x-cr-auth': 'required' } }); }

    const path = url.pathname;
    if (path.startsWith('/api/')) {
      try { return await api(request, env, url, who, ctx); }
      catch (e) { return err(e.status || 500, e.status ? e.message : 'Something went wrong: ' + String(e.message || e).slice(0, 200)); }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: SEC });
    const page = { ...SEC, 'cache-control': 'no-store' };
    if (path === '/' || path === '/index.html') {
      const html = INDEX_HTML.replaceAll('{{APP_NAME}}', APP_NAME).replaceAll('{{APP_TAGLINE}}', APP_TAGLINE);
      return new Response(html, { headers: { ...page, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP } });
    }
    if (path === '/app.js') return new Response(APP_JS, { headers: { ...page, 'content-type': 'text/javascript; charset=utf-8' } });
    if (path === '/convert.js') return new Response(CONVERT_JS.replace('/*FF_VERSION*/', FF_VERSION), { headers: { ...page, 'content-type': 'text/javascript; charset=utf-8' } });
    if (path === '/mp3.js') return new Response(MP3_JS, { headers: { ...page, 'content-type': 'text/javascript; charset=utf-8' } });
    if (path === '/app.css') return new Response(APP_CSS, { headers: { ...page, 'content-type': 'text/css; charset=utf-8' } });
    // LOCAL TESTS ONLY: media from the local R2 (falls back to the public media host for files only in prod)
    if (env.LOCAL_MEDIA === '1' && path.startsWith('/media/')) {
      const key = decodeURIComponent(path.slice(7));
      if (!/^(t|art|state)\/[\w./-]+$/.test(key) || key.includes('..')) return new Response(null, { status: 404 });
      const obj = await env.MEDIA.get(key);
      if (!obj) return Response.redirect('https://media.bcradio.net/' + key, 302);
      const h = new Headers(SEC); obj.writeHttpMetadata(h); h.set('cache-control', 'no-store');
      return new Response(obj.body, { headers: h });
    }
    if (path.startsWith('/assets/')) {
      const res = await env.ASSETS.fetch(request);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(SEC)) h.set(k, v);
      h.set('cache-control', path.startsWith('/assets/ff/') ? 'private, max-age=31536000, immutable' : 'private, max-age=3600');
      if (path.endsWith('.js')) h.set('content-type', 'text/javascript; charset=utf-8');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return new Response(null, { status: 404, headers: page });
  },
};
