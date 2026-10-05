import { ensureSchedule } from '../_lib.js';

// Continuous MP3 stream that follows the same shared timeline as the website.
// Keeps the old AzuraCast URL working for anything that has it saved
// (https://stream.bcradio.net/listen/bcradio/radio.mp3): VLC, iTunes, smart
// speakers, radio apps. Joins the current track at the live position (cut on an
// MP3 frame boundary), then pipes each scheduled track from R2 in order, paced
// to real time.

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
const BURST_S = 8;                  // send this much audio at once so players start fast

// Find the first real MPEG frame header at/after `from` for our CBR 128k/44.1k files.
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

  // Byte-paced pipe: a burst up front so the player starts quickly, then real
  // time (128 kbps), so this stream stays on the same clock as the website.
  const { readable, writable } = new TransformStream();
  const BPS = 16000;
  const pump = async () => {
    const w = writable.getWriter();
    const t0 = Date.now();
    let sent = 0;
    try {
      let first = true;
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
        if (obj && obj.body) {
          const rd = obj.body.getReader();
          let aligned = !opts;
          for (;;) {
            const { value, done } = await rd.read();
            if (done) break;
            let chunk = value;
            if (!aligned) {
              const i = frameStart(chunk);
              if (i < 0) continue;
              chunk = chunk.subarray(i); aligned = true;
            }
            await w.write(chunk);
            sent += chunk.length;
            const ahead = sent / BPS - (Date.now() - t0) / 1000 - BURST_S;
            if (ahead > 0.5) await sleep(ahead * 1000);
          }
        }
        await ensureSchedule(env, Date.now());
        row = await env.DB.prepare(`${ROW} WHERE s.seq > ?1 ORDER BY s.seq ASC LIMIT 1`).bind(row.seq).first();
      }
    } catch (e) {
      // listener went away or a read failed: end the stream
    }
    try { await w.close(); } catch (e) {}
  };
  pump();
  return new Response(readable, { headers: HEADERS });
}
