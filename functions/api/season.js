import { json, featureWindows } from '../_lib.js';

// GET /api/season -> which seasonal look the apps and the website should show.
//   {"theme":"christmas","until_ms":<end of the current window, UTC ms>}
//     while a featured period whose name matches /christmas|holiday/i is ON right now
//     (switched on, not paused or deleted, and now is inside one of its windows; yearly
//     periods repeat), else {"theme":null}.
// The period is the one made in the Control Room ("Featured times"), so pausing or deleting it
// there switches the look off everywhere within 5 minutes. Public, no auth, edge-cached 300 s
// (one D1 read per data center every 5 minutes, however many players ask).
const TTL = 300;
const NAME = /christmas|holiday/i;

export async function seasonNow(env, now = Date.now()) {
  let rows = [];
  try {
    ({ results: rows } = await env.DB.prepare(
      'SELECT id, name, start_ms, end_ms, yearly, tz, start_local, end_local FROM features WHERE active=1 AND deleted_ms IS NULL AND (yearly=1 OR (start_ms <= ?1 AND end_ms > ?1))'
    ).bind(now).all());
  } catch (e) {
    return { theme: null };               // tables missing: no seasonal look
  }
  let until = 0;
  for (const f of rows || []) {
    if (!NAME.test(f.name || '')) continue;
    let wins = [];
    try { wins = featureWindows(f, now, now + 1); } catch (e) { continue; }   // bad time zone: skip
    for (const [a, b] of wins) if (a <= now && now < b && b > until) until = b;
  }
  return until ? { theme: 'christmas', until_ms: until } : { theme: null };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/season', request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = json(await seasonNow(env), 200, { 'cache-control': `public, s-maxage=${TTL}` });
  waitUntil(cache.put(key, res.clone()));
  return res;
}

export async function onRequest() {
  return json({ ok: false, message: 'Use GET.' }, 405, { allow: 'GET' });
}
