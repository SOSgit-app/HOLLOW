/* Headless check: both jack-in stages must be solvable and never start solved. */
'use strict';
require('../game/src/circuit.js');
var C = global.HOLLOW.circuit.debug;

var stages = C.stageCount();
for (var s = 0; s < stages; s++) {
  C.setStage(s);
  if (C.connected()) {
    throw new Error('stage ' + (s + 1) + ' starts already solved');
  }
  C.solve();
  if (!C.connected()) {
    throw new Error('stage ' + (s + 1) + ' solution does not connect');
  }
}
console.log(stages + ' stages: all solvable, none pre-solved. CIRCUIT OK');
