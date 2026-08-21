/* HOLLOW — render.js : raw WebGL1 point-cloud ring buffer + CRT post pass. */
(function (NS) {
  'use strict';

  var CAPACITY = 700000;     // points (GDD §3.2)
  var STRIDE = 8;            // x y z r g b birth life
  var BYTES = STRIDE * 4;
  var quality = { xrMaxPoints: 300000, fboScale: 0.85 };

  var gl = null, canvas = null;
  var pointProg = null, postProg = null;
  var vbo = null, quadVbo = null;
  var fbo = null, fboTex = null, fboW = 0, fboH = 0;
  var cpu = new Float32Array(CAPACITY * STRIDE);
  var cursor = 0, written = 0;
  var staging = new Float32Array(60000 * STRIDE);
  var stagingCount = 0;
  // Spatial density gate — stops LiDAR returns stacking into eye-searing white
  var DENS_BUCKETS = 8192;
  var densStamp = new Float32Array(DENS_BUCKETS);
  var densCount = new Uint8Array(DENS_BUCKETS);
  var DENS_CELL = 0.16;      // metres
  var DENS_MAX = 2;          // live hits allowed per cell window
  var DENS_WINDOW = 0.55;    // seconds

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('HOLLOW shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('HOLLOW link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  var POINT_VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aCol;',
    'attribute float aBirth;',
    'attribute float aLife;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform float uNow;',
    'varying vec3 vCol;',
    'varying float vBright;',
    'void main(){',
    '  vec4 vp = uView * vec4(aPos, 1.0);',
    '  gl_Position = uProj * vp;',
    '  float age = uNow - aBirth;',
    '  float hold = min(1.6, aLife * 0.22);',
    '  float fade = max(0.08, aLife - hold);',
    '  float b = age < 0.12 ? mix(1.35, 1.0, age / 0.12)',
    '                      : age < hold ? 1.0',
    '                      : max(0.0, 1.0 - (age - hold) / fade);',
    '  vBright = b;',
    '  vCol = aCol;',
    '  float dist = max(0.5, -vp.z);',
    '  gl_PointSize = clamp(140.0 / dist, 1.4, 4.2) * (b > 0.0 ? 1.0 : 0.0);',
    '}'
  ].join('\n');

  var POINT_FS = [
    'precision mediump float;',
    'varying vec3 vCol;',
    'varying float vBright;',
    'void main(){',
    '  if (vBright <= 0.004) discard;',
    '  vec2 d = gl_PointCoord - 0.5;',
    '  float r2 = dot(d, d);',
    '  if (r2 > 0.25) discard;',
    '  float soft = 1.0 - smoothstep(0.10, 0.5, sqrt(r2));',
    '  gl_FragColor = vec4(vCol * vBright * soft * 0.52, 1.0);',
    '}'
  ].join('\n');

  // Wristlink / Pip-Boy panel — world-space textured quad (proper stereo)
  var HUD_VS = [
    'attribute vec3 aPos;',
    'attribute vec2 aUv;',
    'uniform mat4 uMVP;',
    'varying vec2 vUv;',
    'void main(){ vUv = aUv; gl_Position = uMVP * vec4(aPos, 1.0); }'
  ].join('\n');
  var HUD_FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'void main(){',
    '  vec4 c = texture2D(uTex, vUv);',
    '  if (c.a < 0.02) discard;',
    '  gl_FragColor = vec4(c.rgb, 1.0);',
    '}'
  ].join('\n');

  var POST_VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  // Clean passthrough (no CRT). Optional death flood + movement comfort vignette.
  var POST_FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform float uFlood;',
    'uniform float uVignette;',
    'void main(){',
    '  vec3 col = texture2D(uTex, vUv).rgb;',
    '  float peak = max(col.r, max(col.g, col.b));',
    '  col *= 1.05 / (1.0 + peak * 0.85);',
    '  col = mix(col, vec3(0.9, 0.05, 0.05), uFlood);',
    '  float r = length(vUv - 0.5);',
    '  float vig = smoothstep(0.22, 0.92, r) * uVignette;',
    '  col *= 1.0 - vig * 0.92;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // World-space comfort reference: dim floor grid + horizon ticks
  var GRID_VS = [
    'attribute vec3 aPos;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'void main(){ gl_Position = uProj * uView * vec4(aPos, 1.0); }'
  ].join('\n');
  var GRID_FS = [
    'precision mediump float;',
    'uniform vec3 uColor;',
    'void main(){ gl_FragColor = vec4(uColor, 1.0); }'
  ].join('\n');

  // XR screen-space comfort vignette (NDC full-screen)
  var VIG_VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');
  var VIG_FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform float uVignette;',
    'void main(){',
    '  float r = length(vUv - 0.5);',
    '  float a = smoothstep(0.22, 0.92, r) * uVignette * 0.85;',
    '  gl_FragColor = vec4(0.0, 0.0, 0.0, a);',
    '}'
  ].join('\n');

  var attrs = {}, unis = {}, postAttrs = {}, postUnis = {};
  var gridProg = null, gridAttrs = {}, gridUnis = {};
  var vigProg = null, vigAttrs = {}, vigUnis = {};
  var gridVbo = null, gridCount = 0;
  var comfortOpts = { vignette: 0 };
  var hudProg = null, hudAttrs = {}, hudUnis = {};
  var hudCanvas = null, hudCtx = null, hudTex = null, hudVbo = null;
  var hudState = {
    hint: '', obj: '', aux: 0, stamina: 1, exhausted: false, timer: '',
    contacts: [], yaw: 0, px: 0, pz: 0, showNoise: true,
    beacons: 0, beaconsMax: 0
  };
  var hudDirty = true;
  var wristModel = null; // Float32Array(16) game-world model matrix
  var circuitModel = null;
  var circuitSrc = null;
  var circuitTex = null;
  var circuitDirty = true;
  var coachCanvas = null, coachCtx = null, coachTex = null;
  var coachModel = null;
  var coachDirty = true;
  var coachState = { title: '', lines: [], buttons: [], step: 0, total: 0 };

  function init(cnv) {
    canvas = cnv;
    gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
      xrCompatible: true
    });
    if (!gl) throw new Error('HOLLOW: WebGL unavailable');

    pointProg = program(POINT_VS, POINT_FS);
    postProg = program(POST_VS, POST_FS);
    hudProg = program(HUD_VS, HUD_FS);
    gridProg = program(GRID_VS, GRID_FS);
    vigProg = program(VIG_VS, VIG_FS);

    attrs.aPos = gl.getAttribLocation(pointProg, 'aPos');
    attrs.aCol = gl.getAttribLocation(pointProg, 'aCol');
    attrs.aBirth = gl.getAttribLocation(pointProg, 'aBirth');
    attrs.aLife = gl.getAttribLocation(pointProg, 'aLife');
    unis.uProj = gl.getUniformLocation(pointProg, 'uProj');
    unis.uView = gl.getUniformLocation(pointProg, 'uView');
    unis.uNow = gl.getUniformLocation(pointProg, 'uNow');

    postAttrs.aPos = gl.getAttribLocation(postProg, 'aPos');
    postUnis.uTex = gl.getUniformLocation(postProg, 'uTex');
    postUnis.uFlood = gl.getUniformLocation(postProg, 'uFlood');
    postUnis.uVignette = gl.getUniformLocation(postProg, 'uVignette');

    gridAttrs.aPos = gl.getAttribLocation(gridProg, 'aPos');
    gridUnis.uProj = gl.getUniformLocation(gridProg, 'uProj');
    gridUnis.uView = gl.getUniformLocation(gridProg, 'uView');
    gridUnis.uColor = gl.getUniformLocation(gridProg, 'uColor');

    vigAttrs.aPos = gl.getAttribLocation(vigProg, 'aPos');
    vigUnis.uVignette = gl.getUniformLocation(vigProg, 'uVignette');

    hudAttrs.aPos = gl.getAttribLocation(hudProg, 'aPos');
    hudAttrs.aUv = gl.getAttribLocation(hudProg, 'aUv');
    hudUnis.uTex = gl.getUniformLocation(hudProg, 'uTex');
    hudUnis.uMVP = gl.getUniformLocation(hudProg, 'uMVP');

    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, CAPACITY * BYTES, gl.DYNAMIC_DRAW);

    quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    gridVbo = gl.createBuffer();

    // Unit quad in local space (scaled by wrist model). x=width, y=height, z=0 face.
    hudVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, hudVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0, 0, 1,
       0.5, -0.5, 0, 1, 1,
      -0.5,  0.5, 0, 0, 0,
       0.5, -0.5, 0, 1, 1,
       0.5,  0.5, 0, 1, 0,
      -0.5,  0.5, 0, 0, 0
    ]), gl.STATIC_DRAW);

    hudCanvas = document.createElement('canvas');
    hudCanvas.width = 640;
    hudCanvas.height = 400;
    hudCtx = hudCanvas.getContext('2d');
    hudTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hudTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 640, 400, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    coachCanvas = document.createElement('canvas');
    coachCanvas.width = 768;
    coachCanvas.height = 480;
    coachCtx = coachCanvas.getContext('2d');
    coachTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, coachTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 768, 480, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    circuitTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, circuitTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 420, 460, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    resize();
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    var scale = quality.fboScale || 1;
    var w = Math.floor(canvas.clientWidth * dpr * scale);
    var h = Math.floor(canvas.clientHeight * dpr * scale);
    if (w === 0 || h === 0) return;
    // keep canvas CSS size; FBO resolution tracks quality
    var cw = Math.floor(canvas.clientWidth * dpr);
    var ch = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    if (fboW === w && fboH === h) return;
    fboW = w; fboH = h;
    if (fboTex) { gl.deleteTexture(fboTex); gl.deleteFramebuffer(fbo); }
    fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setQuality(q) {
    quality.xrMaxPoints = q.xrMaxPoints || quality.xrMaxPoints;
    quality.fboScale = q.fboScale != null ? q.fboScale : quality.fboScale;
    fboW = 0; fboH = 0; // force FBO rebuild
    if (canvas) resize();
  }

  function setComfort(opts) {
    opts = opts || {};
    comfortOpts.vignette = Math.max(0, Math.min(1, opts.vignette || 0));
  }

  function drawComfortVignette() {
    if (!vigProg || comfortOpts.vignette <= 0.001) return;
    gl.useProgram(vigProg);
    gl.uniform1f(vigUnis.uVignette, comfortOpts.vignette);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(vigAttrs.aPos);
    gl.vertexAttribPointer(vigAttrs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(vigAttrs.aPos);
    gl.disable(gl.BLEND);
  }

  function densHash(x, y, z) {
    var ix = Math.floor(x / DENS_CELL);
    var iy = Math.floor(y / DENS_CELL);
    var iz = Math.floor(z / DENS_CELL);
    var h = ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0;
    return h % DENS_BUCKETS;
  }

  function addPoint(x, y, z, r, g, b, birth, life, force) {
    if (stagingCount >= 60000) return;
    if (!force) {
      var h = densHash(x, y, z);
      if (birth - densStamp[h] > DENS_WINDOW) {
        densStamp[h] = birth;
        densCount[h] = 0;
      }
      if (densCount[h] >= DENS_MAX) return;
      densCount[h]++;
    }
    var o = stagingCount * STRIDE;
    staging[o] = x; staging[o + 1] = y; staging[o + 2] = z;
    staging[o + 3] = r; staging[o + 4] = g; staging[o + 5] = b;
    staging[o + 6] = birth; staging[o + 7] = life;
    stagingCount++;
  }

  function clearPoints() {
    cursor = 0; written = 0; stagingCount = 0;
    densStamp.fill(0);
    densCount.fill(0);
  }

  // Kill lingering LiDAR returns around a world XZ (e.g. unlocked blast door).
  function expirePointsNear(x, z, radius, nowTs) {
    var r2 = radius * radius;
    var killed = 0;
    function killBuf(buf, count) {
      for (var i = 0; i < count; i++) {
        var o = i * STRIDE;
        var dx = buf[o] - x, dz = buf[o + 2] - z;
        if (dx * dx + dz * dz > r2) continue;
        buf[o + 6] = nowTs - 10;
        buf[o + 7] = 0.01;
        killed++;
      }
    }
    killBuf(staging, stagingCount);
    var n = Math.min(written, CAPACITY);
    if (n > 0) {
      killBuf(cpu, n);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpu.subarray(0, n * STRIDE));
    }
    return killed;
  }

  function flush() {
    if (stagingCount === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    var remaining = stagingCount, srcOff = 0;
    while (remaining > 0) {
      var space = CAPACITY - cursor;
      var n = Math.min(space, remaining);
      var view = staging.subarray(srcOff * STRIDE, (srcOff + n) * STRIDE);
      cpu.set(view, cursor * STRIDE);
      gl.bufferSubData(gl.ARRAY_BUFFER, cursor * BYTES, view);
      cursor = (cursor + n) % CAPACITY;
      written += n;
      srcOff += n;
      remaining -= n;
    }
    stagingCount = 0;
  }

  function pointCount() { return Math.min(written, CAPACITY); }

  function drawPoints(proj, view, now, maxPoints) {
    var n = pointCount();
    if (n <= 0) return;
    gl.useProgram(pointProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(attrs.aPos);
    gl.vertexAttribPointer(attrs.aPos, 3, gl.FLOAT, false, BYTES, 0);
    gl.enableVertexAttribArray(attrs.aCol);
    gl.vertexAttribPointer(attrs.aCol, 3, gl.FLOAT, false, BYTES, 12);
    gl.enableVertexAttribArray(attrs.aBirth);
    gl.vertexAttribPointer(attrs.aBirth, 1, gl.FLOAT, false, BYTES, 24);
    gl.enableVertexAttribArray(attrs.aLife);
    gl.vertexAttribPointer(attrs.aLife, 1, gl.FLOAT, false, BYTES, 28);
    gl.uniformMatrix4fv(unis.uProj, false, proj);
    gl.uniformMatrix4fv(unis.uView, false, view);
    gl.uniform1f(unis.uNow, now);
    if (!maxPoints || n <= maxPoints) {
      gl.drawArrays(gl.POINTS, 0, n);
    } else {
      // Quest budget: draw the newest points from the circular buffer.
      var start = (cursor - maxPoints + CAPACITY) % CAPACITY;
      var firstCount = Math.min(maxPoints, CAPACITY - start);
      gl.drawArrays(gl.POINTS, start, firstCount);
      if (firstCount < maxPoints) {
        gl.drawArrays(gl.POINTS, 0, maxPoints - firstCount);
      }
    }
    gl.disableVertexAttribArray(attrs.aPos);
    gl.disableVertexAttribArray(attrs.aCol);
    gl.disableVertexAttribArray(attrs.aBirth);
    gl.disableVertexAttribArray(attrs.aLife);
  }

  function render(proj, view, now, opts) {
    opts = opts || {};
    resize();
    flush();

    // pass 1: points -> fbo
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fboW, fboH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    drawPoints(proj, view, now, quality.xrMaxPoints);

    // pass 2: fbo -> screen (clean + optional comfort vignette / death flood)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(postProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.uniform1i(postUnis.uTex, 0);
    gl.uniform1f(postUnis.uFlood, opts.flood || 0);
    gl.uniform1f(postUnis.uVignette, comfortOpts.vignette || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(postAttrs.aPos);
    gl.vertexAttribPointer(postAttrs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(postAttrs.aPos);
  }

  // WebXR: wristlink panel — status + Alien Isolation–style motion tracker
  function paintHud() {
    if (!hudCtx) return;
    var ctx = hudCtx;
    var w = hudCanvas.width, h = hudCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(4, 18, 10, 0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(124,255,155,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.strokeStyle = 'rgba(63,138,85,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, w - 36, h - 36);

    function wrapText(text, maxW, maxLines) {
      text = String(text || '');
      ctx.save();
      var words = text.split(/\s+/), lines = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var trial = cur ? cur + ' ' + words[i] : words[i];
        if (ctx.measureText(trial).width <= maxW) { cur = trial; continue; }
        if (cur) lines.push(cur);
        cur = words[i];
      }
      if (cur) lines.push(cur);
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        var last = lines[maxLines - 1];
        while (last.length && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
        lines[maxLines - 1] = last + '…';
      }
      ctx.restore();
      return lines.length ? lines : [''];
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(124,255,155,0.98)';
    ctx.font = 'bold 22px Consolas, monospace';
    ctx.fillText('RD-9 WRISTLINK', 32, 38);
    ctx.textAlign = 'right';
    ctx.font = '18px Consolas, monospace';
    ctx.fillStyle = 'rgba(124,255,155,0.7)';
    ctx.fillText(hudState.timer || 'T+00:00', w - 32, 38);

    ctx.textAlign = 'left';
    ctx.font = 'bold 18px Consolas, monospace';
    ctx.fillStyle = 'rgba(124,255,155,0.95)';
    var objLines = wrapText(hudState.obj || '', w - 64, 2);
    var oy = 62;
    for (var oi = 0; oi < objLines.length; oi++) {
      ctx.fillText(objLines[oi], 32, oy + oi * 20);
    }
    if (hudState.beaconsMax > 0) {
      ctx.font = '16px Consolas, monospace';
      ctx.fillStyle = 'rgba(255,179,71,0.9)';
      ctx.fillText('BEACON ' + hudState.beacons + '/' + hudState.beaconsMax, 32, oy + objLines.length * 20 + 4);
    }

    var cx = w * 0.30, cy = h * 0.56, rad = Math.min(w, h) * 0.20;
    ctx.strokeStyle = 'rgba(124,255,155,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, rad * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - rad, cy); ctx.lineTo(cx + rad, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - rad); ctx.lineTo(cx, cy + rad); ctx.stroke();
    ctx.fillStyle = 'rgba(124,255,155,0.95)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx - 7, cy + 8);
    ctx.lineTo(cx + 7, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = '15px Consolas, monospace';
    ctx.fillStyle = 'rgba(124,255,155,0.7)';
    ctx.fillText('MOTION', cx, cy + rad + 16);

    var contacts = hudState.contacts || [];
    var yaw = hudState.yaw || 0;
    var rangeM = 42;
    var pulse = 0.65 + 0.35 * Math.sin(Date.now() * 0.008);
    for (var i = 0; i < contacts.length; i++) {
      var c = contacts[i];
      if (!c) continue;
      var dx = c.x - (hudState.px || 0);
      var dz = c.z - (hudState.pz || 0);
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > rangeM) continue;
      var bearing = Math.atan2(dx, -dz) - yaw;
      var r = (dist / rangeM) * rad;
      var bx = cx + Math.sin(bearing) * r;
      var by = cy - Math.cos(bearing) * r;
      var isPow = c.kind === 'pow' || c.state === 'POW' || c.state === 'POW_FREE';
      var chasing = c.state === 'CHASE';
      var dormant = c.state === 'DORMANT';
      if (isPow) {
        ctx.fillStyle = 'rgba(60,220,90,' + (0.75 + 0.25 * pulse) + ')';
        ctx.beginPath();
        ctx.arc(bx, by, c.state === 'POW_FREE' ? 6 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(180,255,190,0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, c.state === 'POW_FREE' ? 8 : 7, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = chasing
          ? 'rgba(255,70,70,' + pulse + ')'
          : (dormant ? 'rgba(124,255,155,0.35)' : 'rgba(255,200,80,' + pulse + ')');
        ctx.beginPath();
        ctx.arc(bx, by, chasing ? 7 : (dormant ? 3.5 : 5), 0, Math.PI * 2);
        ctx.fill();
      }
      var label = Math.max(1, Math.round(dist)) + 'm';
      var lx = bx + Math.sin(bearing) * 16;
      var ly = by - Math.cos(bearing) * 16;
      if (lx < 28) lx = 28;
      if (lx > w - 28) lx = w - 28;
      if (ly < 96) ly = 96;
      if (ly > h - 78) ly = h - 78;
      ctx.font = 'bold 12px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,8,4,0.85)';
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle = chasing
        ? 'rgba(255,140,140,0.98)'
        : (isPow ? 'rgba(180,255,190,0.98)' : 'rgba(255,230,160,0.98)');
      ctx.fillText(label, lx, ly);
    }

    var bx2 = w * 0.56, bw2 = w * 0.38, bh2 = 20;
    var meterY = 118;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px Consolas, monospace';

    if (hudState.showNoise) {
      var aux = Math.max(0, Math.min(1, hudState.aux || 0));
      ctx.fillStyle = 'rgba(124,255,155,0.85)';
      ctx.fillText('NOISE LEVEL', bx2, meterY);
      meterY += 16;
      ctx.strokeStyle = 'rgba(63,138,85,0.95)';
      ctx.strokeRect(bx2, meterY, bw2, bh2);
      var band = hudState.auxBand || (aux > 0.47 ? 'RED' : (aux > 0.15 ? 'YELLOW' : 'SAFE'));
      ctx.fillStyle = band === 'RED'
        ? 'rgba(255,68,68,0.95)'
        : (band === 'YELLOW' ? 'rgba(255,179,71,0.95)' : 'rgba(124,255,155,0.95)');
      ctx.fillRect(bx2 + 2, meterY + 2, Math.max(0, (bw2 - 4) * aux), bh2 - 4);
      var safeT = Math.max(0, Math.min(1, hudState.auxSafe != null ? hudState.auxSafe : 0.15));
      var yelT = Math.max(0, Math.min(1, hudState.auxYellow != null ? hudState.auxYellow : 0.47));
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(bx2 + 2 + (bw2 - 4) * safeT, meterY);
      ctx.lineTo(bx2 + 2 + (bw2 - 4) * safeT, meterY + bh2);
      ctx.moveTo(bx2 + 2 + (bw2 - 4) * yelT, meterY);
      ctx.lineTo(bx2 + 2 + (bw2 - 4) * yelT, meterY + bh2);
      ctx.stroke();
      ctx.fillStyle = band === 'RED' ? 'rgba(255,120,120,0.9)'
        : (band === 'YELLOW' ? 'rgba(255,200,120,0.9)' : 'rgba(160,255,180,0.85)');
      ctx.font = '13px Consolas, monospace';
      ctx.fillText(band === 'RED' ? 'RED — CHASE' : (band === 'YELLOW' ? 'YELLOW — CHECK' : 'GREEN — SAFE'),
        bx2, meterY + bh2 + 14);
      meterY += 52;
      ctx.font = 'bold 16px Consolas, monospace';
    }

    var sta = Math.max(0, Math.min(1, hudState.stamina == null ? 1 : hudState.stamina));
    ctx.fillStyle = 'rgba(124,255,155,0.85)';
    ctx.fillText('STAMINA', bx2, meterY);
    meterY += 16;
    ctx.strokeStyle = 'rgba(63,138,85,0.95)';
    ctx.strokeRect(bx2, meterY, bw2, bh2);
    ctx.fillStyle = hudState.exhausted
      ? 'rgba(255,80,80,0.95)'
      : (sta < 0.3 ? 'rgba(255,179,71,0.95)' : 'rgba(120,200,255,0.95)');
    ctx.fillRect(bx2 + 2, meterY + 2, Math.max(0, (bw2 - 4) * sta), bh2 - 4);

    // Virus upload takeover — flashing Wristlink plant screen
    if (hudState.virusUpload != null) {
      var vp = Math.max(0, Math.min(1, hudState.virusUpload));
      var active = !!hudState.virusHolding;
      var flash = 0.45 + 0.55 * Math.abs(Math.sin(Date.now() * 0.012));
      ctx.fillStyle = active
        ? 'rgba(12, 4, 4, ' + (0.88 + flash * 0.1) + ')'
        : 'rgba(4, 10, 8, 0.94)';
      ctx.fillRect(12, 12, w - 24, h - 24);
      ctx.strokeStyle = active
        ? 'rgba(255,' + Math.floor(60 + flash * 80) + ',60,' + (0.55 + flash * 0.45) + ')'
        : 'rgba(255,120,60,0.7)';
      ctx.lineWidth = active ? 8 : 4;
      ctx.strokeRect(16, 16, w - 32, h - 32);
      if (active) {
        ctx.strokeStyle = 'rgba(255,40,40,' + flash + ')';
        ctx.lineWidth = 2;
        ctx.strokeRect(28, 28, w - 56, h - 56);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = active
        ? 'rgba(255,' + Math.floor(100 + flash * 80) + ',80,0.98)'
        : 'rgba(255,160,80,0.95)';
      ctx.font = 'bold 28px Consolas, monospace';
      ctx.fillText(active ? '⚠ UPLOADING VIRUS' : 'VIRUS PAYLOAD', w * 0.5, 78);
      ctx.font = '18px Consolas, monospace';
      ctx.fillStyle = 'rgba(255,200,160,0.85)';
      ctx.fillText(active ? 'HOLD X — DO NOT RELEASE' : 'HOLD X AT CONSOLE TO UPLOAD', w * 0.5, 112);

      var ubx = 80, uby = 170, ubw = w - 160, ubh = 36;
      ctx.strokeStyle = 'rgba(255,120,60,0.95)';
      ctx.lineWidth = 3;
      ctx.strokeRect(ubx, uby, ubw, ubh);
      ctx.fillStyle = active
        ? 'rgba(255,' + Math.floor(50 + flash * 50) + ',40,0.95)'
        : 'rgba(255,140,50,0.9)';
      ctx.fillRect(ubx + 3, uby + 3, Math.max(0, (ubw - 6) * vp), ubh - 6);
      ctx.fillStyle = 'rgba(255,230,200,0.98)';
      ctx.font = 'bold 26px Consolas, monospace';
      ctx.fillText(Math.floor(vp * 100) + '%', w * 0.5, uby + ubh + 36);
      ctx.font = '15px Consolas, monospace';
      ctx.fillStyle = 'rgba(255,180,120,0.8)';
      ctx.fillText('SEEDING LOCAL INSTANCE · EMCON DEGRADED', w * 0.5, uby + ubh + 64);
      ctx.fillText(hudState.timer || '', w * 0.5, h - 48);
      hudDirty = false;
      return;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(28, h - 64, w - 56, 42);
    ctx.strokeStyle = 'rgba(255,179,71,0.45)';
    ctx.strokeRect(28, h - 64, w - 56, 42);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,179,71,0.9)';
    ctx.font = '13px Consolas, monospace';
    var hint = hudState.hint || 'RAISE WRIST · TRACK SECURITY';
    var hintLines = wrapText(hint, w - 80, 2);
    if (hintLines.length > 1) {
      ctx.fillText(hintLines[0], w * 0.5, h - 48);
      ctx.fillText(hintLines[1], w * 0.5, h - 32);
    } else {
      ctx.fillText(hintLines[0], w * 0.5, h - 42);
    }
    hudDirty = false;
  }

  function setVRHud(state) {
    if (!state) return;
    hudState = {
      hint: state.hint || '',
      obj: state.obj || '',
      aux: state.aux || 0,
      auxBand: state.auxBand || 'SAFE',
      auxSafe: state.auxSafe != null ? state.auxSafe : 0.15,
      auxYellow: state.auxYellow != null ? state.auxYellow : 0.47,
      stamina: state.stamina == null ? 1 : state.stamina,
      exhausted: !!state.exhausted,
      timer: state.timer || '',
      contacts: state.contacts || [],
      yaw: state.yaw || 0,
      px: state.px || 0,
      pz: state.pz || 0,
      virusUpload: state.virusUpload == null ? null : state.virusUpload,
      virusHolding: !!state.virusHolding,
      showNoise: state.showNoise !== false,
      beacons: state.beacons || 0,
      beaconsMax: state.beaconsMax || 0
    };
    hudDirty = true;
  }

  function setWristModel(m) {
    wristModel = m || null;
  }

  function setCircuitPanel(srcCanvas, model) {
    circuitSrc = srcCanvas || null;
    circuitModel = model || null;
    circuitDirty = true;
  }

  function paintCoach() {
    if (!coachCtx) return;
    var ctx = coachCtx;
    var w = coachCanvas.width, h = coachCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(4, 12, 8, 0.94)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,179,71,0.92)';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.strokeStyle = 'rgba(124,255,155,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, w - 44, h - 44);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,179,71,0.95)';
    ctx.font = 'bold 26px Consolas, monospace';
    var stepLabel = (coachState.step && coachState.total)
      ? ('STEP ' + coachState.step + ' / ' + coachState.total)
      : 'TUTORIAL';
    ctx.fillText(stepLabel, 44, 52);

    ctx.fillStyle = 'rgba(124,255,155,0.98)';
    ctx.font = 'bold 40px Consolas, monospace';
    ctx.fillText((coachState.title || '').slice(0, 28), 44, 108);

    ctx.fillStyle = 'rgba(210,255,220,0.92)';
    ctx.font = '26px Consolas, monospace';
    var lines = coachState.lines || [];
    var y = 168;
    for (var i = 0; i < lines.length && i < 4; i++) {
      ctx.fillText(String(lines[i] || '').slice(0, 42), 44, y);
      y += 36;
    }

    ctx.fillStyle = 'rgba(255,179,71,0.12)';
    ctx.fillRect(36, h - 168, w - 72, 132);
    ctx.strokeStyle = 'rgba(255,179,71,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(36, h - 168, w - 72, 132);

    ctx.fillStyle = 'rgba(255,179,71,0.95)';
    ctx.font = 'bold 22px Consolas, monospace';
    ctx.fillText('CONTROLS', 52, h - 138);

    ctx.fillStyle = 'rgba(255,220,160,0.95)';
    ctx.font = '22px Consolas, monospace';
    var buttons = coachState.buttons || [];
    var by = h - 104;
    for (var b = 0; b < buttons.length && b < 3; b++) {
      ctx.fillText('· ' + String(buttons[b] || '').slice(0, 40), 52, by);
      by += 30;
    }
    coachDirty = false;
  }

  function setCoachPanel(state, model) {
    if (!state) {
      coachModel = null;
      return;
    }
    coachState = {
      title: state.title || '',
      lines: state.lines || [],
      buttons: state.buttons || [],
      step: state.step || 0,
      total: state.total || 0
    };
    coachModel = model || null;
    coachDirty = true;
  }

  function drawCoachPanel(proj, view) {
    if (!coachModel || !coachTex || !coachCanvas) return;
    if (coachDirty) paintCoach();
    drawTexturedQuad(proj, view, coachModel, coachTex, coachCanvas, true);
  }

  function drawTexturedQuad(proj, view, model, tex, srcCanvas, forceUpload) {
    if (!hudProg || !tex || !model || !srcCanvas) return;
    if (forceUpload) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
    }
    var math = NS.math;
    var mvp = math.mat4Multiply(proj, math.mat4Multiply(view, model));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(hudProg);
    gl.uniformMatrix4fv(hudUnis.uMVP, false, mvp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(hudUnis.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, hudVbo);
    gl.enableVertexAttribArray(hudAttrs.aPos);
    gl.enableVertexAttribArray(hudAttrs.aUv);
    gl.vertexAttribPointer(hudAttrs.aPos, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(hudAttrs.aUv, 2, gl.FLOAT, false, 20, 12);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(hudAttrs.aPos);
    gl.disableVertexAttribArray(hudAttrs.aUv);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  function drawVRHud(proj, view) {
    if (!hudProg || !hudTex || !wristModel) return;
    paintHud();
    drawTexturedQuad(proj, view, wristModel, hudTex, hudCanvas, true);
  }

  function drawCircuitPanel(proj, view) {
    if (!circuitModel || !circuitSrc || !circuitTex) return;
    var upload = circuitDirty;
    if (NS.circuit && NS.circuit.consumeDirty) upload = NS.circuit.consumeDirty() || upload;
    drawTexturedQuad(proj, view, circuitModel, circuitTex, circuitSrc, upload);
    circuitDirty = false;
  }

  function renderXR(views, framebuffer, now) {
    flush();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (var i = 0; i < views.length; i++) {
      var v = views[i];
      gl.viewport(v.viewport.x, v.viewport.y, v.viewport.width, v.viewport.height);
      // Coach behind circuit so jack-in stays readable
      drawCoachPanel(v.projection, v.view);
      drawCircuitPanel(v.projection, v.view);
      drawPoints(v.projection, v.view, now, quality.xrMaxPoints || 300000);
      drawVRHud(v.projection, v.view);
      drawComfortVignette();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function makeXRCompatible() {
    if (gl.makeXRCompatible) return gl.makeXRCompatible();
    return Promise.resolve();
  }

  NS.render = {
    CAPACITY: CAPACITY,
    init: init, resize: resize,
    addPoint: addPoint, pointCount: pointCount, clearPoints: clearPoints,
    expirePointsNear: expirePointsNear,
    render: render, renderXR: renderXR,
    setVRHud: setVRHud, setWristModel: setWristModel, setCircuitPanel: setCircuitPanel,
    setCoachPanel: setCoachPanel,
    setQuality: setQuality, setComfort: setComfort,
    getContext: function () { return gl; },
    makeXRCompatible: makeXRCompatible
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
