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
if (!M.powSites || M.powSites().length !== 3) throw new Error('need 3 POW holds');
var powCodes = {};
M.powSites().forEach(function (s) {
  if (!s.code) throw new Error(s.id + ' missing wall code');
  if (powCodes[s.code]) throw new Error('POW sites share wall code ' + s.code);
  powCodes[s.code] = true;
  mustPath(M.markers.P, s, 'P→' + s.id);
});
if (!M.markers.safes || !M.markers.safes.length) throw new Error('harbor missing');
if (!M.markers.harbors || M.markers.harbors.length !== 2) throw new Error('need infil + east Faraday');
if (M.markers.lasers.length < 9) throw new Error('raid should have E/L tripwires');
var ids = M.markers.lasers.map(function (L) { return L.id; });
['L-EAST', 'L-KEY3', 'L-EWEST', 'L-PINCH3'].forEach(function (id) {
  if (ids.indexOf(id) < 0) throw new Error('missing tripwire ' + id);
});
if (M.isSafeCell(31, 2)) throw new Error('east harbor should leave the E room');
if (M.isSafeCell(40, 2)) throw new Error('F north / key 3 should stay outside east safe space');
if (!M.isSafeCell(42, 5) || !M.isSafeCell(41, 6) || !M.isSafeCell(42, 6) || !M.isSafeCell(42, 9)) {
  throw new Error('east safe space should be the F3–F5/M1 alcove');
}
if (M.isSafeCell(42, 1) || M.isSafeCell(42, 3)) throw new Error('F1/F2 should stay outside alcove');
if (M.isSafeCell(39, 6) || M.isSafeCell(44, 6)) throw new Error('E4/F6 should stay outside alcove');
if (M.isSafeCell(37, 6)) throw new Error('F west door should stay outside harbor');
if (M.isSafeCell(35, 9)) throw new Error('U2 spawn must stay outside east harbor');
if (M.isSafeCell(22, 8) || M.isSafeCell(32, 34)) throw new Error('U5/U6 must stay outside harbors');
if (!M.markers.refills || M.markers.refills.length !== 3) throw new Error('need 3 beacon refills');
if (!M.markers.shutoffs || M.markers.shutoffs.length !== 3) throw new Error('need 3 shutoff boxes');
['B1', 'B2', 'B3'].forEach(function (id) {
  if (!M.markers.refills.filter(function (p) { return p.id === id; }).length) throw new Error('missing ' + id);
});
['K1', 'K2', 'K3'].forEach(function (id) {
  if (!M.markers.shutoffs.filter(function (p) { return p.id === id; }).length) throw new Error('missing ' + id);
});
if (M.securityPosts('easy').length !== 4) throw new Error('easy should staff 4 posts');
if (M.securityPosts('medium').length !== 6 || M.securityPosts('hard').length !== 6) {
  throw new Error('medium/hard should staff 6 posts');
}

function mustPath(from, to, label) {
  if (!M.astar(from.x, from.z, to.x, to.z)) throw new Error('no path ' + label);
}
mustPath(M.markers.P, M.markers.fuses[0], 'P→key1');
mustPath(M.markers.P, M.markers.fuses[1], 'P→key2');
mustPath(M.markers.P, M.markers.fuses[2], 'P→key3');
mustPath(M.markers.P, M.markers.X, 'P→LZ');
M.markers.refills.forEach(function (p) { mustPath(M.markers.P, p, 'P→' + p.id); });
M.markers.shutoffs.forEach(function (p) { mustPath(M.markers.P, p, 'P→' + p.id); });
M.markers.security.forEach(function (p) {
  mustPath(p, M.markers.P, p.id + '→P');
});

console.log('overlay packet marks OK — codes, keys, doors, wires, harbor, POW, patrol posts');
