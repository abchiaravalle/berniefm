/* BC Radio live listener count ("12 listening now"). Privacy-safe:
 * - While this page is actually playing, it tells the station "still listening" once a minute
 *   (POST /api/listen {sid, platform:"web", playing}). sid is a random code made up when play
 *   starts, held only in this page's memory (never stored, never tied to anything), and a new
 *   one is made every time play starts. Stop / leaving the page sends playing:false.
 * - Every 30 s while the page is visible it reads the total (GET /api/listeners, edge-cached).
 * The server keeps nothing but (sid, platform, last seen) for players playing right now.
 * Needs window.BCSync (bcsync-v5.js) and <p id="listening" hidden> in the page.
 */
(function () {
  const el = document.getElementById('listening');
  if (!el || !window.BCSync) return;
  const PING_MS = 60000, POLL_MS = 30000;
  let sid = null, pingT = null, shown = null;

  const css = document.createElement('style');
  css.textContent =
    '.listening{display:inline-flex;align-items:center;gap:8px;margin:10px 0 0!important;font-size:13px!important;' +
    'letter-spacing:.08em;color:var(--gold-300)!important;font-variant-numeric:tabular-nums}' +
    '.listening[hidden]{display:none!important}' +
    '.listening i{width:6px;height:6px;border-radius:50%;background:var(--gold-400);box-shadow:0 0 0 3px rgba(231,195,111,.16);flex-shrink:0}' +
    '@media (max-width:900px){.headline .listening{justify-content:center}}';
  document.head.appendChild(css);

  function newSid() {
    const b = new Uint8Array(18);
    crypto.getRandomValues(b);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return (window.BC_LISTEN_SID_PREFIX || '') + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Show the newest numbers we have (a cached GET can be older than our own last ping).
  function show(d) {
    if (!d || typeof d.total !== 'number' || typeof d.now !== 'number') return;
    if (shown && d.now < shown.now) return;
    shown = d;
    let n = d.total;
    if (sid && n < 1) n = 1;                 // we're playing, so at least us
    if (n < 1) { el.hidden = true; return; }
    el.innerHTML = '<i aria-hidden="true"></i>' + (n === 1 ? '1 listening now' : n.toLocaleString() + ' listening now');
    el.hidden = false;
  }

  function send(playing, beacon) {
    if (!sid) return;
    const body = JSON.stringify({ sid, platform: 'web', playing });
    if (beacon && navigator.sendBeacon) {
      try { if (navigator.sendBeacon('/api/listen', new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return; } catch (e) {}
    }
    fetch('/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      .then(r => r.ok ? r.json() : null).then(d => { if (d) show(d); }).catch(() => {});
  }

  function begin() {
    if (sid) return;
    sid = newSid();
    send(true);
    clearInterval(pingT);
    pingT = setInterval(() => { if (BCSync.isLive()) send(true); else end(false); }, PING_MS);
    if (shown && shown.total < 1) show(Object.assign({}, shown));
  }
  function end(beacon) {
    if (!sid) return;
    clearInterval(pingT); pingT = null;
    send(false, beacon);
    sid = null;
  }

  BCSync.on('play', begin);       // fires on start and on every rejoin; one session per start
  BCSync.on('pause', () => end(false));
  addEventListener('pagehide', () => end(true));
  addEventListener('pageshow', e => { if (e.persisted && BCSync.isLive()) begin(); });

  function poll() {
    if (document.hidden) return;
    fetch('/api/listeners').then(r => r.ok ? r.json() : null).then(d => { if (d) show(d); }).catch(() => {});
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', poll);
  poll();
})();
