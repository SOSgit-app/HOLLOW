/* HOLLOW — enemy.js : the Custodian. Blind; hears everything. GDD §5. */
(function (NS) {
  'use strict';

  // Tuning constants (GDD §5 — kept 1:1 with the document)
  var SPEED_PATROL = 2.0;
  var SPEED_INVESTIGATE = 3.4;
  var SPEED_CHASE = 6.0;
  var SPEED_ALARM = 5.6;      // tripwire / lockout response
  var SPEED_CONVERGE = 6.4;   // virus success → LZ rush
  var KILL_RANGE = 1.3;
  var TOUCH_RANGE = 3.5;
  var CHASE_CONF = 0.75;
  var CHASE_LOSE_S = 6.0;
  var CHASE_SOUND_S = 7.0;     // red signature: chase this long, then resume patrol
  var NOISE_SAFE_MAX = 5;       // at/below: green — ignored by security hearing
  var NOISE_YELLOW_MAX = 16;    // up to here: yellow — investigate noise origin
  var YELLOW_DWELL_S = 3.0;     // seconds listening at yellow noise site
  var AGITATION_DECAY = 1.2;
  var DORMANT_WAKE = 12;
  var BIAS_THRESHOLD = 40;
  var WALL_ATTEN = 0.6;
  var RADIUS = 0.5;

  var M, math;

  var E = {
    x: 0, z: 0,
    state: 'DORMANT',
    agitation: 0,
    agitationFloor: 0
  };

  var path = null, pathIdx = 0;
  var repathTimer = 0;
  var investigateTarget = null, dwellTimer = 0, dwellAngle = 0;
  var lastNoiseFed = -999;
  var lastKnownX = 0, lastKnownZ = 0;
  var mustInvestigateAfterChase = false;
  var clickTimer = 0, stepDist = 0;
  var wakeTimer = 0;            // ambient wake: it always rises eventually
  var waypoints = [];
  var lairX = 0, lairZ = 0;
  // body presentation
  var facing = 0, animT = 0;
  var bodyCache = null;
  var hasteTimer = 0;
  var hasteMode = 'NONE'; // NONE | ALARM | CONVERGE
  var skipX = 0, skipZ = 0, skipTimer = 0;
  var chaseLeft = 0;
  var investigateDwell = 4;

  // Secondary security units (independent stalkers)
  // patrolHalf: 'W' = west half of map, 'E' = east half
  function makeUnit(lairX, lairZ, clickBias, patrolHalf) {
    return {
      x: lairX, z: lairZ, state: 'PATROL', agitation: 0, agitationFloor: 0,
      path: null, pathIdx: 0, repathTimer: 0,
      lastNoiseFed: -999, lastKnownX: lairX, lastKnownZ: lairZ,
      clickTimer: clickBias, stepDist: 0, wakeTimer: 0,
      facing: 0, animT: 0, bodyCache: null,
      lairX: lairX, lairZ: lairZ,
      patrolHalf: patrolHalf || 'W',
      chaseLeft: 0,
      investigateDwell: 4
    };
  }
  var B = makeUnit(4.5, 4.5, 2.0, 'W');
  var C = makeUnit(106.5, 28.5, 2.8, 'E');
  var D = makeUnit(16.5, 73.5, 3.2, 'W');
  var ALL_SECONDARIES = [B, C, D];
  var SECONDARIES = [B, C, D];
  var currentDiff = 'medium';

  function mapMidX() {
    return M.COLS() * M.CELL / 2;
  }

  // Snap out of wall-jammed positions (radius overlaps solid) so patrol can step.
  function unstick(entity) {
    if (!M.isSolidAt(entity.x - RADIUS, entity.z) &&
        !M.isSolidAt(entity.x + RADIUS, entity.z) &&
        !M.isSolidAt(entity.x, entity.z - RADIUS) &&
        !M.isSolidAt(entity.x, entity.z + RADIUS)) {
      return;
    }
    var cx = (Math.floor(entity.x / M.CELL) + 0.5) * M.CELL;
    var cz = (Math.floor(entity.z / M.CELL) + 0.5) * M.CELL;
    if (!M.isSolidAt(cx, cz)) {
      entity.x = cx;
      entity.z = cz;
    }
  }

  function resetUnit(U, lx, lz, half, clickBias, agit) {
    U.lairX = lx; U.lairZ = lz;
    U.x = lx; U.z = lz;
    U.patrolHalf = half;
    U.state = 'PATROL';
    U.agitation = agit; U.agitationFloor = 0;
    U.path = null; U.pathIdx = 0; U.repathTimer = 0;
    U.lastNoiseFed = -999;
    U.lastKnownX = lx; U.lastKnownZ = lz;
    U.clickTimer = clickBias; U.stepDist = 0; U.wakeTimer = 0;
    U.facing = 0; U.animT = 0; U.bodyCache = null;
    U.chaseLeft = 0;
    U.investigateDwell = 4;
  }

  var suppressed = false; // tutorial: gone until tripwire
  var heldStill = false;

  function setSuppressed(v) {
    suppressed = !!v;
    if (suppressed) {
      heldStill = false;
      E.state = 'DORMANT';
      path = null;
      bodyCache = null;
      E.agitation = 0;
      E.agitationFloor = 0;
      // Park far off the playable map so nothing can scan or touch it
      E.x = -999;
      E.z = -999;
      SECONDARIES = [];
    } else {
      heldStill = false;
    }
  }

  // Tutorial: materialize security in the first room when the wire trips
  function spawnTutorial(x, z) {
    suppressed = false;
    heldStill = false;
    SECONDARIES = [];
    E.x = x;
    E.z = z;
    unstick(E);
    E.state = 'PATROL';
    E.agitation = Math.max(E.agitation, 28);
    E.agitationFloor = Math.max(E.agitationFloor, 12);
    wakeTimer = 0;
    path = null;
    bodyCache = null;
    chaseLeft = 0;
  }

  function wakeFromStill() {
    if (!heldStill) return;
    heldStill = false;
    if (E.state === 'DORMANT') E.state = 'PATROL';
    path = null;
    wakeTimer = 0;
  }

  function isHeldStill() { return heldStill; }

  function reset(difficulty) {
    currentDiff = difficulty || 'medium';
    if (currentDiff === 'tutorial') SECONDARIES = [];
    else if (currentDiff === 'easy') SECONDARIES = [B];
    else if (currentDiff === 'medium') SECONDARIES = [B, C];
    else SECONDARIES = [B, C, D];

    M = NS.map; math = NS.math;
    // SEC-1 east (old lair), SEC-2/4 west, SEC-3 east — 2 per half
    lairX = M.markers.C ? M.markers.C.x : 4.5;
    lairZ = M.markers.C ? M.markers.C.z : 4.5;
    E.x = lairX; E.z = lairZ;
    E.patrolHalf = currentDiff === 'tutorial' ? 'W' : 'E';
    // Tutorial starts with no guard — spawns on tripwire
    suppressed = currentDiff === 'tutorial';
    heldStill = false;
    E.state = suppressed ? 'DORMANT' : 'PATROL';
    E.agitation = suppressed ? 0 : 12;
    E.agitationFloor = 0;
    path = null; pathIdx = 0; repathTimer = 0;
    investigateTarget = null; dwellTimer = 0;
    lastNoiseFed = -999;
    mustInvestigateAfterChase = false;
    clickTimer = 1.5; stepDist = 0; wakeTimer = 0;
    waypoints = M.patrolWaypoints();
    facing = 0; animT = 0; bodyCache = null;
    skipX = 0; skipZ = 0; skipTimer = 0;
    hasteTimer = 0; hasteMode = 'NONE';
    chaseLeft = 0;
    investigateDwell = 4;

    // Four units: west pair + east pair (cell centers — avoid wall-jammed spawns)
    resetUnit(B, 4.5, 4.5, 'W', 2.4, 8);
    resetUnit(C, 106.5, 28.5, 'E', 2.8, 8);
    resetUnit(D, 16.5, 73.5, 'W', 3.2, 8);
    if (suppressed) {
      E.x = -999; E.z = -999;
      bodyCache = null;
    } else {
      unstick(E);
      unstick(B);
      unstick(C);
      unstick(D);
    }
  }

  function setPathTo(x, z) {
    path = M.astar(E.x, E.z, x, z);
    pathIdx = 0;
  }

  function distToPlayer(p) {
    var dx = p.x - E.x, dz = p.z - E.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function noiseBand(loud) {
    if (loud <= NOISE_SAFE_MAX) return 'SAFE';
    if (loud <= NOISE_YELLOW_MAX) return 'YELLOW';
    return 'RED';
  }

  // Perceived loudness model (GDD §3.4 / §5.1)
  // Player emission bands (match AUX bar):
  //   SAFE (green)  — heard but ignored
  //   YELLOW        — units that hear investigate the noise origin (~3s)
  //   RED           — units that hear chase the player for 7s, then resume patrol
  function hear(x, z, loud, now, isPlayerNoise) {
    if (suppressed || heldStill) return;
    if (currentDiff === 'easy' && isPlayerNoise) loud *= 0.7;

    // Player noise from inside a safe harbor is heavily attenuated (EMCON)
    if (isPlayerNoise && M.isSafeAt(x, z)) {
      loud *= 0.15;
    }
    var band = isPlayerNoise ? noiseBand(loud) : 'RED';

    hearPrimary(x, z, loud, now, isPlayerNoise, band);
    for (var si = 0; si < SECONDARIES.length; si++) {
      hearUnit(SECONDARIES[si], x, z, loud * (0.85 - si * 0.05), now, isPlayerNoise, band);
    }
  }

  function hearPrimary(x, z, loud, now, isPlayerNoise, band) {
    var dx = x - E.x, dz = z - E.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var walls = M.wallsBetween(E.x, E.z, x, z);
    var effective = loud * Math.pow(WALL_ATTEN, walls) - dist;
    if (effective <= 0) return;

    if (band === 'SAFE') {
      E.agitation = Math.min(100, E.agitation + effective * 0.12);
      return;
    }

    E.agitation = Math.min(100, E.agitation + effective * 0.9);
    if (E.state === 'DORMANT') return;
    if (isPlayerNoise) lastNoiseFed = now;

    // Inside sanctuary: never escalate to CHASE from hearing alone
    if (isPlayerNoise && M.isSafeAt(x, z)) {
      if (E.state !== 'CHASE') beginInvestigate(x, z, YELLOW_DWELL_S);
      return;
    }

    if (band === 'RED') {
      lastKnownX = x; lastKnownZ = z;
      if (isPlayerNoise) {
        lastKnownX = x; lastKnownZ = z;
        enterChase(CHASE_SOUND_S);
      } else if (E.state !== 'CHASE') {
        beginInvestigate(x, z, YELLOW_DWELL_S);
      }
      return;
    }

    // YELLOW — investigate noise site, never chase from yellow alone
    if (E.state !== 'CHASE') {
      beginInvestigate(x, z, YELLOW_DWELL_S);
    } else {
      lastKnownX = x; lastKnownZ = z;
    }
  }

  function beginInvestigate(x, z, dwell) {
    E.state = 'INVESTIGATE';
    investigateTarget = { x: x, z: z };
    dwellTimer = 0;
    investigateDwell = dwell || (4 + math.rand() * 4);
    setPathTo(x, z);
  }

  function hearUnit(U, x, z, loud, now, isPlayerNoise, band) {
    band = band || (isPlayerNoise ? noiseBand(loud) : 'RED');
    var dx = x - U.x, dz = z - U.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var walls = M.wallsBetween(U.x, U.z, x, z);
    var effective = loud * Math.pow(WALL_ATTEN, walls) - dist;
    if (effective <= 0) return;

    if (band === 'SAFE') {
      U.agitation = Math.min(100, U.agitation + effective * 0.1);
      return;
    }

    U.agitation = Math.min(100, U.agitation + effective * 0.85);
    if (U.state === 'DORMANT') return;
    if (isPlayerNoise) U.lastNoiseFed = now;

    if (isPlayerNoise && M.isSafeAt(x, z)) {
      if (U.state !== 'CHASE') {
        U.state = 'INVESTIGATE';
        U.investigateDwell = YELLOW_DWELL_S;
        U.lastKnownX = x; U.lastKnownZ = z;
        U._dwellAcc = 0;
        U.path = M.astar(U.x, U.z, x, z); U.pathIdx = 0;
      }
      return;
    }

    if (band === 'RED') {
      U.lastKnownX = x; U.lastKnownZ = z;
      if (isPlayerNoise) {
        U.state = 'CHASE';
        U.chaseLeft = Math.max(U.chaseLeft || 0, CHASE_SOUND_S);
        U.repathTimer = 0;
      } else if (U.state !== 'CHASE') {
        U.state = 'INVESTIGATE';
        U.investigateDwell = YELLOW_DWELL_S;
        U._dwellAcc = 0;
        U.path = M.astar(U.x, U.z, x, z); U.pathIdx = 0;
      }
      return;
    }

    if (U.state !== 'CHASE') {
      U.state = 'INVESTIGATE';
      U.investigateDwell = YELLOW_DWELL_S;
      U.lastKnownX = x; U.lastKnownZ = z;
      U._dwellAcc = 0;
      U.path = M.astar(U.x, U.z, x, z); U.pathIdx = 0;
    } else {
      U.lastKnownX = x; U.lastKnownZ = z;
    }
  }

  function pulseHaste(mode, seconds) {
    hasteMode = mode;
    hasteTimer = Math.max(hasteTimer, seconds);
  }

  function moveSpeed(base, state) {
    var s = base;
    if (currentDiff === 'easy' && state === 'PATROL') s *= 0.75;
    if (currentDiff === 'hard' && state === 'CHASE') s *= 1.1;

    if (hasteTimer <= 0 || hasteMode === 'NONE') return s;
    // Only units actually responding (investigate/chase) get the haste boost
    if (state !== 'INVESTIGATE' && state !== 'CHASE') return s;
    if (hasteMode === 'ALARM') return Math.max(s, SPEED_ALARM);
    if (hasteMode === 'CONVERGE') return Math.max(s, SPEED_CONVERGE);
    return s;
  }

  function dispatchPrimaryInvestigate(x, z, nowTs) {
    if (E.state === 'DORMANT') E.state = 'PATROL';
    E.agitation = Math.min(100, E.agitation + 55);
    E.agitationFloor = Math.max(E.agitationFloor, 30);
    lastKnownX = x; lastKnownZ = z;
    lastNoiseFed = nowTs;
    mustInvestigateAfterChase = false;
    if (E.state === 'CHASE') NS.audio.sting(false);
    E.state = 'INVESTIGATE';
    investigateTarget = { x: x, z: z };
    dwellTimer = 0;
    setPathTo(x, z);
  }

  function dispatchUnitInvestigate(U, x, z, nowTs) {
    if (U.state === 'DORMANT') U.state = 'PATROL';
    U.agitation = Math.min(100, U.agitation + 50);
    U.agitationFloor = Math.max(U.agitationFloor, 24);
    U.lastKnownX = x; U.lastKnownZ = z;
    U.lastNoiseFed = nowTs;
    U.state = 'INVESTIGATE';
    U.path = M.astar(U.x, U.z, x, z);
    U.pathIdx = 0;
    U.repathTimer = 0;
  }

  // maxUnits: how many closest responders (default 2 for tripwires).
  // Pass 0 / Infinity / negative to send every unit (circuit lockout, etc.).
  function forceInvestigate(x, z, maxUnits) {
    if (suppressed) return;
    wakeFromStill();
    if (maxUnits === undefined || maxUnits === null) maxUnits = 2;
    pulseHaste('ALARM', 14);
    var nowTs = (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000);

    var candidates = [{ kind: 'E', x: E.x, z: E.z, dist: 0 }];
    for (var i = 0; i < SECONDARIES.length; i++) {
      candidates.push({ kind: 'U', idx: i, x: SECONDARIES[i].x, z: SECONDARIES[i].z, dist: 0 });
    }
    for (var c = 0; c < candidates.length; c++) {
      var dx = candidates[c].x - x, dz = candidates[c].z - z;
      candidates[c].dist = dx * dx + dz * dz;
    }
    candidates.sort(function (a, b) { return a.dist - b.dist; });

    var n = (maxUnits <= 0 || !isFinite(maxUnits)) ? candidates.length : Math.min(maxUnits, candidates.length);
    for (var r = 0; r < n; r++) {
      var pick = candidates[r];
      if (pick.kind === 'E') dispatchPrimaryInvestigate(x, z, nowTs);
      else dispatchUnitInvestigate(SECONDARIES[pick.idx], x, z, nowTs);
    }
  }

  function enterChase(seconds) {
    E.state = 'CHASE';
    repathTimer = 0;
    chaseLeft = Math.max(chaseLeft, seconds != null ? seconds : CHASE_SOUND_S);
    NS.audio.sting(true);
  }
  function forceChase(now) {
    if (suppressed) return;
    wakeFromStill();
    mustInvestigateAfterChase = false;
    if (typeof now === 'number') lastNoiseFed = now;
    enterChase(CHASE_SOUND_S);
  }

  function endChaseToPatrol() {
    NS.audio.sting(false);
    mustInvestigateAfterChase = false;
    E.state = 'PATROL';
    path = null;
    chaseLeft = 0;
  }

  // Quiet converge: all units rush toward LZ vicinity (virus success).
  function convergeOn(x, z) {
    if (suppressed) return;
    wakeFromStill();
    pulseHaste('CONVERGE', 28);
    var offsets = [
      { x: 0, z: 0 },
      { x: 5, z: 3 },
      { x: -4, z: 6 },
      { x: 3, z: -5 }
    ];
    var tx = x + offsets[0].x, tz = z + offsets[0].z;
    E.agitation = Math.min(100, E.agitation + 40);
    E.agitationFloor = Math.max(E.agitationFloor, 35);
    lastKnownX = tx; lastKnownZ = tz;
    mustInvestigateAfterChase = false;
    if (E.state === 'CHASE') NS.audio.sting(false);
    E.state = 'INVESTIGATE';
    investigateTarget = { x: tx, z: tz };
    dwellTimer = 0;
    setPathTo(tx, tz);

    for (var i = 0; i < SECONDARIES.length; i++) {
      var U = SECONDARIES[i];
      var off = offsets[i + 1] || { x: 0, z: 0 };
      var ox = x + off.x, oz = z + off.z;
      U.agitation = Math.min(100, U.agitation + 38);
      U.agitationFloor = Math.max(U.agitationFloor, 30);
      U.lastKnownX = ox; U.lastKnownZ = oz;
      U.state = 'INVESTIGATE';
      U.path = M.astar(U.x, U.z, ox, oz);
      U.pathIdx = 0;
      U.repathTimer = 0;
    }
  }

  function leaveChase(toInvestigateAt) {
    NS.audio.sting(false);
    mustInvestigateAfterChase = true;
    E.state = 'INVESTIGATE';
    investigateTarget = toInvestigateAt;
    dwellTimer = 0;
    setPathTo(toInvestigateAt.x, toInvestigateAt.z);
  }

  function pickPatrolTarget(p, patrolHalf, agitation) {
    if (!waypoints.length) return null;
    var mid = mapMidX();
    var half = patrolHalf || E.patrolHalf || 'E';
    var agit = agitation != null ? agitation : E.agitation;
    // Stick to assigned map half (2 west / 2 east)
    var pool = waypoints.filter(function (w) {
      return half === 'W' ? w.x < mid : w.x >= mid;
    });
    if (pool.length < 2) pool = waypoints.slice();
    // High agitation: bias within half toward the player's side of that half
    if (agit > BIAS_THRESHOLD && p) {
      var towardPlayer = pool.filter(function (w) {
        return (w.z < (M.ROWS() * M.CELL / 2)) === (p.z < (M.ROWS() * M.CELL / 2));
      });
      if (towardPlayer.length > 2) pool = towardPlayer;
    }
    // exclude spawn-room area until first fuse taken (anti-frustration, GDD §5.5)
    if (NS.game && NS.game.fusesCollected && NS.game.fusesCollected() === 0) {
      var P = M.markers.P;
      var filtered = pool.filter(function (w) {
        var dx = w.x - P.x, dz = w.z - P.z;
        return dx * dx + dz * dz > 12 * 12;
      });
      if (filtered.length > 2) pool = filtered;
    }
    return pool[Math.floor(math.rand() * pool.length)];
  }

  // Prefer half-map target; if A* fails, fall back across the full waypoint set.
  function choosePatrolPath(fromX, fromZ, p, patrolHalf, agitation) {
    var tried = {};
    for (var attempt = 0; attempt < 8; attempt++) {
      var t = pickPatrolTarget(p, attempt < 5 ? patrolHalf : null, agitation);
      if (!t) break;
      var key = t.x + ',' + t.z;
      if (tried[key]) continue;
      tried[key] = true;
      var pth = M.astar(fromX, fromZ, t.x, t.z);
      if (pth && pth.length) return pth;
    }
    // Last resort: nearest reachable waypoint
    var best = null, bestD = Infinity;
    for (var i = 0; i < waypoints.length; i++) {
      var w = waypoints[i];
      var dx = w.x - fromX, dz = w.z - fromZ;
      var d = dx * dx + dz * dz;
      if (d < 1) continue;
      var pathTry = M.astar(fromX, fromZ, w.x, w.z);
      if (pathTry && pathTry.length && d < bestD) {
        bestD = d;
        best = pathTry;
      }
    }
    return best;
  }

  function followPath(dt, speed) {
    if (!path || pathIdx >= path.length) return true; // arrived
    var wp = path[pathIdx];
    var dx = wp.x - E.x, dz = wp.z - E.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.6) { pathIdx++; return pathIdx >= path.length; }
    var step = speed * dt;
    var nx = E.x + dx / d * step, nz = E.z + dz / d * step;
    var moved = M.moveWithCollision(E.x, E.z, nx, nz, RADIUS);
    if (moved.x === E.x && moved.z === E.z) {
      // Wedged — snap free and repath
      unstick(E);
      path = null;
      return true;
    }
    E.x = moved.x; E.z = moved.z;
    stepDist += step;
    // turn the body toward travel direction (shortest arc)
    var want = Math.atan2(dx, dz);
    var diff = want - facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    facing += diff * Math.min(1, dt * 6);
    return false;
  }

  function emitMovementAudio(p, speed, now) {
    void now;
    var dist = distToPlayer(p);
    var walls = M.wallsBetween(E.x, E.z, p.x, p.z);
    var atten = Math.pow(WALL_ATTEN, walls) / (1 + dist * 0.16);
    // pan: project direction-to-enemy on the player's right vector
    var ang = Math.atan2(E.x - p.x, -(E.z - p.z)); // world bearing
    var rel = ang - p.yaw;
    var pan = Math.sin(rel);

    var stride = speed > 5 ? 1.4 : 2.0;
    if (stepDist > stride) {
      stepDist = 0;
      NS.audio.enemyStep(pan, Math.min(0.14, 0.25 * atten));
    }
    return { dist: dist, pan: pan, atten: atten };
  }

  function clickInterval() {
    switch (E.state) {
      case 'DORMANT': return 4.5;
      case 'PATROL': return 2.2;
      case 'INVESTIGATE': return 1.1;
      case 'CHASE': return 0.4;
    }
    return 2.2;
  }

  function update(dt, p, now, game) {
    if (suppressed) {
      NS.audio.setAgitation(0);
      bodyCache = null;
      return;
    }
    // agitation decay toward floor
    E.agitation = Math.max(E.agitationFloor, E.agitation - AGITATION_DECAY * dt);
    NS.audio.setAgitation(E.agitation);
    animT += dt;
    if (hasteTimer > 0) {
      hasteTimer -= dt;
      if (hasteTimer <= 0) { hasteTimer = 0; hasteMode = 'NONE'; }
    }

    var dist = distToPlayer(p);
    var playerSafe = M.isSafeAt(p.x, p.z);

    // touch-range certainty (anti-camping) — suppressed while player is in harbor
    if (dist < TOUCH_RANGE && E.state !== 'DORMANT' && !playerSafe) {
      lastNoiseFed = now;
      lastKnownX = p.x; lastKnownZ = p.z;
      if (E.state !== 'CHASE') {
        mustInvestigateAfterChase = false;
        enterChase(CHASE_SOUND_S);
      } else {
        chaseLeft = Math.max(chaseLeft, CHASE_SOUND_S);
      }
    }

    // kill check — safe zones block kill (sanctuary)
    if (dist < KILL_RANGE && E.state !== 'DORMANT' && !playerSafe) {
      game.onKill();
      return;
    }

    // If chasing into a harbor, break off at the edge
    if (E.state === 'CHASE' && playerSafe) {
      endChaseToPatrol();
    }

    var speed = 0, arrived;
    switch (E.state) {
      case 'DORMANT':
        if (heldStill) break; // tutorial freeze — only tripwire / force wakes
        wakeTimer += dt;
        if (E.agitation > DORMANT_WAKE || wakeTimer > 120) {
          E.state = 'PATROL';
          path = null;
        }
        break;

      case 'PATROL':
        speed = moveSpeed(SPEED_PATROL, E.state);
        if (!path || pathIdx >= path.length) {
          path = choosePatrolPath(E.x, E.z, p, E.patrolHalf, E.agitation);
          pathIdx = 0;
        }
        followPath(dt, speed);
        break;

      case 'INVESTIGATE':
        speed = moveSpeed(SPEED_INVESTIGATE, E.state);
        arrived = followPath(dt, speed);
        if (arrived) {
          dwellTimer += dt;
          dwellAngle += dt * 1.6;
          // tight listening circle
          var cx = E.x + Math.cos(dwellAngle) * 0.5 * dt;
          var cz = E.z + Math.sin(dwellAngle) * 0.5 * dt;
          var mv = M.moveWithCollision(E.x, E.z, cx, cz, RADIUS);
          E.x = mv.x; E.z = mv.z;
          // Alarm / converge: barely dwell — keep pressure moving
          var dwellNeeded = (hasteMode === 'ALARM' || hasteMode === 'CONVERGE')
            ? (0.35 + math.rand() * 0.45)
            : investigateDwell;
          if (dwellTimer > dwellNeeded) {
            mustInvestigateAfterChase = false;
            if (hasteMode === 'CONVERGE' && investigateTarget) {
              // re-path toward LZ cluster instead of going idle
              setPathTo(investigateTarget.x, investigateTarget.z);
              dwellTimer = 0;
            } else {
              E.state = 'PATROL';
              path = null;
              investigateDwell = 4 + math.rand() * 4;
            }
          }
        }
        break;

      case 'CHASE':
        speed = moveSpeed(SPEED_CHASE, E.state);
        repathTimer -= dt;
        chaseLeft -= dt;
        if (repathTimer <= 0) {
          lastKnownX = p.x; lastKnownZ = p.z;
          setPathTo(p.x, p.z);
          repathTimer = 0.4;
        }
        followPath(dt, speed);
        // Red signature chase ends after timer unless still in touch range
        if (chaseLeft <= 0 && dist >= TOUCH_RANGE) {
          endChaseToPatrol();
        } else if (chaseLeft <= 0 && dist < TOUCH_RANGE && !playerSafe) {
          chaseLeft = CHASE_SOUND_S;
        }
        break;
    }

    // ---- audio presence ----
    var au = emitMovementAudio(p, speed, now);
    clickTimer -= dt;
    if (clickTimer <= 0) {
      clickTimer = clickInterval() * (0.85 + math.rand() * 0.3);
      NS.audio.click(au.pan, Math.min(0.16, 0.30 * au.atten + 0.01));
      if (game.onEnemyClick) game.onEnemyClick(au.dist, au.pan);
    }
    NS.audio.setBreath(Math.max(0, (14 - au.dist) / 14) * 0.18 * au.atten * 8, au.pan);

    bodyCache = buildBody(dt);
    for (var ui = 0; ui < SECONDARIES.length; ui++) {
      updateSecondary(SECONDARIES[ui], dt, p, now, game, 0.92 - ui * 0.04);
    }
  }

  function followPathUnit(u, dt, speed) {
    if (!u.path || u.pathIdx >= u.path.length) return true;
    var wp = u.path[u.pathIdx];
    var dx = wp.x - u.x, dz = wp.z - u.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.6) { u.pathIdx++; return u.pathIdx >= u.path.length; }
    var step = speed * dt;
    var nx = u.x + dx / d * step, nz = u.z + dz / d * step;
    var moved = M.moveWithCollision(u.x, u.z, nx, nz, RADIUS);
    if (moved.x === u.x && moved.z === u.z) {
      unstick(u);
      u.path = null;
      return true;
    }
    u.x = moved.x; u.z = moved.z;
    u.stepDist += step;
    var want = Math.atan2(dx, dz);
    var diff = want - u.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    u.facing += diff * Math.min(1, dt * 6);
    return false;
  }

  function updateSecondary(U, dt, p, now, game, speedScale) {
    speedScale = speedScale || 0.95;
    U.agitation = Math.max(U.agitationFloor, U.agitation - AGITATION_DECAY * dt);
    U.animT += dt;
    var dx = p.x - U.x, dz = p.z - U.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var playerSafe = M.isSafeAt(p.x, p.z);

    if (dist < TOUCH_RANGE && U.state !== 'DORMANT' && !playerSafe) {
      U.lastNoiseFed = now;
      U.lastKnownX = p.x; U.lastKnownZ = p.z;
      U.state = 'CHASE';
      U.chaseLeft = Math.max(U.chaseLeft || 0, CHASE_SOUND_S);
    }
    if (dist < KILL_RANGE && U.state !== 'DORMANT' && !playerSafe) {
      game.onKill();
      return;
    }
    if (U.state === 'CHASE' && playerSafe) {
      U.state = 'PATROL';
      U.path = null;
      U.chaseLeft = 0;
    }

    var speed = 0;
    switch (U.state) {
      case 'DORMANT':
        U.wakeTimer += dt;
        if (U.agitation > DORMANT_WAKE || U.wakeTimer > 90) {
          U.state = 'PATROL';
          U.path = null;
        }
        break;
      case 'PATROL':
        speed = moveSpeed(SPEED_PATROL, U.state) * speedScale;
        if (!U.path || U.pathIdx >= U.path.length) {
          U.path = choosePatrolPath(U.x, U.z, p, U.patrolHalf, U.agitation);
          U.pathIdx = 0;
        }
        followPathUnit(U, dt, speed);
        break;
      case 'INVESTIGATE':
        speed = moveSpeed(SPEED_INVESTIGATE, U.state) * speedScale;
        if (!U.path) {
          U.path = M.astar(U.x, U.z, U.lastKnownX != null ? U.lastKnownX : p.x,
            U.lastKnownZ != null ? U.lastKnownZ : p.z);
          U.pathIdx = 0;
        }
        if (followPathUnit(U, dt, speed)) {
          if (hasteMode === 'CONVERGE' && U.lastKnownX != null) {
            U.path = M.astar(U.x, U.z, U.lastKnownX, U.lastKnownZ);
            U.pathIdx = 0;
          } else if (hasteMode === 'ALARM' && U.lastKnownX != null) {
            U.path = M.astar(U.x, U.z, U.lastKnownX, U.lastKnownZ);
            U.pathIdx = 0;
          } else {
            // Yellow: brief linger then resume patrol
            U.wakeTimer = (U.wakeTimer || 0) + dt; // reuse as dwell at site
            if (!U._dwellAcc) U._dwellAcc = 0;
            U._dwellAcc += dt;
            if (U._dwellAcc > (U.investigateDwell || YELLOW_DWELL_S)) {
              U._dwellAcc = 0;
              U.state = 'PATROL';
              U.path = null;
            }
          }
        } else {
          U._dwellAcc = 0;
        }
        break;
      case 'CHASE':
        speed = moveSpeed(SPEED_CHASE, U.state) * (speedScale - 0.03);
        U.repathTimer -= dt;
        U.chaseLeft = (U.chaseLeft || 0) - dt;
        if (U.repathTimer <= 0) {
          U.lastKnownX = p.x; U.lastKnownZ = p.z;
          U.path = M.astar(U.x, U.z, p.x, p.z); U.pathIdx = 0;
          U.repathTimer = 0.45;
        }
        followPathUnit(U, dt, speed);
        if (U.chaseLeft <= 0 && dist >= TOUCH_RANGE) {
          U.state = 'PATROL';
          U.path = null;
          U.chaseLeft = 0;
        } else if (U.chaseLeft <= 0 && dist < TOUCH_RANGE && !playerSafe) {
          U.chaseLeft = CHASE_SOUND_S;
        }
        break;
    }

    var walls = M.wallsBetween(U.x, U.z, p.x, p.z);
    var atten = Math.pow(WALL_ATTEN, walls) / (1 + dist * 0.16);
    var ang = Math.atan2(U.x - p.x, -(U.z - p.z));
    var pan = Math.sin(ang - p.yaw);
    if (U.stepDist > (speed > 5 ? 1.4 : 2.0)) {
      U.stepDist = 0;
      NS.audio.enemyStep(pan, Math.min(0.12, 0.22 * atten));
    }
    U.clickTimer -= dt;
    if (U.clickTimer <= 0 && U.state !== 'DORMANT') {
      U.clickTimer = (U.state === 'CHASE' ? 0.5 : 2.0) * (0.85 + math.rand() * 0.3);
      NS.audio.click(pan, Math.min(0.12, 0.22 * atten + 0.01));
    }

    var saved = { x: E.x, z: E.z, state: E.state, facing: facing, animT: animT,
      skipX: skipX, skipZ: skipZ, skipTimer: skipTimer };
    E.x = U.x; E.z = U.z; E.state = U.state; facing = U.facing; animT = U.animT;
    skipX = 0; skipZ = 0;
    U.bodyCache = buildBody(0);
    E.x = saved.x; E.z = saved.z; E.state = saved.state; facing = saved.facing; animT = saved.animT;
    skipX = saved.skipX; skipZ = saved.skipZ; skipTimer = saved.skipTimer;
  }

  // legacy name kept so nothing else breaks if referenced
  function updateB(dt, p, now, game) {
    updateSecondary(B, dt, p, now, game, 0.95);
  }

  // ------------------------------------------------------------------
  // body spheres for the scanner's ray tests (GDD: red returns)
  // A 2.6 m gaunt articulated figure instead of two blobs: hunched spine,
  // long neck, cocked head, arms that hang to the floor, claw fingers.
  // Posture is state-driven; rebuilt once per update and cached.
  // ------------------------------------------------------------------
  function buildBody(dt) {
    var out = [];
    var t = animT;
    var ca = Math.cos(facing), sa = Math.sin(facing);

    // chase: the form intermittently "skips" — renders displaced like a bad tape
    if (E.state === 'CHASE') {
      skipTimer -= dt;
      if (skipTimer <= 0) {
        if (skipX === 0 && skipZ === 0 && math.rand() < 0.35) {
          skipX = (math.rand() - 0.5) * 0.7;
          skipZ = (math.rand() - 0.5) * 0.7;
          skipTimer = 0.06 + math.rand() * 0.08;    // brief ghost offset
        } else {
          skipX = 0; skipZ = 0;
          skipTimer = 0.25 + math.rand() * 0.5;
        }
      }
    } else {
      skipX = 0; skipZ = 0;
    }

    var bx = E.x + skipX, bz = E.z + skipZ;

    // local frame: lx = right, lz = forward (matches facing = atan2(dx,dz))
    function add(lx, y, lz, r) {
      out.push({ x: bx + lx * ca + lz * sa, y: y, z: bz - lx * sa + lz * ca, r: r });
    }

    if (E.state === 'DORMANT') {
      // huddled mass in the lair — barely reads as a creature until it isn't
      var br = Math.sin(t * 0.45) * 0.04;            // slow breathing
      add(0, 0.38 + br, 0, 0.46);
      add(0.18, 0.62 + br, -0.18, 0.34);
      add(-0.2, 0.55 + br, 0.12, 0.3);
      add(0.05, 0.92 + br, 0.3, 0.17);               // tucked head
      add(0.4, 0.18, 0.35, 0.09);                    // one folded claw
      add(0.52, 0.14, 0.42, 0.05);
      return out;
    }

    var chase = E.state === 'CHASE';
    var invest = E.state === 'INVESTIGATE';

    // posture
    var lean = chase ? 0.45 : (invest ? 0.3 : 0.12);  // forward pitch of upper body
    var gait = chase ? 9.0 : (invest ? 0 : 2.6);      // stride frequency
    var bob = gait > 0 ? Math.abs(Math.sin(t * gait)) * (chase ? 0.08 : 0.05) : 0;
    var sway = Math.sin(t * 1.1) * 0.05;              // idle weight shift
    var tw = chase ? 0.04 : 0.012;                    // skeletal twitch amplitude
    function j() { return (math.rand() - 0.5) * 2 * tw; }
    // lean: everything above the pelvis slides forward with height
    function fwd(y) { return Math.max(0, y - 1.0) * lean; }
    // chain of spheres along a segment — keeps limbs reading as one body
    function chain(x0, y0, z0, x1, y1, z1, n, r0, r1) {
      for (var c = 0; c < n; c++) {
        var f = n === 1 ? 0 : c / (n - 1);
        add(x0 + (x1 - x0) * f + j(),
            y0 + (y1 - y0) * f + j(),
            z0 + (z1 - z0) * f + j(),
            r0 + (r1 - r0) * f);
      }
    }

    // spine — pelvis up to a hunched hump between the shoulders
    chain(sway, 1.0 + bob, 0,
          sway * 0.4, 1.92 + bob, fwd(1.92), 6, 0.27, 0.2);

    // shoulders
    add(0.36 + j(), 1.9 + bob + j(), fwd(1.9) + j(), 0.14);
    add(-0.36 + j(), 1.9 + bob + j(), fwd(1.9) + j(), 0.14);

    // head — small, cocked over to one side, listening
    var tilt = invest ? Math.sin(t * 2.2) * 0.3                     // sweeping for sound
             : Math.sin(t * 0.4) * 0.14 + 0.1;                      // slow sickening roll
    var hy = 2.42 + bob + (chase ? Math.sin(t * 13.0) * 0.04 : 0);  // chase: head judder

    // neck — too long, craned forward to the skull
    chain(0, 1.98 + bob, fwd(1.98),
          tilt, hy - 0.06, fwd(hy) + 0.16, 4, 0.11, 0.08);
    add(tilt + j(), hy, fwd(hy) + 0.2 + j(), 0.16);                 // skull
    add(tilt * 1.3 + j(), hy - 0.13, fwd(hy) + 0.33 + j(), 0.08);   // elongated jaw

    // arms — knuckles near the floor; trail behind in a chase
    var armB = chase ? -0.25 : 0.05;                                // hands swept back
    var swing = gait > 0 ? Math.sin(t * gait) * (chase ? 0.25 : 0.12) : Math.sin(t * 0.8) * 0.05;
    var side, sgn;
    for (side = 0; side < 2; side++) {
      sgn = side === 0 ? 1 : -1;
      var sw = swing * sgn;
      chain(sgn * 0.36, 1.9 + bob, fwd(1.9),
            sgn * 0.5, 0.2, armB + 0.12 + sw * 1.3, 7, 0.12, 0.06);
      add(sgn * 0.56 + j(), 0.07, armB + 0.24 + sw * 1.3, 0.035);   // claw
      add(sgn * 0.42 + j(), 0.06, armB + 0.26 + sw * 1.3, 0.035);   // claw
    }

    // legs — thin, wrong
    for (side = 0; side < 2; side++) {
      sgn = side === 0 ? 1 : -1;
      var st = gait > 0 ? Math.sin(t * gait + (side === 0 ? 0 : Math.PI)) * (chase ? 0.35 : 0.18) : 0;
      chain(sgn * 0.13, 0.95 + bob * 0.5, 0,
            sgn * 0.16, 0.07, st * 0.4 + 0.08, 5, 0.12, 0.08);
    }

    return out;
  }

  function spheres() {
    if (suppressed) return [];
    var out = bodyCache || [];
    if (!out.length) {
      bodyCache = buildBody(0);
      out = bodyCache;
    }
    for (var i = 0; i < SECONDARIES.length; i++) {
      if (SECONDARIES[i].bodyCache && SECONDARIES[i].bodyCache.length) {
        out = out.concat(SECONDARIES[i].bodyCache);
      }
    }
    return out;
  }

  function contacts() {
    if (suppressed) return [];
    var list = [{ id: 'SEC-1', x: E.x, z: E.z, state: E.state }];
    for (var i = 0; i < SECONDARIES.length; i++) {
      list.push({
        id: 'SEC-' + (i + 2),
        x: SECONDARIES[i].x,
        z: SECONDARIES[i].z,
        state: SECONDARIES[i].state
      });
    }
    return list;
  }

  function addAgitationFloor(v) {
    E.agitationFloor = Math.min(80, E.agitationFloor + v);
    E.agitation = Math.max(E.agitation, E.agitationFloor);
    for (var i = 0; i < SECONDARIES.length; i++) {
      var U = SECONDARIES[i];
      U.agitationFloor = Math.min(80, U.agitationFloor + v * (0.7 - i * 0.1));
      U.agitation = Math.max(U.agitation, U.agitationFloor);
    }
  }

  NS.enemy = {
    state: E,
    reset: reset, update: update, hear: hear, spheres: spheres,
    contacts: contacts,
    addAgitationFloor: addAgitationFloor,
    forceChase: forceChase,
    forceInvestigate: forceInvestigate,
    convergeOn: convergeOn,
    setSuppressed: setSuppressed,
    spawnTutorial: spawnTutorial,
    wakeFromStill: wakeFromStill,
    isHeldStill: isHeldStill,
    noiseBand: noiseBand,
    NOISE_SAFE_MAX: NOISE_SAFE_MAX,
    NOISE_YELLOW_MAX: NOISE_YELLOW_MAX
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
