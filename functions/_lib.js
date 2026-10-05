// Shared helpers for BC Radio Pages Functions. Leading underscore = not routed.
// The station is a deterministic shared timeline stored in D1 (`schedule`).
// Every listener asks "what is playing at server time T and at what offset",
// so all browsers play the same track at the same position.

export const MEDIA = 'https://media.bcradio.net/';
export const HORIZON_MS = 30 * 60 * 1000;     // keep >= 30 min scheduled ahead
export const HISTORY_KEEP_MS = 3 * 24 * 3600 * 1000;
export const NO_REPEAT_TRACK_MS = 4 * 3600 * 1000; // request blocked if played within 4h (matches old station feel)
export const GAP_MS = 0;                      // back-to-back, no dead air

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...extra,
    },
  });
}

export async function ipHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const data = new TextEncoder().encode((env.IP_SALT || 'bcradio') + '|' + ip);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fixed-window limiter, one round trip. Returns true when over the limit.
export async function limited(env, action, who, windowSec, max) {
  const now = Date.now();
  const idx = Math.floor(now / (windowSec * 1000));
  const bucket = `${action}:${who}:${windowSec}:${idx}`;
  const win = (idx + 1) * windowSec * 1000;
  const row = await env.DB.prepare(
    'INSERT INTO hits(bucket,win,n) VALUES(?1,?2,1) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n'
  ).bind(bucket, win).first();
  if (Math.random() < 0.03) {
    await env.DB.prepare('DELETE FROM hits WHERE win < ?1').bind(now).run();
  }
  return (row?.n || 1) > max;
}

export async function verifyTurnstile(env, token, request, expectHost, expectAction) {
  if (!env.TURNSTILE_SECRET) return { ok: false, why: 'no-secret' };
  if (!token || typeof token !== 'string' || token.length > 4096) return { ok: false, why: 'no-token' };
  try {
    const fd = new FormData();
    fd.append('secret', env.TURNSTILE_SECRET);
    fd.append('response', token);
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) fd.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: fd });
    const d = await r.json();
    if (!d.success) return { ok: false, why: 'fail:' + (d['error-codes'] || []).join(',') };
    if (expectHost && !expectHost(d.hostname)) return { ok: false, why: 'host:' + d.hostname };
    if (expectAction && d.action !== expectAction) return { ok: false, why: 'action:' + d.action };
    const age = Date.now() - Date.parse(d.challenge_ts || 0);
    if (!(age >= 0 && age < 300000)) return { ok: false, why: 'stale' };
    return { ok: true };
  } catch (e) {
    return { ok: false, why: 'verifier-error' };
  }
}

// ---------- scheduling ----------

// Pick the next rotation track: among the least-recently-played, skip anything
// already on the upcoming schedule, avoid the album/collection of the last few
// slots, and pick randomly among the stalest few so the order never feels mechanical.
async function pickRotation(env, excludeIds, recentGroups) {
  const { results } = await env.DB.prepare(
    'SELECT id, grp, dur_ms, last_played_ms FROM tracks WHERE enabled=1 ORDER BY last_played_ms ASC, plays ASC LIMIT 60'
  ).all();
  let pool = results.filter(t => !excludeIds.has(t.id));
  if (!pool.length) pool = results;
  for (let k = recentGroups.length; k > 0; k--) {
    const avoid = new Set(recentGroups.slice(0, k));
    const p2 = pool.filter(t => !t.grp || !avoid.has(t.grp));
    if (p2.length) { pool = p2; break; }
  }
  pool = pool.slice(0, 10);
  return pool[Math.floor(Math.random() * pool.length)];
}

