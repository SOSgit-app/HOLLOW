/* Headless check: overlay packets can load the mission map and POW mark. */
'use strict';
require('../game/src/math.js');
require('../game/src/map.js');
var M = global.HOLLOW.map;
M.loadLayout('mission', { lasers: 'standard' });

if (!M.wallMarks().length) throw new Error('wall codes missing');
if (!M.markers.P || !M.markers.G || !M.markers.X) throw new Error('missing P/G/X');
if (!M.markers.fuses || M.markers.fuses.length < 3) throw new Error('need 3 keys');
if (!M.markers.doors || M.markers.doors.length < 9) throw new Error('need D1–D9 blast doors');
var doorIds = M.markers.doors.map(function (d) { return d.id; });
['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'].forEach(function (id) {
  if (doorIds.indexOf(id) < 0) throw new Error('missing door ' + id);
});
if (!M.markers.doors.filter(function (d) { return d.console; }).length) {
  throw new Error('D3/console door missing');
}
if (!M.markers.lasers || !M.markers.lasers.length) throw new Error('need tripwires');
if (!M.markers.W) throw new Error('POW mark W required for Controller sheet');
if (!M.markers.safes || !M.markers.safes.length) throw new Error('harbor missing');
if (!M.markers.harbors || M.markers.harbors.length !== 2) throw new Error('need infil + east Faraday');
if (M.markers.lasers.length < 9) throw new Error('raid should have E/L tripwires');
var ids = M.markers.lasers.map(function (L) { return L.id; });
['L-EAST', 'L-KEY3', 'L-EWEST', 'L-PINCH3'].forEach(function (id) {
  if (ids.indexOf(id) < 0) throw new Error('missing tripwire ' + id);
});
if (M.isSafeCell(31, 2)) throw new Error('east harbor should leave the E room');
if (M.isSafeCell(40, 2) !== true) throw new Error('east harbor should cover the F room');
if (M.isSafeCell(37, 6)) throw new Error('F west door should stay outside harbor');
if (M.isSafeCell(35, 9)) throw new Error('U2 spawn must stay outside east harbor');
if (!M.markers.security || M.markers.security.length !== 4) throw new Error('need 4 named patrol posts');
if (M.securityPosts('medium').length !== 3) throw new Error('medium should staff 3 posts');
if (M.securityPosts('easy').length !== 4 || M.securityPosts('hard').length !== 4) {
  throw new Error('easy/hard should staff 4 posts');
}

function mustPath(from, to, label) {
  if (!M.astar(from.x, from.z, to.x, to.z)) throw new Error('no path ' + label);
}
mustPath(M.markers.P, M.markers.fuses[0], 'P→key1');
mustPath(M.markers.P, M.markers.fuses[1], 'P→key2');
mustPath(M.markers.P, M.markers.fuses[2], 'P→key3');
mustPath(M.markers.P, M.markers.X, 'P→LZ');
mustPath(M.markers.P, M.markers.W, 'P→POW');
M.markers.security.forEach(function (p) {
  mustPath(p, M.markers.P, p.id + '→P');
});

console.log('overlay packet marks OK — codes, keys, doors, wires, harbor, POW, patrol posts');
