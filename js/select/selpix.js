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

  // ---------- refine selection (edge detection, smooth, feather, contrast, shift, decontaminate) ----------
  // Colour guided filter (He et al.): p filtered with an RGB guide; image channels 0..1.
  function guidedColor(img, p, r, eps) {
    var w = img.width, h = img.height, n = w * h, d = img.data, i, j;
    var I = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (i = 0, j = 0; i < n; i++, j += 4) { I[0][i] = d[j] / 255; I[1][i] = d[j + 1] / 255; I[2][i] = d[j + 2] / 255; }
    function bx(a) { return box(a, w, h, r); }
    function prod(a, b) { var o = new Float32Array(n); for (var k = 0; k < n; k++) o[k] = a[k] * b[k]; return o; }
    var mI = I.map(function (c) { return bx(Float32Array.from(c)); }), mp = bx(Float32Array.from(p));
    var cov = I.map(function (c, k) { var o = bx(prod(c, p)); for (var q = 0; q < n; q++) o[q] -= mI[k][q] * mp[q]; return o; });
    var pairs = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]], V = pairs.map(function (pr) { var o = bx(prod(I[pr[0]], I[pr[1]])); for (var q = 0; q < n; q++) o[q] -= mI[pr[0]][q] * mI[pr[1]][q]; return o; });
    var A0 = new Float32Array(n), A1 = new Float32Array(n), A2 = new Float32Array(n), B = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var rr = V[0][i] + eps, rg = V[1][i], rb = V[2][i], gg = V[3][i] + eps, gb = V[4][i], bb = V[5][i] + eps;
      var c00 = gg * bb - gb * gb, c01 = rb * gb - rg * bb, c02 = rg * gb - rb * gg, c11 = rr * bb - rb * rb, c12 = rb * rg - rr * gb, c22 = rr * gg - rg * rg;
      var det = rr * c00 + rg * c01 + rb * c02; if (Math.abs(det) < 1e-12) det = 1e-12;
      var x0 = cov[0][i], x1 = cov[1][i], x2 = cov[2][i];
      var a0 = (c00 * x0 + c01 * x1 + c02 * x2) / det, a1 = (c01 * x0 + c11 * x1 + c12 * x2) / det, a2 = (c02 * x0 + c12 * x1 + c22 * x2) / det;
      A0[i] = a0; A1[i] = a1; A2[i] = a2; B[i] = mp[i] - a0 * mI[0][i] - a1 * mI[1][i] - a2 * mI[2][i];
    }
    bx(A0); bx(A1); bx(A2); bx(B);
    var q = new Float32Array(n);
    for (i = 0; i < n; i++) q[i] = clamp(A0[i] * I[0][i] + A1[i] * I[1][i] + A2[i] * I[2][i] + B[i], 0, 1);
    return q;
  }
  PIXS.guidedColor = guidedColor;
  // mask: Uint8 selection; band: Uint8 extra edge area painted with the refine brush (or null).
  // opt: {radius px, smart, smooth 0..100, feather px, contrast 0..100, shift -100..100}. Returns Uint8 alpha.
  PIXS.refine = function (img, mask, band, opt) {
    var w = img.width, h = img.height, n = w * h, p, rad = Math.max(0, +opt.radius || 0), d = img.data;
    var a = new Float32Array(n); for (p = 0; p < n; p++) a[p] = mask[p] / 255;
    var anyBand = false; if (band) for (p = 0; p < n; p++) if (band[p] >= 128) { anyBand = true; break; }
    if (rad > 0.5 || anyBand) {
      var sd = PIXS.signedDist(mask, w, h), edge = null;
      if (opt.smart) {           // hard image edges get a narrow band, soft ones (hair, fur) the full radius
        edge = new Float32Array(n);
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4, ir = i + (x < w - 1 ? 4 : 0), id = i + (y < h - 1 ? w * 4 : 0);
          var g = Math.abs(d[ir] - d[i]) + Math.abs(d[ir + 1] - d[i + 1]) + Math.abs(d[ir + 2] - d[i + 2]) + Math.abs(d[id] - d[i]) + Math.abs(d[id + 1] - d[i + 1]) + Math.abs(d[id + 2] - d[i + 2]);
          edge[y * w + x] = clamp(g / 180, 0, 1);
        }
      }
      var r = Math.max(2, Math.round(Math.min(Math.max(rad, 4), 40) / 2)), q = guidedColor(img, a, r, 2e-3);
      for (p = 0; p < n; p++) {
        var R = rad * (edge ? 1 - 0.7 * edge[p] : 1), inBand = Math.abs(sd[p]) <= R || (band && band[p] >= 128);
        if (inBand) a[p] = q[p];
      }
    }
    if (opt.smooth > 0) { var sr = Math.max(1, Math.round(opt.smooth / 100 * 8)); box(a, w, h, sr); for (p = 0; p < n; p++) a[p] = clamp((a[p] - 0.5) * (1 + opt.smooth / 50) + 0.5, 0, 1); }
    if (opt.feather > 0) { PIX.blurPlane(a, w, h, opt.feather / 2); }
    if (opt.shift) { var gm = Math.pow(2, -opt.shift / 50); for (p = 0; p < n; p++) a[p] = Math.pow(a[p], gm); }
    if (opt.contrast > 0) { var k = 1 / Math.max(0.01, 1 - opt.contrast / 100); for (p = 0; p < n; p++) a[p] = clamp((a[p] - 0.5) * k + 0.5, 0, 1); }
    var o = new Uint8Array(n); for (p = 0; p < n; p++) o[p] = Math.round(clamp(a[p], 0, 1) * 255);
    return o;
  };
  // Decontaminate: pull edge colours towards the colours of fully selected pixels nearby. Returns new RGBA bytes.
  PIXS.decontaminate = function (img, alpha, amount, radius) {
    var w = img.width, h = img.height, n = w * h, d = img.data, k = clamp(amount, 0, 1), W = new Float32Array(n), C = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], p, i;
    for (p = 0, i = 0; p < n; p++, i += 4) { if (alpha[p] >= 250) { W[p] = 1; C[0][p] = d[i]; C[1][p] = d[i + 1]; C[2][p] = d[i + 2]; } }
    var sg = Math.max(2, radius || 8) / 2;
    PIX.blurPlane(W, w, h, sg); C.forEach(function (c) { PIX.blurPlane(c, w, h, sg); });
    var out = new Uint8ClampedArray(d);
    for (p = 0, i = 0; p < n; p++, i += 4) {
      var a = alpha[p]; if (a >= 250 || a === 0 || W[p] < 1e-4) continue;
      var t = k * (1 - a / 255) * 0.5 + k * 0.5;
      for (var c = 0; c < 3; c++) out[i + c] = d[i + c] + (C[c][p] / W[p] - d[i + c]) * t;
    }
    return out;
  };

  // ---------- colour range ----------
  function srgbLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  var LIN = new Float32Array(256); for (var li = 0; li < 256; li++) LIN[li] = srgbLin(li);
  function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  PIXS.lab = function (r, g, b) {
    var R = LIN[r], G = LIN[g], B = LIN[b];
    var X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    var fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  function smooth01(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  // opt: {mode: "sampled"|"reds"|…|"highlights"|"midtones"|"shadows"|"skin", samples: [[r,g,b,x,y]], minus: [[r,g,b,x,y]], fuzz 0..200, range (px, 0 = off), invert}
  PIXS.colorRange = function (img, opt) {
    var w = img.width, h = img.height, n = w * h, d = img.data, out = new Uint8Array(n), mode = opt.mode || "sampled", F = Math.max(1, opt.fuzz == null ? 40 : opt.fuzz), p, i;
    var HUES = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
    var S = (opt.samples || []).map(function (s) { return { lab: PIXS.lab(s[0], s[1], s[2]), x: s[3], y: s[4] }; }), M = (opt.minus || []).map(function (s) { return { lab: PIXS.lab(s[0], s[1], s[2]), x: s[3], y: s[4] }; });
    var range = opt.range > 0 ? opt.range : 0;
    function near(list, L, x, y) {
      var best = 0;
      for (var k = 0; k < list.length; k++) {
        var q = list[k], dl = (L[0] - q.lab[0]) * 0.7, da = L[1] - q.lab[1], db = L[2] - q.lab[2], dist = Math.sqrt(dl * dl + da * da + db * db);
        var v = clamp(1.5 - 1.5 * dist / F, 0, 1);
        if (range && v > 0) { var sd = Math.hypot(x - q.x, y - q.y); v *= clamp(1.25 - 1.25 * sd / range, 0, 1); }
        if (v > best) best = v;
      }
      return best;
    }
    for (p = 0, i = 0; p < n; p++, i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2], v = 0;
      if (d[i + 3] === 0) { out[p] = opt.invert ? 255 : 0; continue; }
      if (mode === "sampled") { var L = PIXS.lab(r, g, b), x = p % w, y = (p - x) / w; v = S.length ? near(S, L, x, y) : 0; if (M.length) v = Math.min(v, 1 - near(M, L, x, y)); }
      else if (HUES[mode] != null) {
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, hue = 0, dd = mx - mn;
        if (dd > 0) { if (mx === r) hue = ((g - b) / dd + 6) % 6; else if (mx === g) hue = (b - r) / dd + 2; else hue = (r - g) / dd + 4; hue *= 60; }
        var dh = Math.abs(((hue - HUES[mode]) % 360 + 540) % 360 - 180);
        v = (1 - smooth01(22, 48, dh)) * smooth01(0.08, 0.3, sat) * smooth01(10, 40, mx);
      } else if (mode === "highlights" || mode === "midtones" || mode === "shadows") {
        var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        v = mode === "highlights" ? smooth01(0.55, 0.8, lum) : mode === "shadows" ? 1 - smooth01(0.2, 0.45, lum) : smooth01(0.15, 0.4, lum) * (1 - smooth01(0.6, 0.85, lum));
      } else if (mode === "skin") {
        var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b, f = F / 40;
        v = (1 - smooth01(12 * f, 24 * f, Math.abs(cb - 108))) * (1 - smooth01(10 * f, 22 * f, Math.abs(cr - 152))) * smooth01(30, 70, r) * (r > b ? 1 : 0);
      }
      out[p] = Math.round((opt.invert ? 1 - v : v) * 255);
    }
    return out;
  };

  // ---------- focus area: where the picture is sharp ----------
  // Local detail = blurred |Laplacian| of luma, relative to a noise floor; range 0..100 sets how much counts as in focus.
  PIXS.focusMap = function (img) {
    var w = img.width, h = img.height, n = w * h, d = img.data, L = new Float32Array(n), F = new Float32Array(n), p, i;
    for (p = 0, i = 0; p < n; p++, i += 4) L[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { p = y * w + x; F[p] = Math.abs(4 * L[p] - L[p - 1] - L[p + 1] - L[p - w] - L[p + w]); }
    var r = Math.max(2, Math.round(Math.max(w, h) / 120));
    box(F, w, h, r); box(F, w, h, r);
    var s = Float32Array.from(F).sort(), hi = s[Math.floor(n * 0.98)] || 1;
    for (p = 0; p < n; p++) F[p] = clamp(F[p] / hi, 0, 1);
    return F;
  };
  PIXS.focusArea = function (img, range, noise) {
    var w = img.width, h = img.height, n = w * h, F = PIXS.focusMap(img), out = new Uint8Array(n), t = 1 - clamp(range, 0, 100) / 100, nz = clamp(noise || 0, 0, 100) / 400, p;
    var thr = Math.max(0.02, nz + t * 0.6);
    for (p = 0; p < n; p++) out[p] = F[p] > thr ? 255 : 0;
    var m = PIXS.smooth(out, w, h, Math.max(2, Math.round(Math.max(w, h) / 200)));
    return PIXS.smooth(m, w, h, Math.max(2, Math.round(Math.max(w, h) / 100)));
  };

  // ---------- dispatcher for js/select/worker.js ----------
  PIXS.call = function (fn, args) {
    if (["edt", "call"].indexOf(fn) >= 0 || typeof PIXS[fn] !== "function") throw new Error("Not allowed: " + fn);
    return PIXS[fn].apply(null, args);
  };
  G.PIXS = PIXS;
})(typeof self !== "undefined" ? self : this);
