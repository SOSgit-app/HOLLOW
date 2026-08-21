/* HOLLOW — map.js : Site C sublevel 2. ASCII grid, DDA raycast, A*, occlusion. */
(function (NS) {
  'use strict';

  var CELL = 3;      // metres per cell
  var WALL_H = 4;    // ceiling height, metres

  // Legend: '#'/' ' solid · '.' floor · S safe/harbor · P spawn · C lair
  //         1 2 3 fuses · G generator · X exit · W POW
  var MISSION_ASCII = [
    "################################################",
    "#......#..........#...........#......#.........#",
    "#......#..........#.....2.....#......#....3....#",
    "#......#..........#...........#..##..#.........#",
    "#......#..#####...#..##...##..#..##..#..####...#",
    "#...#..#..#...#...#..##...##..#......#..#..#...#",
    "#...#.....#...#......##...##.....##.....#..#...#",
    "#...#..#..#####...#...........#..##..#..#..#...#",
    "#...#..#..........#...........#......#..#..#...#",
    "#...#..#..........#...........#......#..#..#...#",
    "###.#############.#####...########.######.####.#",
    "#......#...........#.........#.................#",
    "#......#...........#.........#..##..##..##.....#",
    "#..1...#..##..##................##..##..##..#..#",
    "#......#..##..##....#.........#..............#.#"
  ];
  var MISSION_ASCII2 = [
    "#...#..#............#.........#..##..##..##..#.#",
    "#...#..#..##W.##....#.........#..##..##..##....#",
    "#...#......##..##...#....#######...............#",
    "#...#..#............#....#.....#..############.#",
    "#...#..#############.....#.....#...............#",
    "#......#............#....#.....#..#########....#",
    "#......#............#....#.....#..#.......#....#",
    "#..##..#............#....#.....#..#.......#....#",
    "#..##.....P.........#....#..............G.#....#",
    "#......#............#....#.....#..#.......#....#",
    "#......#............#....#.....#..#########....#",
    "######.##....########....##..###...............#",
    "#....#.......#..........................####...#",
    "#....#..######..######....######..#####....#...#",
    "#....#..#......................#..#...#....#...#",
    "#.X..#..#..######..######..#...#..#...#....#...#",
    "#....#..#..#....#..#....#..#...#......#.C..#...#",
    "#....#..#..#....#..#....#..#...#..#...#....#...#",
    "#....#..................#..#......#...#....#...#",
    "#......................................####....#",
    "################################################"
  ];

  // Compact tutorial arena: harbor → key room → keyed door → console · south LZ
  // Stations: move → key → door → circuit → tripwire → virus → exfil
  var TUTORIAL_ASCII = [
    "########################",
    "#SSSSSS#.......#.......#",
    "#SSPSSS................#",
    "#SSSSSS#...1...#..CG...#",
    "#SSSSSS#.......#.......#",
    "########.......#########",
    "#..............#########",
    "#......................#",
    "#..........X...........#",
    "#......................#",
    "########################"
  ];

  var currentLayout = 'mission';
  var laserSet = 'standard';
  var ASCII = MISSION_ASCII;
  var ASCII2 = MISSION_ASCII2;

  // grid[row][col] => true if solid; safe[row][col] => acoustic harbor
  var grid = [];
  var safe = [];
  var lz = []; // yellow landing-zone pad
  var consoleRoom = []; // walkable cells of the jack-in room — security cannot enter
  var ROWS = 0, COLS = 0;
  var markers = { fuses: [], P: null, C: null, G: null, X: null, W: null, safes: [], lasers: [], lasersEasy: [], doors: [] };
  var doorSolid = {}; // key "c,r" -> true while locked

  // Stencilled wall codes ("B4", "K2", ...) painted on wall faces so the
  // Operator can read a location aloud and the Director can find it on the
  // printed map. See buildWallMarks().
  var wallMarks = [];
  var wallMarkByCell = [];  // openR * COLS + openC -> mark (at most one per cell)
  var MARK_SPACING = 6;     // cells between marks along a wall run
  var MARK_PX = 0.048;      // stencil pixel size, metres (2x glyphs, 15 rows)
  var MARK_H = MARK_PX * 15;
  var MARK_Y = 1.55;        // stencil centre height, metres

  function doorKey(c, r) { return c + ',' + r; }

  function setDoorSolid(c, r, locked) {
    var k = doorKey(c, r);
    if (locked) doorSolid[k] = true;
    else delete doorSolid[k];
  }

  function isDoorSolid(c, r) {
    return !!doorSolid[doorKey(c, r)];
  }

  function placeLzPad() {
    if (!markers.X) return;
    var cx = Math.floor(markers.X.x / CELL);
    var cz = Math.floor(markers.X.z / CELL);
    var rad = 2;
    for (var r = cz - rad; r <= cz + rad; r++) {
      for (var c = cx - rad; c <= cx + rad; c++) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
        if (grid[r][c]) continue;
        lz[r][c] = true;
      }
    }
  }

  function laserH(c0, c1, r, id, easyOnly) {
    var IN = 0.08, TY = 0.22, TH = 0.03;
    return {
      x0: c0 * CELL + IN, z0: r * CELL, x1: c1 * CELL - IN, z1: r * CELL,
      y0: TY - TH, y1: TY + TH, id: id, easyOnly: !!easyOnly
    };
  }
  function laserV(c, r0, r1, id, easyOnly) {
    var IN = 0.08, TY = 0.22, TH = 0.03;
    return {
      x0: c * CELL, z0: r0 * CELL + IN, x1: c * CELL, z1: r1 * CELL - IN,
      y0: TY - TH, y1: TY + TH, id: id, easyOnly: !!easyOnly
    };
  }

  // Same walls/keys/doors as the raid. Easy adds extra hallway beams so
  // the three beacons have work to do without changing the printed geometry.
  function missionLasersEasy() {
    return [
      laserH(9, 13, 26.5, 'L-HARBOR', true), // south bottleneck out of spawn
      laserV(3.5, 17, 18, 'L-WEST', true),   // west spine toward key 1
      laserH(8, 10, 16.5, 'L-POW', true),    // west of POW cell
      laserV(24.5, 27, 29, 'L-D2', true),    // hall west of D2
      laserH(14, 22, 34.5, 'L-LZ', true)     // south run into the LZ
    ];
  }
  function missionLasers() {
    var core = [
      laserH(3, 4, 10.5, 'L-STORAGE'),
      laserV(18.5, 6, 7, 'L-LAB'),
      laserV(15.5, 15, 16, 'L-MID'),
      laserV(31.5, 23, 24, 'L-GEN'),
      laserV(5.5, 34, 35, 'L-EXIT')
    ];
    markers.lasersEasy = missionLasersEasy();
    return laserSet === 'easy' ? core.concat(markers.lasersEasy) : core;
  }

  function parse() {
    var rows = currentLayout === 'tutorial' ? TUTORIAL_ASCII : MISSION_ASCII.concat(MISSION_ASCII2);
    markers.fuses = [];
    markers.P = null;
    markers.C = null;
    markers.G = null;
    markers.X = null;
    markers.W = null;
    markers.safes = [];
    markers.lasers = [];
    markers.doors = [];
    ROWS = rows.length;
    COLS = rows[0].length;
    grid = [];
    safe = [];
    lz = [];
    consoleRoom = [];
    for (var r = 0; r < ROWS; r++) {
      var line = rows[r];
      if (line.length !== COLS) {
        throw new Error('HOLLOW map: row ' + r + ' length ' + line.length + ' != ' + COLS);
      }
      var row = [], srow = [], lrow = [], crow = [];
      for (var c = 0; c < COLS; c++) {
        var ch = line[c];
        row.push(ch === '#' || ch === ' ');
        srow.push(false);
        lrow.push(false);
        crow.push(false);
        var wx = (c + 0.5) * CELL, wz = (r + 0.5) * CELL;
        if (ch === 'P') markers.P = { x: wx, z: wz };
        else if (ch === 'C') markers.C = { x: wx, z: wz };
        else if (ch === 'G') markers.G = { x: wx, z: wz };
        else if (ch === 'X') markers.X = { x: wx, z: wz };
        else if (ch === 'W') markers.W = { x: wx, z: wz };
        else if (ch === '1' || ch === '2' || ch === '3') markers.fuses[+ch - 1] = { x: wx, z: wz };
        else if (ch === 'S') {
          srow[c] = true;
          markers.safes.push({ x: wx, z: wz, c: c, r: r });
        }
      }
      grid.push(row);
      safe.push(srow);
      lz.push(lrow);
      consoleRoom.push(crow);
    }

    var IN = 0.08;
    var TY = 0.22;
    var TH = 0.03;

    if (currentLayout === 'tutorial') {
      // Harbor around spawn (cols 1-6, rows 1-4)
      for (var sr = 1; sr <= 4; sr++) {
        for (var sc = 1; sc <= 6; sc++) placeSafe(sc, sr);
      }
      // Tripwire armed only after circuit (see armTutorialTripwire in game.js)
      markers.lasers = [];
      markers.lasersEasy = [];
      markers.doors = [
        { id: 'D1', c: 15, r: 2, locked: true, keysRequired: 1, console: true }
      ];
    } else {
      // One Faraday sanctuary = the spawn / infil room (around P)
      for (var mr = 20; mr <= 25; mr++) {
        for (var mc = 8; mc <= 19; mc++) placeSafe(mc, mr);
      }
      markers.lasers = missionLasers();
      markers.doors = [
        { id: 'D1', c: 17, r: 10, locked: true, keysRequired: 1 },
        { id: 'D2', c: 26, r: 27, locked: true, keysRequired: 1 },
        { id: 'D3', c: 34, r: 23, locked: true, keysRequired: 3, console: true }
      ];
    }

    placeLzPad();

    buildWallMarks();

    doorSolid = {};
    markers.doors.forEach(function (d) {
      if (!grid[d.r] || grid[d.r][d.c]) {
        throw new Error('HOLLOW door on solid/invalid cell ' + d.id + ' @' + d.c + ',' + d.r);
      }
      setDoorSolid(d.c, d.r, true);
      d.x = (d.c + 0.5) * CELL;
      d.z = (d.r + 0.5) * CELL;
    });
    buildConsoleRoom();
    markers.keys = markers.fuses;
  }

  function placeSafe(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    if (grid[r][c]) return;
    if (!safe[r][c]) {
      safe[r][c] = true;
      markers.safes.push({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL, c: c, r: r });
    }
  }

  // Flood-fill the jack-in room from G, treating the console door cell as a
  // sealed threshold so security can walk up to it but never inside.
  function buildConsoleRoom() {
    var r, c;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) consoleRoom[r][c] = false;
    }
    if (!markers.G) return;
    var gc = Math.floor(markers.G.x / CELL), gr = Math.floor(markers.G.z / CELL);
    var door = null;
    for (var i = 0; i < markers.doors.length; i++) {
      if (markers.doors[i].console) { door = markers.doors[i]; break; }
    }
    var blocked = {};
    if (door) blocked[door.c + ',' + door.r] = true;
    var q = [[gc, gr]], qi = 0;
    if (gc < 0 || gr < 0 || gc >= COLS || gr >= ROWS || grid[gr][gc]) return;
    consoleRoom[gr][gc] = true;
    while (qi < q.length) {
      var cur = q[qi++];
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var n = 0; n < 4; n++) {
        var nc = cur[0] + nb[n][0], nr = cur[1] + nb[n][1];
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        if (grid[nr][nc] || consoleRoom[nr][nc]) continue;
        if (blocked[nc + ',' + nr]) continue;
        consoleRoom[nr][nc] = true;
        q.push([nc, nr]);
      }
    }
  }

  function isConsoleCell(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    return !!consoleRoom[r][c];
  }
  function isConsoleAt(x, z) {
    return isConsoleCell(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  // ---------------------------------------------------------------
  // Wall codes. Every open cell that backs onto a wall is a candidate face;
  // we keep one every MARK_SPACING cells along the run so a sweep of any
  // corridor turns up a code. The letter is a coarse zone (6x4 blocks over
  // the map), the digit counts marks inside that zone, top-left to
  // bottom-right — so "K3" narrows to a block before you even read the map.
  // ---------------------------------------------------------------
  var ZONE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O: unreadable stencilled

  function buildWallMarks() {
    wallMarks = [];
    wallMarkByCell = new Array(ROWS * COLS);
    var zCols = Math.max(1, Math.round(COLS / 8));
    var zRows = Math.max(1, Math.round(ROWS / 9));
    if (zCols * zRows > ZONE_LETTERS.length) zCols = Math.max(1, Math.floor(ZONE_LETTERS.length / zRows));
    var zw = COLS / zCols, zh = ROWS / zRows;
    var counts = {};
    // dc/dr point at the wall; along tells which axis the wall face runs on.
    var DIRS = [
      { dc: 0, dr: -1, axis: 'Z' }, { dc: 0, dr: 1, axis: 'Z' },
      { dc: -1, dr: 0, axis: 'X' }, { dc: 1, dr: 0, axis: 'X' }
    ];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (grid[r][c]) continue;
        for (var d = 0; d < DIRS.length; d++) {
          var dir = DIRS[d];
          var wc = c + dir.dc, wr = r + dir.dr;
          if (wc < 0 || wr < 0 || wc >= COLS || wr >= ROWS) continue;
          if (!grid[wr][wc]) continue;
          // space marks out along the wall's own axis
          if ((dir.axis === 'X' ? r : c) % MARK_SPACING !== 0) continue;
          var zi = Math.min(zRows - 1, Math.floor(r / zh)) * zCols
                 + Math.min(zCols - 1, Math.floor(c / zw));
          var letter = ZONE_LETTERS[zi % ZONE_LETTERS.length];
          counts[letter] = (counts[letter] || 0) + 1;
          var code = letter + counts[letter];
          // plane = shared cell boundary; along = centre of the open cell
          var plane = (dir.axis === 'X' ? (dir.dc > 0 ? wc : c) : (dir.dr > 0 ? wr : r)) * CELL;
          var along = (dir.axis === 'X' ? r + 0.5 : c + 0.5) * CELL;
          var mark = {
            code: code, zone: letter, axis: dir.axis,
            c: c, r: r, wc: wc, wr: wr,
            plane: plane, along: along,
            x: dir.axis === 'X' ? plane : along,
            z: dir.axis === 'X' ? along : plane,
            y: MARK_Y,
            faceC: dir.dc, faceR: dir.dr,
            // text reads left-to-right for someone standing in the open cell
            flip: dir.axis === 'X' ? dir.dc < 0 : dir.dr > 0,
            w: (code.length * 12 - 1) * MARK_PX, h: MARK_H
          };
          wallMarks.push(mark);
          wallMarkByCell[r * COLS + c] = mark;
          break; // one code per cell keeps the printed map readable
        }
      }
    }
  }

  // Look up the code painted on the face between an open cell and a wall cell.
  // Called once per scan ray, so it stays allocation-free.
  function wallMarkFor(openC, openR, wallC, wallR) {
    if (openC < 0 || openR < 0 || openC >= COLS || openR >= ROWS) return null;
    var m = wallMarkByCell[openR * COLS + openC];
    return (m && m.wc === wallC && m.wr === wallR) ? m : null;
  }

  function wallMarkBox() { return { px: MARK_PX, h: MARK_H, y: MARK_Y }; }

  function loadLayout(name, opts) {
    currentLayout = (name === 'tutorial') ? 'tutorial' : 'mission';
    laserSet = (opts && opts.lasers) || 'standard';
    parse();
    return currentLayout;
  }

  parse();

  function isSafeCell(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    return !!safe[r][c];
  }
  function isSafeAt(x, z) {
    return isSafeCell(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  function isLzCell(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    return !!(lz[r] && lz[r][c]);
  }
  function isLzAt(x, z) {
    return isLzCell(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  function asciiRows() {
    return currentLayout === 'tutorial' ? TUTORIAL_ASCII.slice() : MISSION_ASCII.concat(MISSION_ASCII2);
  }

  function isSolidCell(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
    if (isDoorSolid(c, r)) return true;
    return grid[r][c];
  }
  function isSolidAt(x, z) {
    return isSolidCell(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  // ---------------------------------------------------------------
  // Raycast: analytic floor/ceiling planes + 2D DDA through wall cells.
  // Returns { t, x, y, z, type } with type in 'wall' | 'door' | 'floor' | 'ceil',
  // or null if nothing within maxDist.
  // ---------------------------------------------------------------
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    var best = maxDist, type = null;
    var hitAxis = null, hitC = 0, hitR = 0, openC = 0, openR = 0;

    if (dy < -1e-6) {                       // floor y=0
      var tf = -oy / dy;
      if (tf > 0 && tf < best) { best = tf; type = 'floor'; }
    } else if (dy > 1e-6) {                 // ceiling y=WALL_H
      var tc = (WALL_H - oy) / dy;
      if (tc > 0 && tc < best) { best = tc; type = 'ceil'; }
    }

    // 2D DDA over (x,z)
    var cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    if (isSolidCell(cx, cz)) {
      return { t: 0, x: ox, y: oy, z: oz, type: isDoorSolid(cx, cz) ? 'door' : 'wall' };
    }
    var adx = Math.abs(dx), adz = Math.abs(dz);
    if (adx > 1e-9 || adz > 1e-9) {
      var stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      var tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
      var tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
      var nextVX = (cx + (dx > 0 ? 1 : 0)) * CELL;
      var nextVZ = (cz + (dz > 0 ? 1 : 0)) * CELL;
      var tMaxX = adx > 1e-9 ? (nextVX - ox) / dx : Infinity;
      var tMaxZ = adz > 1e-9 ? (nextVZ - oz) / dz : Infinity;
      var t = 0, axis = null;
      for (var i = 0; i < 256; i++) {
        if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; axis = 'X'; }
        else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; axis = 'Z'; }
        if (t >= best) break;
        if (isSolidCell(cx, cz)) {
          best = t;
          type = isDoorSolid(cx, cz) ? 'door' : 'wall';
          hitAxis = axis;
          hitC = cx; hitR = cz;
          openC = axis === 'X' ? cx - stepX : cx;
          openR = axis === 'Z' ? cz - stepZ : cz;
          break;
        }
      }
    }

    if (type === null) return null;
    return {
      t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, type: type,
      axis: hitAxis, wallC: hitC, wallR: hitR, openC: openC, openR: openR
    };
  }

  // ---------------------------------------------------------------
  // Walls crossed on the straight line between two world points
  // (Bresenham on cells) — hearing attenuation, GDD §3.4.
  // ---------------------------------------------------------------
  function wallsBetween(ax, az, bx, bz) {
    var x0 = Math.floor(ax / CELL), y0 = Math.floor(az / CELL);
    var x1 = Math.floor(bx / CELL), y1 = Math.floor(bz / CELL);
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy, count = 0, guard = 0;
    while (guard++ < 256) {
      if (isSolidCell(x0, y0)) count++;
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return count;
  }

  // ---------------------------------------------------------------
  // A* over walkable cells, 4-connected. Returns array of world-space
  // waypoints [{x,z}...] (excluding start cell), or null.
  // ---------------------------------------------------------------
  function astar(ax, az, bx, bz) {
    var sc = Math.floor(ax / CELL), sr = Math.floor(az / CELL);
    var gc = Math.floor(bx / CELL), gr = Math.floor(bz / CELL);
    // Security never paths into the console room. If the goal is inside
    // (or on the locked door), snap to a walkable cell just outside the door.
    if (isConsoleCell(gc, gr) || (consoleDoor() && gc === consoleDoor().c && gr === consoleDoor().r)) {
      var d = consoleDoor();
      var snapped = false;
      if (d) {
        var nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var si = 0; si < 4; si++) {
          var oc = d.c + nbs[si][0], or = d.r + nbs[si][1];
          if (!isSolidCell(oc, or) && !isConsoleCell(oc, or)) {
            gc = oc; gr = or; snapped = true; break;
          }
        }
      }
      if (!snapped) return null;
    }
    if (isSolidCell(gc, gr) || isSolidCell(sc, sr)) return null;
    var W = COLS, key = function (c, r) { return r * W + c; };
    var open = [{ c: sc, r: sr, g: 0, f: 0 }];
    var came = {}, gScore = {};
    gScore[key(sc, sr)] = 0;
    var closed = {};
    var h = function (c, r) { return Math.abs(c - gc) + Math.abs(r - gr); };
    open[0].f = h(sc, sr);

    while (open.length) {
      // small open sets here; linear extract-min is fine
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0];
      var ck = key(cur.c, cur.r);
      if (closed[ck]) continue;
      closed[ck] = true;
      if (cur.c === gc && cur.r === gr) {
        var path = [];
        var k = ck;
        while (came[k] !== undefined) {
          var c = k % W, r = (k - c) / W;
          path.push({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL });
          k = came[k];
        }
        path.reverse();
        return path;
      }
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var n = 0; n < 4; n++) {
        var nc = cur.c + nb[n][0], nr = cur.r + nb[n][1];
        if (isSolidCell(nc, nr)) continue;
        // already-inside units can leave; nobody walks in
        if (isConsoleCell(nc, nr) && !isConsoleCell(cur.c, cur.r)) continue;
        var nk = key(nc, nr);
        var ng = cur.g + 1;
        if (gScore[nk] === undefined || ng < gScore[nk]) {
          gScore[nk] = ng;
          came[nk] = ck;
          open.push({ c: nc, r: nr, g: ng, f: ng + h(nc, nr) });
        }
      }
    }
    return null;
  }

  // Collision: slide a circle of radius rad against solid cells.
  function moveWithCollision(x, z, nx, nz, rad, opts) {
    var avoidConsole = opts && opts.avoidConsole;
    function blocked(px, pz) {
      // sample the circle against the four nearest cell edges
      if (isSolidAt(px - rad, pz) || isSolidAt(px + rad, pz) ||
          isSolidAt(px, pz - rad) || isSolidAt(px, pz + rad) ||
          isSolidAt(px - rad * 0.707, pz - rad * 0.707) ||
          isSolidAt(px + rad * 0.707, pz - rad * 0.707) ||
          isSolidAt(px - rad * 0.707, pz + rad * 0.707) ||
          isSolidAt(px + rad * 0.707, pz + rad * 0.707)) return true;
      if (avoidConsole && isConsoleAt(px, pz) && !isConsoleAt(x, z)) return true;
      return false;
    }
    var rx = x, rz = z;
    if (!blocked(nx, rz)) rx = nx;
    if (!blocked(rx, nz)) rz = nz;
    return { x: rx, z: rz };
  }

  // Room-centre waypoints for patrol (walkable cells with open space around)
  function patrolWaypoints() {
    var pts = [];
    for (var r = 2; r < ROWS - 2; r += 4) {
      for (var c = 2; c < COLS - 2; c += 4) {
        if (!isSolidCell(c, r) && !isSolidCell(c + 1, r) &&
            !isSolidCell(c, r + 1) && !isSolidCell(c - 1, r) && !isSolidCell(c, r - 1) &&
            !isConsoleCell(c, r)) {
          pts.push({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL });
        }
      }
    }
    return pts;
  }

  // Ray–laser: AABB slab hit on the floating tripwire sheet (wall-to-wall segment)
  function rayLaser(ox, oy, oz, dx, dy, dz, maxDist) {
    var best = -1;
    var THICK = 0.05; // thin ribbon — one beam, not a double sheet
    for (var i = 0; i < markers.lasers.length; i++) {
      var L = markers.lasers[i];
      var lx0 = Math.min(L.x0, L.x1), lx1 = Math.max(L.x0, L.x1);
      var lz0 = Math.min(L.z0, L.z1), lz1 = Math.max(L.z0, L.z1);
      // Expand the thin axis so the beam is a visible vertical ribbon
      if (lx1 - lx0 < THICK * 2) {
        var mx = (lx0 + lx1) * 0.5;
        lx0 = mx - THICK; lx1 = mx + THICK;
      }
      if (lz1 - lz0 < THICK * 2) {
        var mz = (lz0 + lz1) * 0.5;
        lz0 = mz - THICK; lz1 = mz + THICK;
      }
      var t0 = 0, t1 = maxDist;
      // X slab
      if (Math.abs(dx) > 1e-8) {
        var tx0 = (lx0 - ox) / dx, tx1 = (lx1 - ox) / dx;
        if (tx0 > tx1) { var tmpx = tx0; tx0 = tx1; tx1 = tmpx; }
        t0 = Math.max(t0, tx0); t1 = Math.min(t1, tx1);
      } else if (ox < lx0 || ox > lx1) continue;
      // Y slab (floating band)
      if (Math.abs(dy) > 1e-8) {
        var ty0 = (L.y0 - oy) / dy, ty1 = (L.y1 - oy) / dy;
        if (ty0 > ty1) { var tmpy = ty0; ty0 = ty1; ty1 = tmpy; }
        t0 = Math.max(t0, ty0); t1 = Math.min(t1, ty1);
      } else if (oy < L.y0 || oy > L.y1) continue;
      // Z slab
      if (Math.abs(dz) > 1e-8) {
        var tz0 = (lz0 - oz) / dz, tz1 = (lz1 - oz) / dz;
        if (tz0 > tz1) { var tmpz = tz0; tz0 = tz1; tz1 = tmpz; }
        t0 = Math.max(t0, tz0); t1 = Math.min(t1, tz1);
      } else if (oz < lz0 || oz > lz1) continue;
      if (t0 >= t1 || t1 <= 0 || t0 > maxDist) continue;
      var tm = t0 > 0 ? t0 : t1;
      if (tm > 0 && tm <= maxDist && (best < 0 || tm < best)) best = tm;
    }
    return best;
  }

  // Distance from point to laser segment in XZ; used for player crossing
  function laserHitPlayer(px, pz, rad) {
    for (var i = 0; i < markers.lasers.length; i++) {
      var L = markers.lasers[i];
      var ax = L.x0, az = L.z0, bx = L.x1, bz = L.z1;
      var abx = bx - ax, abz = bz - az;
      var len2 = abx * abx + abz * abz || 1e-6;
      var t = ((px - ax) * abx + (pz - az) * abz) / len2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var cx = ax + abx * t, cz = az + abz * t;
      var dx = px - cx, dz = pz - cz;
      if (dx * dx + dz * dz <= rad * rad) return L;
    }
    return null;
  }

  function unlockDoor(id) {
    for (var i = 0; i < markers.doors.length; i++) {
      var d = markers.doors[i];
      if (d.id === id || (!id && d.locked)) {
        if (!d.locked) continue;
        d.locked = false;
        setDoorSolid(d.c, d.r, false);
        return d;
      }
    }
    return null;
  }

  function resetDoors() {
    markers.doors.forEach(function (d) {
      d.locked = true;
      setDoorSolid(d.c, d.r, true);
    });
  }

  function doorsOpenCount() {
    var n = 0;
    markers.doors.forEach(function (d) { if (!d.locked) n++; });
    return n;
  }

  function consoleDoor() {
    for (var i = 0; i < markers.doors.length; i++) {
      if (markers.doors[i].console || markers.doors[i].id === 'D3') return markers.doors[i];
    }
    return null;
  }

  function isConsoleSealed() {
    var d = consoleDoor();
    return !!(d && d.locked);
  }

  // Triangle mesh of floors / ceilings / wall faces for flashlight mode.
  // Locked doors are solid faces; unlocking a door opens a floor gap.
  function isMeshFloor(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    if (grid[r][c]) return false;
    if (isDoorSolid(c, r)) return false;
    return true;
  }

  function buildWorldMesh() {
    var verts = [];
    function push(x, y, z, nx, ny, nz, r, g, b) {
      verts.push(x, y, z, nx, ny, nz, r, g, b);
    }
    function quad(p0, p1, p2, p3, nx, ny, nz, r, g, b) {
      var ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      var bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
      var cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      if (cx * nx + cy * ny + cz * nz < 0) {
        var tmp = p1; p1 = p3; p3 = tmp;
      }
      push(p0[0], p0[1], p0[2], nx, ny, nz, r, g, b);
      push(p1[0], p1[1], p1[2], nx, ny, nz, r, g, b);
      push(p2[0], p2[1], p2[2], nx, ny, nz, r, g, b);
      push(p0[0], p0[1], p0[2], nx, ny, nz, r, g, b);
      push(p2[0], p2[1], p2[2], nx, ny, nz, r, g, b);
      push(p3[0], p3[1], p3[2], nx, ny, nz, r, g, b);
    }

    var FLOOR = [0.34, 0.36, 0.38];
    var HARBOR = [0.16, 0.52, 0.28];
    var LZ = [0.55, 0.46, 0.16];
    var WALL = [0.30, 0.34, 0.40];
    var CEIL = [0.11, 0.12, 0.14];
    var DOOR = [0.16, 0.26, 0.70];
    var dirs = [
      { dc: 1, dr: 0 }, { dc: -1, dr: 0 },
      { dc: 0, dr: 1 }, { dc: 0, dr: -1 }
    ];

    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (!isMeshFloor(c, r)) continue;
        var x0 = c * CELL, x1 = (c + 1) * CELL;
        var z0 = r * CELL, z1 = (r + 1) * CELL;
        var fc = FLOOR;
        if (isSafeCell(c, r)) fc = HARBOR;
        else if (isLzCell(c, r)) fc = LZ;
        quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], 0, 1, 0, fc[0], fc[1], fc[2]);
        quad([x0, WALL_H, z0], [x0, WALL_H, z1], [x1, WALL_H, z1], [x1, WALL_H, z0], 0, -1, 0, CEIL[0], CEIL[1], CEIL[2]);

        for (var d = 0; d < dirs.length; d++) {
          var nc = c + dirs[d].dc, nr = r + dirs[d].dr;
          if (isMeshFloor(nc, nr)) continue;
          var col = (isDoorSolid(nc, nr) ? DOOR : WALL);
          var nx = -dirs[d].dc, nz = -dirs[d].dr;
          if (dirs[d].dc === 1) {
            quad([x1, 0, z0], [x1, 0, z1], [x1, WALL_H, z1], [x1, WALL_H, z0], nx, 0, nz, col[0], col[1], col[2]);
          } else if (dirs[d].dc === -1) {
            quad([x0, 0, z1], [x0, 0, z0], [x0, WALL_H, z0], [x0, WALL_H, z1], nx, 0, nz, col[0], col[1], col[2]);
          } else if (dirs[d].dr === 1) {
            quad([x1, 0, z1], [x0, 0, z1], [x0, WALL_H, z1], [x1, WALL_H, z1], nx, 0, nz, col[0], col[1], col[2]);
          } else {
            quad([x0, 0, z0], [x1, 0, z0], [x1, WALL_H, z0], [x0, WALL_H, z0], nx, 0, nz, col[0], col[1], col[2]);
          }
        }
      }
    }

    return { data: new Float32Array(verts), count: verts.length / 9, stride: 9 };
  }

  NS.map = {
    CELL: CELL, WALL_H: WALL_H, ROWS: function () { return ROWS; }, COLS: function () { return COLS; },
    markers: markers,
    isSolidCell: isSolidCell, isSolidAt: isSolidAt,
    isSafeCell: isSafeCell, isSafeAt: isSafeAt,
    isLzCell: isLzCell, isLzAt: isLzAt,
    isConsoleCell: isConsoleCell, isConsoleAt: isConsoleAt,
    raycast: raycast, wallsBetween: wallsBetween, astar: astar,
    moveWithCollision: moveWithCollision, patrolWaypoints: patrolWaypoints,
    rayLaser: rayLaser, laserHitPlayer: laserHitPlayer, asciiRows: asciiRows,
    unlockDoor: unlockDoor, resetDoors: resetDoors, doorsOpenCount: doorsOpenCount,
    consoleDoor: consoleDoor, isConsoleSealed: isConsoleSealed,
    wallMarks: function () { return wallMarks; },
    wallMarkFor: wallMarkFor, wallMarkBox: wallMarkBox,
    loadLayout: loadLayout, layout: function () { return currentLayout; },
    buildWorldMesh: buildWorldMesh
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
