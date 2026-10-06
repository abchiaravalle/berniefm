import { json, MEDIA } from '../_lib.js';

// Every song, organized: sections > albums > tracks (track order, cover art).
// Built from the catalog columns on `tracks` (written by publish_catalog.py).
// Public data (same songs as the request list). Edge-cached 60 s.
const ORDER = ['Albums', 'Singles', 'Silent Partner', 'Collaborations', 'Rarities & demos'];

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/api/catalog?b=${Math.floor(Date.now() / 60000)}`, { method: 'GET' });
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const { results } = await env.DB.prepare(
    `SELECT id, title, artist, album, art, dur_ms, cat_section, cat_album, cat_no, cat_title, cat_artist, cat_year
       FROM tracks WHERE enabled=1`
  ).all();
  const albums = new Map();
  for (const t of results) {
    const sec = t.cat_section || 'Rarities & demos';
    const name = t.cat_album || t.album || 'Rarities';
    const k = sec + '|' + name;
    if (!albums.has(k)) albums.set(k, { section: sec, name, year: null, artists: {}, arts: {}, tracks: [] });
    const a = albums.get(k);
    const artist = t.cat_artist || t.artist || 'Bernie Chiaravalle';
    const art = t.art ? MEDIA + t.art : MEDIA + 'art/default.jpg';
    a.artists[artist] = (a.artists[artist] || 0) + 1;
    a.arts[art] = (a.arts[art] || 0) + 1;
    if (t.cat_year && (!a.year || t.cat_year > a.year)) a.year = t.cat_year;
    a.tracks.push({ id: t.id, title: t.cat_title || t.title, artist, no: t.cat_no, dur: Math.round(t.dur_ms / 1000), art });
  }
  const top = o => Object.entries(o).sort((x, y) => y[1] - x[1])[0][0];
  const sections = ORDER.map(name => ({ name, albums: [] }));
  for (const a of albums.values()) {
    const singles = a.name === 'Singles';
    a.tracks.sort((x, y) => singles ? x.title.localeCompare(y.title)
      : ((x.no ?? 1e9) - (y.no ?? 1e9)) || x.title.localeCompare(y.title));
    const out = { name: a.name, artist: top(a.artists), year: a.year, art: top(a.arts), tracks: a.tracks };
    (sections.find(s => s.name === a.section) || sections[sections.length - 1]).albums.push(out);
  }
  for (const s of sections) {
    s.albums.sort((x, y) => s.name === 'Albums'
      ? (Number(y.year || 0) - Number(x.year || 0)) || x.name.localeCompare(y.name)
      : x.name.localeCompare(y.name));
  }
  const res = json({ count: results.length, sections: sections.filter(s => s.albums.length) }, 200,
    { 'cache-control': 'public, max-age=60' });
  waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}
