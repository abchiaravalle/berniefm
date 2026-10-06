// Shared helpers for BC Radio Pages Functions. Leading underscore = not routed.
// The station is a deterministic shared timeline stored in D1 (`schedule`).
// Every listener asks "what is playing at server time T and at what offset",
// so all browsers play the same track at the same position.

export const MEDIA = 'https://media.bcradio.net/';
export const HORIZON_MS = 2 * 3600 * 1000;    // keep >= 2 h scheduled ahead (published to R2 as a static file)
export const STATE_KEY = 'state/now.json';
export const REV_KEY = 'state/rev.json';
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

// Pick the next rotation track (in memory): among the least-recently-played,
// skip anything already on the upcoming schedule, avoid the album/collection of
// the last few slots, and pick randomly among the stalest few so the order never
// feels mechanical. `pool` is sorted stalest first.
function pickRotation(pool, exclude, recentGroups) {
  let cand = pool.filter(t => !exclude.has(t.id));
  if (!cand.length) cand = pool.slice();
  for (let k = recentGroups.length; k > 0; k--) {
    const avoid = new Set(recentGroups.slice(0, k));
    const c2 = cand.filter(t => !t.grp || !avoid.has(t.grp));
    if (c2.length) { cand = c2; break; }
  }
  cand = cand.slice(0, 10);
  return cand[Math.floor(Math.random() * cand.length)];
}

// Extend the schedule so it reaches now + HORIZON_MS. The whole extension is
// planned in memory and written in ONE transaction (a handful of D1 calls no
// matter how many slots), so long-lived streams never run out of their
// per-invocation call budget.
// Safe under concurrency: every slot insert is conditional on its predecessor
// being exactly the row we planned from (seq, start, track). If another worker
// (or a request re-plan) wrote first, our rows stop at the first mismatch, and
// the next round re-reads the real tail. The timeline can never get a hole or
// an overlap. Pending listener requests are slotted first (FIFO).
export async function ensureSchedule(env, now = Date.now(), { publish = true } = {}) {
  let added = 0;
  for (let round = 0; round < 4; round++) {
    const { results: tails } = await env.DB.prepare(
      'SELECT s.seq, s.start_ms, s.dur_ms, s.track_id, t.grp FROM schedule s LEFT JOIN tracks t ON t.id=s.track_id ORDER BY s.seq DESC LIMIT 3'
    ).all();
    const tail = tails[0];
    // Station idle long enough that the timeline ran out: restart the clock at
    // now rather than "catching up" through dead slots.
    let start = tail ? Math.max(tail.start_ms + tail.dur_ms + GAP_MS, now) : now;
    if (start > now + HORIZON_MS) break;

    const [{ results: reqs }, { results: upcoming }, { results: pool }] = await env.DB.batch([
      env.DB.prepare("SELECT r.id, r.track_id, t.dur_ms, t.grp FROM requests r JOIN tracks t ON t.id=r.track_id WHERE r.status='pending' ORDER BY r.id ASC LIMIT 20"),
      env.DB.prepare('SELECT track_id FROM schedule WHERE start_ms >= ?1').bind(now - 6 * 3600 * 1000),
      env.DB.prepare('SELECT id, grp, dur_ms FROM tracks WHERE enabled=1 ORDER BY last_played_ms ASC, plays ASC LIMIT 150'),
    ]);
    const exclude = new Set(upcoming.map(u => u.track_id));
    const recent = tails.map(t => t.grp).filter(Boolean);    // newest first
    const plan = [];
    let prev = tail ? { seq: tail.seq, start: tail.start_ms, track: tail.track_id, dur: tail.dur_ms } : null;
    let seq = tail ? tail.seq : 0;
    while (start <= now + HORIZON_MS) {
      let trackId, durMs, grp, requestId = null;
      const rq = reqs.shift();
      if (rq) {
        trackId = rq.track_id; durMs = rq.dur_ms; grp = rq.grp; requestId = rq.id;
      } else {
        const t = pickRotation(pool, exclude, recent.slice(0, 3));
        if (!t) break;
        trackId = t.id; durMs = t.dur_ms; grp = t.grp;
      }
      seq++;
      plan.push({ seq, trackId, start, durMs, requestId, prev });
      prev = { seq, start, track: trackId, dur: durMs };
      exclude.add(trackId);
      recent.unshift(grp);
      start += durMs + GAP_MS;
    }
    if (!plan.length) break;

    const writer = crypto.randomUUID();     // proves which slots THIS call wrote
    const stmts = [];
    for (const p of plan) {
      const guard = p.prev
        ? 'EXISTS (SELECT 1 FROM schedule WHERE seq=?7 AND start_ms=?8 AND track_id=?9 AND dur_ms=?11)'
        : 'NOT EXISTS (SELECT 1 FROM schedule)';
      const st = env.DB.prepare(
        `INSERT OR IGNORE INTO schedule(seq, track_id, start_ms, dur_ms, request_id, created_ms, writer)
         SELECT ?1,?2,?3,?4,?5,?6,?10 WHERE ${guard}`
      );
      stmts.push(p.prev
        ? st.bind(p.seq, p.trackId, p.start, p.durMs, p.requestId, now, p.prev.seq, p.prev.start, p.prev.track, writer, p.prev.dur)
        : st.bind(p.seq, p.trackId, p.start, p.durMs, p.requestId, now, null, null, null, writer));
      // side effects only for slots that really landed as planned
      stmts.push(env.DB.prepare(
        'UPDATE tracks SET last_played_ms=?1, plays=plays+1 WHERE id=?2 AND EXISTS (SELECT 1 FROM schedule WHERE seq=?3 AND writer=?4)'
      ).bind(p.start, p.trackId, p.seq, writer));
      if (p.requestId) {
        stmts.push(env.DB.prepare(
          "UPDATE requests SET status='scheduled', seq=?1 WHERE id=?2 AND EXISTS (SELECT 1 FROM schedule WHERE seq=?1 AND writer=?3)"
        ).bind(p.seq, p.requestId, writer));
      }
    }
    const res = await env.DB.batch(stmts);
    let landed = 0;
    for (let i = 0, k = 0; k < plan.length; k++) {
      if (res[i].meta && res[i].meta.changes === 1) landed++;
      i += plan[k].requestId ? 3 : 2;
    }
    added += landed;
    if (landed === plan.length) {
      // Fully written. One more cheap round only if the plan stopped early.
      if (start > now + HORIZON_MS) break;
    }
    // else: lost a race part-way; loop re-reads the real tail and continues from it
  }
  if (added && publish) await publishState(env, now);
  return added;
}

