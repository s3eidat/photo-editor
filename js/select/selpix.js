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

  // ---------- AI subject mask post-processing ----------
  // Bilinear resize of a float plane, pixel-centre aligned, edges clamped.
  function bilinear(src, sw, sh, dw, dh) {
    var out = new Float32Array(dw * dh), x0 = new Int32Array(dw), x1 = new Int32Array(dw), wx = new Float32Array(dw), x, y;
    for (x = 0; x < dw; x++) { var sx = Math.max(0, (x + 0.5) * sw / dw - 0.5), a = Math.min(sw - 1, Math.floor(sx)); x0[x] = a; x1[x] = Math.min(sw - 1, a + 1); wx[x] = Math.min(1, sx - a); }
    for (y = 0; y < dh; y++) {
      var sy = Math.max(0, (y + 0.5) * sh / dh - 0.5), b = Math.min(sh - 1, Math.floor(sy)), r0 = b * sw, r1 = Math.min(sh - 1, b + 1) * sw, wy = Math.min(1, sy - b), row = y * dw;
      for (x = 0; x < dw; x++) {
        var t = src[r0 + x0[x]] + (src[r0 + x1[x]] - src[r0 + x0[x]]) * wx[x], u = src[r1 + x0[x]] + (src[r1 + x1[x]] - src[r1 + x0[x]]) * wx[x];
        out[row + x] = t + (u - t) * wy;
      }
    }
    return out;
  }
  PIXS.bilinear = bilinear;
  function boxCopy(a, w, h, r) { return box(Float32Array.from(a), w, h, r); }
  // Guided filter (He, Sun & Tang): smooths p but follows the edges of the guide I. Both 0..1 float planes.
  function guided(I, p, w, h, r, eps) {
    var n = w * h, Ip = new Float32Array(n), II = new Float32Array(n), i;
    for (i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
    var mI = boxCopy(I, w, h, r), mP = boxCopy(p, w, h, r), mIp = box(Ip, w, h, r), mII = box(II, w, h, r);
    for (i = 0; i < n; i++) { var A = (mIp[i] - mI[i] * mP[i]) / (mII[i] - mI[i] * mI[i] + eps); mIp[i] = A; mII[i] = mP[i] - A * mI[i]; }
    box(mIp, w, h, r); box(mII, w, h, r);
    var q = new Float32Array(n);
    for (i = 0; i < n; i++) q[i] = clamp(mIp[i] * I[i] + mII[i], 0, 1);
    return q;
  }
  PIXS.guided = guided;
  PIXS.luma = function (img) { var d = img.data, n = img.width * img.height, g = new Float32Array(n); for (var p = 0, i = 0; p < n; p++, i += 4) g[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255; return g; };
  // raw: model output (sw x sh, 0..1) -> selection mask at the guide image's size, edges snapped to the photo.
  PIXS.subject = function (raw, sw, sh, guide, threshold, band) {
    var w = guide.width, h = guide.height, m = bilinear(raw, sw, sh, w, h), scale = Math.max(w, h) / Math.max(sw, sh);
    if (scale > 1.4) m = guided(PIXS.luma(guide), m, w, h, clamp(Math.round(scale * 2), 2, 24), 2e-3);
    var t = threshold == null ? 0.5 : threshold, bd = band || 0.16, o = new Uint8Array(w * h);
    for (var i = 0; i < m.length; i++) o[i] = Math.round(clamp((m[i] - t) / bd + 0.5, 0, 1) * 255);
    return o;
  };

  // ---------- quick selection: edge-aware region growing from painted seeds ----------
  // img: RGBA (working size), seed: Uint8 (>=128 = painted), opt {sens 0.5..2, enhance}. Returns the grown region (Uint8).
  PIXS.quickSel = function (img, seed, opt) {
    opt = opt || {};
    var w = img.width, h = img.height, n = w * h, d = img.data, p, i;
    var luma = new Float32Array(n), grad = new Float32Array(n);
    for (p = 0, i = 0; p < n; p++, i += 4) luma[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      p = y * w + x;
      var gx = luma[p + (x < w - 1 ? 1 : 0)] - luma[p - (x > 0 ? 1 : 0)], gy = luma[p + (y < h - 1 ? w : 0)] - luma[p - (y > 0 ? w : 0)];
      grad[p] = Math.max(Math.abs(gx), Math.abs(gy)) / 2;
    }
    // seed colours -> a small palette (k-means), and how varied they are
    var seeds = [];
    for (p = 0; p < n; p++) if (seed[p] >= 128) seeds.push(p);
    if (!seeds.length) return new Uint8Array(n);
    var step = Math.max(1, Math.floor(seeds.length / 3000)), sample = [];
    for (i = 0; i < seeds.length; i += step) { var q = seeds[i] * 4; sample.push([d[q], d[q + 1], d[q + 2]]); }
    var K = Math.min(4, sample.length), C = [], it, k;
    for (k = 0; k < K; k++) C.push(sample[Math.floor(k * sample.length / K)].slice());
    function dist(c, r, g, b) { var dr = c[0] - r, dg = c[1] - g, db = c[2] - b; return Math.sqrt((dr * dr * 2 + dg * dg * 4 + db * db * 3) / 9); }
    for (it = 0; it < 6; it++) {
      var acc = C.map(function () { return [0, 0, 0, 0]; });
      sample.forEach(function (s) { var bi = 0, bd = 1e9; for (var j = 0; j < K; j++) { var dd = dist(C[j], s[0], s[1], s[2]); if (dd < bd) { bd = dd; bi = j; } } var A = acc[bi]; A[0] += s[0]; A[1] += s[1]; A[2] += s[2]; A[3]++; });
      for (k = 0; k < K; k++) if (acc[k][3]) C[k] = [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]];
    }
    var spread = 0, gs = [];
    sample.forEach(function (s) { var bd = 1e9; for (var j = 0; j < K; j++) bd = Math.min(bd, dist(C[j], s[0], s[1], s[2])); spread += bd; });
    spread /= sample.length;
    for (i = 0; i < seeds.length; i += step) gs.push(grad[seeds[i]]);
    gs.sort(function (a, b) { return a - b; });
    var sens = opt.sens || 1, T = Math.min(80, Math.max(9, 9 + spread * 2.2)) * sens, E = Math.max(14, gs[Math.floor(gs.length * 0.95)] * 2.2) * sens;
    function ok(q) { var j = q * 4, bd = 1e9; for (var c = 0; c < K; c++) { var dd = dist(C[c], d[j], d[j + 1], d[j + 2]); if (dd < bd) bd = dd; } return bd <= T && (grad[q] <= E || bd <= T * 0.35); }
    var out = new Uint8Array(n), stack = new Int32Array(n), sp = 0;
    seeds.forEach(function (s) { out[s] = 255; stack[sp++] = s; });
    while (sp) {
      var c0 = stack[--sp], cx = c0 % w;
      if (cx > 0 && !out[c0 - 1] && ok(c0 - 1)) { out[c0 - 1] = 255; stack[sp++] = c0 - 1; }
      if (cx < w - 1 && !out[c0 + 1] && ok(c0 + 1)) { out[c0 + 1] = 255; stack[sp++] = c0 + 1; }
      if (c0 >= w && !out[c0 - w] && ok(c0 - w)) { out[c0 - w] = 255; stack[sp++] = c0 - w; }
      if (c0 < n - w && !out[c0 + w] && ok(c0 + w)) { out[c0 + w] = 255; stack[sp++] = c0 + w; }
    }
    // close pinholes smaller than ~2 px, then optionally snap the edge to the photo (guided filter)
    var m = PIXS.smooth(out, w, h, 1);
    for (p = 0; p < n; p++) if (seed[p] >= 128) m[p] = 255;
    if (!opt.enhance) return m;
    var f = new Float32Array(n); for (p = 0; p < n; p++) { f[p] = m[p] / 255; luma[p] /= 255; }
    var g = PIXS.guided(luma, f, w, h, 2, 4e-3), o = new Uint8Array(n);
    for (p = 0; p < n; p++) o[p] = Math.round(clamp((g[p] - 0.5) * 2.5 + 0.5, 0, 1) * 255);
    for (p = 0; p < n; p++) if (seed[p] >= 128) o[p] = 255;
    return o;
  };

  // ---------- dispatcher for js/select/worker.js ----------
  PIXS.call = function (fn, args) {
    if (["edt", "call"].indexOf(fn) >= 0 || typeof PIXS[fn] !== "function") throw new Error("Not allowed: " + fn);
    return PIXS[fn].apply(null, args);
  };
  G.PIXS = PIXS;
})(typeof self !== "undefined" ? self : this);
