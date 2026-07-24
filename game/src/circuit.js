/* HOLLOW — circuit.js : jack-in routing puzzle (fixed hard board). */
(function (NS) {
  'use strict';

  // Tile masks: bit0=N bit1=E bit2=S bit3=W
  var STRAIGHT = 5;   // N+S
  var BEND = 3;       // N+E
  var TEE = 7;        // N+E+S (three-way)

  var SIZE = 6;
  var TIMEOUT = 20;
  var COL_LABELS = 'ABCDEF';

  // Fixed 6×6 — hard, always the same.
  // Solution path:
  // ENTRY→A1→B1→B2→C2→D2→D3→D4→E4→E5→F5→F6→CORE
  // (E,S,E,E,S,S,E,S,E,S then east out)
  var FIXED_TILES = [
  // A      B      C      D      E      F
    STRAIGHT, BEND,   TEE,     BEND,   STRAIGHT, BEND,     // 1
    BEND,     BEND,   STRAIGHT, BEND,   TEE,     STRAIGHT, // 2
    TEE,      STRAIGHT, BEND,   STRAIGHT, BEND,   BEND,     // 3
    BEND,     TEE,    STRAIGHT, BEND,   BEND,    TEE,      // 4
    STRAIGHT, BEND,   TEE,     BEND,   BEND,    BEND,     // 5
    BEND,     STRAIGHT, BEND,   TEE,    STRAIGHT, BEND      // 6
  ];

  // Solved orientations for the path tiles (distractors keep fixed angles)
  // STRAIGHT: 0=NS 1=EW · BEND: 0=NE 1=ES 2=SW 3=WN · TEE: 0=NES 1=ESW 2=SWN 3=WNE
  var FIXED_SOLUTION = [
  // A1=EW  B1=WS  C1     D1     E1     F1
    1,      2,     0,     1,     0,     0,
  // A2     B2=NE  C2=EW  D2=WS  E2     F2
    1,      0,     1,     2,     2,     1,
  // A3     B3     C3     D3=NS  E3     F3
    0,      0,     3,     0,     1,     2,
  // A4     B4     C4     D4=NE  E4=WS  F4
    2,      1,     0,     0,     2,     0,
  // A5     B5     C5     D5     E5=NE  F5=WS
    0,      3,     2,     1,     0,     2,
  // A6     B6     C6     D6     E6     F6=NE
    1,      0,     0,     3,     1,     0
  ];

  // Unsolved start — most tiles wrong; same sheet the Mission Director prints
  var FIXED_START = [
    0, 0, 1, 0, 1, 2,
    0, 2, 0, 0, 0, 0,
    2, 1, 1, 1, 0, 0,
    0, 0, 2, 2, 0, 1,
    1, 1, 0, 0, 3, 0,
    0, 1, 2, 1, 0, 2
  ];

  var active = false;
  var tiles = [];
  var rot = [];
  var solutionRot = [];
  var selected = 0;
  var timeLeft = TIMEOUT;
  var onSuccess = null;
  var onTimeout = null;
  var canvas = null, ctx = null;
  var confirmHold = 0;
  var dirty = true;
  var CELL = 58;
  var PAD = 52;
  var TOP = 72;

  function rotateMask(mask, turns) {
    turns = ((turns % 4) + 4) % 4;
    var m = mask;
    for (var i = 0; i < turns; i++) {
      var n = 0;
      if (m & 1) n |= 2;
      if (m & 2) n |= 4;
      if (m & 4) n |= 8;
      if (m & 8) n |= 1;
      m = n;
    }
    return m;
  }

  function idx(c, r) { return r * SIZE + c; }

  function tileLabel(c, r) {
    return COL_LABELS.charAt(c) + (r + 1);
  }

  function resetPuzzle() {
    tiles = FIXED_TILES.slice();
    solutionRot = FIXED_SOLUTION.slice();
    rot = FIXED_START.slice();
    selected = 0;
    timeLeft = TIMEOUT;
    confirmHold = 0;
    dirty = true;
  }

  function applySolution() {
    for (var i = 0; i < SIZE * SIZE; i++) rot[i] = solutionRot[i];
  }

  function maskAt(c, r) {
    return rotateMask(tiles[idx(c, r)], rot[idx(c, r)]);
  }

  function connected() {
    return liveSet()[idx(SIZE - 1, SIZE - 1)] === true && !!(maskAt(SIZE - 1, SIZE - 1) & 2);
  }

  function liveSet() {
    var live = {};
    if (!(maskAt(0, 0) & 8)) return live;
    var q = [{ c: 0, r: 0 }];
    live[idx(0, 0)] = true;
    var dirs = [
      { b: 1, dc: 0, dr: -1, opp: 4 },
      { b: 2, dc: 1, dr: 0, opp: 8 },
      { b: 4, dc: 0, dr: 1, opp: 1 },
      { b: 8, dc: -1, dr: 0, opp: 2 }
    ];
    while (q.length) {
      var cur = q.shift();
      var m = maskAt(cur.c, cur.r);
      for (var d = 0; d < 4; d++) {
        if (!(m & dirs[d].b)) continue;
        var nc = cur.c + dirs[d].dc, nr = cur.r + dirs[d].dr;
        if (nc < 0 || nr < 0 || nc >= SIZE || nr >= SIZE) continue;
        if (!(maskAt(nc, nr) & dirs[d].opp)) continue;
        var k = idx(nc, nr);
        if (live[k]) continue;
        live[k] = true;
        q.push({ c: nc, r: nr });
      }
    }
    return live;
  }

  function inVR() {
    return !!(NS.vr && NS.vr.active && NS.vr.active());
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'circuit-overlay';
    canvas.width = PAD * 2 + CELL * SIZE;
    canvas.height = TOP + CELL * SIZE + 36;
    canvas.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'z-index:8', 'pointer-events:auto', 'display:none',
      'border:1px solid #7cff9b', 'background:rgba(0,8,4,0.92)',
      'box-shadow:0 0 24px rgba(124,255,155,0.25)',
      'max-width:92vw', 'max-height:88vh'
    ].join(';');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    canvas.addEventListener('mousedown', function (e) {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) * (canvas.width / rect.width);
      var y = (e.clientY - rect.top) * (canvas.height / rect.height);
      var c = Math.floor((x - PAD) / CELL);
      var r = Math.floor((y - TOP) / CELL);
      if (c >= 0 && r >= 0 && c < SIZE && r < SIZE) {
        selected = idx(c, r);
        rotateSelected();
      }
    });
  }

  function arm() { return CELL * 0.42; }

  function drawPipe(cx, cy, mask, color, width) {
    var a = arm();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || Math.max(5, CELL * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (mask & 1) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - a); }
    if (mask & 2) { ctx.moveTo(cx, cy); ctx.lineTo(cx + a, cy); }
    if (mask & 4) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + a); }
    if (mask & 8) { ctx.moveTo(cx, cy); ctx.lineTo(cx - a, cy); }
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, CELL * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    if (!active || !ctx) return;
    ctx.fillStyle = '#020805';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#7cff9b';
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('JACK-IN ROUTING MATRIX 6×6', canvas.width / 2, 22);
    ctx.fillStyle = '#3f8a55';
    ctx.font = '11px Consolas, monospace';
    if (inVR()) {
      ctx.fillText('POINT LASER · A/X OR TRIGGER ROTATE · STICK ALSO WORKS · TILE IDs A1…F6', canvas.width / 2, 42);
    } else {
      ctx.fillText('CLICK TO ROTATE — CONNECT ENTRY → CORE · TILE IDs A1…F6', canvas.width / 2, 42);
    }
    ctx.fillStyle = timeLeft < 8 ? '#ff4444' : '#ffb347';
    ctx.fillText('LOCKOUT T-' + Math.ceil(timeLeft) + 's', canvas.width / 2, 60);

    var live = liveSet();
    var ok = connected();

    ctx.strokeStyle = live[idx(0, 0)] ? '#9fffbb' : '#ffb347';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(PAD - 22, TOP + CELL * 0.5);
    ctx.lineTo(PAD + 6, TOP + CELL * 0.5);
    ctx.stroke();
    ctx.strokeStyle = ok ? '#9fffbb' : '#ffb347';
    ctx.beginPath();
    ctx.moveTo(PAD + SIZE * CELL - 6, TOP + CELL * (SIZE - 0.5));
    ctx.lineTo(PAD + SIZE * CELL + 22, TOP + CELL * (SIZE - 0.5));
    ctx.stroke();

    ctx.fillStyle = '#7cff9b';
    ctx.font = '11px Consolas, monospace';
    ctx.fillText('ENTRY', 20, TOP + CELL * 0.5 + 14);
    ctx.fillText('CORE', canvas.width - 20, TOP + CELL * (SIZE - 0.5) + 14);

    // column headers
    ctx.fillStyle = '#3f8a55';
    ctx.font = '10px Consolas, monospace';
    for (var c = 0; c < SIZE; c++) {
      ctx.fillText(COL_LABELS.charAt(c), PAD + c * CELL + CELL * 0.5, TOP - 6);
    }

    for (var r = 0; r < SIZE; r++) {
      ctx.fillStyle = '#3f8a55';
      ctx.fillText(String(r + 1), PAD - 12, TOP + r * CELL + CELL * 0.55);
      for (c = 0; c < SIZE; c++) {
        var i = idx(c, r);
        var x = PAD + c * CELL, y = TOP + r * CELL;
        var powered = !!live[i];
        ctx.strokeStyle = i === selected ? '#ffb347' : (powered ? '#7cff9b' : '#3f8a55');
        ctx.lineWidth = i === selected ? 2.5 : 1;
        ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
        var col = ok ? '#9fffbb' : (powered ? '#b8ffd0' : '#4a7a58');
        drawPipe(x + CELL / 2, y + CELL / 2, maskAt(c, r), col, powered ? 8 : 6);

        ctx.fillStyle = i === selected ? '#ffb347' : '#2a5a3a';
        ctx.font = '9px Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(tileLabel(c, r), x + 6, y + 14);
        ctx.textAlign = 'center';

        var m = maskAt(c, r);
        if ((m & 2) && c + 1 < SIZE && (maskAt(c + 1, r) & 8)) {
          ctx.fillStyle = '#ffb347';
          ctx.beginPath();
          ctx.arc(x + CELL - 2, y + CELL / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if ((m & 4) && r + 1 < SIZE && (maskAt(c, r + 1) & 1)) {
          ctx.fillStyle = '#ffb347';
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL - 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (ok) {
      ctx.fillStyle = '#ffb347';
      ctx.font = '13px Consolas, monospace';
      ctx.fillText('PATH VALID — HOLDING TO CONFIRM…', canvas.width / 2, canvas.height - 12);
    } else {
      ctx.fillStyle = '#3f8a55';
      ctx.font = '10px Consolas, monospace';
      ctx.fillText('LIT = POWERED FROM ENTRY · CALL OUT TILE IDs TO ROTATE', canvas.width / 2, canvas.height - 12);
    }
    dirty = true;
  }

  function update(dt) {
    if (!active) return false;
    timeLeft -= dt;
    if (timeLeft <= 0) {
      var cb = onTimeout;
      close();
      if (cb) cb();
      return true;
    }
    if (connected()) {
      confirmHold += dt;
      if (confirmHold > 0.55) {
        var ok = onSuccess;
        close();
        if (ok) ok();
        return true;
      }
    } else {
      confirmHold = 0;
    }
    render();
    return true;
  }

  function rotateSelected() {
    if (!active) return;
    rot[selected] = (rot[selected] + 1) % 4;
    confirmHold = 0;
    render();
  }

  function moveSelection(dc, dr) {
    if (!active) return;
    var c = selected % SIZE;
    var r = Math.floor(selected / SIZE);
    c = Math.max(0, Math.min(SIZE - 1, c + dc));
    r = Math.max(0, Math.min(SIZE - 1, r + dr));
    selected = idx(c, r);
    confirmHold = 0;
    render();
  }

  function nextTile() {
    if (!active) return;
    selected = (selected + 1) % (SIZE * SIZE);
    confirmHold = 0;
    render();
  }

  function pickUv(u, v) {
    if (!active || !canvas) return -1;
    var x = u * canvas.width;
    var y = v * canvas.height;
    var c = Math.floor((x - PAD) / CELL);
    var r = Math.floor((y - TOP) / CELL);
    if (c < 0 || r < 0 || c >= SIZE || r >= SIZE) return -1;
    var i = idx(c, r);
    if (i !== selected) {
      selected = i;
      confirmHold = 0;
      render();
    }
    return i;
  }

  function open(successCb, timeoutCb) {
    ensureCanvas();
    resetPuzzle();
    onSuccess = successCb;
    onTimeout = timeoutCb;
    active = true;
    canvas.style.display = inVR() ? 'none' : 'block';
    render();
  }

  function close() {
    active = false;
    if (canvas) canvas.style.display = 'none';
    onSuccess = null;
    onTimeout = null;
    dirty = true;
  }

  // Sheet data for printable Mission Director packet (unsolved)
  function getSheetData() {
    return {
      size: SIZE,
      colLabels: COL_LABELS,
      tiles: FIXED_TILES.slice(),
      start: FIXED_START.slice(),
      solution: FIXED_SOLUTION.slice(),
      straight: STRAIGHT,
      bend: BEND,
      tee: TEE
    };
  }

  NS.circuit = {
    open: open, close: close, update: update, rotateSelected: rotateSelected,
    moveSelection: moveSelection, nextTile: nextTile, pickUv: pickUv,
    isActive: function () { return active; },
    getCanvas: function () { return canvas; },
    getSheetData: getSheetData,
    consumeDirty: function () {
      var d = dirty;
      dirty = false;
      return d;
    },
    debug: {
      reset: resetPuzzle,
      solve: applySolution,
      connected: connected,
      rot: function () { return rot.slice(); },
      solutionRot: function () { return solutionRot.slice(); }
    }
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
