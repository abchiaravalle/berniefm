import { ensureSchedule } from '../_lib.js';

// Continuous MP3 stream that follows the same shared timeline as the website.
// Keeps the old AzuraCast URL working for anything that has it saved
// (https://stream.bcradio.net/listen/bcradio/radio.mp3): VLC, iTunes, smart
// speakers, radio apps. Joins the current track at the live position, then
// pipes each scheduled track from R2 in order. Pace is set by the player's own
// reads (stream backpressure); we also idle if a player races far ahead.

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
const ROW = 'SELECT s.seq, s.start_ms, s.dur_ms, t.file, t.bytes FROM schedule s JOIN tracks t ON t.id=s.track_id';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_TRACKS = 300;   // roughly a day per connection; players reconnect

export async function onRequest({ request, env, params }) {
  const p = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  if (!/\.mp3$/i.test(p)) return new Response('Not found', { status: 404 });
  if (request.method === 'HEAD' || request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const now = Date.now();
  await ensureSchedule(env, now);
  let row = await env.DB.prepare(`${ROW} WHERE s.start_ms <= ?1 ORDER BY s.seq DESC LIMIT 1`).bind(now).first();
  if (!row) return new Response('Station starting, try again', { status: 503 });

  const { readable, writable } = new TransformStream();
  const pump = async () => {
    let first = true;
    try {
      for (let n = 0; n < MAX_TRACKS && row; n++) {
        let opts;
        if (first) {
          first = false;
          const frac = (Date.now() - row.start_ms) / row.dur_ms;
          if (frac > 0.98) {
            row = await env.DB.prepare(`${ROW} WHERE s.seq > ?1 ORDER BY s.seq ASC LIMIT 1`).bind(row.seq).first();
            n--; continue;
          }
          const off = Math.floor(row.bytes * Math.max(0, frac));
          if (off > 8192) opts = { range: { offset: off } };
        }
        const obj = await env.MEDIA.get(row.file, opts);
        if (obj && obj.body) await obj.body.pipeTo(writable, { preventClose: true });
        let lead = row.start_ms + row.dur_ms - Date.now();
        while (lead > 90000) {           // player is buffering far ahead: wait in short steps
          await sleep(Math.min(lead - 45000, 30000));
          lead = row.start_ms + row.dur_ms - Date.now();
        }
        await ensureSchedule(env, Date.now());
        row = await env.DB.prepare(`${ROW} WHERE s.seq > ?1 ORDER BY s.seq ASC LIMIT 1`).bind(row.seq).first();
      }
    } catch (e) {
      // listener went away or a read failed: end the stream
    }
    try { await writable.close(); } catch (e) {}
  };
  pump();
  return new Response(readable, { headers: HEADERS });
}