// Extend the schedule so it reaches now + HORIZON_MS. Safe under concurrency:
// each slot is INSERT OR IGNORE keyed on seq; a racing worker that loses simply
// re-reads. Pending listener requests are slotted first (FIFO).
export async function ensureSchedule(env, now = Date.now()) {
  for (let guard = 0; guard < 40; guard++) {
    const { results: tails } = await env.DB.prepare(
      'SELECT s.seq, s.start_ms, s.dur_ms, s.track_id, t.grp FROM schedule s LEFT JOIN tracks t ON t.id=s.track_id ORDER BY s.seq DESC LIMIT 3'
    ).all();
    const tail = tails[0];
    const recentGroups = tails.map(t => t.grp).filter(Boolean);
    let nextSeq, nextStart;
    if (!tail) {
      nextSeq = 1; nextStart = now;
    } else {
      nextSeq = tail.seq + 1;
      nextStart = tail.start_ms + tail.dur_ms + GAP_MS;
      // Station was idle (no traffic) long enough that the timeline ran out:
      // restart the clock at now rather than "catching up" through dead slots.
      if (nextStart < now) nextStart = now;
    }
    if (nextStart > now + HORIZON_MS) return;

    // Requests first
    const req = await env.DB.prepare(
      "SELECT r.id, r.track_id, t.dur_ms FROM requests r JOIN tracks t ON t.id=r.track_id WHERE r.status='pending' ORDER BY r.id ASC LIMIT 1"
    ).first();
    let trackId, durMs, requestId = null;
    if (req) {
      trackId = req.track_id; durMs = req.dur_ms; requestId = req.id;
    } else {
      const { results: upcoming } = await env.DB.prepare(
        'SELECT track_id FROM schedule WHERE start_ms >= ?1'
      ).bind(now - 6 * 3600 * 1000).all();
      const t = await pickRotation(env, new Set(upcoming.map(u => u.track_id)), recentGroups);
      if (!t) return;
      trackId = t.id; durMs = t.dur_ms;
    }
    // Conditional insert: only lands if the tail we planned from still exists
    // unchanged. If a concurrent request re-plan deleted it, nothing is written
    // and we loop to re-read, so the timeline can never get a hole.
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO schedule(seq, track_id, start_ms, dur_ms, request_id, created_ms)
       SELECT ?1,?2,?3,?4,?5,?6 WHERE (?7 = 0) OR EXISTS (SELECT 1 FROM schedule WHERE seq=?7 AND start_ms=?8)`
    ).bind(nextSeq, trackId, nextStart, durMs, requestId, now, tail ? tail.seq : 0, tail ? tail.start_ms : 0).run();
    if (ins.meta && ins.meta.changes === 1) {
      const stmts = [
        env.DB.prepare('UPDATE tracks SET last_played_ms=?1, plays=plays+1 WHERE id=?2').bind(nextStart, trackId),
      ];
      if (requestId) {
        stmts.push(env.DB.prepare("UPDATE requests SET status='scheduled', seq=?1 WHERE id=?2").bind(nextSeq, requestId));
      }
      await env.DB.batch(stmts);
    }
    // loop: re-read tail (either ours or the racer's)
  }
}

export async function pruneHistory(env, now = Date.now()) {
  if (Math.random() < 0.02) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM schedule WHERE start_ms + dur_ms < ?1').bind(now - HISTORY_KEEP_MS),
      env.DB.prepare("DELETE FROM requests WHERE status='scheduled' AND created_ms < ?1").bind(now - HISTORY_KEEP_MS),
    ]);
  }
}

export function trackOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || 'Bernie Chiaravalle',
    album: row.album || '',
    art: row.art ? MEDIA + row.art : MEDIA + 'art/default.jpg',
    url: MEDIA + row.file,
    duration: row.dur_ms / 1000,
  };
}

// Full station state at `now`: current item + offset, upcoming, recent history.
export async function stationState(env, now = Date.now()) {
  await ensureSchedule(env, now);
  const cols = 's.seq, s.start_ms, s.dur_ms, s.request_id, t.id, t.title, t.artist, t.album, t.art, t.file';
  const { results: around } = await env.DB.prepare(
    `SELECT ${cols} FROM schedule s JOIN tracks t ON t.id=s.track_id
     WHERE s.start_ms > ?1 - 7200000 ORDER BY s.seq ASC LIMIT 40`
  ).bind(now).all();
  const items = around.map(r => ({
    seq: r.seq, start_ms: r.start_ms, end_ms: r.start_ms + r.dur_ms, is_request: !!r.request_id, track: trackOut(r),
  }));
  let curIdx = items.findIndex(i => i.start_ms <= now && now < i.end_ms);
  if (curIdx < 0) curIdx = items.findIndex(i => i.start_ms > now);
  const current = items[curIdx] || null;
  const next = curIdx >= 0 ? items.slice(curIdx + 1, curIdx + 6) : [];
  const history = curIdx > 0 ? items.slice(Math.max(0, curIdx - 5), curIdx).reverse() : [];
  pruneHistory(env, now);
  return { now, current, next, history };
}
