import { json } from '../_lib.js';
import { countStatement, countsFrom, cleanupStatements, minuteSnapshot } from '../_listeners.js';

// GET /api/listeners -> {now, total, web, ios, android}: players seen in the last 150 s.
// Cached at the edge for 15 s, so however many pages poll, D1 sees about one read per
// data center every 15 s. A cache miss also does the housekeeping (stale sessions, the
// per-minute totals) so it happens even when no player is pinging.
const TTL = 15;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL('/api/listeners', request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const now = Date.now();
  const { results } = await countStatement(env, now).all();
  const res = json({ now, ...countsFrom(results) }, 200, { 'cache-control': `public, max-age=10, s-maxage=${TTL}` });
  waitUntil(cache.put(key, res.clone()));
  const house = cleanupStatements(env, now);
  const snap = minuteSnapshot(env, now);
  if (snap) house.unshift(snap);
  waitUntil(env.DB.batch(house).catch(() => {}));
  return res;
}

export async function onRequest() {
  return json({ ok: false, message: 'Use GET.' }, 405, { allow: 'GET' });
}
