/* Adjust lane: pixelate filters (colour halftone, halftone pattern, crystallize, pointillize, mezzotint, facet,
   fragment). Pure maths, page + worker. Cell sizes scale with p._scale (reduced-size previews). */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, c255 = A.c255;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }

  // ---------- dots on a rotated screen ----------
  // ink: plane 0..1 (already averaged over about a cell), angle in degrees, cell size s px -> coverage 0..1 per pixel.
  function screen(ink, w, h, ang, s, shape, out) {
    var a = ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), rmax = s * 0.5 * Math.SQRT2;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var u = x * ca + y * sa, v = -x * sa + y * ca, gu = Math.floor(u / s), gv = Math.floor(v / s), cov = 0;
      for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
        var cu = (gu + i + 0.5) * s, cv = (gv + j + 0.5) * s, X = cu * ca - cv * sa, Y = cu * sa + cv * ca;     // cell centre back in image space
        var k = A.bilin(ink, w, h, clamp(X, 0, w - 1), clamp(Y, 0, h - 1)), du = u - cu, dv = v - cv, c;
        if (shape === "line") c = clamp(k * s * 0.5 - Math.abs(dv) + 0.5, 0, 1);
        else if (shape === "circle") { var dd = Math.sqrt(du * du + dv * dv), ringW = Math.max(1, k * s * 0.35); c = clamp(ringW - Math.abs(dd - s * 0.3) + 0.5, 0, 1) * (k > 0.02 ? 1 : 0); }
        else c = clamp(Math.sqrt(k) * rmax - Math.sqrt(du * du + dv * dv) + 0.5, 0, 1);
        if (c > cov) cov = c;
      }
      out[y * w + x] = cov;
    }
    return out;
  }
  A.reg("colorHalftone", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, d = img.data, S = sc(p), R = Math.max(2, clamp(num(p.radius, 8), 4, 127) * S), s = R * 2;
    var angs = [num(p.a1, 108), num(p.a2, 162), num(p.a3, 90), num(p.a4, 45)], useK = p.black !== false, q, i;
    var C = new Float32Array(n), M = new Float32Array(n), Y = new Float32Array(n), K = new Float32Array(n);
    for (q = 0, i = 0; q < n; q++, i += 4) {
      var c = 1 - d[i] / 255, m = 1 - d[i + 1] / 255, y = 1 - d[i + 2] / 255, k = useK ? Math.min(c, m, y) : 0;
      C[q] = c - k; M[q] = m - k; Y[q] = y - k; K[q] = k;
    }
    var inks = [C, M, Y, K], cov = [];
    for (var j = 0; j < (useK ? 4 : 3); j++) { var pl = A.boxMean(inks[j], w, h, Math.max(1, Math.round(R * 0.7))); cov.push(screen(pl, w, h, angs[j], s, "dot", new Float32Array(n))); }
    for (q = 0, i = 0; q < n; q++, i += 4) {
      var kk = useK ? cov[3][q] : 0;
      d[i] = 255 * (1 - cov[0][q]) * (1 - kk); d[i + 1] = 255 * (1 - cov[1][q]) * (1 - kk); d[i + 2] = 255 * (1 - cov[2][q]) * (1 - kk);
    }
    return img;
  }));
  // Halftone pattern: one screen of dots / circles / lines in the foreground colour on the background colour.
  A.reg("halftonePattern", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, d = img.data, S = sc(p), s = Math.max(2, clamp(num(p.size, 4), 1, 12) * 2 * S), ct = clamp(num(p.contrast, 5), 0, 50) / 50;
    var fg = A.hex(p.fg, [0, 0, 0]), bg = A.hex(p.bg, [255, 255, 255]), L = A.lumPlane(img, 1 / 255), q, i;
    for (q = 0; q < n; q++) { var v = 1 - L[q]; L[q] = clamp(0.5 + (v - 0.5) * (1 + ct * 4), 0, 1); }
    var ink = A.boxMean(L, w, h, Math.max(1, Math.round(s * 0.35))), cov = screen(ink, w, h, p.pattern === "line" ? 0 : 45, s, p.pattern || "dot", new Float32Array(n));
    for (q = 0, i = 0; q < n; q++, i += 4) for (var c = 0; c < 3; c++) d[i + c] = bg[c] + (fg[c] - bg[c]) * cov[q];
    return img;
  }));

  // ---------- jittered-grid cells (Voronoi) ----------
  function sites(w, h, s, seed) {
    var GW = Math.ceil(w / s) + 2, GH = Math.ceil(h / s) + 2, R = A.rng(seed), sx = new Float32Array(GW * GH), sy = new Float32Array(GW * GH);
    for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) { var k = gy * GW + gx; sx[k] = (gx - 1 + 0.1 + R() * 0.8) * s; sy[k] = (gy - 1 + 0.1 + R() * 0.8) * s; }
    return { GW: GW, GH: GH, x: sx, y: sy, s: s };
  }
  function nearest(T, x, y, out) {
    var gx = Math.floor(x / T.s) + 1, gy = Math.floor(y / T.s) + 1, best = Infinity, bk = 0, second = Infinity;
    for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
      var X = gx + i, Y = gy + j; if (X < 0 || Y < 0 || X >= T.GW || Y >= T.GH) continue;
      var k = Y * T.GW + X, dx = T.x[k] - x, dy = T.y[k] - y, dd = dx * dx + dy * dy;
      if (dd < best) { second = best; best = dd; bk = k; } else if (dd < second) second = dd;
    }
    if (out) { out[0] = Math.sqrt(best); out[1] = Math.sqrt(second); }
    return bk;
  }
  A.reg("crystallize", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, S = sc(p), s = Math.max(2, clamp(num(p.size, 10), 3, 300) * S), T = sites(w, h, s, 31), n = T.GW * T.GH, lab = new Int32Array(w * h);
    var sum = new Float64Array(n * 4), cnt = new Float64Array(n), q, i, k;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      q = y * w + x; i = q * 4; k = nearest(T, x + 0.5, y + 0.5); lab[q] = k;
      var a = d[i + 3]; sum[k * 4] += d[i] * a; sum[k * 4 + 1] += d[i + 1] * a; sum[k * 4 + 2] += d[i + 2] * a; sum[k * 4 + 3] += a; cnt[k]++;
    }
    for (q = 0, i = 0; q < w * h; q++, i += 4) { k = lab[q]; var A0 = sum[k * 4 + 3]; if (A0 > 0) { d[i] = sum[k * 4] / A0; d[i + 1] = sum[k * 4 + 1] / A0; d[i + 2] = sum[k * 4 + 2] / A0; } d[i + 3] = A0 / cnt[k]; }
    return img;
  }));
  A.reg("pointillize", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, S = sc(p), s = Math.max(2, clamp(num(p.size, 6), 3, 300) * S), T = sites(w, h, s * 0.8, 47), n = T.GW * T.GH, src = PIX.copyImg(img), o = [0, 0, 0, 0], col = new Float32Array(n * 3), R = A.rng(53), rad = new Float32Array(n);
    var bg = A.hex(p.bg, [255, 255, 255]), dd = [0, 0];
    for (var k = 0; k < n; k++) {
      A.sample(src, clamp(T.x[k], 0, w - 1), clamp(T.y[k], 0, h - 1), o, "clamp");
      var jit = (R() - 0.5) * 40; col[k * 3] = o[0] + jit; col[k * 3 + 1] = o[1] + jit * 0.8; col[k * 3 + 2] = o[2] + jit * 1.1; rad[k] = s * (0.42 + R() * 0.25);
    }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var kk = nearest(T, x + 0.5, y + 0.5, dd), i = (y * w + x) * 4, cov = clamp(rad[kk] - dd[0] + 0.5, 0, 1);
      for (var c = 0; c < 3; c++) d[i + c] = c255(bg[c] + (col[kk * 3 + c] - bg[c]) * cov);
      d[i + 3] = 255;
    }
    return img;
  }));
  // Mezzotint: every channel thresholded against a random pattern (dots, lines or strokes of three sizes).
  A.reg("mezzotint", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, d = img.data, S = sc(p), type = p.type || "medDots", R = A.rng(61), q;
    var sz = { fineDots: 0, medDots: 0.8, grainyDots: 1.2, coarseDots: 2, shortLines: 3, medLines: 8, longLines: 20, shortStrokes: 3, medStrokes: 7, longStrokes: 14 }[type] || 0.8;
    for (var c = 0; c < 3; c++) {
      var t = new Float32Array(n); for (q = 0; q < n; q++) t[q] = R();
      if (/Lines$/.test(type)) { for (var y = 0; y < h; y++) { var row = t.subarray(y * w, y * w + w), b = A.boxMean(row, w, 1, Math.max(1, Math.round(sz * S))); row.set(b); } }
      else if (/Strokes$/.test(type)) t = diag(t, w, h, Math.max(1, Math.round(sz * S)));
      else if (sz) A.blur(t, w, h, sz * S);
      var mn = Infinity, mx = -Infinity; for (q = 0; q < n; q += 5) { if (t[q] < mn) mn = t[q]; if (t[q] > mx) mx = t[q]; }
      var sp = mx - mn || 1;
      for (q = 0; q < n; q++) { var th = (t[q] - mn) / sp * 255; d[q * 4 + c] = type === "grainyDots" ? (d[q * 4 + c] > th ? 255 : d[q * 4 + c] > th * 0.7 ? 128 : 0) : (d[q * 4 + c] > th ? 255 : 0); }
    }
    return img;
  }));
  function diag(t, w, h, len) {      // average along the 45° diagonal
    var o = new Float32Array(t.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var s = 0, c = 0; for (var k = -len; k <= len; k++) { var X = x + k, Y = y + k; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; s += t[Y * w + X]; c++; } o[y * w + x] = s / c; }
    return o;
  }
  // Facet: flattens areas of similar colour into blocks (small Kuwahara twice).
  A.reg("facet", A.filter(function (img, p) { var r = Math.max(2, Math.round(4 * sc(p))); A.kuwahara(img, r); return A.kuwahara(img, r); }));
  // Fragment: four copies offset diagonally, averaged.
  A.reg("fragment", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, src = new Uint8ClampedArray(d), o = Math.max(1, Math.round(4 * sc(p))), off = [[-o, -o], [o, -o], [-o, o], [o, o]];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      for (var c = 0; c < 4; c++) { var s = 0; for (var k = 0; k < 4; k++) s += src[(clamp(y + off[k][1], 0, h - 1) * w + clamp(x + off[k][0], 0, w - 1)) * 4 + c]; d[i + c] = s / 4; }
    }
    return img;
  }));
})(typeof self !== "undefined" ? self : this);
