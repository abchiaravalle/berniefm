import { json, MEDIA } from '../../_lib.js';

// Old AzuraCast request API, for pages still cached from the AzuraCast era
// (they call https://stream.bcradio.net/api/station/1/requests and
//  .../request/<id>). Listing still works, in the old shape; submitting asks the
// listener to refresh, because new requests go through the spam check on the
// current page.
//   GET  /api/station/1/requests          -> AzuraCast-shaped song list
//   POST /api/station/1/request/<id>      -> 400 "please refresh"
//   anything else under /api/station/     -> 404
export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path || ''];
  const [station, what] = parts;
  if (!['1', 'bcradio'].includes(station)) {
    return json({ code: 404, type: 'NotFound', message: 'Station not found.' }, 404);
  }
  if (what === 'requests' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, title, artist, album, art FROM tracks WHERE enabled=1 AND requestable=1 ORDER BY title COLLATE NOCASE'
    ).all();
    return json(results.map(t => ({
      request_id: t.id,
      request_url: `/api/station/1/request/${t.id}`,
      song: {
        id: t.id, art: t.art ? MEDIA + t.art : MEDIA + 'art/default.jpg', custom_fields: [],
        text: `${t.artist || 'Bernie Chiaravalle'} - ${t.title}`, artist: t.artist || 'Bernie Chiaravalle',
        title: t.title, album: t.album || '', genre: '', isrc: '', lyrics: '',
      },
    })), 200, { 'cache-control': 'public, max-age=60' });
  }
  if (what === 'request') {
    const msg = 'BC Radio has been updated. Please refresh the page, then make your request again.';
    return json({ code: 400, type: 'Updated', message: msg, formatted_message: msg, success: false }, 400);
  }
  return json({ code: 404, type: 'NotFound', message: 'Not found.' }, 404);
}
