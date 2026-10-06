/* Headless check: mission map splits west/east and wall marks exist for the Controller index. */
'use strict';
require('../game/src/math.js');
require('../game/src/map.js');
var M = global.HOLLOW.map;
M.loadLayout('mission', { lasers: 'standard' });

if (M.SPLIT_COL !== 24) throw new Error('SPLIT_COL should be 24');
if (M.sheetForCol(0) !== 'WEST') throw new Error('col 0 should be WEST');
if (M.sheetForCol(24) !== 'EAST') throw new Error('col 24 should be EAST');

var marks = M.wallMarks();
if (!marks.length) throw new Error('expected wall marks for controller index');
var west = 0, east = 0;
marks.forEach(function (m) {
  if (M.sheetForCol(m.c) === 'WEST') west++;
  else east++;
});
if (!west || !east) throw new Error('wall marks must exist on both halves');

var p = M.markers.P, g = M.markers.G, x = M.markers.X;
if (!p || !g || !x) throw new Error('missing P/G/X');
if (M.sheetForCol(Math.floor(p.x / M.CELL)) !== 'WEST') throw new Error('start should be WEST');
if (M.sheetForCol(Math.floor(g.x / M.CELL)) !== 'EAST') throw new Error('core G should be EAST');
if (M.sheetForCol(Math.floor(x.x / M.CELL)) !== 'WEST') throw new Error('LZ X should be WEST');

console.log(marks.length + ' wall marks, west ' + west + ' / east ' + east + '. SPLIT MAP OK');
