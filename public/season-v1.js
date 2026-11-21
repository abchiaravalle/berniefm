/* BC Radio seasonal look (v1): falling snow + a twinkling string of Christmas lights along the
   top of the player. Switched by GET /api/season (a Control Room featured period named
   Christmas/Holiday that is on right now). Nothing happens otherwise.
   - Snow: one fixed full-window canvas, pointer-events none, ~30 fps, pre-rendered flake
     sprites, density scales with window size, stops when the tab is hidden.
   - Lights: one small canvas on the top edge of the player (#deck), same 30 fps loop.
   - prefers-reduced-motion (or ?still=1): lights drawn once, no snow, no loop.
   - ?season=christmas / ?season=off force it on/off (testing). */
(function () {
  'use strict';
  if (window.__bcSeason) return;
  window.__bcSeason = true;
  var FPS = 30, FRAME = 1000 / FPS;
  var qs = /[?&]season=(christmas|off)\b/.exec(location.search);
  var reduce = (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    document.documentElement.classList.contains('still');
  var COLORS = ['#ff5a4a', '#f2c862', '#5fd07c', '#fff1d0', '#6fb4ff'];
  var snow = null, lights = null, raf = 0, last = 0, offTimer = 0, on = false;

  function css() {
    var s = document.createElement('style');
    s.textContent =
      '.bc-snow{position:fixed;inset:0;width:100%;height:100%;z-index:5;pointer-events:none}' +
      '.bc-lights{position:absolute;left:-14px;top:-30px;height:76px;width:calc(100% + 28px);z-index:4;pointer-events:none}' +
      '@media (max-width:620px){.bc-lights{top:-28px;height:70px}}';
    document.head.appendChild(s);
  }

  // ---------- snow ----------
  function makeSnow() {
    var c = document.createElement('canvas');
    c.className = 'bc-snow'; c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    var ctx = c.getContext('2d');
    var sprites = [2, 3, 4.5, 6].map(function (r) {
      var s = document.createElement('canvas'), d = Math.ceil(r * 4);
      s.width = s.height = d;
      var g = s.getContext('2d'), gr = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
      gr.addColorStop(0, 'rgba(255,253,245,.95)'); gr.addColorStop(.35, 'rgba(255,250,235,.75)'); gr.addColorStop(1, 'rgba(255,250,235,0)');
      g.fillStyle = gr; g.fillRect(0, 0, d, d);
      return s;
    });
    var W = 0, H = 0, flakes = [];
    function flake(top) {
      var k = Math.random(), size = k < .45 ? 0 : k < .78 ? 1 : k < .94 ? 2 : 3;
      return { x: Math.random() * W, y: top ? -10 - Math.random() * 40 : Math.random() * H, s: size,
        vy: 14 + size * 9 + Math.random() * 14,             // px per second
        sway: 8 + Math.random() * 22, ph: Math.random() * 6.28, sp: .4 + Math.random() * .9,
        a: .35 + size * .12 + Math.random() * .2 };
    }
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = innerWidth; H = innerHeight;
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.max(36, Math.min(130, Math.round(W * H / 11000)));
      while (flakes.length < n) flakes.push(flake(false));
      flakes.length = n;
    }
    resize();
    addEventListener('resize', resize);
    return {
      el: c,
      step: function (dt, t) {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < flakes.length; i++) {
          var f = flakes[i];
          f.y += f.vy * dt;
          var x = f.x + Math.sin(f.ph + t * f.sp) * f.sway;
          if (f.y > H + 12) { flakes[i] = flake(true); continue; }
          if (x < -12) f.x += W + 24; else if (x > W + 12) f.x -= W + 24;
          var sp = sprites[f.s];
          ctx.globalAlpha = f.a;
          ctx.drawImage(sp, x - sp.width / 2, f.y - sp.height / 2);
        }
        ctx.globalAlpha = 1;
      },
    };
  }

  // ---------- string of lights on the player ----------
  function makeLights(host) {
    var c = document.createElement('canvas');
    c.className = 'bc-lights'; c.setAttribute('aria-hidden', 'true');
    host.appendChild(c);
    var ctx = c.getContext('2d');
    var W = 0, H = 0, bulbs = [], glows = {}, wire = [];
    COLORS.forEach(function (col) {
      var s = document.createElement('canvas'), d = 40;
      s.width = s.height = d;
      var g = s.getContext('2d'), gr = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
      gr.addColorStop(0, col + 'cc'); gr.addColorStop(.3, col + '66'); gr.addColorStop(.75, col + '14'); gr.addColorStop(1, col + '00');
      g.fillStyle = gr; g.fillRect(0, 0, d, d);
      glows[col] = s;
    });
    var PAD = 26, TOP = 24;                                 // glow never reaches the canvas edges
    function y(x) {                                         // wire: shallow scallops between hooks
      var L = W - 2 * PAD, n = Math.max(3, Math.round(L / 170)), seg = L / n, p = (((x - PAD) % seg) + seg) % seg / seg;
      return TOP + Math.sin(Math.PI * p) * (L < 500 ? 7 : 10);
    }
    function resize() {
      var r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(50, r.width); H = Math.max(30, r.height);
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var L = W - 2 * PAD, n = Math.max(10, Math.round(L / (L < 500 ? 28 : 34)));
      bulbs = [];
      for (var i = 0; i < n; i++) {
        var x = PAD + (i + .5) * L / n;
        bulbs.push({ x: x, y: y(x), col: COLORS[i % COLORS.length], ph: Math.random() * 6.28,
          sp: .7 + Math.random() * 1.3, tilt: (Math.random() - .5) * .35, spark: 0 });
      }
      wire = [];
      for (var k = 0; k <= 80; k++) { var xx = PAD - 6 + k * (W - 2 * PAD + 12) / 80; wire.push([xx, y(xx)]); }
    }
    resize();
    addEventListener('resize', resize);
    function draw(t, still) {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(18,34,24,.95)';
      ctx.beginPath();
      for (var k = 0; k < wire.length; k++) k ? ctx.lineTo(wire[k][0], wire[k][1]) : ctx.moveTo(wire[k][0], wire[k][1]);
      ctx.stroke();
      ctx.lineWidth = .7; ctx.strokeStyle = 'rgba(120,150,110,.45)'; ctx.stroke();
      for (var i = 0; i < bulbs.length; i++) {
        var b = bulbs[i];
        var lvl = still ? .9 : .55 + .45 * (.5 + .5 * Math.sin(b.ph + t * b.sp));
        if (!still) {
          if (b.spark <= 0 && Math.random() < .004) b.spark = 1;     // now and then one flares
          if (b.spark > 0) { lvl = Math.min(1, lvl + b.spark * .5); b.spark -= .06; }
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.tilt);
        ctx.globalAlpha = .25 + .6 * lvl;                      // glow
        ctx.drawImage(glows[b.col], -20, -9, 40, 40);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1c2e22'; ctx.fillRect(-2.6, -1.5, 5.2, 5.5);   // socket
        ctx.globalAlpha = .55 + .45 * lvl;
        ctx.fillStyle = b.col;                                 // bulb (teardrop)
        ctx.beginPath();
        ctx.moveTo(-3.6, 5.5);
        ctx.bezierCurveTo(-5.2, 10, -3.2, 15, 0, 17.5);
        ctx.bezierCurveTo(3.2, 15, 5.2, 10, 3.6, 5.5);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = .55 * lvl; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(-1.3, 9, 1, 2.2, 0, 0, 6.283); ctx.fill();
        ctx.restore();
      }
    }
    return { el: c, step: function (dt, t) { draw(t, false); }, still: function () { draw(0, true); } };
  }

  // ---------- loop ----------
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME - 2) return;
    var dt = Math.min(.1, (now - (last || now)) / 1000);
    last = now;
    var t = now / 1000;
    if (snow) snow.step(dt, t);
    if (lights) lights.step(dt, t);
  }
  function start() { if (!raf && !reduce && on && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });

  function turnOn(until) {
    if (on) return;
    var host = document.getElementById('deck');
    if (!host) return;
    on = true;
    css();
    document.documentElement.classList.add('season-christmas');
    lights = makeLights(host);
    if (reduce) { lights.still(); return; }
    snow = makeSnow();
    start();
    if (until) {
      var left = until - Date.now();
      if (left < 2147e6) offTimer = setTimeout(turnOff, Math.max(0, left));
    }
  }
  function turnOff() {
    stop();
    clearTimeout(offTimer);
    if (snow) snow.el.remove();
    if (lights) lights.el.remove();
    snow = lights = null; on = false;
    document.documentElement.classList.remove('season-christmas');
  }
  window.bcSeason = { on: function () { turnOn(0); }, off: turnOff };

  function check() {
    if (qs) { if (qs[1] === 'christmas') turnOn(0); return; }
    fetch('/api/season', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && d.theme === 'christmas' && !(d.until_ms && d.until_ms <= Date.now())) turnOn(d.until_ms);
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else check();
})();
