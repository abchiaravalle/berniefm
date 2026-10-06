import { ensureSchedule, publishState, MEDIA, STATE_KEY } from '../_lib.js';

// Continuous MP3 stream that follows the same shared timeline as the website.
// Keeps the old AzuraCast URL working for anything that has it saved
// (https://stream.bcradio.net/listen/bcradio/radio.mp3): VLC, iTunes, smart
// speakers, radio apps. Joins the current track at the live position (cut on an
// MP3 frame boundary), then follows the timeline song by song, paced to real time.
//
// Alignment: the stream tracks the timeline time of the next byte it sends
// ("content time"). At every song change it picks whatever the timeline has on
// air at that content time and seeks into it if needed, so a DJ cut, a skip or
// a re-plan can never leave it permanently out of step. While a song plays it
// re-reads the timeline every 30 s, so a song cut short by the DJ stops on time.
//
// Call budget (free plan: 1000 internal calls per invocation): ~2 per song plus
// 1 per 30 s. Connections end after MAX_MS; players reconnect on their own.

const HEADERS = {
  'content-type': 'audio/mpeg',
  'cache-control': 'no-store, no-cache, private',
  'access-control-allow-origin': '*',
  'icy-name': 'BCRadio',
  'icy-description': 'Rarities & Classics from Bernie Chiaravalle',
  'icy-url': 'https://bcradio.net',
  'icy-br': '128',
  'icy-pub': '0',
  'x-content-type-options': 'nosniff',
};
const BPS = 16000;                  // CBR 128 kbps
const BURST_S = 8;                  // send this much audio at once so players start fast
const MAX_MS = 4 * 3600 * 1000;     // ~4 h per connection
const LOW_WATER_MS = 10 * 60000;    // extend the schedule when < 10 min is planned ahead
const RECHECK_MS = 30000;

function frameStart(buf, from = 0) {
  for (let i = from; i < buf.length - 4; i++) {
    if (buf[i] === 0xFF && (buf[i + 1] & 0xE0) === 0xE0) {
      const b1 = buf[i + 1], b2 = buf[i + 2];
      const version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, br = b2 >> 4, sr = (b2 >> 2) & 3;
      if (version === 3 && layer === 1 && br !== 0 && br !== 15 && sr !== 3) {
        const len = Math.floor(144 * 128000 / 44100) + ((b2 >> 1) & 1);
        if (i + len + 1 < buf.length && buf[i + len] === 0xFF && (buf[i + len + 1] & 0xE0) === 0xE0) return i;
      }
    }
  }
  return -1;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = item => item.track.url.slice(MEDIA.length);

async function readTimeline(env) {
  try {
    const o = await env.MEDIA.get(STATE_KEY);
    if (!o) return [];
    const s = await o.json();
    return Array.isArray(s.items) ? s.items : [];
  } catch (e) {
    return [];
  }
}
async function timeline(env, horizonFrom) {
  let items = await readTimeline(env);
  const lastEnd = items.length ? items[items.length - 1].end_ms : 0;
  if (lastEnd - horizonFrom < LOW_WATER_MS) {
    const now = Date.now();
    await ensureSchedule(env, now);
    items = await readTimeline(env);
    const le = items.length ? items[items.length - 1].end_ms : 0;
    if (le - horizonFrom < LOW_WATER_MS) items = (await publishState(env, now)).items;
  }
  return items;
}
const itemAt = (items, t) => items.find(i => i.start_ms <= t && t < i.end_ms) || items.find(i => i.start_ms > t) || null;

export async function onRequest({ request, env, params }) {
  const p = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  if (!/\.mp3$/i.test(p)) return new Response('Not found', { status: 404 });
  if (request.method === 'HEAD' || request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const t0 = Date.now();
  let items = await timeline(env, t0);
  if (!itemAt(items, t0)) return new Response('Station starting, try again', { status: 503 });

  const { readable, writable } = new TransformStream();
  const pump = async () => {
    const w = writable.getWriter();
    let content = t0;          // timeline time of the next byte we send
    let sent = 0;
    try {
      while (Date.now() - t0 < MAX_MS) {
        let item = itemAt(items, content);
        if (!item) { items = await timeline(env, content); item = itemAt(items, content); if (!item) break; }
        if (item.start_ms > content) content = item.start_ms;            // idle gap: jump ahead
        const into = content - item.start_ms;
        if (item.end_ms - content < 1500) {                              // ~nothing left of this one
          content = item.end_ms; continue;
        }
        let limit = Math.floor((item.end_ms - item.start_ms) / 1000 * BPS);   // bytes of this item on air
        let off = Math.floor(into / 1000 * BPS);
        const obj = await env.MEDIA.get(keyOf(item), off > 8192 ? { range: { offset: off } } : undefined);
        if (off <= 8192) off = 0;
        let pos = off, aligned = off === 0, lastCheck = Date.now();
        if (obj && obj.body) {
          const rd = obj.body.getReader();
          for (;;) {
            const { value, done } = await rd.read();
            if (done) break;
            let chunk = value;
            if (!aligned) {
              const i = frameStart(chunk);
              if (i < 0) { pos += chunk.length; continue; }
              pos += i; chunk = chunk.subarray(i); aligned = true;
            }
            if (pos + chunk.length > limit) chunk = chunk.subarray(0, Math.max(0, limit - pos));
            if (chunk.length) {
              await w.write(chunk);
              pos += chunk.length; sent += chunk.length;
            }
            if (pos >= limit) { try { await rd.cancel(); } catch (e) {} break; }
            const ahead = sent / BPS - (Date.now() - t0) / 1000 - BURST_S;
            if (ahead > 0.5) await sleep(ahead * 1000);
            if (Date.now() - lastCheck > RECHECK_MS) {                 // DJ cut / re-plan?
              lastCheck = Date.now();
              items = await readTimeline(env);
              const same = items.find(i => i.seq === item.seq && i.start_ms === item.start_ms);
              if (same) limit = Math.floor((same.end_ms - same.start_ms) / 1000 * BPS);
            }
          }
        }
        content = item.start_ms + Math.round(pos / BPS * 1000);
        items = await timeline(env, content);
      }
    } catch (e) {
      // listener went away or a read failed: end the stream
    }
    try { await w.close(); } catch (e) {}
  };
  pump();
  return new Response(readable, { headers: HEADERS });
}
