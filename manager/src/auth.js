// Cloudflare Access identity. Verifies the Access JWT properly: RS256 signature against the
// team's published keys, exp, nbf, aud (THIS app's audience tag) and iss. A decoded-but-unverified
// token is never trusted: the email claim would be free to forge.
// Adapted from ~/gits/amplifi-hub/functions/_lib/auth.js (proven in production).

let JWKS = null;
let JWKS_AT = 0;

function b64urlToBytes(s) {
  let b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function keys(teamDomain, force) {
  const now = Date.now();
  if (!force && JWKS && now - JWKS_AT < 3600e3) return JWKS;
  const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error('certs ' + r.status);
  JWKS = (await r.json()).keys || [];
  JWKS_AT = now;
  return JWKS;
}

export function readToken(request) {
  const h = request.headers.get('Cf-Access-Jwt-Assertion');
  if (h) return h;
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === 'CF_Authorization') return part.slice(i + 1).trim();
  }
  return '';
}

// Returns the verified, lower-cased email, or throws.
export async function verifiedEmail(token, { teamDomain, aud, serviceId }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('no token');
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('bad alg');
  let list = await keys(teamDomain, false);
  let key = list.find((k) => k.kid === header.kid);
  if (!key) { list = await keys(teamDomain, true); key = list.find((k) => k.kid === header.kid); }
  if (!key) throw new Error('signing key not found');
  const pub = await crypto.subtle.importKey('jwk', { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now - 30) throw new Error('expired');
  if (claims.nbf && claims.nbf > now + 30) throw new Error('not yet valid');
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud || !auds.includes(aud)) throw new Error('wrong audience');
  if (!String(claims.iss || '').includes(teamDomain)) throw new Error('wrong issuer');
  const email = String(claims.email || '').trim().toLowerCase();
  if (email && email.includes('@')) return email;
  if (serviceId && claims.common_name && claims.common_name === serviceId) return 'automated-check';
  throw new Error('no email');
}
