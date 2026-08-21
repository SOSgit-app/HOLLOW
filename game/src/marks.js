// HOLLOW — wall code stencils.
// map.js decides where a code lives; this module knows how to paint one.
// Codes are 5x7 pixel glyphs sprayed onto the wall face so the Operator can
// read a position aloud ("I'm on K4") and the Director can find it on the
// printed mission map.
(function (NS) {
  'use strict';

  var GLYPHS = {
    A: '.###.,#...#,#...#,#####,#...#,#...#,#...#',
    B: '####.,#...#,#...#,####.,#...#,#...#,####.',
    C: '.####,#....,#....,#....,#....,#....,.####',
    D: '####.,#...#,#...#,#...#,#...#,#...#,####.',
    E: '#####,#....,#....,####.,#....,#....,#####',
    F: '#####,#....,#....,####.,#....,#....,#....',
    G: '.###.,#...#,#....,#.###,#...#,#...#,.###.',
    H: '#...#,#...#,#...#,#####,#...#,#...#,#...#',
    I: '#####,..#..,..#..,..#..,..#..,..#..,#####',
    J: '..###,...#.,...#.,...#.,...#.,#..#.,.##..',
    K: '#...#,#..#.,#.#..,##...,#.#..,#..#.,#...#',
    L: '#....,#....,#....,#....,#....,#....,#####',
    M: '#...#,##.##,#.#.#,#.#.#,#...#,#...#,#...#',
    N: '#...#,##..#,#.#.#,#.#.#,#..##,#...#,#...#',
    O: '.###.,#...#,#...#,#...#,#...#,#...#,.###.',
    P: '####.,#...#,#...#,####.,#....,#....,#....',
    Q: '.###.,#...#,#...#,#...#,#.#.#,#..#.,.##.#',
    R: '####.,#...#,#...#,####.,#.#..,#..#.,#...#',
    S: '.####,#....,#....,.###.,....#,....#,####.',
    T: '#####,..#..,..#..,..#..,..#..,..#..,..#..',
    U: '#...#,#...#,#...#,#...#,#...#,#...#,.###.',
    V: '#...#,#...#,#...#,#...#,#...#,.#.#.,..#..',
    W: '#...#,#...#,#...#,#.#.#,#.#.#,##.##,#...#',
    X: '#...#,#...#,.#.#.,..#..,.#.#.,#...#,#...#',
    Y: '#...#,#...#,.#.#.,..#..,..#..,..#..,..#..',
    Z: '#####,....#,...#.,..#..,.#...,#....,#####',
    '0': '.###.,#..##,#..##,#.#.#,##..#,##..#,.###.',
    '1': '..#..,.##..,..#..,..#..,..#..,..#..,.###.',
    '2': '.###.,#...#,....#,...#.,..#..,.#...,#####',
    '3': '#####,...#.,..#..,...#.,....#,#...#,.###.',
    '4': '...#.,..##.,.#.#.,#..#.,#####,...#.,...#.',
    '5': '#####,#....,####.,....#,....#,#...#,.###.',
    '6': '..##.,.#...,#....,####.,#...#,#...#,.###.',
    '7': '#####,....#,...#.,..#..,.#...,.#...,.#...',
    '8': '.###.,#...#,#...#,.###.,#...#,#...#,.###.',
    '9': '.###.,#...#,#...#,.####,....#,...#.,.##..'
  };

  var GW = 5, GH = 7, ADVANCE = 6; // logical glyph cell + tracking
  var SCALE = 2, PAD = 1;          // 2x upsample + 1px dilation → solid strokes
  var OUT_ADV = ADVANCE * SCALE;
  var OUT_H = GH * SCALE + PAD;

  // code -> [[px, py], ...] of lit pixels, origin top-left of the whole string
  var inkCache = {};

  function inkPixels(code) {
    var hit = inkCache[code];
    if (hit) return hit;
    var px = [], seen = {};
    function add(x, y) {
      if (x < 0 || y < 0 || y >= OUT_H) return;
      var k = x + ',' + y;
      if (seen[k]) return;
      seen[k] = 1;
      px.push([x, y]);
    }
    for (var i = 0; i < code.length; i++) {
      var rows = GLYPHS[code[i]];
      if (!rows) continue;
      rows = rows.split(',');
      for (var y = 0; y < GH; y++) {
        for (var x = 0; x < GW; x++) {
          if (rows[y][x] !== '#') continue;
          var sx = i * OUT_ADV + x * SCALE, sy = y * SCALE;
          for (var oy = 0; oy < SCALE + PAD; oy++) {
            for (var ox = 0; ox < SCALE + PAD; ox++) add(sx + ox, sy + oy);
          }
        }
      }
    }
    inkCache[code] = px;
    return px;
  }

  function widthPx(code) { return code.length * OUT_ADV - 1; }
  function heightPx() { return OUT_H; }

  // Where on the stencil did this ray land? Returns null outside the box,
  // otherwise { u, v } in pixel units from the stencil's top-left.
  function locate(mark, along, y) {
    var du = along - mark.along;
    if (mark.flip) du = -du;
    var u = (du + mark.w / 2) / mark.w * widthPx(mark.code);
    var v = (mark.y + mark.h / 2 - y) / mark.h * heightPx();
    if (u < 0 || v < 0 || u >= widthPx(mark.code) || v >= heightPx()) return null;
    return { u: u, v: v };
  }

  // World position of one stencil pixel's centre, nudged off the wall so the
  // code floats just proud of the surface instead of z-fighting with it.
  function pixelWorld(mark, px, py, out) {
    var box = NS.map.wallMarkBox();
    var du = (px + 0.5 - widthPx(mark.code) / 2) * box.px;
    if (mark.flip) du = -du;
    var along = mark.along + du;
    var y = mark.y + mark.h / 2 - (py + 0.5) * box.px;
    var off = 0.02;
    if (mark.axis === 'X') {
      out[0] = mark.plane - mark.faceC * off;
      out[1] = y;
      out[2] = along;
    } else {
      out[0] = along;
      out[1] = y;
      out[2] = mark.plane - mark.faceR * off;
    }
    return out;
  }

  NS.marks = {
    color: [0.55, 0.88, 1.0],   // pale blue — signage, not a pickup or a threat
    inkPixels: inkPixels,
    widthPx: widthPx,
    height: OUT_H,
    locate: locate,
    pixelWorld: pixelWorld
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
