// Host routing:
//  - bernieradio.acwebdev.net (legacy alias) -> 301 to https://bcradio.net
//  - stream.bcradio.net root / old AzuraCast public player -> 302 to https://bcradio.net
//  - everything else passes through (static site, /api, /listen)
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const host = url.hostname;
  if (host === 'bernieradio.acwebdev.net' || host === 'www.bcradio.net') {
    return Response.redirect('https://bcradio.net' + url.pathname + url.search, 301);
  }
  if (host === 'stream.bcradio.net') {
    const p = url.pathname;
    if (p === '/' || p === '/index.html' || p.startsWith('/public/')) {
      return Response.redirect('https://bcradio.net/', 302);
    }
  }
  return next();
}
