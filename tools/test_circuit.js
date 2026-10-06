/* Headless check: overlay packets can load the mission map and POW mark. */
'use strict';
require('../game/src/math.js');
require('../game/src/map.js');
var M = global.HOLLOW.map;
M.loadLayout('mission', { lasers: 'standard' });

if (!M.wallMarks().length) throw new Error('wall codes missing');
if (!M.markers.P || !M.markers.G || !M.markers.X) throw new Error('missing P/G/X');
if (!M.markers.fuses || M.markers.fuses.length < 3) throw new Error('need 3 keys');
if (!M.markers.doors || !M.markers.doors.length) throw new Error('need blast doors');
if (!M.markers.lasers || !M.markers.lasers.length) throw new Error('need tripwires');
if (!M.markers.W) throw new Error('POW mark W required for Controller sheet');
if (!M.markers.safes || !M.markers.safes.length) throw new Error('harbor missing');

console.log('overlay packet marks OK — codes, keys, doors, wires, harbor, POW');
