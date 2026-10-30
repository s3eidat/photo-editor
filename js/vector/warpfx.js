/* Vector lane: the maths behind the distortions, shared by transforms, warp text and the warp tools.
   square -> quad projective maps, 4 x 4 bicubic bezier patches, least-squares patch fitting, and the warp styles
   (arc, bulge, flag, wave, fish, rise, fisheye, inflate, squeeze, twist…), all written for this app. */
(function (G) {
  "use strict";
  var WF = {};
  // ---------- square (u, v in 0..1) -> quad p[0..3] = TL, TR, BR, BL ----------
  WF.homog = function (p) {
    var x0 = p[0].x, y0 = p[0].y, x1 = p[1].x, y1 = p[1].y, x2 = p[2].x, y2 = p[2].y, x3 = p[3].x, y3 = p[3].y;
    var sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, a, b, c, d, e, f, g = 0, h = 0;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) { a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; }
    else {
      var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1 || 1e-12;
      g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
      a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
    }
    var fn = function (u, v) { var w = g * u + h * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
    fn.m = [a, b, c, d, e, f, g, h];
    // inverse (quad -> square), for mapping anchors and hit tests
    fn.inv = function (x, y) {
      var A = e - f * h, B = f * g - d, C = d * h - e * g, D = c * h - b, E = a - c * g, F = b * g - a * h, Gm = b * f - c * e, Hm = c * d - a * f, I = a * e - b * d;
      var w = C * x + F * y + I; return { u: (A * x + D * y + Gm) / w, v: (B * x + E * y + Hm) / w };
    };
    return fn;
  };
  // ---------- bicubic bezier patch: P = 16 points, row-major (v rows, u columns) ----------
  function bern(t) { var s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; }
  WF.bern = bern;
  WF.patch = function (P) {
    return function (u, v) {
      var bu = bern(u), bv = bern(v), x = 0, y = 0;
      for (var j = 0; j < 4; j++) for (var i = 0; i < 4; i++) { var w = bv[j] * bu[i], q = P[j * 4 + i]; x += w * q.x; y += w * q.y; }
      return { x: x, y: y };
    };
  };
  // identity patch over a rect
  WF.gridPatch = function (r) { var P = []; for (var j = 0; j < 4; j++) for (var i = 0; i < 4; i++) P.push({ x: r.x + r.w * i / 3, y: r.y + r.h * j / 3 }); return P; };
  // least-squares 4x4 patch through samples of f(u, v) on an n x n grid (keeps the corners exact)
  WF.fitPatch = function (f, n) {
    n = n || 9;
    var M = [], bx = [], by = [];
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var u = i / (n - 1), v = j / (n - 1), bu = bern(u), bv = bern(v), row = [];
      for (var q = 0; q < 4; q++) for (var p = 0; p < 4; p++) row.push(bv[q] * bu[p]);
      var t = f(u, v); M.push(row); bx.push(t.x); by.push(t.y);
    }
    function solve(rhs) {      // normal equations, Gaussian elimination
      var A = [], k, r, c;
      for (r = 0; r < 16; r++) { A.push(new Array(17).fill(0)); for (k = 0; k < M.length; k++) { for (c = 0; c < 16; c++) A[r][c] += M[k][r] * M[k][c]; A[r][16] += M[k][r] * rhs[k]; } }
      for (c = 0; c < 16; c++) {
        var piv = c; for (r = c + 1; r < 16; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
        for (r = 0; r < 16; r++) if (r !== c && A[c][c]) { var fct = A[r][c] / A[c][c]; for (k = c; k < 17; k++) A[r][k] -= fct * A[c][k]; }
      }
      return A.map(function (row, i) { return row[16] / (row[i] || 1); });
    }
    var X = solve(bx), Y = solve(by);
    return X.map(function (x, i) { return { x: x, y: Y[i] }; });
  };
  // move the patch point at (u, v) by (dx, dy) with the smallest change to the controls
  WF.dragPatch = function (P0, u, v, dx, dy) {
    var bu = bern(u), bv = bern(v), w = [], s = 0, j, i;
    for (j = 0; j < 4; j++) for (i = 0; i < 4; i++) { var q = bv[j] * bu[i]; w.push(q); s += q * q; }
    return P0.map(function (p, k) { return { x: p.x + dx * w[k] / s, y: p.y + dy * w[k] / s }; });
  };
  // nearest (u, v) on a mapping to point (x, y): coarse grid then refine
  WF.locate = function (f, x, y) {
    var best = { u: 0.5, v: 0.5, d: Infinity }, N = 24, i, j;
    for (j = 0; j <= N; j++) for (i = 0; i <= N; i++) { var p = f(i / N, j / N), d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < best.d) best = { u: i / N, v: j / N, d: d }; }
    var st = 1 / N;
    for (var it = 0; it < 16; it++) {
      [[st, 0], [-st, 0], [0, st], [0, -st]].forEach(function (o) {
        var u = Math.max(0, Math.min(1, best.u + o[0])), v = Math.max(0, Math.min(1, best.v + o[1])), p = f(u, v), d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (d < best.d) best = { u: u, v: v, d: d };
      });
      st /= 2;
    }
    best.d = Math.sqrt(best.d);
    return best;
  };

  // ---------- warp styles: (u, v) in the unit box -> warped unit coordinates. bend, hd, vd in -1..1 ----------
  WF.STYLES = [["none", "None"], ["arc", "Arc"], ["arcLower", "Arc lower"], ["arcUpper", "Arc upper"], ["arch", "Arch"], ["bulge", "Bulge"], ["shellLower", "Shell lower"], ["shellUpper", "Shell upper"],
    ["flag", "Flag"], ["wave", "Wave"], ["fish", "Fish"], ["rise", "Rise"], ["fisheye", "Fisheye"], ["inflate", "Inflate"], ["squeeze", "Squeeze"], ["twist", "Twist"]];
  function hump(t) { var s = 2 * t - 1; return 1 - s * s; }      // 0 at the ends, 1 in the middle
  // aspect = box height / width: the geometric styles (arc, fisheye, twist) work in true proportions
  WF.style = function (style, bend, hd, vd, aspect) {
    var b = bend || 0, A = aspect > 0 ? aspect : 1;
    function base(u, v) {
      switch (style) {
        case "arc": {
          if (Math.abs(b) < 1e-4) return [u, v];
          var sg = b < 0 ? -1 : 1, ab = Math.abs(b), R = 1 / (ab * Math.PI), th = (u - 0.5) * ab * Math.PI, vv = (sg > 0 ? v : 1 - v) * A, r = R + A / 2 - vv;
          var x = 0.5 + r * Math.sin(th), y = (A / 2 + R - r * Math.cos(th)) / A;
          return [x, sg > 0 ? y : 1 - y];
        }
        case "arcLower": return [u, v + v * b * 0.5 * hump(u)];
        case "arcUpper": return [u, v - (1 - v) * b * 0.5 * hump(u)];
        case "arch": return [u, v - b * 0.5 * hump(u)];
        case "bulge": return [u, v + (v - 0.5) * b * hump(u)];
        case "shellLower": return [0.5 + (u - 0.5) * (1 - b * 0.35 * (1 - v)), v + v * b * 0.5 * hump(u)];
        case "shellUpper": return [0.5 + (u - 0.5) * (1 - b * 0.35 * v), v - (1 - v) * b * 0.5 * hump(u)];
        case "flag": return [u, v + b * 0.45 * Math.sin(2 * Math.PI * u)];
        case "wave": return [u, v + b * 0.45 * Math.sin(2 * Math.PI * u + v * Math.PI * 0.6)];
        case "fish": return [u, v + (v - 0.5) * b * Math.sin(Math.PI * u) * (1.4 - u)];
        case "rise": return [u, v - b * 0.35 * Math.sin(Math.PI * (u - 0.5))];
        case "fisheye": { var dx = u - 0.5, dy = (v - 0.5) * A, R2 = 0.25 + A * A / 4, k = 1 + b * 0.6 * Math.max(0, 1 - (dx * dx + dy * dy) / R2); return [0.5 + dx * k, 0.5 + dy * k / A]; }
        case "inflate": return [u + (u - 0.5) * b * 0.6 * hump(v), v + (v - 0.5) * b * 0.6 * hump(u)];
        case "squeeze": return [0.5 + (u - 0.5) * (1 - b * 0.6 * hump(v)), v];
        case "twist": { var tx = u - 0.5, ty = (v - 0.5) * A, rr = Math.min(1, Math.hypot(tx, ty) / Math.sqrt(0.25 + A * A / 4)), a = b * Math.PI * (1 - rr) * (1 - rr), c = Math.cos(a), s = Math.sin(a); return [0.5 + tx * c - ty * s, 0.5 + (tx * s + ty * c) / A]; }
        default: return [u, v];
      }
    }
    return function (u, v) {
      var p = base(u, v), x = p[0], y = p[1];
      if (vd) x = 0.5 + (x - 0.5) * (1 - vd * (y - 0.5) * 1.2);      // vertical distortion: wider at one end
      if (hd) y = 0.5 + (y - 0.5) * (1 - hd * (x - 0.5) * 1.2);      // horizontal distortion: taller at one side
      return [x, y];
    };
  };
  G.WF = WF;
  if (G.PE) G.PE.WF = WF;
})(typeof self !== "undefined" ? self : this);
