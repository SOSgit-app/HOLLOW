/* HOLLOW — intro.js : code-rain title card played over the boot screen.
   Two cards (who made it, then what it is), after which the rain drops to a
   quiet backdrop and the boot menu is revealed on top of it. */
(function (NS) {
  'use strict';

  var GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789<>=*+-/\\|:.';
  var FONT = '"Consolas","Lucida Console",monospace';

  // one card each; `at`/`hold` are seconds from the first frame of rain
  var BEATS = [
    { at: 0.9, hold: 2.6, pre: 'MADE BY', big: 'SQUADRON OFFICER SCHOOL', small: '( S O S )' },
    { at: 4.1, hold: 3.1, big: 'CYBER INFILTRATION', small: 'RD-9  ·  BLACKOUT OPERATIONS', decode: true }
  ];
  var RUN = 7.5;       // seconds of title cards before the menu appears
  var AMBIENT = 0.16;  // rain opacity once the cards are done

  var canvas = null, ctx = null, host = null;
  var raf = 0, running = false, onDone = null, blip = null, showHint = true;
  var backstop = 0, cardsDone = false;
  var t = 0, last = 0, fade = 1;
  var cell = 17, cols = 0, rows = 0;
  var dropY = null, dropV = null, dropG = null;

  function rnd(n) { return Math.floor(Math.random() * n); }
  function glyph() { return GLYPHS.charAt(rnd(GLYPHS.length)); }

  function resize() {
    if (!canvas) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = w < 620 ? 13 : 17;
    cols = Math.ceil(w / cell);
    rows = Math.ceil(h / cell);
    dropY = new Float32Array(cols);
    dropV = new Float32Array(cols);
    dropG = new Array(cols);
    for (var i = 0; i < cols; i++) {
      dropY[i] = -rnd(rows) - 1;
      dropV[i] = 9 + Math.random() * 17;
      dropG[i] = glyph();
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }

  // Columns of glyphs falling at their own rate. The per-frame wash is what
  // leaves the trail; the head is redrawn green as soon as it is overtaken.
  function drawRain(dt, w, h) {
    ctx.fillStyle = 'rgba(0,6,3,0.085)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = (cell - 2) + 'px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (var i = 0; i < cols; i++) {
      var prev = Math.floor(dropY[i]);
      dropY[i] += dropV[i] * dt;
      var now = Math.floor(dropY[i]);
      if (now === prev) continue;
      var x = i * cell;
      if (prev >= 0 && prev < rows) {
        ctx.fillStyle = '#2fd167';
        ctx.fillText(dropG[i], x, prev * cell);
      }
      for (var r = prev + 1; r < now; r++) {
        if (r < 0 || r >= rows) continue;
        ctx.fillStyle = '#2fd167';
        ctx.fillText(glyph(), x, r * cell);
      }
      dropG[i] = glyph();
      if (now >= 0 && now < rows) {
        ctx.fillStyle = '#ccffdc';
        ctx.fillText(dropG[i], x, now * cell);
      }
      if (now > rows + 2 && Math.random() < 0.06) {
        dropY[i] = -rnd(14) - 2;
        dropV[i] = 9 + Math.random() * 17;
      }
    }
  }

  // Letters are placed one at a time so the tracking is wide enough to read as
  // signage; monospace means the whole line scales linearly to fit maxW.
  function drawSpaced(text, cx, y, size, trackMul, color, alpha, glow, maxW) {
    if (alpha <= 0.01 || !text) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + size + 'px ' + FONT;
    var adv = ctx.measureText('M').width + size * trackMul;
    var total = adv * text.length;
    if (total > maxW) {
      var k = maxW / total;
      size *= k; adv *= k;
      ctx.font = 'bold ' + size + 'px ' + FONT;
    }
    var x = cx - (adv * text.length) / 2 + adv / 2;
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.fillStyle = color;
    for (var i = 0; i < text.length; i++) ctx.fillText(text.charAt(i), x + i * adv, y);
    ctx.restore();
  }

  function envelope(now, at, hold) {
    if (now < at || now > at + hold) return 0;
    return Math.max(0, Math.min(1, Math.min((now - at) / 0.5, (at + hold - now) / 0.55)));
  }

  // second card resolves out of noise, left to right
  function cardText(b, local) {
    if (!b.decode) return b.big;
    var reveal = Math.min(1, local / 1.2);
    var out = '';
    for (var i = 0; i < b.big.length; i++) {
      var c = b.big.charAt(i);
      out += (c === ' ' || (i / b.big.length) < reveal) ? c : glyph();
    }
    return out;
  }

  function frame(nowMs) {
    if (!running) return;
    var dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    t += dt;

    var w = canvas.clientWidth, h = canvas.clientHeight;
    drawRain(dt, w, h);

    var cx = w / 2, cy = h * 0.45, maxW = w * 0.88;
    var size = Math.max(16, Math.min(44, w / 27));
    for (var i = 0; i < BEATS.length; i++) {
      var b = BEATS[i];
      var a = envelope(t, b.at, b.hold);
      if (a <= 0) continue;
      var sub = Math.max(10, size * 0.3);
      drawSpaced(b.pre, cx, cy - size * 1.5, sub, 0.3, '#63f293', a * 0.8, 0, maxW * 0.6);
      drawSpaced(cardText(b, t - b.at), cx, cy, size, 0.34, '#d9ffe6', a, 13, maxW);
      drawSpaced(b.small, cx, cy + size * 1.5, sub, 0.26, '#63f293', a * 0.85, 0, maxW * 0.8);
      if (blip && Math.random() < 0.1) blip();
    }

    if (showHint && t < RUN) {
      drawSpaced('PRESS ANY KEY TO SKIP', cx, h - 34, 10, 0.3, '#2c7a48', 0.75, 0, maxW);
    }

    var target = t >= RUN ? AMBIENT : 1;
    fade += (target - fade) * Math.min(1, dt * 2.2);
    canvas.style.opacity = fade.toFixed(3);

    if (t >= RUN) reveal();
    raf = requestAnimationFrame(frame);
  }

  function reveal() {
    if (cardsDone) return;
    cardsDone = true;
    clearTimeout(backstop); backstop = 0;
    if (onDone) { var d = onDone; onDone = null; d(); }
  }

  function stop() {
    running = false;
    cardsDone = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(backstop); backstop = 0;
    window.removeEventListener('resize', resize);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; ctx = null; onDone = null; blip = null;
  }

  function play(opts) {
    opts = opts || {};
    stop();
    host = opts.host || document.body;
    blip = opts.blip || null;
    onDone = opts.onDone || null;
    showHint = !opts.skipCards;

    canvas = document.createElement('canvas');
    canvas.id = 'intro-rain';
    canvas.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none';
    host.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    t = opts.skipCards ? RUN : 0;
    fade = opts.skipCards ? AMBIENT : 1;
    canvas.style.opacity = fade;
    last = performance.now();
    running = true;
    raf = requestAnimationFrame(frame);
    if (opts.skipCards) reveal();
    // never strand the player on the boot screen if rAF is throttled or stalled
    else backstop = setTimeout(reveal, (RUN + 3) * 1000);
  }

  // jump past the cards but leave the rain running behind the menu
  function finish() {
    if (!running || cardsDone) return false;
    t = RUN;
    reveal();
    return true;
  }

  NS.intro = { play: play, finish: finish, stop: stop, running: function () { return running; } };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
