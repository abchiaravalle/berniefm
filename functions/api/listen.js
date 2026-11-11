import { json, limited } from '../_lib.js';
import { PLATFORMS, SID_RE, countStatement, countsFrom, cleanupStatements, minuteSnapshot } from '../_listeners.js';

// POST /api/listen  {sid, platform: "web"|"ios"|"android", playing: true|false}
// A playing player calls this about once a minute; playing:false (stop, page closed) removes
// its session right away. Only (sid, platform, last_seen_ms) is stored, see ../_listeners.js.
// The answer carries the live totals so the player can show them without a second call.

const MAX_BODY = 512;
// The website's own hosts (and this project's preview aliases). The apps send no Origin header.
const SITE_ORIGIN = /^https:\/\/((www\.|stream\.)?bcradio\.net|([a-z0-9-]+\.)?berniefm\.pages\.dev)$/;

// Rate-limit key: a salted one-way hash of the IP that changes every minute (8 bytes), so a
// limiter bucket can't be matched to any other minute or to anything else the station keeps.
// Buckets are deleted once their minute is over (cleanupStatements and limited()).
async function minuteKey(request, env, now) {
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const data = new TextEncoder().encode(`${env.IP_SALT || 'bcradio'}|listen|${Math.floor(now / 60000)}|${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && !SITE_ORIGIN.test(origin)) {
    return json({ ok: false, message: 'Forbidden.' }, 403);
  }
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ ok: false, message: 'Too large.' }, 413);
  let body;
  try {
    const txt = await request.text();
    if (txt.length > MAX_BODY) return json({ ok: false, message: 'Too large.' }, 413);
    body = JSON.parse(txt);
  } catch {
    return json({ ok: false, message: 'Bad request.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, message: 'Bad request.' }, 400);
  const { sid, platform, playing } = body;
  if (typeof sid !== 'string' || !SID_RE.test(sid)) return json({ ok: false, message: 'Bad sid.' }, 400);
  if (typeof platform !== 'string' || !PLATFORMS.includes(platform)) return json({ ok: false, message: 'Bad platform.' }, 400);
  if (typeof playing !== 'boolean') return json({ ok: false, message: 'Bad playing.' }, 400);

  const now = Date.now();
  if (await limited(env, 'listen', await minuteKey(request, env, now), 60, 30)) {
    return json({ ok: false, message: 'Slow down.' }, 429, { 'retry-after': '60' });
  }

  const stmts = [];
  const snap = minuteSnapshot(env, now);
  if (snap) stmts.push(snap);
  stmts.push(playing
    ? env.DB.prepare(
        'INSERT INTO listen_sessions(sid, platform, last_seen_ms) VALUES (?1, ?2, ?3) ON CONFLICT(sid) DO UPDATE SET platform=excluded.platform, last_seen_ms=excluded.last_seen_ms'
      ).bind(sid, platform, now)
    : env.DB.prepare('DELETE FROM listen_sessions WHERE sid=?1').bind(sid));
  if (Math.random() < 0.1) stmts.push(...cleanupStatements(env, now));
  stmts.push(countStatement(env, now));
  const res = await env.DB.batch(stmts);
  return json({ ok: true, now, ...countsFrom(res[res.length - 1].results) });
}

export async function onRequest() {
  return json({ ok: false, message: 'Use POST.' }, 405, { allow: 'POST' });
}
