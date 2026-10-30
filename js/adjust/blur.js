/* Adjust lane: blur, noise and "other" filters (motion, radial, surface, smart, median, despeckle, dust & scratches,
   reduce noise, high pass, minimum / maximum). Pure maths, runs in page and worker. Pixel radii scale with p._scale
   (reduced-size previews). */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, c255 = A.c255;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }

  // ---------- alpha-correct per-plane filtering ----------
  // fn(plane Float32Array, w, h) filters one plane in place. Colours are premultiplied by alpha while filtered.
  A.planes = function (img, fn, keepAlpha) {
    var w = img.width, h = img.height, n = w * h, d = img.data, a = new Float32Array(n), q, i, opaque = true;
    for (q = 0; q < n; q++) { a[q] = d[q * 4 + 3]; if (a[q] < 255) opaque = false; }
    var fa = a;                                   // alpha used to un-premultiply
    if (!opaque && !keepAlpha) { fa = new Float32Array(a); fn(fa, w, h, 3); }
    var pl = new Float32Array(n);
    for (var c = 0; c < 3; c++) {
      for (q = 0, i = c; q < n; q++, i += 4) pl[q] = opaque ? d[i] : d[i] * a[q] / 255;
      fn(pl, w, h, c);
      for (q = 0, i = c; q < n; q++, i += 4) d[i] = opaque ? pl[q] : (fa[q] > 0.01 ? pl[q] * 255 / fa[q] : 0);
    }
    if (fa !== a) for (q = 0; q < n; q++) d[q * 4 + 3] = fa[q];
    return img;
  };
  // Same, but on 8-bit planes (median-type filters that need exact values). fn(src Uint8Array, dst Uint8Array, w, h).
  A.planes8 = function (img, fn) {
    var w = img.width, h = img.height, n = w * h, d = img.data, s = new Uint8Array(n), o = new Uint8Array(n), q, i;
    for (var c = 0; c < 3; c++) {
      for (q = 0, i = c; q < n; q++, i += 4) s[q] = d[i];
      fn(s, o, w, h, c);
      for (q = 0, i = c; q < n; q++, i += 4) d[i] = o[q];
    }
    return img;
  };

  // ---------- interleaved premultiplied RGBA (one coordinate computation serves all four channels) ----------
  A.toP4 = function (img) {
    var d = img.data, n = img.width * img.height, b = new Float32Array(n * 4);
    for (var i = 0; i < n * 4; i += 4) { var a = d[i + 3] / 255; b[i] = d[i] * a; b[i + 1] = d[i + 1] * a; b[i + 2] = d[i + 2] * a; b[i + 3] = d[i + 3]; }
    return b;
  };
  A.fromP4 = function (b, img) {
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) { var a = b[i + 3], k = a > 0.01 ? 255 / a : 0; d[i] = b[i] * k; d[i + 1] = b[i + 1] * k; d[i + 2] = b[i + 2] * k; d[i + 3] = a; }
    return img;
  };
  function bilin(a, w, h, x, y) {
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    var x0 = x | 0, y0 = y | 0, x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0, tx = x - x0, ty = y - y0, r0 = y0 * w, r1 = y1 * w;
    return (a[r0 + x0] * (1 - tx) + a[r0 + x1] * tx) * (1 - ty) + (a[r1 + x0] * (1 - tx) + a[r1 + x1] * tx) * ty;
  }
  A.bilin = bilin;
  // Average of taps: tap k maps (x, y) -> (x * M[k][0] + y * M[k][1] + M[k][2], x * M[k][3] + y * M[k][4] + M[k][5]).
  function tapPass(src, dst, w, h, M) {
    var n = M.length, inv = 1 / n, a00 = new Float64Array(n), a01 = new Float64Array(n), a02 = new Float64Array(n), a10 = new Float64Array(n), a11 = new Float64Array(n), a12 = new Float64Array(n), k;
    for (k = 0; k < n; k++) { a00[k] = M[k][0]; a01[k] = M[k][1]; a02[k] = M[k][2]; a10[k] = M[k][3]; a11[k] = M[k][4]; a12[k] = M[k][5]; }
    var W1 = w - 1, H1 = h - 1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (k = 0; k < n; k++) {
        var X = x * a00[k] + y * a01[k] + a02[k], Y = x * a10[k] + y * a11[k] + a12[k];
        if (X < 0) X = 0; else if (X > W1) X = W1;
        if (Y < 0) Y = 0; else if (Y > H1) Y = H1;
        var x0 = X | 0, y0 = Y | 0, tx = X - x0, ty = Y - y0, x1 = x0 < W1 ? x0 + 1 : x0, y1 = y0 < H1 ? y0 + 1 : y0;
        var i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
        var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        s0 += src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
        s1 += src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
        s2 += src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
        s3 += src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;
      }
      var o = (y * w + x) * 4; dst[o] = s0 * inv; dst[o + 1] = s1 * inv; dst[o + 2] = s2 * inv; dst[o + 3] = s3 * inv;
    }
  }
  A.tapPass = tapPass;
  // Two passes of taps make a uniform "comb": n1 coarse taps, then n2 fine taps filling each gap.
  A.combBlur = function (img, coarse, fine) {
    var b = A.toP4(img), t = new Float32Array(b.length);
    tapPass(b, t, img.width, img.height, coarse);
    if (fine.length > 1) tapPass(t, b, img.width, img.height, fine); else b = t;
    return A.fromP4(b, img);
  };
  function shifts(ux, uy, n, sp) { var M = [], half = (n - 1) / 2; for (var k = 0; k < n; k++) { var o = (k - half) * sp; M.push([1, 0, ux * o, 0, 1, uy * o]); } return M; }
  // Single plane, uniform blur along a line (used for strokes and textures): same two-pass comb.
  function linePass(src, dst, w, h, ux, uy, n, sp) {
    var half = (n - 1) / 2, inv = 1 / n;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0;
      for (var k = 0; k < n; k++) { var o = (k - half) * sp; s += bilin(src, w, h, x + ux * o, y + uy * o); }
      dst[y * w + x] = s * inv;
    }
  }
  A.lineBlur = function (pl, w, h, angleDeg, len) {
    if (len < 1) return pl;
    var a = angleDeg * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a), n1 = Math.max(1, Math.round(Math.sqrt(len))), n2 = Math.max(1, Math.round(len / n1)), tmp = new Float32Array(pl.length);
    linePass(pl, tmp, w, h, ux, uy, n1, len / n1);
    linePass(tmp, pl, w, h, ux, uy, n2, len / n1 / n2);
    return pl;
  };
  A.reg("motionBlur", A.filter(function (img, p) {
    var len = clamp(num(p.distance, 20), 0, 2000) * sc(p), a = num(p.angle, 0) * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a);
    if (len < 1) return img;
    var n1 = Math.max(1, Math.round(Math.sqrt(len))), n2 = Math.max(1, Math.round(len / n1));
    return A.combBlur(img, shifts(ux, uy, n1, len / n1), shifts(ux, uy, n2, len / n1 / n2));
  }));

  // ---------- radial blur: spin (rotations about the centre) or zoom (scalings about it) ----------
  function about(cx, cy, spin, o) {
    if (spin) { var c = Math.cos(o), s = Math.sin(o); return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy]; }
    var f = Math.exp(o); return [f, 0, cx - f * cx, 0, f, cy - f * cy];
  }
  A.reg("radialBlur", A.filter(function (img, p) {
    var amt = clamp(num(p.amount, 10), 0, 100) / 100, spin = p.mode !== "zoom", w = img.width, h = img.height;
    if (!amt) return img;
    var cx = clamp(num(p.cx, 50), 0, 100) / 100 * w, cy = clamp(num(p.cy, 50), 0, 100) / 100 * h, R = Math.sqrt(Math.pow(Math.max(cx, w - cx), 2) + Math.pow(Math.max(cy, h - cy), 2));
    var total = spin ? amt * Math.PI / 2 : Math.log(1 + amt * 0.9), lenPx = Math.max(1, total * R), q = p.quality === "draft" ? 0.6 : p.quality === "best" ? 1.6 : 1;
    var n1 = clamp(Math.round(Math.sqrt(lenPx) * q), 2, 90), n2 = clamp(Math.round(lenPx / n1 / (q < 1 ? 2 : q > 1 ? 0.8 : 1.2)), 1, 60), half1 = (n1 - 1) / 2, half2 = (n2 - 1) / 2, c1 = [], c2 = [], k;
    for (k = 0; k < n1; k++) c1.push(about(cx, cy, spin, (k - half1) * total / n1));
    for (k = 0; k < n2; k++) c2.push(about(cx, cy, spin, (k - half2) * total / n1 / n2));
    return A.combBlur(img, c1, c2);
  }));

  // ---------- surface blur / smart blur (edge-preserving) ----------
  // Surface: each channel smoothed by a self-guided filter; threshold sets how big a step counts as an edge.
  A.reg("surfaceBlur", A.filter(function (img, p) {
    var r = Math.max(1, Math.round(clamp(num(p.radius, 5), 1, 100) * sc(p))), t = clamp(num(p.threshold, 15), 2, 255), eps = Math.pow(t * 0.6, 2);
    return A.planes(img, function (pl, w, h) { var g = A.guided(pl, pl, w, h, r, eps); pl.set(g); return pl; }, true);
  }));
  // Smart: all channels guided by luminance (keeps colour edges aligned); modes: normal, edges only, overlay edges.
  A.reg("smartBlur", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, d = img.data, r = Math.max(1, Math.round(clamp(num(p.radius, 3), 0.5, 100) * sc(p)));
    var t = clamp(num(p.threshold, 25), 1, 100), eps = Math.pow(t * 0.8, 2), Y = A.lumPlane(img), mode = p.mode || "normal", q, i;
    var edges = null;
    if (mode !== "normal") {      // edges of the smoothed luminance, so noise inside flat areas does not count
      var gY = A.guided(Y, Y, w, h, r, eps), thr = 4 + t * 0.5, x, y;
      edges = new Uint8Array(n);
      for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { q = y * w + x; var gx = gY[q + 1] - gY[q - 1], gy = gY[q + w] - gY[q - w]; if (gx * gx + gy * gy > thr * thr) edges[q] = 1; }
      if (mode === "edges") { for (q = 0, i = 0; q < n; q++, i += 4) d[i] = d[i + 1] = d[i + 2] = edges[q] ? 255 : 0; return img; }
    }
    var pl = new Float32Array(n);
    for (var c = 0; c < 3; c++) {
      for (q = 0, i = c; q < n; q++, i += 4) pl[q] = d[i];
      var g = A.guided(Y, pl, w, h, r, eps);
      for (q = 0, i = c; q < n; q++, i += 4) d[i] = edges && edges[q] ? 255 : g[q];
    }
    return img;
  }));

  // ---------- median (Huang's sliding histogram, O(r) per pixel) ----------
  A.median8 = function (s, o, w, h, r) {
    var H = new Int32Array(256), x, y, k, j, half;
    if (r < 1) { o.set(s); return o; }
    var area = (2 * r + 1) * (2 * r + 1); half = area >> 1;
    for (y = 0; y < h; y++) {
      H.fill(0);
      var rows = []; for (k = -r; k <= r; k++) rows.push(clamp(y + k, 0, h - 1) * w);
      for (j = 0; j < rows.length; j++) for (k = -r; k <= r; k++) H[s[rows[j] + clamp(k, 0, w - 1)]]++;
      var med = 0, lt = 0;     // lt = count of values < med
      while (lt + H[med] <= half) { lt += H[med]; med++; }
      o[y * w] = med;
      for (x = 1; x < w; x++) {
        var xo = clamp(x - r - 1, 0, w - 1), xi = clamp(x + r, 0, w - 1);
        for (j = 0; j < rows.length; j++) {
          var vo = s[rows[j] + xo], vi = s[rows[j] + xi];
          H[vo]--; if (vo < med) lt--;
          H[vi]++; if (vi < med) lt++;
        }
        if (lt > half) { while (lt > half) { med--; lt -= H[med]; } }
        else { while (lt + H[med] <= half) { lt += H[med]; med++; } }
        o[y * w + x] = med;
      }
    }
    return o;
  };
  A.reg("median", A.filter(function (img, p) {
    var r = Math.max(1, Math.round(clamp(num(p.radius, 2), 1, 100) * sc(p)));
    return A.planes8(img, function (s, o, w, h) { A.median8(s, o, w, h, r); });
  }));
  // Dust & scratches: median, but only where the pixel differs from it by more than the threshold.
  A.reg("dustScratches", A.filter(function (img, p) {
    var r = Math.max(1, Math.round(clamp(num(p.radius, 2), 1, 100) * sc(p))), t = clamp(num(p.threshold, 10), 0, 255);
    return A.planes8(img, function (s, o, w, h) { A.median8(s, o, w, h, r); for (var q = 0; q < s.length; q++) if (Math.abs(s[q] - o[q]) <= t) o[q] = s[q]; });
  }));
  // Despeckle: 3x3 median everywhere except along edges (edges found on luminance).
  A.reg("despeckle", A.filter(function (img) {
    var w = img.width, h = img.height, Y = A.lumPlane(img), E = new Uint8Array(w * h), x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var q = y * w + x, gx = Y[q + 1] - Y[q - 1], gy = Y[q + w] - Y[q - w];
      if (gx * gx + gy * gy > 24 * 24) E[q] = 1;
    }
    var Eg = PIX.grow(E, w, h, 1);
    return A.planes8(img, function (s, o) { A.median8(s, o, w, h, 1); for (var q2 = 0; q2 < s.length; q2++) if (Eg[q2]) o[q2] = s[q2]; });
  }));

  // ---------- reduce noise ----------
  A.reg("reduceNoise", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, d = img.data, S = sc(p), q, i;
    var str = clamp(num(p.strength, 6), 0, 10) / 10, keep = clamp(num(p.details, 60), 0, 100) / 100, cn = clamp(num(p.color, 45), 0, 100) / 100, sh = clamp(num(p.sharpen, 25), 0, 100) / 100;
    var R = new Float32Array(n), Gc = new Float32Array(n), B = new Float32Array(n), Y = new Float32Array(n);
    for (q = 0, i = 0; q < n; q++, i += 4) { R[q] = d[i]; Gc[q] = d[i + 1]; B[q] = d[i + 2]; Y[q] = 0.299 * R[q] + 0.587 * Gc[q] + 0.114 * B[q]; }
    var Yn = Y;
    if (str) {
      var base = A.guided(Y, Y, w, h, Math.max(1, Math.round((1 + str * 3) * S)), Math.pow(4 + str * 26 * (1.2 - keep), 2));
      Yn = new Float32Array(n); for (q = 0; q < n; q++) Yn[q] = Y[q] + (base[q] - Y[q]) * str * (1 - keep * 0.6) * 1.4;
    }
    var cr = new Float32Array(n), cb = new Float32Array(n);
    for (q = 0; q < n; q++) { cr[q] = R[q] - Y[q]; cb[q] = B[q] - Y[q]; }
    if (cn) { A.blur(cr, w, h, (0.5 + cn * 5) * S); A.blur(cb, w, h, (0.5 + cn * 5) * S); }
    if (sh) { var bl = A.blur(new Float32Array(Yn), w, h, Math.max(0.5, 1.2 * S)), Ys = new Float32Array(n); for (q = 0; q < n; q++) Ys[q] = Yn[q] + (Yn[q] - bl[q]) * sh * 1.2; Yn = Ys; }
    for (q = 0, i = 0; q < n; q++, i += 4) {
      var yy = Yn[q], r = yy + cr[q], b = yy + cb[q], g = (yy - 0.299 * r - 0.114 * b) / 0.587;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    return img;
  }));

  // ---------- high pass ----------
  A.reg("highPass", A.filter(function (img, p) {
    var rad = clamp(num(p.radius, 10), 0.1, 1000) * sc(p), d = img.data, bl = PIX.copyImg(img);
    PIX.gaussian(bl, rad * 2);
    var b = bl.data;
    for (var i = 0; i < d.length; i += 4) { d[i] = c255(d[i] - b[i] + 128); d[i + 1] = c255(d[i + 1] - b[i + 1] + 128); d[i + 2] = c255(d[i + 2] - b[i + 2] + 128); }
    return img;
  }));

  // ---------- minimum / maximum (erode / dilate) ----------
  // Square windows with the van Herk / Gil-Werman running min/max (O(1) per pixel per pass); "round" adds a few
  // diamond steps on top of a smaller square so the shape is an octagon.
  function vhgw(s, o, w, h, r, max, horiz) {
    var n = horiz ? w : h, m = horiz ? h : w, k = 2 * r + 1, g = new Uint8Array(n + k), hh = new Uint8Array(n + k), line = new Uint8Array(n + 2 * r);
    for (var j = 0; j < m; j++) {
      var i, base = horiz ? j * w : j, step = horiz ? 1 : w;
      for (i = 0; i < n + 2 * r; i++) line[i] = s[base + clamp(i - r, 0, n - 1) * step];
      var L = n + 2 * r;
      for (i = 0; i < L; i++) g[i] = i % k === 0 ? line[i] : (max ? Math.max(g[i - 1], line[i]) : Math.min(g[i - 1], line[i]));
      for (i = L - 1; i >= 0; i--) hh[i] = (i % k === k - 1 || i === L - 1) ? line[i] : (max ? Math.max(hh[i + 1], line[i]) : Math.min(hh[i + 1], line[i]));
      for (i = 0; i < n; i++) { var a = hh[i], b = g[i + 2 * r]; o[base + i * step] = max ? (a > b ? a : b) : (a < b ? a : b); }
    }
  }
  A.morph8 = function (s, o, w, h, r, max, round) {
    var t = new Uint8Array(s.length), sq = round ? Math.round(r * 0.6) : r, dia = round ? r - sq : 0, cur = new Uint8Array(s);
    if (sq > 0) { vhgw(cur, t, w, h, sq, max, true); vhgw(t, cur, w, h, sq, max, false); }
    for (var it = 0; it < dia; it++) {       // one diamond (cross) step
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var q = y * w + x, v = cur[q], u;
        if (x > 0) { u = cur[q - 1]; v = max ? Math.max(v, u) : Math.min(v, u); }
        if (x < w - 1) { u = cur[q + 1]; v = max ? Math.max(v, u) : Math.min(v, u); }
        if (y > 0) { u = cur[q - w]; v = max ? Math.max(v, u) : Math.min(v, u); }
        if (y < h - 1) { u = cur[q + w]; v = max ? Math.max(v, u) : Math.min(v, u); }
        t[q] = v;
      }
      cur.set(t);
    }
    o.set(cur); return o;
  };
  ["minimum", "maximum"].forEach(function (nm) {
    A.reg(nm, A.filter(function (img, p) {
      var r = Math.max(1, Math.round(clamp(num(p.radius, 1), 1, 200) * sc(p))), round = p.shape === "round";
      return A.planes8(img, function (s, o, w, h) { A.morph8(s, o, w, h, r, nm === "maximum", round); });
    }));
  });
})(typeof self !== "undefined" ? self : this);
