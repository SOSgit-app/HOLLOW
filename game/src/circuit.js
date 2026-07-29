/* HOLLOW — circuit.js : jack-in routing puzzles (mission boards + tutorial). */
(function (NS) {
  'use strict';

  // Tile masks: bit0=N bit1=E bit2=S bit3=W
  var STRAIGHT = 5;   // N+S
  var BEND = 3;       // N+E
  var TEE = 7;        // N+E+S (three-way)

  var SIZE = 6;
  var TIMEOUT = 60;
  var COL_LABELS = 'ABCDEF';

  // STRAIGHT: 0=NS 1=EW · BEND: 0=NE 1=ES 2=SW 3=WN · TEE: 0=NES 1=ESW 2=SWN 3=WNE
  // Stage 1 path: ENTRY→A1→B1→B2→C2→D2→D3→D4→E4→E5→F5→F6→CORE
  var STAGE1 = {
    tiles: [
      STRAIGHT, BEND,   TEE,     BEND,   STRAIGHT, BEND,
      BEND,     BEND,   STRAIGHT, BEND,   TEE,     STRAIGHT,
      TEE,      STRAIGHT, BEND,   STRAIGHT, BEND,   BEND,
      BEND,     TEE,    STRAIGHT, BEND,   BEND,    TEE,
      STRAIGHT, BEND,   TEE,     BEND,   BEND,    BEND,
      BEND,     STRAIGHT, BEND,   TEE,    STRAIGHT, BEND
    ],
    solution: [
      1, 2, 0, 1, 0, 0,
      1, 0, 1, 2, 2, 1,
      0, 0, 3, 0, 1, 2,
      2, 1, 0, 0, 2, 0,
      0, 3, 2, 1, 0, 2,
      1, 0, 0, 3, 1, 0
    ],
    start: [
      0, 0, 1, 0, 1, 2,
      0, 2, 0, 0, 0, 0,
      2, 1, 1, 1, 0, 0,
      0, 0, 2, 2, 0, 1,
      1, 1, 0, 0, 3, 0,
      0, 1, 2, 1, 0, 2
    ]
  };

  // Stage 2 path: ENTRY→A1→B1→C1→D1→D2→D3→E3→F3→F4→F5→F6→CORE
  var STAGE2 = {
    tiles: [
      STRAIGHT, STRAIGHT, STRAIGHT, BEND,   STRAIGHT, BEND,
      BEND,     TEE,      BEND,     STRAIGHT, TEE,     BEND,
      TEE,      STRAIGHT, BEND,     BEND,   STRAIGHT, BEND,
      BEND,     BEND,     TEE,      STRAIGHT, BEND,    STRAIGHT,
      STRAIGHT, TEE,      BEND,     BEND,   STRAIGHT, STRAIGHT,
      BEND,     STRAIGHT, TEE,      BEND,   STRAIGHT, BEND
    ],
    solution: [
      1, 1, 1, 2, 0, 0,
      0, 0, 1, 0, 1, 2,
      2, 1, 0, 0, 1, 2,
      1, 3, 0, 1, 0, 0,
      0, 2, 1, 3, 0, 0,
      2, 0, 1, 0, 1, 0
    ],
    start: [
      0, 0, 0, 0, 1, 2,
      2, 1, 0, 2, 0, 0,
      0, 0, 2, 1, 0, 1,
      0, 1, 2, 0, 3, 1,
      1, 0, 0, 1, 1, 2,
      0, 2, 0, 2, 0, 3
    ]
  };

  // Stage 3 path: ENTRY→A1→A2→B2→B3→B4→C4→D4→E4→E5→E6→F6→CORE
  var STAGE3 = {
    tiles: [
      BEND,     TEE,      STRAIGHT, BEND,   BEND,     STRAIGHT,
      BEND,     BEND,     TEE,      STRAIGHT, BEND,    BEND,
      STRAIGHT, STRAIGHT, BEND,     TEE,      BEND,    STRAIGHT,
      BEND,     BEND,     STRAIGHT, STRAIGHT, BEND,    TEE,
      TEE,      STRAIGHT, BEND,     BEND,     STRAIGHT, BEND,
      BEND,     TEE,      STRAIGHT, BEND,     BEND,     STRAIGHT
    ],
    solution: [
      2, 0, 1, 0, 1, 0,
      0, 2, 1, 0, 0, 2,
      1, 0, 0, 2, 1, 0,
      0, 0, 1, 1, 2, 0,
      1, 1, 3, 0, 0, 2,
      2, 0, 0, 1, 0, 1
    ],
    start: [
      0, 1, 0, 2, 0, 1,
      2, 0, 0, 1, 3, 0,
      0, 1, 2, 0, 0, 1,
      1, 2, 0, 0, 0, 1,
      0, 0, 1, 2, 1, 0,
      0, 1, 2, 0, 2, 0
    ]
  };

  var STAGES = [STAGE1, STAGE2, STAGE3];

  // Tutorial only: top-row then right-column L-path. Start is almost solved (~4 one-click fixes).
  // Path: ENTRY→A1→B1→C1→D1→E1→F1→F2→F3→F4→F5→F6→CORE
  var TUTORIAL_STAGE = {
    tiles: [
      STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT, BEND,
      BEND,     BEND,     TEE,      BEND,     BEND,     STRAIGHT,
      BEND,     TEE,      BEND,     TEE,      BEND,     STRAIGHT,
      TEE,      BEND,     BEND,     BEND,     TEE,      STRAIGHT,
      BEND,     BEND,     TEE,      BEND,     BEND,     STRAIGHT,
      BEND,     TEE,      BEND,     BEND,     TEE,      BEND
    ],
    solution: [
      1, 1, 1, 1, 1, 2,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0
    ],
    start: [
      0, 1, 0, 1, 1, 1,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 1
    ]
  };

  var activeStages = STAGES;
  var isTutorialPuzzle = false;
  var TIMEOUT_TUTORIAL = 90;

  var active = false;
  var stageIndex = 0;
  var tiles = [];
  var rot = [];
  var solutionRot = [];
  var selected = 0;
  var timeLeft = TIMEOUT;
  var onSuccess = null;
  var onTimeout = null;
  var onStageClear = null;
  var canvas = null, ctx = null;
  var confirmHold = 0;
  var dirty = true;
  var CELL = 58;
  var PAD = 52;
  var TOP = 72;
  var pointerU = -1;
  var pointerV = -1;
  var pointerFresh = 0;

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

  function loadStage(i) {
    var s = activeStages[i];
    tiles = s.tiles.slice();
    solutionRot = s.solution.slice();
    rot = s.start.slice();
    selected = 0;
    timeLeft = isTutorialPuzzle ? TIMEOUT_TUTORIAL : TIMEOUT;
    confirmHold = 0;
    pointerU = -1;
    pointerV = -1;
    dirty = true;
  }

  function resetPuzzle() {
    stageIndex = 0;
    loadStage(0);
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

  // Operator-blind orientation marker: corner pip moves with tile rotation
  // turns 0=NW, 1=NE, 2=SE, 3=SW — matches print sheet
  function drawOrientDot(cellX, cellY, turns, selectedTile) {
    var corner = ((turns % 4) + 4) % 4;
    var inset = CELL * 0.2;
    var ox, oy;
    if (corner === 0) { ox = cellX + inset; oy = cellY + inset; }
    else if (corner === 1) { ox = cellX + CELL - inset; oy = cellY + inset; }
    else if (corner === 2) { ox = cellX + CELL - inset; oy = cellY + CELL - inset; }
    else { ox = cellX + inset; oy = cellY + CELL - inset; }
    ctx.fillStyle = selectedTile ? '#ffcc66' : '#e0a030';
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(3, CELL * 0.075), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = selectedTile ? '#fff0c0' : 'rgba(255,200,100,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(4.5, CELL * 0.1), 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPointer() {
    if (pointerU < 0 || pointerV < 0 || pointerFresh <= 0) return;
    var x = pointerU * canvas.width;
    var y = pointerV * canvas.height;
    var pulse = 0.65 + 0.35 * Math.sin(pointerFresh * 18);
    ctx.save();
    ctx.globalAlpha = Math.min(1, pulse);
    ctx.strokeStyle = '#ff2a2a';
    ctx.fillStyle = 'rgba(255,40,40,0.35)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffeeee';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 18, y); ctx.lineTo(x - 7, y);
    ctx.moveTo(x + 7, y); ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 7);
    ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 18);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    if (!active || !ctx) return;
    ctx.fillStyle = '#020805';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#7cff9b';
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      isTutorialPuzzle
        ? 'PRACTICE JACK-IN  —  MATCH THE CORNER DOTS'
        : ('JACK-IN ROUTING  6×6  —  STAGE ' + (stageIndex + 1) + '/' + activeStages.length),
      canvas.width / 2, 22
    );
    ctx.fillStyle = '#3f8a55';
    ctx.font = '11px Consolas, monospace';
    if (inVR()) {
      ctx.fillText('LASER SELECT · X OR TRIGGER ROTATE · CORNER DOT TURNS WITH TILE', canvas.width / 2, 42);
    } else {
      ctx.fillText('CLICK TO ROTATE — CORNER DOT SHOWS ORIENTATION · TILE IDs A1…F6', canvas.width / 2, 42);
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
        drawOrientDot(x, y, rot[i], i === selected);

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
      var confirmMsg = stageIndex < activeStages.length - 1
        ? 'PATH VALID — HOLDING TO ADVANCE…'
        : 'PATH VALID — HOLDING TO CONFIRM…';
      ctx.fillText(confirmMsg, canvas.width / 2, canvas.height - 12);
    } else {
      ctx.fillStyle = '#3f8a55';
      ctx.font = '10px Consolas, monospace';
      ctx.fillText('LIT = POWERED FROM ENTRY · CALL OUT TILE IDs TO ROTATE', canvas.width / 2, canvas.height - 12);
    }
    drawPointer();
    dirty = true;
  }

  function finishStageOrDone() {
    if (stageIndex < activeStages.length - 1) {
      var next = stageIndex + 1;
      if (onStageClear) onStageClear(stageIndex + 1, activeStages.length);
      stageIndex = next;
      loadStage(stageIndex);
      render();
      return;
    }
    var ok = onSuccess;
    close();
    if (ok) ok();
  }

  function update(dt) {
    if (!active) return false;
    timeLeft -= dt;
    if (pointerFresh > 0) pointerFresh -= dt;
    if (timeLeft <= 0) {
      var cb = onTimeout;
      close();
      if (cb) cb();
      return true;
    }
    if (connected()) {
      confirmHold += dt;
      if (confirmHold > 0.55) {
        finishStageOrDone();
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
    setPointer(u, v);
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

  function setPointer(u, v) {
    if (!active) return;
    pointerU = u;
    pointerV = v;
    pointerFresh = 0.35;
    dirty = true;
  }

  function clearPointer() {
    if (pointerU < 0 && pointerV < 0) return;
    pointerU = -1;
    pointerV = -1;
    pointerFresh = 0;
    dirty = true;
  }

  function open(successCb, timeoutCb, stageClearCb, opts) {
    ensureCanvas();
    isTutorialPuzzle = !!(opts && opts.tutorial);
    activeStages = isTutorialPuzzle ? [TUTORIAL_STAGE] : STAGES;
    resetPuzzle();
    onSuccess = successCb;
    onTimeout = timeoutCb;
    onStageClear = stageClearCb || null;
    active = true;
    canvas.style.display = inVR() ? 'none' : 'block';
    render();
  }

  function close() {
    active = false;
    isTutorialPuzzle = false;
    activeStages = STAGES;
    if (canvas) canvas.style.display = 'none';
    onSuccess = null;
    onTimeout = null;
    onStageClear = null;
    pointerU = -1;
    pointerV = -1;
    dirty = true;
  }

  function getSheetData() {
    return {
      size: SIZE,
      colLabels: COL_LABELS,
      stages: STAGES.map(function (s, i) {
        return {
          index: i + 1,
          tiles: s.tiles.slice(),
          start: s.start.slice(),
          solution: s.solution.slice()
        };
      }),
      // legacy single-board fields = stage 1
      tiles: STAGE1.tiles.slice(),
      start: STAGE1.start.slice(),
      solution: STAGE1.solution.slice(),
      straight: STRAIGHT,
      bend: BEND,
      tee: TEE
    };
  }

  NS.circuit = {
    open: open, close: close, update: update, rotateSelected: rotateSelected,
    moveSelection: moveSelection, nextTile: nextTile, pickUv: pickUv,
    setPointer: setPointer, clearPointer: clearPointer,
    isActive: function () { return active; },
    getStage: function () { return stageIndex + 1; },
    getStageCount: function () { return activeStages.length; },
    getCanvas: function () { return canvas; },
    getSheetData: getSheetData,
    consumeDirty: function () {
      var d = dirty;
      dirty = false;
      return d;
    },
    debug: {
      reset: resetPuzzle,
      loadStage: loadStage,
      setStage: function (i) { stageIndex = i; loadStage(i); },
      solve: applySolution,
      connected: connected,
      rot: function () { return rot.slice(); },
      solutionRot: function () { return solutionRot.slice(); },
      stageCount: function () { return activeStages.length; }
    }
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
