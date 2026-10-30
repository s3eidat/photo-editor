/* Adjust lane: depth-of-field blurs. Lens blur (depth from a layer mask, the selection or brightness; iris shape;
   bright highlights bloom into discs) and the blur gallery: tilt-shift, iris and field blur. All use one gather:
   each pixel averages taps spread over an iris shape scaled by its own blur radius. Pure maths, page + worker. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, smooth = A.smooth;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }

  // Taps (unit offsets) evenly filling a circle or a polygon with `sides` (curved by `curve`), rotated.
  A.irisTaps = function (n, sides, rotDeg, curve) {
    var out = [], ga = Math.PI * (3 - Math.sqrt(5)), rot = (rotDeg || 0) * Math.PI / 180;
    for (var k = 0; k < n; k++) {
      var r = Math.sqrt((k + 0.5) / n), a = k * ga, x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (sides >= 3) {      // squash the disc point onto the polygon: scale by polygon radius at that angle
        var seg = 2 * Math.PI / sides, t = ((a % seg) + seg) % seg - seg / 2, pr = Math.cos(seg / 2) / Math.cos(t), k2 = 1 + (pr - 1) * (1 - clamp(curve || 0, 0, 1));
        x *= k2; y *= k2;
      }
      out.push([x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return out;
  };
  // Gather blur: R = radius plane (px); taps from irisTaps. Each tap reads from a mip level (2x2 averages) that
  // matches the spacing between taps, so the disc comes out smooth with a fixed number of taps. Highlights above
  // `thr` (0..1 luminance) are boosted in linear light first, so they bloom. Premultiplied linear RGBA inside.
  function mips(b, w, h, maxL) {
    var L = [{ d: b, w: w, h: h }];
    for (var k = 1; k <= maxL; k++) {
      var P = L[k - 1], nw = Math.max(1, Math.ceil(P.w / 2)), nh = Math.max(1, Math.ceil(P.h / 2)), o = new Float32Array(nw * nh * 4);
      for (var y = 0; y < nh; y++) for (var x = 0; x < nw; x++) {
        var x0 = Math.min(P.w - 1, x * 2), x1 = Math.min(P.w - 1, x * 2 + 1), y0 = Math.min(P.h - 1, y * 2), y1 = Math.min(P.h - 1, y * 2 + 1), oi = (y * nw + x) * 4;
        var a = (y0 * P.w + x0) * 4, bq = (y0 * P.w + x1) * 4, c = (y1 * P.w + x0) * 4, dq = (y1 * P.w + x1) * 4;
        for (var ch = 0; ch < 4; ch++) o[oi + ch] = (P.d[a + ch] + P.d[bq + ch] + P.d[c + ch] + P.d[dq + ch]) * 0.25;
      }
      L.push({ d: o, w: nw, h: nh });
      if (nw === 1 && nh === 1) break;
    }
    return L;
  }
  A.varBlur = function (img, R, taps, hl, thr, noise) {
    var w = img.width, h = img.height, n = w * h, d = img.data, S2L = A.S2L, b = new Float32Array(n * 4), q, i, rmax = 0;
    for (q = 0; q < n; q++) if (R[q] > rmax) rmax = R[q];
    if (rmax < 0.5) return img;
    for (q = 0, i = 0; q < n; q++, i += 4) {
      var a = d[i + 3] / 255, r = S2L[d[i]], g = S2L[d[i + 1]], bb = S2L[d[i + 2]];
      if (hl > 0) { var y = 0.2126 * r + 0.7152 * g + 0.0722 * bb; if (y > thr) { var k = 1 + (y - thr) / Math.max(0.02, 1 - thr) * hl * 6; r *= k; g *= k; bb *= k; } }
      b[i] = r * a; b[i + 1] = g * a; b[i + 2] = bb * a; b[i + 3] = a;
    }
    var T = taps.length, tx = new Float32Array(T), ty = new Float32Array(T), sp1 = Math.sqrt(Math.PI / T), maxL = Math.max(0, Math.ceil(Math.log2(Math.max(1, rmax * sp1)))), M = mips(b, w, h, maxL), rnd = noise ? A.rng(13) : null, acc = [0, 0, 0, 0];
    for (var k3 = 0; k3 < T; k3++) { tx[k3] = taps[k3][0]; ty[k3] = taps[k3][1]; }
    function samp(lv, X, Y, wt) {        // bilinear read of mip level lv at full-size position (X, Y), added with weight wt
      var m = M[lv], f = 1 << lv, x = (X + 0.5) / f - 0.5, y = (Y + 0.5) / f - 0.5, W1 = m.w - 1, H1 = m.h - 1;
      if (x < 0) x = 0; else if (x > W1) x = W1;
      if (y < 0) y = 0; else if (y > H1) y = H1;
      var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, x1 = x0 < W1 ? x0 + 1 : x0, y1 = y0 < H1 ? y0 + 1 : y0, D = m.d;
      var i00 = (y0 * m.w + x0) * 4, i10 = (y0 * m.w + x1) * 4, i01 = (y1 * m.w + x0) * 4, i11 = (y1 * m.w + x1) * 4;
      var w00 = (1 - fx) * (1 - fy) * wt, w10 = fx * (1 - fy) * wt, w01 = (1 - fx) * fy * wt, w11 = fx * fy * wt;
      for (var c = 0; c < 4; c++) acc[c] += D[i00 + c] * w00 + D[i10 + c] * w10 + D[i01 + c] * w01 + D[i11 + c] * w11;
    }
    for (var y0 = 0; y0 < h; y0++) for (var x0 = 0; x0 < w; x0++) {
      q = y0 * w + x0; i = q * 4;
      var rr = R[q];
      if (rr < 0.5) continue;
      var lvf = Math.log2(Math.max(1, rr * sp1)), lv = Math.min(M.length - 1, Math.max(0, Math.round(lvf))), cnt = 0;
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (var t = 0; t < T; t++) {
        var X = x0 + tx[t] * rr, Y = y0 + ty[t] * rr, Xi = X < 0 ? 0 : X > w - 1 ? w - 1 : X | 0, Yi = Y < 0 ? 0 : Y > h - 1 ? h - 1 : Y | 0, rs = R[Yi * w + Xi];
        // do not pull sharp (small-radius) foreground pixels into a blurred background: weight them down
        var wt = rs >= rr * 0.5 ? 1 : 0.15 + 1.7 * rs / rr;
        samp(lv, X, Y, wt); cnt += wt;
      }
      var A0 = acc[3] / cnt;
      if (A0 > 1e-4) {
        var nz = rnd ? (rnd() - 0.5) * noise : 0;
        d[i] = A.l2s(acc[0] / cnt / A0 + nz); d[i + 1] = A.l2s(acc[1] / cnt / A0 + nz); d[i + 2] = A.l2s(acc[2] / cnt / A0 + nz);
      }
      d[i + 3] = A0 * 255;
    }
    return img;
  };
  function tapsFor(p, rmax) {
    var q = p.quality === "draft" ? 0.6 : p.quality === "best" ? 1.8 : 1;
    return A.irisTaps(Math.round(clamp(12 + rmax * rmax * 0.8, 12, 36) * q), num(p.sides, 0) | 0, num(p.rotation, 0), clamp(num(p.curve, 0), 0, 100) / 100);
  }

  // ---------- lens blur ----------
  // depth: p.depthSrc = none | mask (p.depth packed plane) | selection | luminance; focal 0..255; invert.
  A.reg("lensBlur", function (img, p, sel) {
    var w = img.width, h = img.height, n = w * h, S = sc(p), rad = clamp(num(p.radius, 15), 0, 100) * S, focal = clamp(num(p.focal, 0), 0, 255), inv = !!p.invert, src = p.depthSrc || "none", q;
    var R = new Float32Array(n), D = null;
    if (src === "selection" && sel) { D = new Float32Array(n); for (q = 0; q < n; q++) D[q] = sel[q]; }
    else if (src === "luminance") D = A.lumPlane(img);
    else if (src === "mask" && p.depth && p.depth.b64) {
      var m = A.b64(p.depth.b64), mw = p.depth.w | 0, mh = p.depth.h | 0, M = new Float32Array(mw * mh);
      for (q = 0; q < mw * mh; q++) M[q] = m[q];
      D = new Float32Array(n);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) D[y * w + x] = A.bilin(M, mw, mh, (x + 0.5) / w * mw - 0.5, (y + 0.5) / h * mh - 0.5);
    }
    for (q = 0; q < n; q++) { var dv = D ? D[q] : 255; if (inv) dv = 255 - dv; R[q] = D ? Math.abs(dv - focal) / 255 * rad : rad; }
    var before = sel && src !== "selection" ? PIX.copyImg(img) : null;
    A.varBlur(img, R, tapsFor(p, rad), clamp(num(p.hlBright, 0), 0, 100) / 100, clamp(num(p.hlThreshold, 255), 0, 255) / 255, clamp(num(p.noise, 0), 0, 100) / 100 * 0.08);
    return before ? PIX.mixSel(before, img, sel) : img;
  });

  // ---------- blur gallery ----------
  // Tilt-shift: sharp band through (cx, cy) at `angle`, `focus` half-width and `transition` (both % of height).
  A.reg("tiltShift", A.filter(function (img, p) {
    var w = img.width, h = img.height, S = sc(p), rad = clamp(num(p.blur, 15), 0, 200) * S, cy = clamp(num(p.cy, 50), 0, 100) / 100 * h, cx = clamp(num(p.cx, 50), 0, 100) / 100 * w;
    var a = num(p.angle, 0) * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a), f = clamp(num(p.focus, 12), 0, 100) / 100 * h, tr = Math.max(1, clamp(num(p.transition, 18), 1, 100) / 100 * h);
    var sym = p.symmetric !== false, R = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dist = (x - cx) * nx + (y - cy) * ny, dd = sym ? Math.abs(dist) : Math.max(0, dist);
      R[y * w + x] = rad * smooth(f, f + tr, dd);
    }
    return A.varBlur(img, R, tapsFor(p, rad), clamp(num(p.bokeh, 0), 0, 100) / 100, 0.75, clamp(num(p.noise, 0), 0, 100) / 100 * 0.08);
  }));
  // Iris: an ellipse at (cx, cy) with radii rx, ry (% of the size), rotation; sharp inside `sharp` of it, then fading.
  A.reg("irisBlur", A.filter(function (img, p) {
    var w = img.width, h = img.height, S = sc(p), rad = clamp(num(p.blur, 15), 0, 200) * S, cx = clamp(num(p.cx, 50), 0, 100) / 100 * w, cy = clamp(num(p.cy, 50), 0, 100) / 100 * h;
    var rx = Math.max(1, clamp(num(p.rx, 30), 1, 150) / 100 * w), ry = Math.max(1, clamp(num(p.ry, 30), 1, 150) / 100 * h), rot = num(p.rotation, 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
    var sharp = clamp(num(p.sharp, 50), 0, 99) / 100, R = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dx = x - cx, dy = y - cy, u = (dx * cr + dy * sr) / rx, v = (-dx * sr + dy * cr) / ry, e = Math.sqrt(u * u + v * v);
      R[y * w + x] = rad * smooth(sharp, 1, e);
    }
    return A.varBlur(img, R, tapsFor(p, rad), clamp(num(p.bokeh, 0), 0, 100) / 100, 0.75, clamp(num(p.noise, 0), 0, 100) / 100 * 0.08);
  }));
  // Field: pins [[x %, y %, blur px], ...]; blur between pins by inverse-distance weighting.
  A.reg("fieldBlur", A.filter(function (img, p) {
    var w = img.width, h = img.height, S = sc(p), pins = (Array.isArray(p.pins) && p.pins.length ? p.pins : [[50, 50, 15]]).slice(0, 32), R = new Float32Array(w * h), rmax = 0;
    var P = pins.map(function (q) { var b = clamp(num(q[2], 15), 0, 200) * S; rmax = Math.max(rmax, b); return [clamp(num(q[0], 50), -50, 150) / 100 * w, clamp(num(q[1], 50), -50, 150) / 100 * h, b]; });
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var sw = 0, sv = 0;
      for (var k = 0; k < P.length; k++) { var dx = x - P[k][0], dy = y - P[k][1], ww = 1 / Math.pow(dx * dx + dy * dy + 1, 1.2); sw += ww; sv += ww * P[k][2]; }
      R[y * w + x] = sv / sw;
    }
    return A.varBlur(img, R, tapsFor(p, rmax), clamp(num(p.bokeh, 0), 0, 100) / 100, 0.75, clamp(num(p.noise, 0), 0, 100) / 100 * 0.08);
  }));
})(typeof self !== "undefined" ? self : this);
