import { json, MEDIA, NO_REPEAT_TRACK_MS } from '../_lib.js';

// Requestable songs with availability. Edge-cached 30s.
export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const bucket = Math.floor(Date.now() / 30000);
  const cacheKey = new Request(`${url.origin}/api/library?b=${bucket}`, { method: 'GET' });
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT id, COALESCE(cat_title, title) AS title, COALESCE(cat_artist, artist) AS artist, COALESCE(cat_album, album) AS album,
            art, dur_ms, last_played_ms FROM tracks WHERE enabled=1 AND requestable=1 ORDER BY 2 COLLATE NOCASE`
  ).all();
  const { results: pend } = await env.DB.prepare(
    "SELECT DISTINCT track_id FROM requests WHERE status='pending'"
  ).all();
  const pending = new Set(pend.map(p => p.track_id));
  const songs = results.map(t => {
    let status = 'ok';
    if (pending.has(t.id) || t.last_played_ms > now) status = 'upcoming';
    else if (t.last_played_ms > now - NO_REPEAT_TRACK_MS) status = 'recent';
    return {
      id: t.id, title: t.title, artist: t.artist || 'Bernie Chiaravalle', album: t.album || '',
      art: t.art ? MEDIA + t.art : MEDIA + 'art/default.jpg', duration: Math.round(t.dur_ms / 1000), status,
    };
  });
  const res = json({ songs }, 200, { 'cache-control': 'public, max-age=30' });
  waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}
