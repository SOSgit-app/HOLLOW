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

  // Compact tutorial arena: harbor → free door → key room → keyed door → console
  // Stations: move → door1 → key → door2 → circuit → virus
  var TUTORIAL_ASCII = [
    "########################",
    "#SSSSSS#.......#.......#",
    "#SSPSSS................#",
    "#SSSSSS#...1...#..CG...#",
    "#SSSSSS#.......#.......#",
    "########.......#########",
    "#..............#########",
    "#......................#",
    "#......................#",
    "#......................#",
    "########################"
  ];

  var currentLayout = 'mission';
  var ASCII = MISSION_ASCII;
  var ASCII2 = MISSION_ASCII2;

  // grid[row][col] => true if solid; safe[row][col] => acoustic harbor
  var grid = [];
  var safe = [];
  var ROWS = 0, COLS = 0;
  var markers = { fuses: [], P: null, C: null, G: null, X: null, W: null, safes: [], lasers: [], doors: [] };
  var doorSolid = {}; // key "c,r" -> true while locked

  function doorKey(c, r) { return c + ',' + r; }

  function setDoorSolid(c, r, locked) {
    var k = doorKey(c, r);
    if (locked) doorSolid[k] = true;
    else delete doorSolid[k];
  }

  function isDoorSolid(c, r) {
    return !!doorSolid[doorKey(c, r)];
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
    for (var r = 0; r < ROWS; r++) {
      var line = rows[r];
      if (line.length !== COLS) {
        throw new Error('HOLLOW map: row ' + r + ' length ' + line.length + ' != ' + COLS);
      }
      var row = [], srow = [];
      for (var c = 0; c < COLS; c++) {
        var ch = line[c];
        row.push(ch === '#' || ch === ' ');
        srow.push(false);
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
    }

    var IN = 0.08;
    var TY = 0.22;
    var TH = 0.03;

    if (currentLayout === 'tutorial') {
      // Harbor around spawn (cols 1-6, rows 1-4)
      for (var sr = 1; sr <= 4; sr++) {
        for (var sc = 1; sc <= 6; sc++) placeSafe(sc, sr);
      }
      // Tripwire armed only after circuit (see releaseTutorialSecurity)
      markers.lasers = [];
      // D1: free practice door into key room. D2: keyed console door.
      markers.doors = [
        { id: 'D1', c: 7, r: 2, locked: true, keysRequired: 0 },
        { id: 'D2', c: 15, r: 2, locked: true, keysRequired: 1, console: true }
      ];
      if (!markers.X && markers.P) markers.X = { x: markers.P.x, z: markers.P.z };
    } else {
      // One Faraday sanctuary = the spawn / infil room (around P)
      for (var mr = 20; mr <= 25; mr++) {
        for (var mc = 8; mc <= 19; mc++) placeSafe(mc, mr);
      }
      markers.lasers = [
        { x0: 3 * CELL + IN, z0: 10.5 * CELL, x1: 4 * CELL - IN, z1: 10.5 * CELL, y0: TY - TH, y1: TY + TH, id: 'L-STORAGE' },
        { x0: 18.5 * CELL, z0: 6 * CELL + IN, x1: 18.5 * CELL, z1: 7 * CELL - IN, y0: TY - TH, y1: TY + TH, id: 'L-LAB' },
        { x0: 15.5 * CELL, z0: 15 * CELL + IN, x1: 15.5 * CELL, z1: 16 * CELL - IN, y0: TY - TH, y1: TY + TH, id: 'L-MID' },
        { x0: 31.5 * CELL, z0: 23 * CELL + IN, x1: 31.5 * CELL, z1: 24 * CELL - IN, y0: TY - TH, y1: TY + TH, id: 'L-GEN' },
        { x0: 5.5 * CELL, z0: 34 * CELL + IN, x1: 5.5 * CELL, z1: 35 * CELL - IN, y0: TY - TH, y1: TY + TH, id: 'L-EXIT' }
      ];
      markers.doors = [
        { id: 'D1', c: 17, r: 10, locked: true, keysRequired: 1 },
        { id: 'D2', c: 26, r: 27, locked: true, keysRequired: 1 },
        { id: 'D3', c: 34, r: 23, locked: true, keysRequired: 3, console: true }
      ];
    }

    doorSolid = {};
    markers.doors.forEach(function (d) {
      if (!grid[d.r] || grid[d.r][d.c]) {
        throw new Error('HOLLOW door on solid/invalid cell ' + d.id + ' @' + d.c + ',' + d.r);
      }
      setDoorSolid(d.c, d.r, true);
      d.x = (d.c + 0.5) * CELL;
      d.z = (d.r + 0.5) * CELL;
    });
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

  function loadLayout(name) {
    currentLayout = (name === 'tutorial') ? 'tutorial' : 'mission';
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
      var t = 0;
      for (var i = 0; i < 256; i++) {
        if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; }
        else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; }
        if (t >= best) break;
        if (isSolidCell(cx, cz)) {
          best = t;
          type = isDoorSolid(cx, cz) ? 'door' : 'wall';
          break;
        }
      }
    }

    if (type === null) return null;
    return { t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, type: type };
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
  function moveWithCollision(x, z, nx, nz, rad) {
    function blocked(px, pz) {
      // sample the circle against the four nearest cell edges
      return isSolidAt(px - rad, pz) || isSolidAt(px + rad, pz) ||
             isSolidAt(px, pz - rad) || isSolidAt(px, pz + rad) ||
             isSolidAt(px - rad * 0.707, pz - rad * 0.707) ||
             isSolidAt(px + rad * 0.707, pz - rad * 0.707) ||
             isSolidAt(px - rad * 0.707, pz + rad * 0.707) ||
             isSolidAt(px + rad * 0.707, pz + rad * 0.707);
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
            !isSolidCell(c, r + 1) && !isSolidCell(c - 1, r) && !isSolidCell(c, r - 1)) {
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

  NS.map = {
    CELL: CELL, WALL_H: WALL_H, ROWS: function () { return ROWS; }, COLS: function () { return COLS; },
    markers: markers,
    isSolidCell: isSolidCell, isSolidAt: isSolidAt,
    isSafeCell: isSafeCell, isSafeAt: isSafeAt,
    raycast: raycast, wallsBetween: wallsBetween, astar: astar,
    moveWithCollision: moveWithCollision, patrolWaypoints: patrolWaypoints,
    rayLaser: rayLaser, laserHitPlayer: laserHitPlayer, asciiRows: asciiRows,
    unlockDoor: unlockDoor, resetDoors: resetDoors, doorsOpenCount: doorsOpenCount,
    consoleDoor: consoleDoor, isConsoleSealed: isConsoleSealed,
    loadLayout: loadLayout, layout: function () { return currentLayout; }
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
