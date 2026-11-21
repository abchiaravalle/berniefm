// The Christmas channels (2026-11-21). Leading underscore = not routed.
//
// While the station's Christmas period is on (Control Room > On the air > Christmas: On), listeners
// pick one of three channels. Each channel is its own shared timeline, so everyone on the same
// channel hears the same song at the same second:
//   mixed     - "Mixed", the default: the station's normal timeline (table `schedule`, ./_lib.js),
//               untouched by anything in this file
//   christmas - "Christmas only": only the Christmas period's songs, as shuffled rounds (every song
//               once before any repeats, never the same song twice in a row; the rules of the
//               Control Room's "Christmas only" setting, pickCycle in ./_lib.js)
//   classic   - "No Christmas": normal rotation without any of the Christmas period's songs
//
// The two extra channels keep everything in their own tables (manager/migrations/0004_channels.sql):
//   ch_schedule  their timelines (seq counts per channel)
//   ch_plays     their own "last played" + play count per song, so a channel never changes the
//                normal timeline's rotation (tracks.last_played_ms / plays are only written by it)
//   ch_requests  their listener requests
// and publish their own files: state/now-<id>.json + state/rev-<id>.json on R2.
//
// A channel costs nothing while nobody listens: it is only planned when someone asks for it
// (/api/now?ch=, a request, a DJ action, the Control Room booth). After a quiet spell the first
// listener's call starts a song at that very second (like the main timeline after an idle night).
// Planning stops at the end of the Christmas window, so the files run out with it.
import {
  HORIZON_MS, GAP_MS, HISTORY_KEEP_MS, DJ_LEAD_MS, REPLAN_LOCK_MS, NO_REPEAT_TRACK_MS,
  trackOut, featureWindows, loadFeatures, featurePlan, pickRotation, pickCycle, pickFeatured, histPush,
} from './_lib.js';

export const CHANNELS = [
  { id: 'mixed', label: 'Mixed', default: true },
  { id: 'christmas', label: 'Christmas only' },
  { id: 'classic', label: 'No Christmas' },
];
export const EXTRA = ['christmas', 'classic'];
export const XMAS_NAME = /christmas|holiday/i;
export const XMAS_GAP_MS = 30 * 60e3;          // christmas channel: a song may come back after 30 min (a round is ~45 min)
export const XMAS_REQ_MS = 15 * 60e3;          // christmas channel: a song can't be requested within 15 min of its last or next play
export const REPEAT_MS = 6 * 3600e3;           // classic channel: nothing repeats within 6 h (same as the main timeline)
const MAX_PENDING = 15;
export const stateKey = ch => `state/now-${ch}.json`;
export const revKey = ch => `state/rev-${ch}.json`;
// 'christmas' | 'classic', anything else = the main timeline
export const extraCh = v => (typeof v === 'string' && EXTRA.includes(v) ? v : null);

// ---------- is the Christmas period on, and which songs are in it ----------
// The first (lowest id) featured period named like /christmas|holiday/i that is switched on, not
// deleted and inside one of its windows right now (the rule /api/season and the Control Room
// switch use). Channels exist while it is on with any setting except the legacy "Christmas only"
// (mode 'only'), where the main timeline itself is all Christmas and there is nothing to choose.
export const P_SQL = 'SELECT id, name, mode, start_ms, end_ms, yearly, tz, start_local, end_local FROM features WHERE active=1 AND deleted_ms IS NULL AND (yearly=1 OR (start_ms <= ?1 AND end_ms > ?1)) ORDER BY id';
export function pickXmas(rows, now) {
  for (const f of rows || []) {
    if (!XMAS_NAME.test(f.name || '')) continue;
    let wins = [];
    try { wins = featureWindows(f, now, now + 1); } catch (e) { continue; }
    const w = wins.find(([a, b]) => a <= now && now < b);
    if (w) return { id: f.id, mode: f.mode, until: w[1] };
  }
  return null;
}
export const channelsOn = x => !!x && x.mode !== 'only';
// The period + its songs while channels are available, else null.
export async function xmasNow(env, now = Date.now()) {
  let rows;
  try { ({ results: rows } = await env.DB.prepare(P_SQL).bind(now).all()); } catch (e) { return null; }
  const x = pickXmas(rows, now);
  if (!channelsOn(x)) return null;
  const { results: songs } = await env.DB.prepare(
    `SELECT DISTINCT t.id, t.grp, t.dur_ms, t.enabled, t.requestable FROM feature_tracks ft JOIN tracks t ON
          (ft.kind='track' AND t.id=ft.value)
       OR (ft.kind='album' AND COALESCE(NULLIF(t.cat_album,''), t.album)=ft.value)
       OR (ft.kind='section' AND t.cat_section=ft.value)
     WHERE ft.feature_id=?1 ORDER BY t.id`
  ).bind(x.id).all();
  if (!songs.length) return null;
  return { ...x, songs, ids: new Set(songs.map(s => s.id)) };
}
const marks = n => Array.from({ length: n }, (_, i) => '?' + (i + 2)).join(',');

