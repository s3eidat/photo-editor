/* Selection maths for the selection lane. Pure functions on plain arrays (no DOM), so the same file runs in the
   page (self-test, small jobs) and in js/select/worker.js (big jobs). Masks are Uint8Array 0..255 like pix.js. */
(function (G) {
  "use strict";
  var PIXS = {};
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var INF = 1e20;

  // ---------- exact Euclidean distance transform (Felzenszwalb & Huttenlocher), squared distances ----------
  function edt1d(f, n, d, v, z) {
    var k = 0, q, s;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < n; q++) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (q = 0; q < n; q++) { while (z[k + 1] < q) k++; var dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
  }
  // Squared distance from every pixel to the nearest pixel where target(p) is true.
  function edt(w, h, target) {
    var n = w * h, D = new Float64Array(n), m = Math.max(w, h), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1), x, y;
    for (var p = 0; p < n; p++) D[p] = target(p) ? 0 : INF;
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) f[y] = D[y * w + x];
      edt1d(f, h, d, v, z);
      for (y = 0; y < h; y++) D[y * w + x] = d[y];
    }
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < w; x++) f[x] = D[row + x];
      edt1d(f, w, d, v, z);
      for (x = 0; x < w; x++) D[row + x] = d[x];
    }
    return D;
  }
  PIXS.edt = edt;
  // Signed distance to the selection edge (pixels, + inside, - outside), from the 50% contour.
  PIXS.signedDist = function (m, w, h) {
    var dOut = edt(w, h, function (p) { return m[p] < 128; }), dIn = edt(w, h, function (p) { return m[p] >= 128; }), n = w * h, s = new Float32Array(n);
    for (var p = 0; p < n; p++) s[p] = m[p] >= 128 ? Math.sqrt(dOut[p]) - 0.5 : -(Math.sqrt(dIn[p]) - 0.5);
    return s;
  };
  function fromSigned(s, fn) { var o = new Uint8Array(s.length); for (var p = 0; p < s.length; p++) o[p] = Math.round(clamp(fn(s[p]), 0, 1) * 255); return o; }
  // Round expand (r > 0) / contract (r < 0) with anti-aliased edges.
  PIXS.offset = function (m, w, h, r) { var s = PIXS.signedDist(m, w, h); return fromSigned(s, function (v) { return v + r + 0.5; }); };
  // Border: a band `width` px wide straddling the selection edge (anti-aliased).
  PIXS.border = function (m, w, h, width) { var s = PIXS.signedDist(m, w, h), hw = Math.max(0.5, width / 2); return fromSigned(s, function (v) { return hw - Math.abs(v) + 0.5; }); };

  // ---------- box blur on a float plane (running sums, edges clamped) ----------
  function boxLine(src, dst, start, step, n, r) {
    var win = 2 * r + 1, sum = 0, k, i;
    for (k = -r; k <= r; k++) sum += src[start + clamp(k, 0, n - 1) * step];
    for (i = 0; i < n; i++) {
      dst[start + i * step] = sum / win;
      sum += src[start + Math.min(n - 1, i + r + 1) * step] - src[start + Math.max(0, i - r) * step];
    }
  }
  function box(a, w, h, r) {
    if (r < 1) return a;
    var t = new Float32Array(a.length), x, y;
    for (y = 0; y < h; y++) boxLine(a, t, y * w, 1, w, r);
    for (x = 0; x < w; x++) boxLine(t, a, x, w, h, r);
    return a;
  }
  PIXS.box = box;
  // Smooth: majority vote in a (2r+1) window, twice (rounds corners, removes specks and pinholes smaller than r).
  PIXS.smooth = function (m, w, h, r) {
    r = Math.max(1, Math.round(r));
    var f = new Float32Array(m.length), p;
    for (p = 0; p < m.length; p++) f[p] = m[p] >= 128 ? 1 : 0;
    box(f, w, h, r);
    var o = new Uint8Array(m.length);
    for (p = 0; p < m.length; p++) o[p] = Math.round(clamp((f[p] - 0.5) * 4 + 0.5, 0, 1) * 255);   // narrow ramp keeps the edge anti-aliased
    return o;
  };

  // ---------- grow / similar: pixels whose colour is within `tol` of a colour already selected ----------
  // Colours are binned 64 levels per channel; a pixel is accepted when a selected colour lies within tol (largest channel difference).
  function selectedColours(img, m, tol) {
    var d = img.data, n = img.width * img.height, B = 64, grid = new Uint8Array(B * B * B), anyClear = false, p;
    for (p = 0; p < n; p++) {
      if (m[p] < 128) continue;
      var i = p * 4;
      if (d[i + 3] === 0) { anyClear = true; continue; }
      grid[((d[i] >> 2) * B + (d[i + 1] >> 2)) * B + (d[i + 2] >> 2)] = 1;
    }
    var R = Math.ceil(tol / 4);
    if (R > 0) {           // dilate the colour set by R bins along each axis (max-norm ball)
      var tmp = new Uint8Array(grid.length), a, b, c, k, run;
      for (var ax = 0; ax < 3; ax++) {
        tmp.fill(0);
        for (a = 0; a < B; a++) for (b = 0; b < B; b++) {
          run = -1e9;
          for (c = 0; c < B + R; c++) {
            if (c < B) { k = ax === 0 ? (c * B + a) * B + b : ax === 1 ? (a * B + c) * B + b : (a * B + b) * B + c; if (grid[k]) run = c; }
            var t = c - R;
            if (t >= 0 && c - run <= 2 * R && run >= 0) { k = ax === 0 ? (t * B + a) * B + b : ax === 1 ? (a * B + t) * B + b : (a * B + b) * B + t; tmp[k] = 1; }
          }
        }
        var sw = grid; grid = tmp; tmp = sw;
      }
    }
    return { grid: grid, clear: anyClear };
  }
  function acceptor(img, m, tol) {
    var cs = selectedColours(img, m, tol), d = img.data, B = 64, g = cs.grid;
    return function (p) { var i = p * 4; if (d[i + 3] === 0) return cs.clear; return g[((d[i] >> 2) * B + (d[i + 1] >> 2)) * B + (d[i + 2] >> 2)] === 1; };
  }
  // Grow: spread from the selection into touching pixels of a similar colour. Similar: those pixels anywhere.
  PIXS.similar = function (img, m, tol, contiguous) {
    var w = img.width, h = img.height, n = w * h, ok = acceptor(img, m, tol), out = new Uint8Array(m), p;
    if (!contiguous) { for (p = 0; p < n; p++) if (out[p] < 255 && ok(p)) out[p] = 255; return out; }
    var seen = new Uint8Array(n), stack = new Int32Array(n), sp = 0;
    for (p = 0; p < n; p++) if (m[p] >= 128) { seen[p] = 1; stack[sp++] = p; }
    while (sp) {
      var q = stack[--sp], x = q % w, nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q >= w ? q - w : -1, q < n - w ? q + w : -1];
      for (var j = 0; j < 4; j++) { var r = nb[j]; if (r < 0 || seen[r]) continue; seen[r] = 1; if (ok(r)) { out[r] = 255; stack[sp++] = r; } }
    }
    return out;
  };

  // ---------- dispatcher for js/select/worker.js ----------
  PIXS.call = function (fn, args) {
    if (["edt", "call"].indexOf(fn) >= 0 || typeof PIXS[fn] !== "function") throw new Error("Not allowed: " + fn);
    return PIXS[fn].apply(null, args);
  };
  G.PIXS = PIXS;
})(typeof self !== "undefined" ? self : this);
