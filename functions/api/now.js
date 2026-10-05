import { json, stationState } from '../_lib.js';

// Station timeline: current item (absolute start/end ms), next items, recent
// history. Absolute times make the payload cacheable: every client computes its
// own offset from /api/time. Edge-cached in 10s buckets so many listeners share
// one D1 read.
export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const bucket = Math.floor(Date.now() / 10000);
  const cacheKey = new Request(`${url.origin}/api/now?b=${bucket}`, { method: 'GET' });
  const cache = caches.default;
  const fresh = url.searchParams.has('fresh');
  if (!fresh) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const state = await stationState(env);
  const res = json(state, 200, { 'cache-control': 'public, max-age=10' });
  if (!fresh) waitUntil(cache.put(cacheKey, res.clone()));
  return new Response(res.body, { status: 200, headers: { ...Object.fromEntries(res.headers), 'cache-control': 'no-store' } });
}