// Is this song on this channel? christmas: one of the period's songs (switched off or not).
// classic: a switched-on song that is not one of them.
export async function songOnChannel(env, ch, id, P) {
  if (ch === 'christmas') return P.ids.has(id) ? env.DB.prepare('SELECT id, dur_ms, title, cat_title, requestable FROM tracks WHERE id=?1').bind(id).first() : null;
  if (P.ids.has(id)) return null;
  return env.DB.prepare('SELECT id, dur_ms, title, cat_title, requestable FROM tracks WHERE id=?1 AND enabled=1').bind(id).first();
}

// ---------- planning ----------
// The channel's pool, stalest first, with the channel's OWN memory: christmas uses only what it
// played itself (a fresh channel starts its first round at random); classic falls back to the
// station's last-played for songs it hasn't played yet, so a fresh channel starts well spread.
function poolStmt(env, ch, P) {
  const ids = [...P.ids];
  if (ch === 'christmas') {
    return env.DB.prepare(
      `SELECT t.id, t.grp, t.dur_ms, COALESCE(p.last_played_ms, 0) AS last_played_ms, COALESCE(p.plays, 0) AS plays
         FROM tracks t LEFT JOIN ch_plays p ON p.channel=?1 AND p.track_id=t.id
        WHERE t.id IN (${marks(ids.length)}) ORDER BY 4 ASC, 5 ASC, t.id`
    ).bind(ch, ...ids);
  }
  return env.DB.prepare(
    `SELECT t.id, t.grp, t.dur_ms, COALESCE(NULLIF(p.last_played_ms, 0), t.last_played_ms) AS last_played_ms, COALESCE(p.plays, 0) AS plays
       FROM tracks t LEFT JOIN ch_plays p ON p.channel=?1 AND p.track_id=t.id
      WHERE t.enabled=1 AND t.id NOT IN (${marks(ids.length)}) ORDER BY 4 ASC, 5 ASC LIMIT 150`
  ).bind(ch, ...ids);
}

