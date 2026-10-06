import { json, ipHash, limited, djPlace, DJ_LEAD_MS } from '../../_lib.js';

// Owner-only DJ controls. The secret tap sequence on the site only opens the
// panel; every action here needs a device token from /api/dj/unlock, which needs
// the DJ code (env DJ_CODE). Changing DJ_CODE signs every device out.
//   POST /api/dj/unlock  {code}                      -> {ok, token}
//   POST /api/dj/check   {token}                     -> {ok}
//   POST /api/dj/play    {token, id, mode:'now'|'next'} -> {ok, at, state}
//   POST /api/dj/skip    {token}                     -> {ok, at, state}

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function tokenOk(env, token) {
  if (!env.DJ_CODE || typeof token !== 'string' || token.length > 200) return false;
  const [exp, sig] = token.split('.');
  if (!/^\d{13}$/.test(exp || '') || +exp < Date.now()) return false;
  return same(sig, await sign(env.DJ_CODE, 'bcdj|' + exp));
}

export async function onRequestPost({ request, env, params }) {
  const action = (Array.isArray(params.path) ? params.path[0] : params.path) || '';
  let body = {};
  try {
    const txt = await request.text();
    if (txt.length > 4096) return json({ ok: false, message: 'Too large.' }, 413);
    body = txt ? JSON.parse(txt) : {};
  } catch { return json({ ok: false, message: 'Bad request.' }, 400); }

  if (action === 'unlock') {
    const who = await ipHash(request, env);
    if (await limited(env, 'djunlock', who, 900, 6)) {
      return json({ ok: false, message: 'Too many tries. Wait 15 minutes.' }, 429);
    }
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!env.DJ_CODE || !same(code, env.DJ_CODE)) return json({ ok: false, message: 'Wrong code.' }, 403);
    const exp = String(Date.now() + 365 * 24 * 3600 * 1000);
    return json({ ok: true, token: exp + '.' + (await sign(env.DJ_CODE, 'bcdj|' + exp)) });
  }

  if (!(await tokenOk(env, body.token))) return json({ ok: false, message: 'Locked.', locked: true }, 403);

  if (action === 'check') return json({ ok: true, lead_ms: DJ_LEAD_MS });
  if (action === 'play') {
    const id = typeof body.id === 'string' ? body.id.slice(0, 32) : '';
    if (!/^[0-9a-z]{6,32}$/.test(id)) return json({ ok: false, message: 'Unknown song.' }, 400);
    const mode = body.mode === 'next' ? 'next' : 'now';
    const r = await djPlace(env, id, mode);
    return json(r, r.ok ? 200 : 400);
  }
  if (action === 'skip') {
    const r = await djPlace(env, null, 'now');
    return json(r, r.ok ? 200 : 400);
  }
  return json({ ok: false, message: 'Not found.' }, 404);
}

export async function onRequestGet() {
  return json({ ok: false, message: 'Use POST.' }, 405, { allow: 'POST' });
}
