/* Headless check: core handshake intercepts reduce to the nine true sequences. */
'use strict';
require('../game/src/circuit.js');
var CIR = global.HOLLOW.circuit;
var C = CIR.debug;
var data = CIR.getSheetData();

var genuine = data.intercepts.filter(CIR.isGenuine);
if (genuine.length !== 9) {
  throw new Error('expected 9 genuine intercepts, got ' + genuine.length);
}

var seen = {};
genuine.forEach(function (row) {
  var key = row.band + '-' + row.stage;
  if (seen[key]) throw new Error('duplicate genuine strip for ' + key);
  seen[key] = true;
  var want = data.solutions[row.band][row.stage - 1].join(',');
  var got = row.pads.join(',');
  if (want !== got) {
    throw new Error(key + ' pads ' + got + ' !== solution ' + want);
  }
});

['WEST', 'EAST', 'CORE'].forEach(function (band) {
  for (var s = 1; s <= 3; s++) {
    if (!seen[band + '-' + s]) throw new Error('missing genuine ' + band + ' stage ' + s);
  }
});

['WEST', 'EAST', 'CORE'].forEach(function (band) {
  C.start({ band: band, serial: '111', stageCount: 3 });
  for (var i = 0; i < 3; i++) {
    C.setStage(i);
    if (C.connected()) throw new Error(band + ' stage ' + (i + 1) + ' starts solved');
    C.solve();
    if (!C.connected()) throw new Error(band + ' stage ' + (i + 1) + ' solution rejected');
  }
});

C.start({ tutorial: true, band: 'EAST', serial: '4B7', stageCount: 1 });
if (C.stageCount() !== 1) throw new Error('tutorial should be 1 stage');
if (C.serial() !== '4B7') throw new Error('tutorial serial');
C.solve();
if (!C.connected()) throw new Error('tutorial solution rejected');

console.log('9 genuine intercepts match solutions; all bands solvable. HANDSHAKE OK');
