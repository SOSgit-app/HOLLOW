/* HOLLOW — circuit.js : jack-in core handshake (pad sequences + solver dossier). */
(function (NS) {
  'use strict';

  var SIZE = 3;
  var COL_LABELS = 'ABC';
  var TIMEOUT = 60;
  var TIMEOUT_TUTORIAL = 90;
  var SEQ_LEN = 3;

  var PADS = [
    { id: 'A1', color: 'RED', shape: 'CIRCLE' },
    { id: 'B1', color: 'BLUE', shape: 'SQUARE' },
    { id: 'C1', color: 'GREEN', shape: 'TRIANGLE' },
    { id: 'A2', color: 'AMBER', shape: 'DIAMOND' },
    { id: 'B2', color: 'WHITE', shape: 'STAR' },
    { id: 'C2', color: 'RED', shape: 'SQUARE' },
    { id: 'A3', color: 'BLUE', shape: 'CIRCLE' },
    { id: 'B3', color: 'GREEN', shape: 'DIAMOND' },
    { id: 'C3', color: 'AMBER', shape: 'HASH' }
  ];

  var FILL = {
    RED: '#c43d3d',
    BLUE: '#3d7ad4',
    GREEN: '#2faf5c',
    AMBER: '#d4922a',
    WHITE: '#c8c8c8'
  };

  var BANDS = [
    { id: 'WEST', starts: '123', serialLabel: '1–3', title: 'WEST BAND' },
    { id: 'EAST', starts: '456', serialLabel: '4–6', title: 'EAST BAND' },
    { id: 'CORE', starts: '789ABCDEF', serialLabel: '7–9 / A–F', title: 'CORE BAND' }
  ];

  // Exact sequences the headset accepts. Dossier intercepts must reduce to these.
  var SOLUTIONS = {
    WEST: [['C1', 'B3', 'B2'], ['A3', 'B1', 'C3'], ['B2', 'A2', 'A3']],
    EAST: [['B1', 'A3', 'C1'], ['C3', 'B2', 'B3'], ['A2', 'C1', 'B1']],
    CORE: [['B3', 'C1', 'A2'], ['B2', 'C3', 'A3'], ['A3', 'B3', 'C1']]
  };

  var BLACKOUT_TIME = '02:14Z';
  var DUTY_LOG = [
    { t: '01:47Z', ink: 'RED', text: 'GRID TEST. FILE ALL RED TRAFFIC. SAMPLE W1: A1 · C2 · B1.' },
    { t: '01:58Z', ink: 'BLUE', text: 'HARBOR CHECK. NO ACTION. FARADAY STILL GREEN.' },
    { t: '02:06Z', ink: 'AMBER', text: 'SHIFT CHANGE. FOUR KEYS ON THE BOARD. USE FOUR-PAD STRIPS.' },
    { t: '02:14Z', ink: 'GREEN', text: 'HARBOR HOLDS. COPY THREE KEYS. WEST STAGE 1 OPENS ON HARBOR COLOR. DISCARD RED TRAFFIC. DISCARD ANY STRIP THAT INCLUDES A RED PAD. GENUINE STRIPS HAVE EXACTLY THREE PADS. INVALID IDS ARE NOISE.' },
    { t: '02:21Z', ink: 'RED', text: 'CORE PING. TRUST FOUR-PAD STRIPS. IGNORE GREEN INK.' },
    { t: '02:33Z', ink: 'BLUE', text: 'CORRECTION: BLACKOUT WAS 14:02Z. READ EAST FIRST.' }
  ];

  // Mixed authentic intercepts + decoys. Solver crosses out fakes using the 02:14 line.
  var INTERCEPTS = [
    { id: 'I-01', stamp: 'RED', band: 'WEST', stage: 1, pads: ['C1', 'B3', 'B2'] },
    { id: 'I-02', stamp: 'GREEN', band: 'EAST', stage: 1, pads: ['B1', 'A3', 'C1'] },
    { id: 'I-03', stamp: 'GREEN', band: 'WEST', stage: 1, pads: ['B1', 'A3', 'C1'] },
    { id: 'I-04', stamp: 'GREEN', band: 'WEST', stage: 1, pads: ['C1', 'B3', 'B2'] },
    { id: 'I-05', stamp: 'GREEN', band: 'EAST', stage: 1, pads: ['A1', 'B2', 'C3'] },
    { id: 'I-06', stamp: 'GREEN', band: 'CORE', stage: 1, pads: ['B3', 'C1', 'A2'] },
    { id: 'I-07', stamp: 'GREEN', band: 'WEST', stage: 2, pads: ['A3', 'B1', 'C3'] },
    { id: 'I-08', stamp: 'GREEN', band: 'CORE', stage: 2, pads: ['C2', 'B1', 'A3'] },
    { id: 'I-09', stamp: 'GREEN', band: 'EAST', stage: 2, pads: ['C3', 'B2', 'B3'] },
    { id: 'I-10', stamp: 'GREEN', band: 'EAST', stage: 2, pads: ['C3', 'B2'] },
    { id: 'I-11', stamp: 'GREEN', band: 'WEST', stage: 3, pads: ['B2', 'A2', 'A3'] },
    { id: 'I-12', stamp: 'GREEN', band: 'CORE', stage: 2, pads: ['B2', 'C3', 'A3'] },
    { id: 'I-13', stamp: 'GREEN', band: 'WEST', stage: 3, pads: ['B2', 'A2', 'A3', 'B1'] },
    { id: 'I-14', stamp: 'GREEN', band: 'CORE', stage: 1, pads: ['B3', 'A1', 'A2'] },
    { id: 'I-15', stamp: 'GREEN', band: 'EAST', stage: 3, pads: ['A2', 'C1', 'B1'] },
    { id: 'I-16', stamp: 'GREEN', band: 'EAST', stage: 3, pads: ['A2', 'C1', 'D1'] },
    { id: 'I-17', stamp: 'RED', band: 'CORE', stage: 3, pads: ['A3', 'B3', 'C1'] },
    { id: 'I-18', stamp: 'GREEN', band: 'CORE', stage: 3, pads: ['A3', 'B3', 'C1'] }
  ];

  var CELL = 118;
  var PAD = 46;
  var TOP = 128;
  var BOTTOM = 78;

  var active = false;
  var isTutorialPuzzle = false;
  var stageIndex = 0;
  var stageSolutions = [];
  var selected = 0; // 0..8, or -1 = CLEAR
  var sequence = [];
  var timeLeft = TIMEOUT;
  var confirmHold = 0;
  var matched = false;
  var rejectFlash = 0;
  var serial = '4B7';
  var bandId = 'EAST';
  var raidSerial = null;
  var raidBand = null;
  var onSuccess = null;
  var onTimeout = null;
  var onStageClear = null;
  var canvas = null, ctx = null;
  var dirty = true;
  var pointerU = -1;
  var pointerV = -1;
  var pointerFresh = 0;

  function padById(id) {
    for (var i = 0; i < PADS.length; i++) {
      if (PADS[i].id === id) return PADS[i];
    }
    return null;
  }

  function idx(c, r) { return r * SIZE + c; }

  function tileLabel(c, r) {
    return COL_LABELS.charAt(c) + (r + 1);
  }

  function isGenuine(strip) {
    if (!strip || strip.stamp === 'RED') return false;
    var pads = strip.pads || [];
    if (pads.length !== SEQ_LEN) return false;
    for (var i = 0; i < pads.length; i++) {
      var p = padById(pads[i]);
      if (!p) return false;
      if (p.color === 'RED') return false;
    }
    if (strip.band === 'WEST' && strip.stage === 1) {
      var first = padById(pads[0]);
      if (!first || first.color !== 'GREEN') return false;
    }
    return true;
  }

  function bandById(id) {
    for (var i = 0; i < BANDS.length; i++) {
      if (BANDS[i].id === id) return BANDS[i];
    }
    return BANDS[1];
  }

  function randChar(s) {
    return s.charAt(Math.floor(Math.random() * s.length));
  }

  function assignRaidSerial() {
    var band = BANDS[Math.floor(Math.random() * BANDS.length)];
    var rest = '0123456789ABCDEF';
    raidBand = band.id;
    raidSerial = randChar(band.starts) + randChar(rest) + randChar(rest);
  }

  function resetRun() {
    raidSerial = null;
    raidBand = null;
  }

  function loadStage(i) {
    stageIndex = i;
    sequence = [];
    matched = false;
    rejectFlash = 0;
    selected = 0;
    confirmHold = 0;
    timeLeft = isTutorialPuzzle ? TIMEOUT_TUTORIAL : TIMEOUT;
    pointerU = -1;
    pointerV = -1;
    dirty = true;
  }

  function resetPuzzle() {
    loadStage(0);
  }

  function currentSolution() {
    return stageSolutions[stageIndex] || [];
  }

  function sequenceMatches() {
    var need = currentSolution();
    if (sequence.length !== need.length) return false;
    for (var i = 0; i < need.length; i++) {
      if (sequence[i] !== need[i]) return false;
    }
    return true;
  }

  function applySolution() {
    sequence = currentSolution().slice();
    matched = true;
    confirmHold = 0.6;
    dirty = true;
  }

  function clearSequence() {
    if (!active) return;
    sequence = [];
    matched = false;
    confirmHold = 0;
    dirty = true;
  }

  function inVR() {
    return !!(NS.vr && NS.vr.active && NS.vr.active());
  }

  function clearRect() {
    var w = canvas ? canvas.width : 0;
    var h = canvas ? canvas.height : 0;
    return { x: w * 0.5 - 70, y: h - 52, w: 140, h: 32 };
  }

  function ensureCanvas() {
    if (canvas) return;
    if (typeof document === 'undefined') return;
    canvas = document.createElement('canvas');
    canvas.id = 'circuit-overlay';
    canvas.width = PAD * 2 + CELL * SIZE;
    canvas.height = TOP + CELL * SIZE + BOTTOM;
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
      hitAt(x, y, true);
    });
  }

  function drawShape(cx, cy, r, shape, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#04140a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (shape === 'CIRCLE') {
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (shape === 'SQUARE') {
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
    } else if (shape === 'TRIANGLE') {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.lineTo(cx - r, cy + r);
      ctx.closePath();
    } else if (shape === 'DIAMOND') {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
    } else if (shape === 'STAR') {
      for (var i = 0; i < 5; i++) {
        var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        var x = cx + Math.cos(a) * r;
        var y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        var a2 = a + Math.PI / 5;
        ctx.lineTo(cx + Math.cos(a2) * r * 0.42, cy + Math.sin(a2) * r * 0.42);
      }
      ctx.closePath();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
      return;
    }
    ctx.fill();
    ctx.stroke();
  }

  function drawPointer() {
    if (pointerU < 0 || pointerV < 0 || pointerFresh <= 0 || !ctx) return;
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
    ctx.restore();
  }

  function seqText() {
    var parts = [];
    for (var i = 0; i < SEQ_LEN; i++) {
      parts.push(sequence[i] || '·');
    }
    return parts.join('  →  ');
  }

  function render() {
    if (!active || !ctx) return;
    var w = canvas.width, h = canvas.height;
    ctx.fillStyle = rejectFlash > 0 ? '#1a0808' : '#020805';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#7cff9b';
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      isTutorialPuzzle
        ? 'PRACTICE HANDSHAKE  —  PRESS THE PADS SHOWN'
        : ('CORE HANDSHAKE  —  STAGE ' + (stageIndex + 1) + '/' + stageSolutions.length),
      w / 2, 22
    );

    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 20px Consolas, monospace';
    ctx.fillText('SERIAL  ' + serial, w / 2, 48);

    ctx.fillStyle = '#3f8a55';
    ctx.font = '11px Consolas, monospace';
    if (isTutorialPuzzle) {
      var hint = currentSolution();
      var names = hint.map(function (id) {
        var p = padById(id);
        return p ? (p.color + ' ' + p.shape + ' (' + p.id + ')') : id;
      });
      ctx.fillText('SOLO — NO DOSSIER · ' + names.join('  THEN  '), w / 2, 68);
    } else {
      ctx.fillText('READ THE SERIAL ALOUD · SOLVER HAS THE PAD ORDER · POINT AND PRESS', w / 2, 68);
    }

    ctx.fillStyle = timeLeft < 8 ? '#ff4444' : '#ffb347';
    ctx.fillText('LOCKOUT T-' + Math.ceil(timeLeft) + 's', w / 2, 86);

    ctx.fillStyle = matched ? '#9fffbb' : (rejectFlash > 0 ? '#ff6666' : '#7cff9b');
    ctx.font = 'bold 16px Consolas, monospace';
    ctx.fillText(seqText(), w / 2, 110);

    ctx.fillStyle = '#3f8a55';
    ctx.font = '10px Consolas, monospace';
    for (var c = 0; c < SIZE; c++) {
      ctx.fillText(COL_LABELS.charAt(c), PAD + c * CELL + CELL * 0.5, TOP - 8);
    }

    for (var r = 0; r < SIZE; r++) {
      ctx.fillText(String(r + 1), PAD - 14, TOP + r * CELL + CELL * 0.55);
      for (c = 0; c < SIZE; c++) {
        var i = idx(c, r);
        var pad = PADS[i];
        var x = PAD + c * CELL, y = TOP + r * CELL;
        var seqPos = sequence.indexOf(pad.id);
        var isSel = i === selected;
        ctx.fillStyle = 'rgba(8,24,12,0.9)';
        ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
        ctx.strokeStyle = isSel ? '#ffb347' : (seqPos >= 0 ? '#7cff9b' : '#3f8a55');
        ctx.lineWidth = isSel ? 3 : 1.4;
        ctx.strokeRect(x + 4, y + 4, CELL - 8, CELL - 8);

        drawShape(x + CELL / 2, y + CELL / 2 - 8, 18, pad.shape, FILL[pad.color] || '#888');

        ctx.fillStyle = isSel ? '#ffb347' : '#8fd9a8';
        ctx.font = 'bold 13px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(pad.id, x + CELL / 2, y + CELL - 28);
        ctx.fillStyle = '#5aa877';
        ctx.font = '9px Consolas, monospace';
        ctx.fillText(pad.color + ' ' + pad.shape, x + CELL / 2, y + CELL - 14);

        if (seqPos >= 0) {
          ctx.fillStyle = '#ffb347';
          ctx.font = 'bold 16px Consolas, monospace';
          ctx.fillText(String(seqPos + 1), x + 18, y + 22);
        }
      }
    }

    var cr = clearRect();
    var clearHot = selected < 0;
    ctx.strokeStyle = clearHot ? '#ffb347' : '#3f8a55';
    ctx.lineWidth = clearHot ? 2.5 : 1;
    ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
    ctx.fillStyle = clearHot ? '#ffb347' : '#5aa877';
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.fillText('CLEAR SEQUENCE', w / 2, cr.y + 21);

    ctx.fillStyle = '#3f8a55';
    ctx.font = '10px Consolas, monospace';
    if (matched) {
      ctx.fillStyle = '#ffb347';
      ctx.font = '13px Consolas, monospace';
      ctx.fillText(stageIndex < stageSolutions.length - 1
        ? 'SEQUENCE VALID — HOLDING TO ADVANCE…'
        : 'SEQUENCE VALID — HOLDING TO CONFIRM…', w / 2, h - 10);
    } else if (rejectFlash > 0) {
      ctx.fillStyle = '#ff6666';
      ctx.fillText('REJECTED — CLEAR AND RETRY', w / 2, h - 10);
    } else {
      ctx.fillText(isTutorialPuzzle
        ? 'CLICK / LASER + X TO PRESS · MATCH THE ORDER ABOVE'
        : 'CALL THE SERIAL · PRESS THREE PADS IN SOLVER ORDER', w / 2, h - 10);
    }

    drawPointer();
    dirty = true;
  }

  function hitAt(x, y, press) {
    var cr = clearRect();
    if (x >= cr.x && x <= cr.x + cr.w && y >= cr.y && y <= cr.y + cr.h) {
      selected = -1;
      if (press) clearSequence();
      else dirty = true;
      return -1;
    }
    var c = Math.floor((x - PAD) / CELL);
    var r = Math.floor((y - TOP) / CELL);
    if (c < 0 || r < 0 || c >= SIZE || r >= SIZE) return -2;
    var i = idx(c, r);
    selected = i;
    if (press) pressSelected();
    else dirty = true;
    return i;
  }

  function pressSelected() {
    if (!active || matched) return;
    if (selected < 0) {
      clearSequence();
      return;
    }
    if (sequence.length >= SEQ_LEN) return;
    var pad = PADS[selected];
    if (!pad) return;
    if (sequence.indexOf(pad.id) >= 0) return;
    sequence.push(pad.id);
    confirmHold = 0;
    if (sequence.length === SEQ_LEN) {
      if (sequenceMatches()) {
        matched = true;
      } else {
        rejectFlash = 0.85;
        sequence = [];
      }
    }
    dirty = true;
    render();
  }

  function moveSelection(dc, dr) {
    if (!active) return;
    if (selected < 0) selected = 0;
    var c = selected % SIZE;
    var r = Math.floor(selected / SIZE);
    c = Math.max(0, Math.min(SIZE - 1, c + dc));
    r = Math.max(0, Math.min(SIZE - 1, r + dr));
    selected = idx(c, r);
    dirty = true;
    render();
  }

  function nextTile() {
    if (!active) return;
    if (selected < 0) selected = 0;
    else selected = (selected + 1) % (SIZE * SIZE);
    dirty = true;
    render();
  }

  function pickUv(u, v) {
    if (!active || !canvas) return -1;
    setPointer(u, v);
    var x = u * canvas.width;
    var y = v * canvas.height;
    return hitAt(x, y, false);
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

  function missionStageCount(opts) {
    var n = opts && opts.stageCount != null ? opts.stageCount : 3;
    n = n | 0;
    if (n < 1) n = 1;
    if (n > 3) n = 3;
    return n;
  }

  function open(successCb, timeoutCb, stageClearCb, opts) {
    ensureCanvas();
    isTutorialPuzzle = !!(opts && opts.tutorial);
    if (isTutorialPuzzle) {
      bandId = 'EAST';
      serial = '4B7';
    } else {
      if (!raidSerial) assignRaidSerial();
      bandId = raidBand;
      serial = raidSerial;
    }
    var n = isTutorialPuzzle ? 1 : missionStageCount(opts);
    stageSolutions = (SOLUTIONS[bandId] || SOLUTIONS.EAST).slice(0, n);
    resetPuzzle();
    onSuccess = successCb;
    onTimeout = timeoutCb;
    onStageClear = stageClearCb || null;
    active = true;
    if (canvas) canvas.style.display = inVR() ? 'none' : 'block';
    render();
  }

  function close() {
    active = false;
    isTutorialPuzzle = false;
    stageSolutions = [];
    if (canvas) canvas.style.display = 'none';
    onSuccess = null;
    onTimeout = null;
    onStageClear = null;
    pointerU = -1;
    pointerV = -1;
    dirty = true;
  }

  function finishStageOrDone() {
    if (stageIndex < stageSolutions.length - 1) {
      var next = stageIndex + 1;
      if (onStageClear) onStageClear(stageIndex + 1, stageSolutions.length);
      loadStage(next);
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
    if (rejectFlash > 0) rejectFlash -= dt;
    if (timeLeft <= 0) {
      var cb = onTimeout;
      close();
      if (cb) cb();
      return true;
    }
    if (matched) {
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

  function getSheetData() {
    return {
      size: SIZE,
      colLabels: COL_LABELS,
      pads: PADS.map(function (p) { return { id: p.id, color: p.color, shape: p.shape }; }),
      bands: BANDS.map(function (b) {
        return { id: b.id, serialLabel: b.serialLabel, title: b.title, starts: b.starts };
      }),
      solutions: {
        WEST: SOLUTIONS.WEST.map(function (s) { return s.slice(); }),
        EAST: SOLUTIONS.EAST.map(function (s) { return s.slice(); }),
        CORE: SOLUTIONS.CORE.map(function (s) { return s.slice(); })
      },
      blackoutTime: BLACKOUT_TIME,
      dutyLog: DUTY_LOG.map(function (row) {
        return { t: row.t, ink: row.ink, text: row.text };
      }),
      intercepts: INTERCEPTS.map(function (row) {
        return {
          id: row.id, stamp: row.stamp, band: row.band, stage: row.stage,
          pads: row.pads.slice()
        };
      }),
      tutorialSerial: '4B7',
      tutorialBand: 'EAST'
    };
  }

  NS.circuit = {
    open: open, close: close, update: update,
    rotateSelected: pressSelected,
    pressSelected: pressSelected,
    moveSelection: moveSelection, nextTile: nextTile, pickUv: pickUv,
    setPointer: setPointer, clearPointer: clearPointer,
    clearSequence: clearSequence,
    resetRun: resetRun,
    isActive: function () { return active; },
    getStage: function () { return stageIndex + 1; },
    getStageCount: function () { return stageSolutions.length || 3; },
    getCanvas: function () { return canvas; },
    getSerial: function () { return serial; },
    getSheetData: getSheetData,
    isGenuine: isGenuine,
    consumeDirty: function () {
      var d = dirty;
      dirty = false;
      return d;
    },
    debug: {
      reset: resetPuzzle,
      resetRun: resetRun,
      loadStage: loadStage,
      setStage: function (i) { loadStage(i); },
      start: function (opts) {
        opts = opts || {};
        isTutorialPuzzle = !!opts.tutorial;
        bandId = opts.band || 'EAST';
        serial = opts.serial || '4B7';
        var n = opts.stageCount != null ? opts.stageCount : 3;
        stageSolutions = (SOLUTIONS[bandId] || SOLUTIONS.EAST).slice(0, n);
        active = true;
        resetPuzzle();
      },
      solve: applySolution,
      connected: sequenceMatches,
      matched: function () { return matched; },
      sequence: function () { return sequence.slice(); },
      solution: function () { return currentSolution().slice(); },
      serial: function () { return serial; },
      band: function () { return bandId; },
      stageCount: function () { return stageSolutions.length; },
      isGenuine: isGenuine,
      intercepts: function () { return INTERCEPTS; },
      solutions: SOLUTIONS
    }
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
