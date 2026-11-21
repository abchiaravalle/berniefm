import { json, MEDIA, NO_REPEAT_TRACK_MS, artHd } from '../_lib.js';
import { extraCh, xmasNow, channelStatus } from '../_channels.js';

// Requestable songs with availability. Edge-cached 30s.
// ?ch=christmas|classic (2026-11-21): the songs that can be requested on that Christmas channel, with
// availability on that channel (christmas: only the Christmas songs; classic: everything but them).
// No ch, or the channels are off: the list as before.
export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const bucket = Math.floor(Date.now() / 30000);
  const ch = extraCh(url.searchParams.get('ch'));
  const cacheKey = new Request(`${url.origin}/api/library?b=${bucket}${ch ? '&ch=' + ch : ''}`, { method: 'GET' });
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const now = Date.now();
  const P = ch ? await xmasNow(env, now) : null;
  let songs;
  if (P) songs = await channelSongs(env, ch, P, now);
  else {
    const { results } = await env.DB.prepare(
      `SELECT id, COALESCE(cat_title, title) AS title, COALESCE(cat_artist, artist) AS artist, COALESCE(cat_album, album) AS album,
              art, dur_ms, last_played_ms FROM tracks WHERE enabled=1 AND requestable=1 ORDER BY 2 COLLATE NOCASE`
    ).all();
    const { results: pend } = await env.DB.prepare(
      "SELECT DISTINCT track_id FROM requests WHERE status='pending'"
    ).all();
    const pending = new Set(pend.map(p => p.track_id));
    songs = results.map(t => {
      let status = 'ok';
      if (pending.has(t.id) || t.last_played_ms > now) status = 'upcoming';
      else if (t.last_played_ms > now - NO_REPEAT_TRACK_MS) status = 'recent';
      return out(t, status);
    });
  }
  const res = json(P ? { ch, songs } : { songs }, 200, { 'cache-control': 'public, max-age=30' });
  waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

const out = (t, status) => ({
  id: t.id, title: t.title, artist: t.artist || 'Bernie Chiaravalle', album: t.album || '',
  art: t.art ? MEDIA + t.art : MEDIA + 'art/default.jpg', art_hd: artHd(t.art), duration: Math.round(t.dur_ms / 1000), status,
});

async function channelSongs(env, ch, P, now) {
  const ids = [...P.ids];
  const mk = ids.map((_, i) => '?' + (i + 1)).join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, COALESCE(cat_title, title) AS title, COALESCE(cat_artist, artist) AS artist, COALESCE(cat_album, album) AS album,
            art, dur_ms FROM tracks WHERE requestable=1 AND ${ch === 'christmas' ? `id IN (${mk})` : `enabled=1 AND id NOT IN (${mk})`}
      ORDER BY 2 COLLATE NOCASE`
  ).bind(...ids).all();
  const st = await channelStatus(env, ch, now);
  return results.map(t => out(t, st.get(t.id) || 'ok'));
}
