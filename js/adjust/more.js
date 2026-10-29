/* Adjust lane: sharpening (smart sharpen, sharpen more, sharpen edges, shake reduction), more blurs (average,
   blur, blur more, box, shape, spin) and Other › custom kernel, HSB/HSL. Pure maths, page + worker. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, c255 = A.c255, smooth = A.smooth;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }
  // Add a luminance change dY (plane) to every pixel's R, G, B (no colour fringes).
  function addY(img, Y0, Y1) { var d = img.data; for (var q = 0, i = 0; q < Y0.length; q++, i += 4) { var dy = Y1[q] - Y0[q]; d[i] = c255(d[i] + dy); d[i + 1] = c255(d[i + 1] + dy); d[i + 2] = c255(d[i + 2] + dy); } return img; }

  // ---------- smart sharpen ----------
  // remove: gaussian | lens | motion (angle). Small details (noise) are left alone by `noise`; shadows and highlights
  // can be spared (fade amounts + tonal widths).
  A.reg("smartSharpen", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, S = sc(p), amt = clamp(num(p.amount, 150), 0, 500) / 100, r = clamp(num(p.radius, 1), 0.1, 64) * S, nz = clamp(num(p.noise, 10), 0, 100) / 100;
    var mode = p.remove || "lens", Y = A.lumPlane(img), B = new Float32Array(Y), q;
    if (mode === "motion") A.lineBlur(B, w, h, num(p.angle, 0), Math.max(1, r * 2));
    else if (mode === "lens") { var rr = Math.max(1, Math.round(r)); B = A.boxMean(A.boxMean(B, w, h, rr), w, h, Math.max(1, Math.round(r * 0.6))); }
    else A.blur(B, w, h, r);
    var sf = clamp(num(p.shFade, 0), 0, 100) / 100, st = clamp(num(p.shTone, 50), 0, 100) / 100, hf = clamp(num(p.hiFade, 0), 0, 100) / 100, ht = clamp(num(p.hiTone, 50), 0, 100) / 100;
    var lo = nz * 6, hi = lo * 2 + 0.5, Y2 = new Float32Array(n), halo = mode === "gaussian" ? 255 : 18 + 40 * (1 - nz);
    for (q = 0; q < n; q++) {
      var dt = Y[q] - B[q], ad = Math.abs(dt), g = nz ? smooth(lo, hi, ad) : 1, y = Y[q] / 255, f = 1;
      if (sf) f *= 1 - sf * (1 - smooth(0, st * 0.5 + 0.02, y));
      if (hf) f *= 1 - hf * smooth(1 - ht * 0.5 - 0.02, 1, y);
      Y2[q] = Y[q] + clamp(dt, -halo, halo) * amt * g * f;
    }
    return addY(img, Y, Y2);
  }));
  A.reg("sharpenMore", A.filter(function (img) { return PIX.unsharp(img, 140, 1.2, 0); }));
  // Sharpen edges: only where the local contrast is high, so flat areas (and their noise) stay as they are.
  A.reg("sharpenEdges", A.filter(function (img, p) {
    var w = img.width, h = img.height, Y = A.lumPlane(img), B = A.blur(new Float32Array(Y), w, h, Math.max(0.6, 1.2 * sc(p))), E = new Float32Array(Y.length), Y2 = new Float32Array(Y.length), q;
    for (q = 0; q < Y.length; q++) E[q] = Math.abs(Y[q] - B[q]);
    E = A.boxMean(E, w, h, 2);
    for (q = 0; q < Y.length; q++) Y2[q] = Y[q] + (Y[q] - B[q]) * 1.6 * smooth(3, 9, E[q]);
    return addY(img, Y, Y2);
  }));
  // Shake reduction: Richardson-Lucy deconvolution of the luminance with a straight blur trace (angle, length).
  A.reg("shakeReduction", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, S = sc(p), len = clamp(num(p.length, 9), 1, 199) * S, ang = num(p.angle, 0), it = clamp(Math.round(num(p.iterations, 12)), 1, 40), damp = clamp(num(p.smooth, 30), 0, 100) / 100, q;
    if (len < 1.5) return img;
    var Y = A.lumPlane(img), obs = new Float32Array(n), est = new Float32Array(n), tmp = new Float32Array(n);
    for (q = 0; q < n; q++) { obs[q] = Y[q] + 1; est[q] = obs[q]; }
    for (var k = 0; k < it; k++) {
      tmp.set(est); A.lineBlur(tmp, w, h, ang, len);
      for (q = 0; q < n; q++) tmp[q] = obs[q] / Math.max(1e-3, tmp[q]);
      A.lineBlur(tmp, w, h, ang, len);
      for (q = 0; q < n; q++) { var f = tmp[q]; f = 1 + (f - 1) * (1 - damp * 0.7); est[q] = clamp(est[q] * f, 0, 300); }
    }
    if (damp) { var sm = A.guided(est, est, w, h, 1, Math.pow(2 + damp * 10, 2)); for (q = 0; q < n; q++) est[q] = est[q] + (sm[q] - est[q]) * damp; }
    for (q = 0; q < n; q++) est[q] -= 1;
    return addY(img, Y, est);
  }));

  // ---------- more blurs ----------
  A.reg("average", function (img, p, sel) {
    var d = img.data, s = [0, 0, 0], wt = 0;
    for (var i = 0, q = 0; i < d.length; i += 4, q++) { var a = d[i + 3] / 255 * (sel ? sel[q] / 255 : 1); s[0] += d[i] * a; s[1] += d[i + 1] * a; s[2] += d[i + 2] * a; wt += a; }
    if (!wt) return img;
    var m = [s[0] / wt, s[1] / wt, s[2] / wt];
    return A.perPixel(img, sel, function (r, g, b, o) { o[0] = m[0]; o[1] = m[1]; o[2] = m[2]; });
  });
  A.reg("blurLight", A.filter(function (img, p) { return PIX.gaussian(img, 1.4 * sc(p) + 0.2); }));
  A.reg("blurMore", A.filter(function (img, p) { return PIX.gaussian(img, 3.2 * sc(p) + 0.4); }));
  A.reg("boxBlur", A.filter(function (img, p) { var r = Math.max(1, Math.round(clamp(num(p.radius, 10), 1, 999) * sc(p))); return A.planes(img, function (pl, w, h) { pl.set(A.boxMean(pl, w, h, r)); return pl; }); }));
  // Shape blur: the blur kernel is a shape (heart, star, ring, ...), taps spread inside it.
  var SHAPES = A.BLUR_SHAPES = {
    disc: function (x, y) { return x * x + y * y <= 1; },
    ring: function (x, y) { var r = x * x + y * y; return r <= 1 && r >= 0.55; },
    heart: function (x, y) { var X = x * 1.15, Y = -y * 1.15 + 0.15, a = X * X + Y * Y - 1; return a * a * a - X * X * Y * Y * Y <= 0; },
    star: function (x, y) { var r = Math.sqrt(x * x + y * y), t = Math.atan2(y, x); return r <= 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(2.5 * t)), 3); },
    cross: function (x, y) { return (Math.abs(x) < 0.28 || Math.abs(y) < 0.28) && Math.abs(x) <= 1 && Math.abs(y) <= 1; },
    diamond: function (x, y) { return Math.abs(x) + Math.abs(y) <= 1; },
    square: function (x, y) { return Math.abs(x) <= 0.85 && Math.abs(y) <= 0.85; },
    line: function (x, y) { return Math.abs(y) < 0.08 && Math.abs(x) <= 1; }
  };
  A.shapeTaps = function (shape, n) {
    var f = SHAPES[shape] || SHAPES.disc, out = [], R = A.rng(41), tries = 0;
    var ga = Math.PI * (3 - Math.sqrt(5));
    for (var k = 0; out.length < n && tries < n * 60; k++, tries++) {      // golden-angle points, kept if inside the shape
      var r = Math.sqrt((k % (n * 4) + 0.5) / (n * 4)), a = k * ga, x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (f(x, y)) out.push([x, y]);
    }
    while (out.length < 4) { var u = R() * 2 - 1, v = R() * 2 - 1; if (f(u, v)) out.push([u, v]); }
    return out;
  };
  A.reg("shapeBlur", A.filter(function (img, p) {
    var w = img.width, h = img.height, r = clamp(num(p.radius, 10), 1, 500) * sc(p), R = new Float32Array(w * h).fill(r);
    return A.varBlur(img, R, A.shapeTaps(p.shape || "heart", Math.round(clamp(20 + r * r, 24, 64))), 0, 1, 0);
  }));
  // Spin blur: a local radial spin inside an ellipse, fading out at its edge.
  A.reg("spinBlur", A.filter(function (img, p) {
    var w = img.width, h = img.height, before = PIX.copyImg(img), cx = clamp(num(p.cx, 50), 0, 100), cy = clamp(num(p.cy, 50), 0, 100);
    PIX.EXT.radialBlur(img, { amount: clamp(num(p.angle, 15), 1, 90) / 90 * 100, mode: "spin", cx: cx, cy: cy, quality: "good" }, null);
    var rx = clamp(num(p.size, 30), 1, 150) / 100 * w, ry = rx * clamp(num(p.aspect, 100), 10, 300) / 100, X = cx / 100 * w, Y = cy / 100 * h, m = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var u = (x - X) / rx, v = (y - Y) / ry; m[y * w + x] = c255(255 * (1 - smooth(0.8, 1, Math.sqrt(u * u + v * v)))); }
    return PIX.mixSel(before, img, m);
  }));

  // ---------- other ----------
  // Custom kernel: 5x5 weights (row by row), divided by `scale`, plus `offset`; alpha kept or filtered too.
  A.reg("customKernel", A.filter(function (img, p) {
    var k = (Array.isArray(p.kernel) ? p.kernel : []).slice(0, 25).map(function (v) { return clamp(num(v, 0), -999, 999); }), w = img.width, h = img.height, d = img.data, src = new Uint8ClampedArray(d);
    while (k.length < 25) k.push(0);
    var sum = k.reduce(function (a, b) { return a + b; }, 0), scl = num(p.scale, 0) || sum || 1, off = clamp(num(p.offset, 0), -9999, 9999), keepA = p.keepAlpha !== false;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = [0, 0, 0, 0];
      for (var j = -2; j <= 2; j++) for (var i = -2; i <= 2; i++) {
        var kv = k[(j + 2) * 5 + i + 2]; if (!kv) continue;
        var t = (clamp(y + j, 0, h - 1) * w + clamp(x + i, 0, w - 1)) * 4; s[0] += src[t] * kv; s[1] += src[t + 1] * kv; s[2] += src[t + 2] * kv; s[3] += src[t + 3] * kv;
      }
      var o = (y * w + x) * 4; d[o] = c255(s[0] / scl + off); d[o + 1] = c255(s[1] / scl + off); d[o + 2] = c255(s[2] / scl + off); if (!keepA) d[o + 3] = c255(s[3] / scl);
    }
    return img;
  }));
  // HSB / HSL: store hue, saturation, brightness (or lightness) in the R, G, B channels (and back).
  A.reg("hsbhsl", function (img, p, sel) {
    var to = p.direction !== "fromHsx", hsl = p.model === "hsl";
    return A.perPixel(img, sel, function (r, g, b, o) {
      if (to) {
        if (hsl) { var x = A.rgb2hsl(r, g, b); o[0] = x[0] / 360 * 255; o[1] = x[1] * 255; o[2] = x[2] * 255; }
        else { var v = A.rgb2hsv(r, g, b); o[0] = v[0] / 360 * 255; o[1] = v[1] * 255; o[2] = v[2] * 255; }
        return;
      }
      var H = r / 255 * 360, S = g / 255, L = b / 255, c;
      if (hsl) c = A.hsl2rgb(H, S, L);
      else { var C = L * S, X = C * (1 - Math.abs((H / 60) % 2 - 1)), m = L - C, k = Math.floor(H / 60) % 6, rr = [C, X, 0, 0, X, C][k], gg = [X, C, C, X, 0, 0][k], bb = [0, 0, X, C, C, X][k]; c = [(rr + m) * 255, (gg + m) * 255, (bb + m) * 255]; }
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
  });
})(typeof self !== "undefined" ? self : this);
