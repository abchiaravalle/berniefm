/* BC Radio DJ panel (owner only).
 * Secret: tap the element marked [data-dj-trigger] 5 times within 3 seconds.
 * First time on a device it asks for the DJ code; after that the device stays
 * unlocked (token in localStorage, valid a year, revoked by changing DJ_CODE).
 * Pick any song by album: "Play now" switches every listener in 10 s,
 * "Play next" queues it right after the current song. "Skip" moves everyone on.
 * Themeable via CSS variables on :root: --dj-bg --dj-panel --dj-line --dj-text
 * --dj-dim --dj-accent --dj-accent-ink --dj-font.
 */
(function () {
  const TAPS = 5, WINDOW_MS = 3000, KEY = 'bcdj-token';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  const css = `
  .djx{--bg:var(--dj-bg,rgba(0,0,0,.82));--panel:var(--dj-panel,#151515);--line:var(--dj-line,#2c2c2c);--text:var(--dj-text,#f4f4f5);
    --dim:var(--dj-dim,#a1a1aa);--acc:var(--dj-accent,#38bdf8);--ink:var(--dj-accent-ink,#04121a);
    position:fixed;inset:0;z-index:20000;background:var(--bg);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;
    font-family:var(--dj-font,inherit);color:var(--text)}
  .djx.open{display:flex}
  .djx-box{background:var(--panel);border:1px solid var(--line);border-radius:22px;width:min(760px,94vw);height:min(86vh,900px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)}
  .djx-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
  .djx-head h2{margin:0;font-size:17px;font-weight:700;letter-spacing:.02em;flex:1}
  .djx-btn{appearance:none;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:999px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer}
  .djx-btn:hover{border-color:var(--acc)}
  .djx-btn.pri{background:var(--acc);border-color:var(--acc);color:var(--ink);font-weight:700}
  .djx-x{width:36px;height:36px;padding:0;font-size:20px;line-height:1}
  .djx-now{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}
  .djx-now img{width:48px;height:48px;border-radius:8px;object-fit:cover;background:#333}
  .djx-now .t{font-weight:700;font-size:15px}.djx-now .s{color:var(--dim);font-size:12.5px}
  .djx-now .grow{flex:1;min-width:0}.djx-now .t,.djx-now .s{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .djx-search{padding:10px 16px;border-bottom:1px solid var(--line)}
  .djx-search input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:12px;color:var(--text);padding:11px 14px;font:inherit;font-size:15px;outline:none}
  .djx-search input:focus{border-color:var(--acc)}
  .djx-body{flex:1;overflow:auto;padding:6px 16px 18px;-webkit-overflow-scrolling:touch}
  .djx-sec{margin:16px 0 8px;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
  .djx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px}
  .djx-alb{background:none;border:0;padding:0;text-align:left;color:var(--text);cursor:pointer;font:inherit}
  .djx-alb img{width:100%;aspect-ratio:1;border-radius:12px;object-fit:cover;display:block;background:#333;border:1px solid var(--line)}
  .djx-alb:hover img{border-color:var(--acc)}
  .djx-alb .n{font-size:13.5px;font-weight:600;margin-top:7px;line-height:1.25}
  .djx-alb .m{font-size:12px;color:var(--dim);margin-top:2px}
  .djx-ahead{display:flex;gap:14px;align-items:flex-end;margin:12px 0 10px}
  .djx-ahead img{width:110px;height:110px;border-radius:12px;object-fit:cover;border:1px solid var(--line)}
  .djx-ahead .n{font-size:20px;font-weight:800;line-height:1.15}.djx-ahead .m{color:var(--dim);font-size:13px;margin-top:4px}
  .djx-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-top:1px solid var(--line)}
  .djx-row .no{width:26px;text-align:right;color:var(--dim);font-size:12.5px;font-variant-numeric:tabular-nums}
  .djx-row .ti{flex:1;min-width:0}.djx-row .ti b{display:block;font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .djx-row .ti span{color:var(--dim);font-size:12px}
  .djx-row .acts{display:flex;gap:6px;flex-shrink:0}
  .djx-row .acts .djx-btn{padding:7px 11px;font-size:12.5px}
  .djx-lock{display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;flex:1;padding:24px;text-align:center}
  .djx-lock input{width:min(320px,80vw);box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:12px;color:var(--text);padding:12px 14px;font:inherit;font-size:16px;text-align:center;outline:none}
  .djx-msg{min-height:20px;color:var(--dim);font-size:13px}
  .djx-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);opacity:0;z-index:20001;background:var(--dj-panel,#151515);color:var(--dj-text,#fff);
    border:1px solid var(--dj-accent,#38bdf8);border-radius:999px;padding:11px 18px;font-size:14px;transition:all .25s;pointer-events:none;max-width:90vw;text-align:center}
  .djx-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  @media (max-width:520px){.djx-box{width:100vw;height:100dvh;border-radius:0}.djx-grid{grid-template-columns:repeat(2,1fr)}.djx-row .acts .djx-btn{padding:7px 9px}}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'djx';
  root.innerHTML = `<div class="djx-box" role="dialog" aria-label="DJ">
    <div class="djx-head"><h2>DJ</h2><button class="djx-btn" data-a="skip">Skip song</button><button class="djx-btn djx-x" data-a="close" aria-label="Close">×</button></div>
    <div class="djx-main" style="display:contents"></div></div>`;
  document.body.appendChild(root);
  const main = $('.djx-main', root);
  const toastEl = document.createElement('div'); toastEl.className = 'djx-toast'; document.body.appendChild(toastEl);
  let toastT;
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3500); }

  let catalog = null, view = { album: null, q: '' }, busy = false;
  const token = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  async function api(action, body) {
    const r = await fetch('/api/dj/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: token() }) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (d.locked) { try { localStorage.removeItem(KEY); } catch (e) {} }
    return d;
  }

  function open() { view = { album: null, q: '' }; root.classList.add('open'); document.documentElement.style.overflow = 'hidden'; token() ? showPicker() : showLock(); }
  function close() { root.classList.remove('open'); document.documentElement.style.overflow = ''; }

  function showLock(msg = '') {
    $('[data-a=skip]', root).style.display = 'none';
    main.innerHTML = `<div class="djx-lock"><div style="font-size:15px">Enter the DJ code</div>
      <input type="password" autocomplete="current-password" inputmode="text" id="djx-code" placeholder="DJ code">
      <button class="djx-btn pri" data-a="unlock">Unlock this device</button><div class="djx-msg">${esc(msg)}</div></div>`;
    setTimeout(() => $('#djx-code', root)?.focus(), 50);
  }
  async function unlock() {
    const code = $('#djx-code', root).value;
    if (!code) return;
    const r = await fetch('/api/dj/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const d = await r.json().catch(() => ({}));
    if (d.ok && d.token) { try { localStorage.setItem(KEY, d.token); } catch (e) {} showPicker(); }
    else showLock(d.message || 'Wrong code.');
  }

  function nowHtml() {
    const cur = window.BCSync && BCSync.onAir && BCSync.onAir();
    const nxt = window.BCSync && BCSync.upcoming ? BCSync.upcoming(1)[0] : null;
    if (!cur) return '';
    const t = cur.track;
    return `<div class="djx-now"><img src="${esc(t.art)}" alt=""><div class="grow"><div class="t">${esc(t.title)}</div>
      <div class="s">On air now${nxt ? ' · next: ' + esc(nxt.track.title) : ''}</div></div></div>`;
  }
  async function showPicker() {
    $('[data-a=skip]', root).style.display = '';
    if (!catalog) {
      main.innerHTML = nowHtml() + `<div class="djx-body"><div class="djx-msg" style="padding:20px 0">Loading songs…</div></div>`;
      try { catalog = await (await fetch('/api/catalog', { cache: 'no-store' })).json(); } catch (e) {}
      if (!catalog) { main.innerHTML = `<div class="djx-lock"><div class="djx-msg">Couldn't load the song list.</div></div>`; return; }
      const ok = await api('check', {});
      if (!ok.ok) { showLock(ok.locked ? 'This device needs the code again.' : (ok.message || '')); return; }
    }
    render();
  }
  function render() {
    const q = view.q.trim().toLowerCase();
    let body = '';
    if (q) {
      const hits = [];
      catalog.sections.forEach(s => s.albums.forEach(a => a.tracks.forEach(t => {
        if ((t.title + ' ' + t.artist + ' ' + a.name).toLowerCase().includes(q)) hits.push({ t, a });
      })));
      body = hits.length ? hits.slice(0, 150).map(({ t, a }) => row(t, a.name)).join('') : `<div class="djx-msg" style="padding:16px 0">No songs match.</div>`;
    } else if (view.album) {
      const a = view.album;
      body = `<button class="djx-btn" data-a="back" style="margin-top:12px">‹ All albums</button>
        <div class="djx-ahead"><img src="${esc(a.art)}" alt=""><div><div class="n">${esc(a.name)}</div>
        <div class="m">${esc(a.artist)}${a.year ? ' · ' + esc(a.year) : ''} · ${a.tracks.length} songs</div></div></div>` +
        a.tracks.map(t => row(t, null)).join('');
    } else {
      body = catalog.sections.map((s, si) => `<div class="djx-sec">${esc(s.name)}</div><div class="djx-grid">` +
        s.albums.map((a, ai) => `<button class="djx-alb" data-alb="${si}:${ai}"><img loading="lazy" src="${esc(a.art)}" alt="">
          <div class="n">${esc(a.name)}</div><div class="m">${a.year ? esc(a.year) + ' · ' : ''}${a.tracks.length} songs</div></button>`).join('') + `</div>`).join('');
    }
    const keepQ = view.q;
    main.innerHTML = nowHtml() + `<div class="djx-search"><input id="djx-q" type="search" placeholder="Search ${catalog.count} songs" value="${esc(keepQ)}"></div><div class="djx-body">${body}</div>`;
    const inp = $('#djx-q', root);
    inp.addEventListener('input', () => { view.q = inp.value; const pos = inp.selectionStart; render(); const i2 = $('#djx-q', root); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (e) {} });
  }
  function row(t, albumName) {
    return `<div class="djx-row"><div class="no">${t.no && !albumName ? Math.floor(t.no) === t.no ? t.no : '' : ''}</div>
      <div class="ti"><b>${esc(t.title)}</b><span>${albumName ? esc(albumName) + ' · ' : ''}${fmt(t.dur)}</span></div>
      <div class="acts"><button class="djx-btn" data-a="next" data-id="${esc(t.id)}" data-t="${esc(t.title)}">Next</button>
      <button class="djx-btn pri" data-a="now" data-id="${esc(t.id)}" data-t="${esc(t.title)}">Play now</button></div></div>`;
  }

  async function act(kind, id, title) {
    if (busy) return; busy = true;
    try {
      const d = kind === 'skip' ? await api('skip', {}) : await api('play', { id, mode: kind });
      if (d.locked) { showLock('This device needs the code again.'); return; }
      if (!d.ok) { toast(d.message || 'That didn\u2019t work. Try again.'); return; }
      if (d.state && window.BCSync) BCSync.setState(d.state);
      const secs = d.at ? Math.max(0, Math.round((d.at - (window.BCSync ? BCSync.serverNow() : Date.now())) / 1000)) : 0;
      toast(kind === 'next' ? `“${title}” plays next for everyone` :
            kind === 'skip' ? `Skipping for everyone in ${secs} s` : `“${title}” starts for everyone in ${secs} s`);
      close();
    } finally { busy = false; }
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-a],[data-alb]');
    if (e.target === root) return close();
    if (!b) return;
    if (b.dataset.alb) { const [si, ai] = b.dataset.alb.split(':').map(Number); view.album = catalog.sections[si].albums[ai]; render(); $('.djx-body', root).scrollTop = 0; return; }
    const a = b.dataset.a;
    if (a === 'close') close();
    else if (a === 'unlock') unlock();
    else if (a === 'back') { view.album = null; render(); }
    else if (a === 'now' || a === 'next') act(a, b.dataset.id, b.dataset.t);
    else if (a === 'skip') act('skip');
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target.id === 'djx-code') unlock(); });

  // Secret: 5 quick taps on the trigger (no visible feedback for listeners).
  let taps = [];
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('[data-dj-trigger]')) { taps = []; return; }
    const t = Date.now();
    taps = taps.filter(x => t - x < WINDOW_MS); taps.push(t);
    if (taps.length >= TAPS) { taps = []; open(); }
  }, true);
  window.BCDJ = { open, close };
})();
