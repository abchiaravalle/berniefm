/* BC Radio channel picker (2026-11-21). While the station offers channels (bcradio.net/api/season
 * `channels`, Christmas period only) a small three-way control under the player lets the listener pick:
 *   Mixed (the station's normal timeline, the default) / Christmas only / No Christmas
 * Each channel is its own shared timeline, so everyone on the same channel hears the same second.
 * The choice is remembered on this device (localStorage 'bc-channel'). Switching while playing re-joins
 * the chosen channel at its live position right away (BCSync.setChannel, bcsync-v6.js).
 * When the station stops offering channels, the control disappears and the player goes back to the
 * normal timeline (the saved choice is kept for next time).
 * "N listening" per channel comes from the listener count (listeners-v1.js broadcasts it), no extra calls.
 * Needs window.BCSync (bcsync-v6.js) and section.deck in the page.
 */
(function () {
  if (!window.BCSync || !BCSync.setChannel) return;
  const KEY = 'bc-channel', SEASON_MS = 10 * 60000;
  const LABEL = { mixed: 'Mixed', christmas: 'Christmas only', classic: 'No Christmas' };
  const ID_RE = /^[a-z0-9-]{1,32}$/;
  const host = document.querySelector('section.deck');
  if (!host) return;
  const force = (location.search.match(/[?&]channels=(off)/) || [])[1];

  const css = document.createElement('style');
  css.textContent =
    '.chpick{max-width:690px;margin:16px auto 0;display:flex;flex-direction:column;align-items:center;gap:9px}' +
    '.chpick[hidden]{display:none}' +
    '.chpick-l{font-size:11.5px;letter-spacing:.24em;text-transform:uppercase;color:var(--gold-400);font-weight:600}' +
    '.chpick-seg{display:flex;width:min(540px,100%);padding:4px;gap:4px;border-radius:999px;border:1px solid var(--line-strong);' +
      'background:rgba(11,26,18,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}' +
    '.chpick-seg button{appearance:none;flex:1 1 0;min-width:0;min-height:46px;border:0;border-radius:999px;background:transparent;color:var(--cream);' +
      'cursor:pointer;padding:8px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;transition:background .2s,color .2s}' +
    '.chpick-seg button b{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
    '.chpick-seg button small{font-size:11px;line-height:1.2;color:var(--cream-dim);font-variant-numeric:tabular-nums}' +
    '.chpick-seg button small:empty{display:none}' +
    '.chpick-seg button:hover{background:rgba(231,195,111,.09)}' +
    '.chpick-seg button[aria-checked="true"]{background:linear-gradient(180deg,var(--gold-400),var(--gold-500));color:var(--ink);cursor:default}' +
    '.chpick-seg button[aria-checked="true"] small{color:rgba(26,18,6,.7)}' +
    '.chpick-seg button:focus-visible{outline:2px solid var(--gold-300);outline-offset:2px}' +
    '@media (max-width:480px){.chpick{margin-top:14px}.chpick-seg button{padding:8px 6px}.chpick-seg button b{font-size:13.5px}}' +
    'html.lite .chpick-seg{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(8,20,13,.86)}';
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.className = 'chpick';
  box.hidden = true;
  box.innerHTML = '<span class="chpick-l" id="chpick-l">Channel</span><div class="chpick-seg" role="radiogroup" aria-labelledby="chpick-l"></div>';
  host.appendChild(box);
  const seg = box.querySelector('.chpick-seg');

  let list = [], counts = null;
  const saved = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const save = id => { try { localStorage.setItem(KEY, id); } catch (e) {} };
  const current = () => BCSync.channel() || 'mixed';

  function build() {
    seg.textContent = '';
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.ch = c.id;
      b.innerHTML = '<b></b><small></small>';
      b.querySelector('b').textContent = LABEL[c.id] || c.label || c.id;
      seg.appendChild(b);
    }
    update();
  }
  function update() {
    const cur = current();
    for (const b of seg.children) {
      const on = b.dataset.ch === cur;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      let n = counts && counts[b.dataset.ch] || 0;
      if (on && BCSync.isLive() && n < 1) n = 1;            // we're on it, so at least us
      b.querySelector('small').textContent = n ? n.toLocaleString() + ' listening' : '';
    }
  }
  function pick(id) {
    if (!list.some(c => c.id === id)) return;
    save(id);
    if (id === current()) return;
    BCSync.setChannel(id === 'mixed' ? null : id).catch(() => {});
    update();
  }
  seg.addEventListener('click', e => { const b = e.target.closest('button[data-ch]'); if (b) pick(b.dataset.ch); });
  seg.addEventListener('keydown', e => {
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
    e.preventDefault();
    const btns = [...seg.children], i = btns.findIndex(b => b.dataset.ch === current());
    const j = k === 'Home' ? 0 : k === 'End' ? btns.length - 1 : (i + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length;
    pick(btns[j].dataset.ch);
    btns[j].focus();
  });
  BCSync.on('channel', update);
  BCSync.on('play', update);
  BCSync.on('pause', update);
  addEventListener('bc-listeners', e => { if (e.detail && e.detail.channels) { counts = e.detail.channels; update(); } });

  function apply(chs) {
    const next = force ? [] : (Array.isArray(chs) ? chs : []).filter(c => c && ID_RE.test(c.id || ''));
    const same = next.map(c => c.id).join() === list.map(c => c.id).join();
    list = next;
    if (!list.length) {
      box.hidden = true;
      if (BCSync.channel()) BCSync.setChannel(null).catch(() => {});
      return;
    }
    if (!same) build();
    box.hidden = false;
    const want = saved();
    if (want && want !== current() && list.some(c => c.id === want)) BCSync.setChannel(want === 'mixed' ? null : want).catch(() => {});
    if (BCSync.channel() && !list.some(c => c.id === BCSync.channel())) BCSync.setChannel(null).catch(() => {});
    update();
  }
  let lastSeason = 0;
  function season() {
    lastSeason = Date.now();
    fetch('/api/season').then(r => r.ok ? r.json() : null).then(d => { if (d) apply(d.channels); }).catch(() => {});
  }
  season();
  setInterval(() => { if (!document.hidden) season(); }, SEASON_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastSeason > 60000) season(); });
  window.BCChannels = { pick, list: () => list.slice(), current };
})();
