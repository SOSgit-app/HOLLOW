/* Headless smoke test: enemy state machine + raycast perf, no DOM. */
'use strict';
require('../game/src/math.js');
require('../game/src/map.js');
require('../game/src/enemy.js');
var NS = global.HOLLOW;
var M = NS.map, EN = NS.enemy;

// stub audio + game
NS.audio = {
  sting: function () {}, click: function () {}, enemyStep: function () {},
  setBreath: function () {}, setAgitation: function () {},
  scareImpact: function () {}, death: function () {}
};
NS.game = { fusesCollected: function () { return 0; } };

var killed = false;
var game = { onKill: function () { killed = true; }, onEnemyClick: function () {} };

EN.reset('medium');
var player = { x: M.markers.P.x, z: M.markers.P.z, yaw: 0 };
var now = 0, dt = 1 / 60;

console.log('initial state:', EN.state.state);
if (EN.state.state !== 'PATROL') throw new Error('should start PATROL');
if (!EN.contacts || EN.contacts().length !== 6) throw new Error('medium should have 6 security units');
EN.reset('easy');
if (EN.contacts().length !== 4) throw new Error('easy should have 4 security units');
EN.reset('hard');
if (EN.contacts().length !== 6) throw new Error('hard should have 6 security units');
console.log('contacts:', EN.contacts().map(function (c) { return c.id + ':' + c.state; }).join(', '));

// Player noise is Hard-only, and only inside HEAR_RANGE (~9 m)
EN.reset('medium');
var agMed = EN.state.agitation;
EN.hear(EN.state.x + 1.5, EN.state.z, 34, 1, true);
if (EN.state.agitation !== agMed) throw new Error('medium should ignore player noise');
EN.reset('hard');
EN.hear(EN.state.x + 1.5, EN.state.z, 34, 1, true);
if (EN.state.state === 'PATROL' && EN.state.agitation < 10) {
  throw new Error('hard should hear nearby player noise');
}
EN.reset('hard');
var agFar = EN.state.agitation;
EN.hear(EN.state.x + 40, EN.state.z, 34, 1, true);
if (EN.state.agitation !== agFar) throw new Error('hard should not hear player noise past hear range');
EN.reset('hard');

// 1) loud noise right next to the lair -> escalate off patrol
for (var i = 0; i < 600; i++) {
  now += dt;
  if (i % 30 === 0) EN.hear(M.markers.C.x + 4, M.markers.C.z, 34, now, true);
  EN.update(dt, player, now, game);
}
console.log('after loud noise near lair:', EN.state.state, 'agitation', EN.state.agitation.toFixed(1));
if (EN.state.state === 'DORMANT') throw new Error('should not be dormant');
if (EN.state.state === 'PATROL' && EN.state.agitation < 10) throw new Error('should have agitated');

// 2) place primary in kill range of a noisy player outside harbor
player = { x: M.markers.C.x + 6, z: M.markers.C.z, yaw: 0 };
if (M.isSafeAt(player.x, player.z) || M.isSolidAt(player.x, player.z)) {
  player.x = M.markers.G.x - 8; player.z = M.markers.G.z;
}
EN.state.x = player.x + 0.8; EN.state.z = player.z;
EN.forceChase(now);
var d0 = Math.hypot(EN.state.x - player.x, EN.state.z - player.z);
for (i = 0; i < 60 * 5 && !killed; i++) {
  now += dt;
  EN.hear(player.x, player.z, 40, now, true);
  EN.update(dt, player, now, game);
}
var d1 = Math.hypot(EN.state.x - player.x, EN.state.z - player.z);
console.log('distance before/after pursuit:', d0.toFixed(1), '->', d1.toFixed(1), 'state:', EN.state.state, 'killed:', killed, 'in', (i / 60).toFixed(1) + 's', 'safe?', M.isSafeAt(player.x, player.z));
if (!killed) throw new Error('player in kill range should die within 5 s');

// 3) silence after chase -> drops out of CHASE
EN.reset();
EN.state.agitation = 50;
player = { x: M.markers.P.x, z: M.markers.P.z, yaw: 0 };
EN.forceChase(now);
now += 100; // ensure lastNoiseFed stale
var lastState = 'CHASE';
for (i = 0; i < 60 * 10; i++) {
  now += dt;
  EN.update(dt, player, now, game);
  lastState = EN.state.state;
  if (lastState !== 'CHASE') break;
}
console.log('silent player: chase decays to', lastState);
if (lastState === 'CHASE') throw new Error('chase should decay without noise');

// 4) raycast perf: 220 rays x 600 frames
var t0 = Date.now();
var hits = 0;
for (var f = 0; f < 600; f++) {
  for (var r = 0; r < 220; r++) {
    var a = Math.random() * Math.PI * 2, p = (Math.random() - 0.5);
    var h = M.raycast(player.x, 1.6, player.z, Math.sin(a), p, -Math.cos(a), 60);
    if (h) hits++;
  }
}
var ms = Date.now() - t0;
console.log('raycast perf: 132000 rays in ' + ms + ' ms (' + (ms / 600).toFixed(3) + ' ms/frame), hit rate ' + (hits / 132000 * 100).toFixed(1) + '%');
if (ms / 600 > 4) throw new Error('raycast too slow');

console.log('SMOKE OK');