// ---------- DJ (owner) controls ----------
// Change what everyone hears. mode 'now': the current song stops DJ_LEAD_MS from
// now and the chosen track starts for every listener at the same moment (the lead
// gives players time to pick up the change). mode 'next': the chosen track plays
// right after the current song. trackId null + mode 'now' = skip to the next song.
// Everything after the cut is dropped and re-planned (listener requests keep their
// place in line, right after the DJ pick).
export const DJ_LEAD_MS = 10000;
export async function djPlace(env, trackId, mode = 'now', now = Date.now()) {
  await ensureSchedule(env, now, { publish: false });
  let track = null;
  if (trackId) {
    track = await env.DB.prepare('SELECT id, dur_ms FROM tracks WHERE id=?1 AND enabled=1').bind(trackId).first();
    if (!track) return { ok: false, message: 'Unknown song.' };
  }
  const cur = await env.DB.prepare(
    'SELECT seq, start_ms, dur_ms, track_id FROM schedule WHERE start_ms <= ?1 AND start_ms + dur_ms > ?1 ORDER BY seq DESC LIMIT 1'
  ).bind(now).first();
  if (!cur) return { ok: false, message: 'Station is starting, try again in a moment.' };
  const curEnd = cur.start_ms + cur.dur_ms;
  let at = curEnd, cut = null;
  if (mode === 'now' && curEnd > now + DJ_LEAD_MS) { at = now + DJ_LEAD_MS; cut = at - cur.start_ms; }
  if (!track && cut === null) return { ok: true, at, message: 'The next song is about to start.', state: await publishState(env, now) };
  if (!track) {
    // Skip: keep the queue exactly as it is (DJ "next" picks, requests), just
    // end the current song early and pull everything after it forward.
    const shift = curEnd - at;
    await env.DB.batch([
      env.DB.prepare('UPDATE schedule SET dur_ms=?1 WHERE seq=?2').bind(cut, cur.seq),
      env.DB.prepare('UPDATE schedule SET start_ms = start_ms - ?1 WHERE seq > ?2').bind(shift, cur.seq),
      env.DB.prepare(`UPDATE tracks SET last_played_ms = last_played_ms - ?1
                        WHERE id IN (SELECT track_id FROM schedule WHERE seq > ?2)
                          AND last_played_ms = (SELECT MAX(s.start_ms) + ?1 FROM schedule s WHERE s.track_id = tracks.id)`).bind(shift, cur.seq),
    ]);
    await ensureSchedule(env, now, { publish: false });
    return { ok: true, at, state: await publishState(env, now) };
  }

  const { results: dropped } = await env.DB.prepare('SELECT seq, track_id, request_id FROM schedule WHERE seq > ?1').bind(cur.seq).all();
  const stmts = [env.DB.prepare('DELETE FROM schedule WHERE seq > ?1').bind(cur.seq)];
  for (const d of dropped) {
    if (d.request_id) stmts.push(env.DB.prepare("UPDATE requests SET status='pending', seq=NULL WHERE id=?1").bind(d.request_id));
    stmts.push(env.DB.prepare(
      `UPDATE tracks SET plays = MAX(plays-1,0), last_played_ms = COALESCE(
         (SELECT MAX(start_ms) FROM schedule WHERE track_id=?1 AND seq <= ?2), 0) WHERE id=?1`
    ).bind(d.track_id, cur.seq));
  }
  if (cut !== null) stmts.push(env.DB.prepare('UPDATE schedule SET dur_ms=?1 WHERE seq=?2').bind(cut, cur.seq));
  if (track) {
    stmts.push(env.DB.prepare(
      "INSERT INTO schedule(seq, track_id, start_ms, dur_ms, request_id, created_ms, writer) VALUES (?1,?2,?3,?4,NULL,?5,'dj')"
    ).bind(cur.seq + 1, track.id, at, track.dur_ms, now));
    stmts.push(env.DB.prepare('UPDATE tracks SET last_played_ms=?1, plays=plays+1 WHERE id=?2').bind(at, track.id));
  }
  await env.DB.batch(stmts);
  await ensureSchedule(env, now, { publish: false });
  const state = await publishState(env, now);
  return { ok: true, at, state };
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
    title: row.cat_title || row.title,
    artist: row.cat_artist || row.artist || 'Bernie Chiaravalle',
    album: row.cat_album || row.album || '',
    art: row.art ? MEDIA + row.art : MEDIA + 'art/default.jpg',
    url: MEDIA + row.file,
    duration: row.dur_ms / 1000,
  };
}

