/* BC Radio synchronized player engine.
 * Every listener follows one shared server timeline (/api/now). The client
 * estimates its clock offset from /api/time, then plays the current track from
 * the same position as everyone else and hands off to the next scheduled track.
 * Drift is corrected continuously (gentle rate nudges, hard seek if far off).
 *
 * window.BCSync: start(), stop(), toggle(), on(evt, fn), onAir(), upcoming(n),
 *   isPlaying(), serverNow(), refresh(), debug()
 * Events: 'state', 'track', 'play', 'pause', 'buffering', 'error'
 */
(function () {
  const API = '/api';
  const STATE_URL = 'https://media.bcradio.net/state/now.json';
  const REV_URL = 'https://media.bcradio.net/state/rev.json';
  const SILENT = 'data:audio/mpeg;base64,//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAALAAAFMwA3Nzc3Nzc3NzdLS0tLS0tLS0tfX19fX19fX19zc3Nzc3Nzc3OHh4eHh4eHh4ebm5ubm5ubm5uvr6+vr6+vr6/Dw8PDw8PDw8PX19fX19fX19fr6+vr6+vr6+v///////////8AAAAATGF2YzYzLjEuAAAAAAAAAAAAAAAAJAQvAAAAAAAABTP1AW8ZAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVf/7EsQpg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVf/7EMRTg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVV//sSxH0DwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVV//sQxKcDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjBVVVX/+xLE0IPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EsTVg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sSxNWDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';
  const listeners = {};
  const emit = (e, d) => (listeners[e] || []).forEach(fn => { try { fn(d); } catch (err) { console.error(err); } });
  const on = (e, fn) => { (listeners[e] = listeners[e] || []).push(fn); };
  const key = i => i ? `${i.seq}:${i.track.id}:${i.start_ms}` : '';

  // ---------- clock sync ----------
  let offsetMs = 0, bestRtt = Infinity, bestAt = 0;
  async function sampleClock() {
    const t0 = performance.now();
    const r = await fetch(API + '/time?_=' + Math.random(), { cache: 'no-store' });
    const { now } = await r.json();
    const rtt = performance.now() - t0;
    const est = now - (Date.now() - rtt / 2);
    if (!(now > 1e12)) return;
    const stale = Date.now() - bestAt > 600000;
    if (rtt <= bestRtt || stale || Math.abs(est - offsetMs) > 1500) {
      bestRtt = rtt; bestAt = Date.now(); offsetMs = est;
    }
  }
  async function syncClock(n = 4) {
    for (let i = 0; i < n; i++) { try { await sampleClock(); } catch (e) {} }
  }
  const serverNow = () => Date.now() + offsetMs;

  // ---------- station state ----------
  let state = null, lastStateAt = 0;
  let activeItem = null, preparedItem = null;
  // Normal path: the published schedule file on R2 (no server work at all).
  // If it is missing, or runs out within 10 minutes, ask the API, which also
  // extends the schedule and republishes the file for everyone.
  async function fetchState(fresh) {
    let s = null;
    try {
      const r = await fetch(STATE_URL + '?_=' + (fresh ? Date.now() : Math.floor(Date.now() / 5000)), { cache: 'no-store' });
      if (r.ok) s = await r.json();
    } catch (e) {}
    const t = serverNow();
    const lastEnd = s && s.items && s.items.length ? s.items[s.items.length - 1].end_ms : 0;
    if (!s || !s.items || lastEnd - t < 600000 || !s.items.some(i => i.start_ms <= t && t < i.end_ms)) {
      const r = await fetch(API + '/now?_=' + Math.random(), { cache: 'no-store' });
      if (!r.ok) throw new Error('now ' + r.status);
      s = await r.json();
    }
    setState(s);
    return state;
  }
  function setState(s) {
    if (!s || !s.now) return;
    if (!s.items) s.items = [...(s.history || []).slice().reverse(), s.current, ...(s.next || [])].filter(Boolean);
    state = s; lastStateAt = Date.now();
    // keep the playing item in step with re-plans (a DJ cut changes its end time)
    if (typeof activeItem !== 'undefined' && activeItem) {
      const m = s.items.find(i => i.seq === activeItem.seq && i.start_ms === activeItem.start_ms && i.track.id === activeItem.track.id);
      if (m && m !== activeItem) {
        if (m.end_ms !== activeItem.end_ms) preparedItem = null;
        activeItem = m;
      }
    }
    emit('state', state);
  }
  const timeline = () => state && state.items ? state.items : [];
  const itemAt = t => timeline().find(i => i.start_ms <= t && t < i.end_ms) || null;
  const itemAfter = item => timeline().find(i => i.start_ms >= item.end_ms - 5) || null;
  function upcoming(n = 4) {
    const t = serverNow();
    return timeline().filter(i => i.start_ms > t).slice(0, n);
  }

  // ---------- audio: two elements, ping-pong for gapless handoff ----------
  const mk = () => {
    const a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    return a;
  };
  const els = [mk(), mk()];
  let active = 0;
  let wantPlaying = false, tick = null, settling = false;
  let gen = 0;                 // bumps on stop(): stale async work checks it and bails
  let selfOp = 0;              // >0 while WE call play()/pause(), so our own events aren't mistaken for outside ones
  const ownPause = el => { selfOp++; try { el.pause(); } finally { setTimeout(() => selfOp--, 0); } };
  const ownPlay = el => { selfOp++; let p; try { p = el.play(); } finally { setTimeout(() => selfOp--, 0); } return p; };
  const chan = ('BroadcastChannel' in window) ? new BroadcastChannel('bcradio-player') : null;
  const tabId = Math.random().toString(36).slice(2);
  const A = () => els[active];
  const B = () => els[1 - active];

  function load(el, item, posSec) {
    const k = key(item);
    if (el.dataset.key === k) return false;
    el.dataset.key = k;
    el.src = item.track.url + (posSec > 1 ? '#t=' + posSec.toFixed(2) : '');
    el.load();
    return true;
  }
  const livePos = item => Math.max(0, (serverNow() - item.start_ms) / 1000);

  function whenReady(el, ev) {
    return new Promise((res, rej) => {
      const ok = () => { cleanup(); res(); };
      const bad = () => { cleanup(); rej(el.error || new Error('media error')); };
      const to = setTimeout(() => { cleanup(); res(); }, 15000);
      const cleanup = () => { clearTimeout(to); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
      el.addEventListener(ev, ok, { once: true });
      el.addEventListener('error', bad, { once: true });
    });
  }

  async function seekAndPlay(el, item) {
    const g = gen;
    settling = true;
    try {
      if (el.readyState < 1) await whenReady(el, 'loadedmetadata');
      if (g !== gen) return;
      const pos = livePos(item);
      if (Math.abs(el.currentTime - pos) > 0.25) { try { el.currentTime = pos; } catch (e) {} }
      el.playbackRate = 1;
      const p = ownPlay(el);
      if (p) await p;
      if (g !== gen) { ownPause(el); return; }
      if (el.readyState < 3) await whenReady(el, 'playing');
      if (g !== gen) { ownPause(el); return; }
      const pos2 = livePos(item);
      if (Math.abs(el.currentTime - pos2) > 0.35) { try { el.currentTime = pos2 + 0.05; } catch (e) {} }
    } finally {
      el.muted = false;
      try { el.volume = 1; } catch (e) {}
      settling = false;
    }
  }

  async function goLive() {
    let item = itemAt(serverNow());
    if (!item || Date.now() - lastStateAt > 20000) {
      await fetchState(true);
      item = itemAt(serverNow());
    }
    if (!item) throw new Error('nothing scheduled');
    activeItem = item; preparedItem = null;
    emit('track', item);
    ownPause(B());
    const el = A();
    if (load(el, item, livePos(item))) el.muted = true;   // hide the first few ms until we are on position
    emit('buffering', true);
    await seekAndPlay(el, item);
    emit('buffering', false);
    emit('play');
  }

  // Move to the next scheduled item. sameElement=true reuses the element that
  // just ended (most reliable when the page is in the background on iOS).
  let handing = false;
  async function handoff(sameElement) {
    if (handing) return;
    handing = true;
    try {
      const now = serverNow();
      let nxt = itemAfter(activeItem) || itemAt(now);
      if (!nxt || key(nxt) === key(activeItem)) {
        await fetchState(true);
        nxt = itemAfter(activeItem) || itemAt(serverNow());
      }
      if (!nxt || key(nxt) === key(activeItem)) return;
      const old = A();
      if (!sameElement) active = 1 - active;
      load(A(), nxt, livePos(nxt));
      activeItem = nxt; preparedItem = null;
      emit('track', nxt);
      if (!sameElement) setTimeout(() => ownPause(old), 1500);
      await seekAndPlay(A(), nxt);
      if (!sameElement) ownPause(old);
      if (!itemAfter(nxt)) fetchState(true).catch(() => {});
    } catch (err) {
      emit('error', err);
    } finally {
      handing = false;
    }
  }

  // Safari/WebKit (incl. every iOS browser): no playbackRate nudging (see loop).
  const NO_RATE = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Android|Edg\//.test(navigator.userAgent)
    || /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let lastFix = 0, seekLead = 0.08, leadChecked = true;
  // ~4x/sec while playing: handoff, preload, schedule changes, drift correction.
  function loop() {
    if (!wantPlaying || !activeItem || settling || handing) return;
    const now = serverNow();
    const el = A();
    if (now >= activeItem.end_ms - 60) { handoff(false); return; }
    const full = (activeItem.track.duration || 0) * 1000;
    if (full && activeItem.end_ms - activeItem.start_ms < full - 1500) {      // cut short by the DJ
      const left = activeItem.end_ms - now;
      const v = left < 1500 ? Math.max(0, left / 1500) : 1;
      if (Math.abs(el.volume - v) > 0.02) { try { el.volume = v; } catch (e) {} }
    }
    // keep the schedule fresh while on air (a request may re-plan the future)
    const left = activeItem.end_ms - now;
    if ((Date.now() - lastStateAt > 120000) || (left < 45000 && left > 5000 && Date.now() - lastStateAt > 30000)) {
      lastStateAt = Date.now(); fetchState(false).catch(() => {});
    }
    const nxt = itemAfter(activeItem);
    if (nxt && key(preparedItem) !== key(nxt) && activeItem.end_ms - now < 45000) {
      preparedItem = nxt;
      load(B(), nxt, 0);
    }
    const onAir = itemAt(now);
    if (onAir && key(onAir) !== key(activeItem) && now < activeItem.end_ms - 1000) {
      goLive().catch(err => emit('error', err));
      return;
    }
    if (!el.paused && el.readyState >= 3 && NO_RATE) {
      // WebKit/Safari: every playbackRate change stalls the audio for ~0.5 s,
      // so never nudge the rate. Its clock tracks wall time well at 1x; only
      // re-seek when it is clearly off, at most once every 8 s.
      const drift = el.currentTime - (now - activeItem.start_ms) / 1000;
      if (el.playbackRate !== 1) el.playbackRate = 1;
      // learn how long a seek takes on this device (once, ~1.6 s after each fix)
      if (lastFix && !leadChecked && Date.now() - lastFix > 1600) {
        leadChecked = true;
        if (Math.abs(drift) < 0.6) seekLead = Math.max(0, Math.min(0.6, seekLead - drift * 0.8));
      }
      if (Math.abs(drift) > 0.3 && Date.now() - lastFix > 8000) {
        lastFix = Date.now(); leadChecked = false;
        try { el.currentTime = (now - activeItem.start_ms) / 1000 + seekLead; } catch (e) {}
      }
    } else if (!el.paused && el.readyState >= 3) {
      const drift = el.currentTime - (now - activeItem.start_ms) / 1000;   // + = ahead of everyone else
      if (Math.abs(drift) > 1.0) {
        try { el.currentTime = (now - activeItem.start_ms) / 1000 + 0.05; } catch (e) {}
        el.playbackRate = 1;
      } else if (Math.abs(drift) > 0.06) {
        const r = drift > 0 ? 0.98 : 1.02;
        if (el.playbackRate !== r) el.playbackRate = r;
      } else if (Math.abs(drift) < 0.03 && el.playbackRate !== 1) {
        el.playbackRate = 1;
      }
    } else if (el.ended && !handing) {
      handoff(true);
    }
  }

  els.forEach(el => {
    el.addEventListener('waiting', () => { if (el === A() && wantPlaying) emit('buffering', true); });
    el.addEventListener('playing', () => { if (el === A()) emit('buffering', false); });
    el.addEventListener('error', () => {
      if (el !== A() || !wantPlaying || settling) return;
      emit('error', el.error);
      el.dataset.key = '';
      setTimeout(() => { if (wantPlaying) goLive().catch(() => {}); }, 2000);
    });
    el.addEventListener('ended', () => { if (el === A() && wantPlaying && !handing) handoff(true); });
    // Something outside the player paused us (another tab or app took the audio,
    // a phone call, headphones unplugged): respect it and show Play. Never fight it.
    el.addEventListener('pause', () => {
      if (el !== A() || !wantPlaying || selfOp || settling || handing || el.ended) return;
      wantPlaying = false; gen++; clearInterval(tick);
      emit('pause');
    });
    // ...and if the system resumes us on its own (call ended, focus regained), rejoin live.
    el.addEventListener('play', () => {
      if (el !== A() || wantPlaying || selfOp) return;
      wantPlaying = true;
      clearInterval(tick); tick = setInterval(loop, 250);
      if (chan) chan.postMessage({ t: 'playing', id: tabId });
      goLive().catch(err => emit('error', err));
    });
  });

  // Must be called directly from a click/tap handler.
  function start() {
    wantPlaying = true;
    const g = ++gen;
    if (chan) chan.postMessage({ t: 'playing', id: tabId });
    // Inside the user gesture: start the element that will play, and unlock the
    // second one with a short silent clip (iOS only lets gesture-started elements play).
    const item = state ? itemAt(serverNow()) : null;
    const el = A();
    if (item) { activeItem = item; if (load(el, item, livePos(item))) el.muted = true; }
    if (el.src) { const p = ownPlay(el); if (p) p.catch(() => {}); }
    const b = B();
    if (!b.dataset.key && !b.dataset.unlocked) {
      b.dataset.unlocked = '1'; b.src = SILENT;
      const p = ownPlay(b); if (p) p.then(() => ownPause(b)).catch(() => {});
    }
    return (async () => {
      if (!state || offsetMs === 0) await Promise.all([syncClock(3), fetchState(true)]);
      if (g !== gen) return;
      await goLive();
      if (g !== gen) return;
      clearInterval(tick);
      tick = setInterval(loop, 250);
    })().catch(err => { if (g === gen) { wantPlaying = false; clearInterval(tick); } emit('error', err); throw err; });
  }
  function stop() {
    wantPlaying = false;
    gen++;
    clearInterval(tick);
    els.forEach(e => ownPause(e));
    emit('pause');
  }
  // Only one tab plays at a time: when another tab starts, this one stops.
  if (chan) chan.onmessage = (m) => {
    if (m.data && m.data.t === 'playing' && m.data.id !== tabId && wantPlaying) stop();
  };
  function toggle() {
    if (wantPlaying) { stop(); return Promise.resolve(false); }
    return start().then(() => true);
  }

  // Keep state fresh for the UI (also when not playing). Faster near track changes.
  async function poll() {
    try { await fetchState(false); } catch (e) {}
  }
  syncClock().catch(() => {});
  poll();
  setInterval(() => { if (!document.hidden && !wantPlaying) poll(); }, 20000);
  // Live changes (DJ picks, requests): a tiny marker file changes whenever the
  // schedule is re-planned. Check it every 3 s while playing (or visible), and
  // pull the new timeline the moment it moves. The DJ lead time (10 s) covers this.
  let lastRev = 0, revBusy = false;
  async function checkRev() {
    if (revBusy || (!wantPlaying && document.hidden)) return;
    revBusy = true;
    try {
      const r = await fetch(REV_URL + '?_=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const { rev } = await r.json();
        if (rev && rev !== lastRev) {
          const first = lastRev === 0;
          lastRev = rev;
          if (!first || (state && state.generated_ms && rev > state.generated_ms)) await fetchState(true);
        }
      }
    } catch (e) {} finally { revBusy = false; }
  }
  setInterval(checkRev, 3000);
  checkRev();
  setInterval(() => syncClock(2).catch(() => {}), 600000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    syncClock(2).then(() => fetchState(true)).then(() => {
      if (wantPlaying) {
        const cur = itemAt(serverNow());
        if (!activeItem || !cur || key(cur) !== key(activeItem)) goLive().catch(() => {});
      }
    }).catch(() => {});
  });

  // Lock screen / headphone controls
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => { start().catch(() => {}); });
      navigator.mediaSession.setActionHandler('pause', () => stop());
      navigator.mediaSession.setActionHandler('stop', () => stop());
      ['seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'].forEach(a => {
        try { navigator.mediaSession.setActionHandler(a, null); } catch (e) {}
      });
    } catch (e) {}
    on('track', item => {
      if (!item) return;
      const t = item.track;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.title, artist: t.artist, album: t.album || 'BC Radio',
          artwork: [{ src: t.art, sizes: '512x512' }],
        });
      } catch (e) {}
    });
  }

  window.BCSync = {
    start, stop, toggle, on, setState,
    onAir: () => itemAt(serverNow()),
    upcoming,
    isPlaying: () => wantPlaying && !A().paused,
    isLive: () => wantPlaying,
    syncClock,
    get state() { return state; },
    serverNow, refresh: () => fetchState(true),
    debug: () => ({
      offsetMs: Math.round(offsetMs), bestRtt: Math.round(bestRtt), key: key(activeItem),
      title: activeItem && activeItem.track.title,
      pos: +A().currentTime.toFixed(3),
      target: activeItem ? +((serverNow() - activeItem.start_ms) / 1000).toFixed(3) : null,
      drift: activeItem ? +(A().currentTime - (serverNow() - activeItem.start_ms) / 1000).toFixed(3) : null,
      rate: A().playbackRate, paused: A().paused, readyState: A().readyState, noRate: NO_RATE, seekLead,
    }),
  };
})();