// Extend a channel so it reaches now + HORIZON_MS (or the end of the Christmas window). Same
// race-safe write as ensureSchedule: the whole plan in ONE transaction, every slot conditional on
// its predecessor, `writer` tags which call wrote which slot.
export async function ensureChannel(env, ch, now = Date.now(), { publish = true, P = null } = {}) {
  P = P || await xmasNow(env, now);
  if (!P || !extraCh(ch)) return 0;
  const until = Math.min(now + HORIZON_MS, P.until);
  let added = 0;
  for (let round = 0; round < 4; round++) {
    const { results: tails } = await env.DB.prepare(
      'SELECT s.seq, s.start_ms, s.dur_ms, s.track_id, t.grp FROM ch_schedule s LEFT JOIN tracks t ON t.id=s.track_id WHERE s.channel=?1 ORDER BY s.seq DESC LIMIT 3'
    ).bind(ch).all();
    const tail = tails[0];
    let start = tail ? Math.max(tail.start_ms + tail.dur_ms + GAP_MS, now) : now;   // quiet channel: start now
    if (start > until) break;

    const [{ results: reqs }, { results: upcoming }, { results: pool }] = await env.DB.batch([
      env.DB.prepare("SELECT r.id, r.track_id, t.dur_ms, t.grp FROM ch_requests r JOIN tracks t ON t.id=r.track_id WHERE r.channel=?1 AND r.status='pending' ORDER BY r.id ASC LIMIT 20").bind(ch),
      env.DB.prepare('SELECT track_id FROM ch_schedule WHERE channel=?1 AND start_ms >= ?2').bind(ch, now - REPEAT_MS),
      poolStmt(env, ch, P),
    ]);
    const exclude = new Set(upcoming.map(u => u.track_id));
    const recent = tails.map(t => t.grp).filter(Boolean);    // newest first
    let pick;
    if (ch === 'christmas') {
      // shuffled rounds: position in the round = all plays of the set on this channel (a running
      // counter in ch_plays, so pruning old history never moves it) mod the number of songs
      const last = new Map(pool.map(t => [t.id, t.last_played_ms || 0]));
      const n = pool.reduce((a, t) => a + (t.plays || 0), 0);
      const H = { hist: [], last, cyc: [{ fid: P.id, ids: new Set(pool.map(t => t.id)), anchor: 0, n }] };
      const fx = { cyc: { fid: P.id, songs: pool, gap: XMAS_GAP_MS } };
      pick = { H, fn: (at) => pickCycle(pool, exclude, recent.slice(0, 3), fx, at, H) };
    } else {
      // other featured periods (not the Christmas one) still apply, as plain boosts
      let F = await loadFeatures(env, start, until + 1);
      if (F) { F.wins = F.wins.filter(w => w.f.id !== P.id); if (!F.wins.length) F = null; }
      pick = { H: null, fn: (at) => {
        const fx = F && featurePlan(F, at);
        if (!fx) return pickRotation(pool, exclude, recent.slice(0, 3));
        const keep = t => !P.ids.has(t.id);
        return pickFeatured(pool, exclude, recent.slice(0, 3), { weight: fx.weight, add: fx.add.filter(keep), only: fx.only.filter(keep) }, at);
      } };
    }
    const plan = [];
    let prev = tail ? { seq: tail.seq, start: tail.start_ms, track: tail.track_id, dur: tail.dur_ms } : null;
    let seq = tail ? tail.seq : 0;
    while (start <= until) {
      let trackId, durMs, grp, requestId = null;
      const rq = reqs.shift();
      if (rq) { trackId = rq.track_id; durMs = rq.dur_ms; grp = rq.grp; requestId = rq.id; }
      else {
        const t = pick.fn(start);
        if (!t) break;
        trackId = t.id; durMs = t.dur_ms; grp = t.grp;
      }
      seq++;
      plan.push({ seq, trackId, start, durMs, requestId, prev });
      prev = { seq, start, track: trackId, dur: durMs };
      exclude.add(trackId);
      recent.unshift(grp);
      histPush(pick.H, trackId, start);
      start += durMs + GAP_MS;
    }
    if (!plan.length) break;

    const writer = crypto.randomUUID();
    const stmts = [];
    for (const p of plan) {
      if (p.prev) {
        stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO ch_schedule(channel, seq, track_id, start_ms, dur_ms, request_id, created_ms, writer)
           SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS (SELECT 1 FROM ch_schedule WHERE channel=?1 AND seq=?9 AND start_ms=?10 AND track_id=?11 AND dur_ms=?12)`
        ).bind(ch, p.seq, p.trackId, p.start, p.durMs, p.requestId, now, writer, p.prev.seq, p.prev.start, p.prev.track, p.prev.dur));
      } else {
        stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO ch_schedule(channel, seq, track_id, start_ms, dur_ms, request_id, created_ms, writer)
           SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE NOT EXISTS (SELECT 1 FROM ch_schedule WHERE channel=?1)`
        ).bind(ch, p.seq, p.trackId, p.start, p.durMs, p.requestId, now, writer));
      }
      // the channel's own memory, only for slots that really landed as planned
      stmts.push(env.DB.prepare(
        `INSERT INTO ch_plays(channel, track_id, last_played_ms, plays)
         SELECT ?1, ?2, ?3, 1 WHERE EXISTS (SELECT 1 FROM ch_schedule WHERE channel=?1 AND seq=?4 AND writer=?5)
         ON CONFLICT(channel, track_id) DO UPDATE SET last_played_ms=excluded.last_played_ms, plays=plays+1`
      ).bind(ch, p.trackId, p.start, p.seq, writer));
      if (p.requestId) {
        stmts.push(env.DB.prepare(
          "UPDATE ch_requests SET status='scheduled', seq=?1 WHERE id=?2 AND EXISTS (SELECT 1 FROM ch_schedule WHERE channel=?3 AND seq=?1 AND writer=?4)"
        ).bind(p.seq, p.requestId, ch, writer));
      }
    }
    const res = await env.DB.batch(stmts);
    let landed = 0;
    for (let i = 0, k = 0; k < plan.length; k++) {
      if (res[i].meta && res[i].meta.changes === 1) landed++;
      i += plan[k].requestId ? 3 : 2;
    }
    added += landed;
    if (landed === plan.length && start > until) break;
  }
  if (added && publish) await publishChannel(env, ch, now);
  return added;
}