// Timeline around `now`: last few finished items + everything scheduled ahead.
export async function buildState(env, now = Date.now()) {
  const cols = 's.seq, s.start_ms, s.dur_ms, s.request_id, t.id, t.title, t.artist, t.album, t.art, t.file, t.cat_title, t.cat_artist, t.cat_album';
  const { results } = await env.DB.prepare(
    `SELECT ${cols} FROM schedule s JOIN tracks t ON t.id=s.track_id
     WHERE s.start_ms + s.dur_ms > ?1 ORDER BY s.start_ms ASC LIMIT 80`
  ).bind(now - 3600000).all();
  let items = results.map(r => ({
    seq: r.seq, start_ms: r.start_ms, end_ms: r.start_ms + r.dur_ms, is_request: !!r.request_id, track: trackOut(r),
  }));
  let curIdx = items.findIndex(i => i.start_ms <= now && now < i.end_ms);
  if (curIdx < 0) curIdx = items.findIndex(i => i.start_ms > now);
  if (curIdx > 5) items = items.slice(curIdx - 5);
  return { now, items };
}

// Everyone's player reads this static file from R2 (media.bcradio.net), so
// listening never costs a server call. Rewritten whenever the schedule changes.
export async function publishState(env, now = Date.now()) {
  const st = await buildState(env, now);
  st.generated_ms = now;
  await env.MEDIA.put(STATE_KEY, JSON.stringify(st), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=5' },
  });
  // Tiny change marker: players poll this every few seconds while playing, and
  // only re-read the full timeline when it changes (DJ picks, requests).
  await env.MEDIA.put(REV_KEY, JSON.stringify({ rev: now }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
  });
  return st;
}

// Full station state at `now` (current / next / history views on top of items).
export async function stationState(env, now = Date.now()) {
  await ensureSchedule(env, now);
  const st = await buildState(env, now);
  const items = st.items;
  let curIdx = items.findIndex(i => i.start_ms <= now && now < i.end_ms);
  if (curIdx < 0) curIdx = items.findIndex(i => i.start_ms > now);
  st.current = items[curIdx] || null;
  st.next = curIdx >= 0 ? items.slice(curIdx + 1, curIdx + 6) : [];
  st.history = curIdx > 0 ? items.slice(Math.max(0, curIdx - 5), curIdx).reverse() : [];
  pruneHistory(env, now);
  return st;
}
