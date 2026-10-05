self.addEventListener('install', function(event) {
  self.skipWaiting();
});
self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
// Pass-through only for this site's own pages and files. Audio (media.bcradio.net),
// the station API and the stream are left to the browser so seeking and
// streaming behave natively on every device.
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/listen/') === 0) return;
  event.respondWith(fetch(event.request));
});