// ---------- state + publishing ----------
export async function buildChannelState(env, ch, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT s.seq, s.start_ms, s.dur_ms, s.request_id, s.writer, t.id, t.title, t.artist, t.album, t.art, t.file, t.cat_title, t.cat_artist, t.cat_album
       FROM ch_schedule s JOIN tracks t ON t.id=s.track_id
      WHERE s.channel=?1 AND s.start_ms + s.dur_ms > ?2 ORDER BY s.start_ms ASC LIMIT 80`
  ).bind(ch, now - 3600000).all();
  let items = results.map(r => ({ seq: r.seq, start_ms: r.start_ms, end_ms: r.start_ms + r.dur_ms, is_request: !!r.request_id, track: trackOut(r), _dj: r.writer === 'dj' }));
  let curIdx = items.findIndex(i => i.start_ms <= now && now < i.end_ms);
  if (curIdx < 0) curIdx = items.findIndex(i => i.start_ms > now);
  if (curIdx > 5) items = items.slice(curIdx - 5);
  const dj = new Set(items.filter(i => i._dj).map(i => i.seq));
  for (const i of items) delete i._dj;
  return { now, ch, items, _dj: dj };
}
// Same shape as state/now.json plus "ch". Players poll rev-<id>.json and re-read on change.
export async function publishChannel(env, ch, now = Date.now(), st = null) {
  st = st || await buildChannelState(env, ch, now);
  const out = { now: st.now, ch, items: st.items, generated_ms: now };
  await env.MEDIA.put(stateKey(ch), JSON.stringify(out), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=5' },
  });
  await env.MEDIA.put(revKey(ch), JSON.stringify({ rev: now }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
  });
  return out;
}
// Channels switched off (Christmas Off / its dates over): the channel files say "ch":"mixed" with
// no items, so a player still on the channel asks /api/now?ch=<id>, gets the main timeline
// (also "ch":"mixed") and moves there. Nothing is planned for the channel any more.
export async function publishGone(env, ch, now = Date.now()) {
  await env.MEDIA.put(stateKey(ch), JSON.stringify({ now, ch: 'mixed', items: [], generated_ms: now }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=5' },
  });
  await env.MEDIA.put(revKey(ch), JSON.stringify({ rev: now }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' },
  });
}
// Full channel state (current / next / history), extending it first. null = channels are off.
export async function channelState(env, ch, now = Date.now(), P = null) {
  P = P || await xmasNow(env, now);
  if (!P) return null;
  await ensureChannel(env, ch, now, { P });
  const st = await buildChannelState(env, ch, now);
  delete st._dj;
  const items = st.items;
  let curIdx = items.findIndex(i => i.start_ms <= now && now < i.end_ms);
  if (curIdx < 0) curIdx = items.findIndex(i => i.start_ms > now);
  st.current = items[curIdx] || null;
  st.next = curIdx >= 0 ? items.slice(curIdx + 1, curIdx + 6) : [];
  st.history = curIdx > 0 ? items.slice(Math.max(0, curIdx - 5), curIdx).reverse() : [];
  pruneChannels(env, now);
  return st;
}
export async function pruneChannels(env, now = Date.now()) {
  if (Math.random() < 0.02) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM ch_schedule WHERE start_ms + dur_ms < ?1').bind(now - HISTORY_KEEP_MS),
      env.DB.prepare("DELETE FROM ch_requests WHERE status!='pending' AND created_ms < ?1").bind(now - HISTORY_KEEP_MS),
    ]);
  }
}

// ---------- re-planning (requests, DJ, Control Room changes) ----------
// Drop the part of the channel that hasn't started (keeping the song on air, anything starting
// within lockMs and the DJ's picks), put its requests back in line, then plan again.
export async function replanChannel(env, ch, now = Date.now(), { lockMs = REPLAN_LOCK_MS, P = null } = {}) {
  P = P || await xmasNow(env, now);
  if (!P) return { ok: false, dropped: 0 };
  await ensureChannel(env, ch, now, { publish: false, P });
  const cut = await env.DB.prepare(
    `SELECT seq, start_ms FROM ch_schedule WHERE channel=?1 AND start_ms >= ?2
       AND seq > COALESCE((SELECT MAX(seq) FROM ch_schedule WHERE channel=?1 AND writer='dj'), 0)
     ORDER BY seq ASC LIMIT 1`
  ).bind(ch, now + lockMs).first();
  let dropped = [];
  if (cut) {
    ({ results: dropped } = await env.DB.prepare('SELECT seq, track_id, request_id FROM ch_schedule WHERE channel=?1 AND seq >= ?2').bind(ch, cut.seq).all());
    const stmts = [env.DB.prepare('DELETE FROM ch_schedule WHERE channel=?1 AND seq >= ?2').bind(ch, cut.seq)];
    for (const d of dropped) {
      if (d.request_id) stmts.push(env.DB.prepare("UPDATE ch_requests SET status='pending', seq=NULL WHERE id=?1").bind(d.request_id));
      stmts.push(unplay(env, ch, d.track_id, cut.seq - 1));
    }
    await env.DB.batch(stmts);
  }
  const added = await ensureChannel(env, ch, now, { publish: false, P });
  const state = await publishChannel(env, ch, now);
  return { ok: true, dropped: dropped.length, added, state, from_ms: cut ? cut.start_ms : null };
}
// a dropped slot no longer counts: one play less, last played = its latest slot still on the books
const unplay = (env, ch, trackId, uptoSeq) => env.DB.prepare(
  `UPDATE ch_plays SET plays = MAX(plays-1,0), last_played_ms = COALESCE(
     (SELECT MAX(start_ms) FROM ch_schedule WHERE channel=?1 AND track_id=?2 AND seq <= ?3), 0)
   WHERE channel=?1 AND track_id=?2`
).bind(ch, trackId, uptoSeq);

// After the Control Room changed something that rotation depends on (the Christmas switch, a
// featured period, a song switched off): channels that are off get the "moved" file once; channels
// that are on and have songs coming up are re-planned. A channel nobody listens to costs a read.
export async function channelsChanged(env, now = Date.now()) {
  let P;
  try { P = await xmasNow(env, now); } catch (e) { return {}; }
  const out = {};
  for (const ch of EXTRA) {
    let live;
    try { live = await env.DB.prepare('SELECT MAX(start_ms + dur_ms) e FROM ch_schedule WHERE channel=?1').bind(ch).first(); }
    catch (e) { return out; }                       // tables not there yet
    if (!live || !(live.e > now)) { out[ch] = 'idle'; continue; }
    if (!P) { await publishGone(env, ch, now); out[ch] = 'gone'; continue; }
    const r = await replanChannel(env, ch, now, { P });
    out[ch] = r.dropped ? 'replanned' : 'kept';
  }
  return out;
}

// ---------- DJ on a channel (website DJ panel, Control Room booth) ----------
// Same moves as djPlace in ./_lib.js on the channel's own timeline.
export async function djPlaceChannel(env, ch, trackId, mode = 'now', now = Date.now(), P = null) {
  P = P || await xmasNow(env, now);
  if (!P) return { ok: false, off: true, message: 'The Christmas channels are off right now.' };
  await ensureChannel(env, ch, now, { publish: false, P });
  let track = null;
  if (trackId) {
    track = await songOnChannel(env, ch, trackId, P);
    if (!track) return { ok: false, message: "That song isn't on this channel." };
  }
  const cur = await env.DB.prepare(
    'SELECT seq, start_ms, dur_ms, track_id FROM ch_schedule WHERE channel=?1 AND start_ms <= ?2 AND start_ms + dur_ms > ?2 ORDER BY seq DESC LIMIT 1'
  ).bind(ch, now).first();
  if (!cur) return { ok: false, message: 'The channel is starting, try again in a moment.' };
  const curEnd = cur.start_ms + cur.dur_ms;
  let at = curEnd, cut = null;
  if (mode === 'now' && curEnd > now + DJ_LEAD_MS) { at = now + DJ_LEAD_MS; cut = at - cur.start_ms; }
  if (!track && cut === null) return { ok: true, at, message: 'The next song is about to start.', state: await publishChannel(env, ch, now) };
  if (!track) {
    const shift = curEnd - at;
    await env.DB.batch([
      env.DB.prepare('UPDATE ch_schedule SET dur_ms=?1 WHERE channel=?3 AND seq=?2').bind(cut, cur.seq, ch),
      env.DB.prepare('UPDATE ch_schedule SET start_ms = start_ms - ?1 WHERE channel=?3 AND seq > ?2').bind(shift, cur.seq, ch),
      env.DB.prepare(`UPDATE ch_plays SET last_played_ms = last_played_ms - ?1
                        WHERE channel=?3 AND track_id IN (SELECT track_id FROM ch_schedule WHERE channel=?3 AND seq > ?2)
                          AND last_played_ms = (SELECT MAX(s.start_ms) + ?1 FROM ch_schedule s WHERE s.channel=?3 AND s.track_id = ch_plays.track_id)`).bind(shift, cur.seq, ch),
    ]);
    await ensureChannel(env, ch, now, { publish: false, P });
    return { ok: true, at, state: await publishChannel(env, ch, now) };
  }
  const { results: dropped } = await env.DB.prepare('SELECT seq, track_id, request_id FROM ch_schedule WHERE channel=?1 AND seq > ?2').bind(ch, cur.seq).all();
  const stmts = [env.DB.prepare('DELETE FROM ch_schedule WHERE channel=?1 AND seq > ?2').bind(ch, cur.seq)];
  for (const d of dropped) {
    if (d.request_id) stmts.push(env.DB.prepare("UPDATE ch_requests SET status='pending', seq=NULL WHERE id=?1").bind(d.request_id));
    stmts.push(unplay(env, ch, d.track_id, cur.seq));
  }
  if (cut !== null) stmts.push(env.DB.prepare('UPDATE ch_schedule SET dur_ms=?1 WHERE channel=?3 AND seq=?2').bind(cut, cur.seq, ch));
  stmts.push(env.DB.prepare(
    "INSERT INTO ch_schedule(channel, seq, track_id, start_ms, dur_ms, request_id, created_ms, writer) VALUES (?1,?2,?3,?4,?5,NULL,?6,'dj')"
  ).bind(ch, cur.seq + 1, track.id, at, track.dur_ms, now));
  stmts.push(env.DB.prepare(
    `INSERT INTO ch_plays(channel, track_id, last_played_ms, plays) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(channel, track_id) DO UPDATE SET last_played_ms=excluded.last_played_ms, plays=plays+1`
  ).bind(ch, track.id, at));
  await env.DB.batch(stmts);
  await ensureChannel(env, ch, now, { publish: false, P });
  return { ok: true, at, state: await publishChannel(env, ch, now) };
}

// ---------- listener requests on a channel ----------
// Called by /api/request after the spam check and the (shared) rate limits.
export async function requestOnChannel(env, ch, trackId, who, now = Date.now(), P = null) {
  P = P || await xmasNow(env, now);
  if (!P) return null;                                     // channels off: the caller uses the main timeline
  const t = await songOnChannel(env, ch, trackId, P);
  if (!t || !t.requestable) return { status: 404, body: { ok: false, message: ch === 'christmas' ? 'Only Christmas songs can be requested on this channel.' : (P.ids.has(trackId) ? 'There are no Christmas songs on this channel.' : 'Unknown song.') } };
  const st = (await channelStatus(env, ch, now, [trackId])).get(trackId) || 'ok';
  if (st === 'upcoming') return { status: 409, body: { ok: false, message: 'That song is already coming up soon.' } };
  if (st === 'recent') return { status: 409, body: { ok: false, message: 'That song was played recently. Please pick another one.' } };
  const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM ch_requests WHERE channel=?1 AND status='pending'").bind(ch).first();
  if ((pend?.n || 0) >= MAX_PENDING) return { status: 429, body: { ok: false, message: 'The request line is full right now. Please try again in a little while.' } };
  const ins = await env.DB.prepare(
    "INSERT INTO ch_requests(channel, track_id, ip_hash, created_ms, status) VALUES (?1,?2,?3,?4,'pending') RETURNING id"
  ).bind(ch, trackId, who, now).first();
  await replanChannel(env, ch, now, { P });
  const slot = await env.DB.prepare('SELECT s.start_ms FROM ch_schedule s JOIN ch_requests r ON r.seq=s.seq AND r.channel=s.channel WHERE r.id=?1').bind(ins.id).first();
  const mins = slot ? Math.max(0, Math.round((slot.start_ms - now) / 60000)) : null;
  const when = mins === null ? 'soon' : mins <= 1 ? 'in about a minute' : `in about ${mins} minutes`;
  const state = await channelState(env, ch, now, P);
  return { status: 200, body: { ok: true, message: `Your request has been submitted and will play ${when}.`, starts_ms: slot?.start_ms || null, ch, state } };
}
// Request availability on a channel, from that channel's own timeline only: id -> 'upcoming' | 'recent'
// (songs not in the map are 'ok').
//   classic   - like the main timeline: planned in the next 2 h or already requested = upcoming,
//               played in the last 4 h = recent
//   christmas - every song comes round every ~45 min, so: requested, or starting within 15 min =
//               upcoming; started within the last 15 min = recent (about a third of the songs are
//               requestable at any moment; a request moves the song up to right after the lock)
export async function channelStatus(env, ch, now = Date.now(), ids = null) {
  const out = new Map();
  const { results: pend } = await env.DB.prepare("SELECT DISTINCT track_id FROM ch_requests WHERE channel=?1 AND status='pending'").bind(ch).all();
  for (const p of pend) out.set(p.track_id, 'upcoming');
  const only = ids ? ` AND track_id IN (${ids.map((_, i) => '?' + (i + 3)).join(',')})` : '';   // ?1, ?2 are taken
  if (ch === 'christmas') {
    const { results } = await env.DB.prepare(
      `SELECT track_id, MAX(CASE WHEN start_ms <= ?2 THEN start_ms END) AS past, MIN(CASE WHEN start_ms > ?2 THEN start_ms END) AS nxt
         FROM ch_schedule WHERE channel='christmas' AND start_ms >= ?1${only} GROUP BY track_id`
    ).bind(now - XMAS_REQ_MS, now, ...(ids || [])).all();
    for (const r of results) {
      if (out.has(r.track_id)) continue;
      if (r.nxt != null && r.nxt <= now + XMAS_REQ_MS) out.set(r.track_id, 'upcoming');
      else if (r.past != null) out.set(r.track_id, 'recent');
    }
    return out;
  }
  const { results } = await env.DB.prepare(
    `SELECT track_id, last_played_ms AS lp FROM ch_plays WHERE channel=?1 AND last_played_ms > ?2${only}`
  ).bind(ch, now - NO_REPEAT_TRACK_MS, ...(ids || [])).all();
  for (const r of results) if (!out.has(r.track_id)) out.set(r.track_id, r.lp > now ? 'upcoming' : 'recent');
  return out;
}
