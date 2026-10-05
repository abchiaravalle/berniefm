import { json, ipHash, limited, verifyTurnstile, ensureSchedule, stationState, publishState, NO_REPEAT_TRACK_MS } from '../_lib.js';

// Hostname pin for the shared Turnstile widget: only tokens solved on this
// station's own hosts (incl. this project's preview aliases) are accepted.
const ALLOWED_HOSTS = h => h === 'bcradio.net' || h === 'stream.bcradio.net' ||
  h === 'berniefm.pages.dev' || /^[a-z0-9-]+\.berniefm\.pages\.dev$/.test(h || '');
const ACTION = 'bcradio-request';
const LOCK_MS = 90000;           // never reshuffle anything starting in the next 90s (players re-read the schedule before every song change)
const MAX_PENDING = 15;

// Re-plan the future so pending requests play next (FIFO) without touching the
// track that is on air. Future rotation slots are released back to the pool.
async function replan(env, now) {
  const cut = await env.DB.prepare(
    'SELECT seq FROM schedule WHERE start_ms >= ?1 ORDER BY seq ASC LIMIT 1'
  ).bind(now + LOCK_MS).first();
  if (cut) {
    const { results: dropped } = await env.DB.prepare(
      'SELECT seq, track_id, request_id FROM schedule WHERE seq >= ?1'
    ).bind(cut.seq).all();
    const stmts = [env.DB.prepare('DELETE FROM schedule WHERE seq >= ?1').bind(cut.seq)];
    for (const d of dropped) {
      if (d.request_id) {
        stmts.push(env.DB.prepare("UPDATE requests SET status='pending', seq=NULL WHERE id=?1").bind(d.request_id));
      }
      // restore the track's last-played time to its most recent slot still on the books
      stmts.push(env.DB.prepare(
        `UPDATE tracks SET plays = MAX(plays-1,0), last_played_ms = COALESCE(
           (SELECT MAX(start_ms) FROM schedule WHERE track_id=?1 AND seq < ?2), 0) WHERE id=?1`
      ).bind(d.track_id, cut.seq));
    }
    await env.DB.batch(stmts);
  }
  await ensureSchedule(env, now, { publish: false });
  await publishState(env, now);
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const txt = await request.text();
    if (txt.length > 8192) return json({ ok: false, message: 'Request too large.' }, 413);
    body = JSON.parse(txt);
  } catch {
    return json({ ok: false, message: 'Bad request.' }, 400);
  }
  const trackId = typeof body.id === 'string' ? body.id.slice(0, 32) : '';
  if (!/^[0-9a-f]{6,32}$/.test(trackId)) return json({ ok: false, message: 'Unknown song.' }, 400);

  const ts = await verifyTurnstile(env, body.token, request, ALLOWED_HOSTS, ACTION);
  if (!ts.ok) {
    console.log('turnstile reject', ts.why);
    return json({ ok: false, message: 'Please complete the check and try again.' }, 400);
  }

  const who = await ipHash(request, env);
  if (await limited(env, 'req2m', who, 120, 1)) {
    return json({ ok: false, message: 'You just made a request. Please wait a couple of minutes before requesting another.' }, 429);
  }
  if (await limited(env, 'req1h', who, 3600, 8)) {
    return json({ ok: false, message: 'That is a lot of requests for one hour. Please try again later.' }, 429);
  }

  const now = Date.now();
  const t = await env.DB.prepare(
    'SELECT id, title, last_played_ms FROM tracks WHERE id=?1 AND enabled=1 AND requestable=1'
  ).bind(trackId).first();
  if (!t) return json({ ok: false, message: 'Unknown song.' }, 404);

  const pendingSame = await env.DB.prepare(
    "SELECT id FROM requests WHERE track_id=?1 AND status='pending' LIMIT 1"
  ).bind(trackId).first();
  if (pendingSame || t.last_played_ms > now) {
    return json({ ok: false, message: 'That song is already coming up soon.' }, 409);
  }
  if (t.last_played_ms > now - NO_REPEAT_TRACK_MS) {
    return json({ ok: false, message: 'That song was played recently. Please pick another one.' }, 409);
  }
  const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE status='pending'").first();
  if ((pend?.n || 0) >= MAX_PENDING) {
    return json({ ok: false, message: 'The request line is full right now. Please try again in a little while.' }, 429);
  }

  const ins = await env.DB.prepare(
    "INSERT INTO requests(track_id, ip_hash, created_ms, status) VALUES (?1,?2,?3,'pending') RETURNING id"
  ).bind(trackId, who, now).first();
  await replan(env, now);

  const slot = await env.DB.prepare('SELECT start_ms FROM schedule s JOIN requests r ON r.seq=s.seq WHERE r.id=?1').bind(ins.id).first();
  const mins = slot ? Math.max(0, Math.round((slot.start_ms - now) / 60000)) : null;
  const when = mins === null ? 'soon' : mins <= 1 ? 'in about a minute' : `in about ${mins} minutes`;
  const state = await stationState(env, now);
  return json({ ok: true, message: `Your request has been submitted and will play ${when}.`, starts_ms: slot?.start_ms || null, state });
}

export async function onRequestGet() {
  return json({ ok: false, message: 'Use POST.' }, 405, { allow: 'POST' });
}
