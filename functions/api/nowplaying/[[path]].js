import { json, stationState } from '../../_lib.js';

// AzuraCast-compatible now-playing shape, so anything still pointed at the old
// stream.bcradio.net API (cached pages, widgets, apps) keeps working.
//   /api/nowplaying          -> [station]
//   /api/nowplaying/bcradio  -> station
//   /api/nowplaying/1        -> station
function song(item) {
  const t = item.track;
  return {
    id: t.id, art: t.art, custom_fields: [], text: `${t.artist} - ${t.title}`,
    artist: t.artist, title: t.title, album: t.album, genre: '', isrc: '', lyrics: '',
  };
}
function entry(item) {
  return {
    sh_id: item.seq, played_at: Math.floor(item.start_ms / 1000),
    duration: Math.round((item.end_ms - item.start_ms) / 1000), playlist: 'BC Playlist',
    streamer: '', is_request: item.is_request, song: song(item),
  };
}
export async function onRequestGet({ request, env, params }) {
  const s = await stationState(env);
  const origin = 'https://stream.bcradio.net';
  const nowSec = Math.floor(s.now / 1000);
  const cur = s.current;
  const station = {
    station: {
      id: 1, name: 'BCRadio', shortcode: 'bcradio', description: '', frontend: 'bcradio-sync', backend: 'cloudflare',
      timezone: 'UTC', listen_url: `${origin}/listen/bcradio/radio.mp3`, url: 'https://bcradio.net', public_player_url: 'https://bcradio.net',
      playlist_pls_url: '', playlist_m3u_url: '', is_public: true,
      mounts: [{ id: 1, name: '/radio.mp3', url: `${origin}/listen/bcradio/radio.mp3`, bitrate: 128, format: 'mp3',
        listeners: { total: 0, unique: 0, current: 0 }, path: '/radio.mp3', is_default: true }],
      remotes: [], hls_enabled: false, hls_is_default: false, hls_url: null, hls_listeners: 0,
    },
    listeners: { total: 0, unique: 0, current: 0 },
    live: { is_live: false, streamer_name: '', broadcast_start: null, art: null },
    now_playing: cur ? { ...entry(cur), elapsed: Math.max(0, nowSec - Math.floor(cur.start_ms / 1000)),
      remaining: Math.max(0, Math.floor(cur.end_ms / 1000) - nowSec) } : null,
    playing_next: s.next[0] ? { cued_at: Math.floor(s.next[0].start_ms / 1000) - 30, ...entry(s.next[0]) } : null,
    song_history: s.history.map(entry),
    is_online: true,
    cache: null,
  };
  const p = params.path;
  const sub = Array.isArray(p) ? p.join('/') : (p || '');
  if (sub) {
    if (sub === 'bcradio' || sub === '1') return json(station);
    return json({ code: 404, type: 'NotFound', message: 'Station not found.' }, 404);
  }
  return json([station]);
}
