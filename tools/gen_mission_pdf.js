'use strict';
var fs = require('fs');
require('../game/src/math.js');
require('../game/src/map.js');
var M = global.HOLLOW.map;

var rows = M.asciiRows().map(function (line, r) {
  var out = '';
  for (var c = 0; c < line.length; c++) {
    var ch = line[c];
    if (ch === 'W') ch = '.'; // POW location withheld from mission map
    if (M.isSafeCell(c, r) && (ch === '.' || ch === 'S')) out += 'S';
    else out += ch;
  }
  return out;
});

// Overlay blast doors + tripwire midpoints so the PDF matches the printable diagram
function putChar(c, r, ch) {
  if (r < 0 || r >= rows.length || c < 0 || c >= rows[r].length) return;
  var line = rows[r];
  rows[r] = line.slice(0, c) + ch + line.slice(c + 1);
}
M.markers.doors.forEach(function (d) {
  putChar(d.c, d.r, 'D');
});
M.markers.lasers.forEach(function (L) {
  var c = Math.floor(((L.x0 + L.x1) * 0.5) / M.CELL);
  var r = Math.floor(((L.z0 + L.z1) * 0.5) / M.CELL);
  putChar(c, r, 'T');
});

var P = M.markers.P;
var pCol = Math.floor(P.x / M.CELL), pRow = Math.floor(P.z / M.CELL);
var doorLine = M.markers.doors.map(function (d) {
  return d.id + '@' + d.c + ',' + d.r;
}).join('  ');
var tripLine = M.markers.lasers.map(function (L) {
  var c = Math.floor(((L.x0 + L.x1) * 0.5) / M.CELL);
  var r = Math.floor(((L.z0 + L.z1) * 0.5) / M.CELL);
  return L.id + '@' + c + ',' + r;
}).join('  ');

var body = [
  'HOLLOW — HOSTILE AI SITE — MISSION MAP',
  'CYBER INFILTRATION / EMP BLACKOUT / CLONE AND CORRUPT',
  '',
  'START / INFIL: grid col ' + pCol + ', row ' + pRow + '  (ASCII character P)',
  'BLAST DOORS: ' + doorLine,
  'TRIPWIRES (T): ' + tripLine,
  'INTENT: Infiltrate blacked-out AI site. Keys → console → clone & corrupt → LZ extract.',
  'EMP cut facility power. Operator maps with LiDAR; Wristlink radar tracks security.',
  'Minimize emissions. One Faraday harbor in the start/infil room. Two security units.',
  '',
  'LEGEND: # wall  . floor  S harbor  P START  D blast door  T tripwire  1-3 keys  G AI core  X LZ  C security',
  ''
].concat(rows).concat([
  '',
  'Operator=VR (LiDAR + radar). Mission Director=this map + voice.',
  'After uplink: inbound then on-station window. Miss LZ = left behind.',
  'Full-color diagram: open game/map-print.html → Print → Save as PDF.'
]);

function pdfEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

var fontSize = 6;
var content = ['BT', '/F1 ' + fontSize + ' Tf', '36 780 Td', '7 TL'];
body.forEach(function (line, i) {
  var cmd = (i === 0 ? '' : 'T* ') + '(' + pdfEscape(line) + ') Tj';
  content.push(cmd);
});
content.push('ET');
var stream = content.join('\n');

var objs = [];
objs.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
objs.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
objs.push('3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n');
objs.push('4 0 obj<< /Length ' + Buffer.byteLength(stream, 'utf8') + ' >>stream\n' + stream + '\nendstream\nendobj\n');
objs.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>endobj\n');

var pdf = '%PDF-1.4\n';
var offsets = [0];
objs.forEach(function (o) {
  offsets.push(Buffer.byteLength(pdf, 'utf8'));
  pdf += o;
});
var xrefStart = Buffer.byteLength(pdf, 'utf8');
pdf += 'xref\n0 ' + (objs.length + 1) + '\n';
pdf += '0000000000 65535 f \n';
for (var i = 1; i < offsets.length; i++) {
  pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
}
pdf += 'trailer<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';

var out = __dirname + '/../game/assets/HOLLOW_Mission_Map.pdf';
fs.mkdirSync(__dirname + '/../game/assets', { recursive: true });
fs.writeFileSync(out, pdf);
console.log('Wrote', out);
console.log('safes=', M.markers.safes.length, 'lasers=', M.markers.lasers.length);
