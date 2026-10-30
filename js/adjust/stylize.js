/* Adjust lane: stylize filters (emboss, find edges, glowing edges, solarize, trace contour, oil paint, wind, diffuse,
   tiles). Pure maths, runs in page and worker. Pixel sizes scale with p._scale (reduced-size previews). */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, c255 = A.c255;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }
  function chan(img, c) { var d = img.data, n = img.width * img.height, o = new Float32Array(n); for (var q = 0, i = c; q < n; q++, i += 4) o[q] = d[i]; return o; }
  // Sobel gradient of a plane -> {gx, gy} planes (edges clamped).
  function sobel(a, w, h) {
    var gx = new Float32Array(a.length), gy = new Float32Array(a.length);
    for (var y = 0; y < h; y++) {
      var ym = (y > 0 ? y - 1 : 0) * w, y0 = y * w, yp = (y < h - 1 ? y + 1 : y) * w;
      for (var x = 0; x < w; x++) {
        var xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : x;
        gx[y0 + x] = (a[ym + xp] + 2 * a[y0 + xp] + a[yp + xp]) - (a[ym + xm] + 2 * a[y0 + xm] + a[yp + xm]);
        gy[y0 + x] = (a[yp + xm] + 2 * a[yp + x] + a[yp + xp]) - (a[ym + xm] + 2 * a[ym + x] + a[ym + xp]);
      }
    }
    return { gx: gx, gy: gy };
  }
  A.sobel = sobel;

  // ---------- emboss: grey relief lit from `angle` ----------
  A.reg("emboss", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, Y = A.lumPlane(img), a = num(p.angle, 135) * Math.PI / 180, ht = Math.max(0.5, clamp(num(p.height, 3), 1, 100) * sc(p));
    var amt = clamp(num(p.amount, 100), 1, 500) / 100, dx = Math.cos(a) * ht, dy = -Math.sin(a) * ht, keep = !!p.color;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var q = y * w + x, i = q * 4, v = (A.bilin(Y, w, h, x + dx, y + dy) - A.bilin(Y, w, h, x - dx, y - dy)) * amt * 0.5;
      if (keep) { d[i] = c255(d[i] + v); d[i + 1] = c255(d[i + 1] + v); d[i + 2] = c255(d[i + 2] + v); }
      else { var g = c255(128 + v); d[i] = d[i + 1] = d[i + 2] = g; }
    }
    return img;
  }));

  // ---------- find edges: dark colour lines on white ----------
  A.reg("findEdges", A.filter(function (img) {
    var w = img.width, h = img.height, d = img.data;
    for (var c = 0; c < 3; c++) {
      var g = sobel(chan(img, c), w, h);
      for (var q = 0, i = c; q < w * h; q++, i += 4) d[i] = c255(255 - Math.sqrt(g.gx[q] * g.gx[q] + g.gy[q] * g.gy[q]) * 0.5);
    }
    return img;
  }));

  // ---------- glowing edges: bright colour edges on black ----------
  A.reg("glowingEdges", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, S = sc(p), width = Math.max(1, Math.round(clamp(num(p.width, 2), 1, 14) * S)), br = clamp(num(p.brightness, 6), 0, 20) / 6, sm = clamp(num(p.smooth, 5), 1, 15);
    var out = [];
    for (var c = 0; c < 3; c++) {
      var pl = A.blur(chan(img, c), w, h, Math.max(0.3, sm * 0.25 * S)), g = sobel(pl, w, h), m = new Uint8Array(w * h);
      for (var q = 0; q < m.length; q++) m[q] = c255(Math.sqrt(g.gx[q] * g.gx[q] + g.gy[q] * g.gy[q]) * 0.35 * br);
      if (width > 1) { var t = new Uint8Array(m.length); A.morph8(m, t, w, h, width - 1, true, true); m = t; }
      out.push(m);
    }
    for (var k = 0, i = 0; k < w * h; k++, i += 4) { d[i] = out[0][k]; d[i + 1] = out[1][k]; d[i + 2] = out[2][k]; }
    return img;
  }));

  // ---------- solarize: values above the threshold are turned negative ----------
  A.reg("solarize", function (img, p, sel) {
    var t = clamp(num(p.threshold, 128), 0, 255), l = new Uint8Array(256);
    for (var i = 0; i < 256; i++) l[i] = i >= t ? 255 - i : i;
    return PIX.applyLuts(img, l, l, l, sel);
  });

  // ---------- trace contour: thin lines where each channel crosses `level` ----------
  A.reg("traceContour", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, lv = clamp(num(p.level, 128), 0, 255), upper = p.edge !== "lower";
    for (var c = 0; c < 3; c++) {
      var a = chan(img, c);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var q = y * w + x, on = a[q] >= lv, line = false;
        if (on === upper) {
          if (x < w - 1 && (a[q + 1] >= lv) !== on) line = true; else if (y < h - 1 && (a[q + w] >= lv) !== on) line = true;
          else if (x > 0 && (a[q - 1] >= lv) !== on) line = true; else if (y > 0 && (a[q - w] >= lv) !== on) line = true;
        }
        d[q * 4 + c] = line ? 0 : 255;
      }
    }
    return img;
  }));

  // ---------- oil paint ----------
  // 1) Kuwahara smoothing (of four quadrants, take the mean of the calmest), 2) brush strokes: smear along the local
  // edge direction (structure tensor), 3) a little relief lighting from the paint's own brightness.
  A.kuwahara = function (img, r) {
    var w = img.width, h = img.height, n = w * h, d = img.data, rr = Math.max(1, Math.round(r / 2)), off = rr, M = [], V, Y = A.lumPlane(img), q, i;
    for (var c = 0; c < 3; c++) M.push(A.boxMean(chan(img, c), w, h, rr));
    var YY = new Float32Array(n); for (q = 0; q < n; q++) YY[q] = Y[q] * Y[q];
    var mY = A.boxMean(Y, w, h, rr), mYY = A.boxMean(YY, w, h, rr); V = new Float32Array(n);
    for (q = 0; q < n; q++) V[q] = mYY[q] - mY[q] * mY[q];
    var ox = [-off, off, -off, off], oy = [-off, -off, off, off];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var best = Infinity, bq = 0;
      for (var k = 0; k < 4; k++) { var X = clamp(x + ox[k], 0, w - 1), Yq = clamp(y + oy[k], 0, h - 1), qq = Yq * w + X; if (V[qq] < best) { best = V[qq]; bq = qq; } }
      i = (y * w + x) * 4; d[i] = M[0][bq]; d[i + 1] = M[1][bq]; d[i + 2] = M[2][bq];
    }
    return img;
  };
  A.reg("oilPaint", A.filter(function (img, p) {
    var w = img.width, h = img.height, n = w * h, d = img.data, S = sc(p), q, i;
    var sty = clamp(num(p.stylization, 4), 0.1, 10), clean = clamp(num(p.cleanliness, 5), 0, 10), scl = clamp(num(p.scale, 2), 0.1, 10), bris = clamp(num(p.bristle, 3), 0, 10);
    var lightA = num(p.angle, -60) * Math.PI / 180, shine = clamp(num(p.shine, 1.3), 0, 10);
    A.kuwahara(img, Math.max(2, (1 + sty * 1.2) * S));
    // stroke direction from the structure tensor of the smoothed luminance
    var Y = A.lumPlane(img), g = sobel(Y, w, h), jxx = new Float32Array(n), jxy = new Float32Array(n), jyy = new Float32Array(n), st = Math.max(1, (1 + clean) * S);
    for (q = 0; q < n; q++) { jxx[q] = g.gx[q] * g.gx[q]; jxy[q] = g.gx[q] * g.gy[q]; jyy[q] = g.gy[q] * g.gy[q]; }
    A.blur(jxx, w, h, st); A.blur(jxy, w, h, st); A.blur(jyy, w, h, st);
    var src = A.toP4(img), out = new Float32Array(src.length), taps = Math.max(2, Math.round((2 + scl * 1.6) * Math.min(1, S * 2))), stepL = Math.max(0.6, scl * 0.6 * S);
    var noise = bris ? new Float32Array(n) : null, R = A.rng(99);
    if (noise) { for (q = 0; q < n; q++) noise[q] = R() - 0.5; A.blur(noise, w, h, 0.6); }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      q = y * w + x;
      var a = jxx[q], b = jxy[q], c2 = jyy[q], ang = 0.5 * Math.atan2(2 * b, a - c2) + Math.PI / 2, tx = Math.cos(ang), ty = Math.sin(ang), s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (var k = -taps; k <= taps; k++) {
        var X = clamp(x + tx * k * stepL, 0, w - 1), Yy = clamp(y + ty * k * stepL, 0, h - 1), xi = X | 0, yi = Yy | 0, j = (yi * w + xi) * 4;
        s0 += src[j]; s1 += src[j + 1]; s2 += src[j + 2]; s3 += src[j + 3];
      }
      var o = q * 4, inv = 1 / (2 * taps + 1); out[o] = s0 * inv; out[o + 1] = s1 * inv; out[o + 2] = s2 * inv; out[o + 3] = s3 * inv;
    }
    A.fromP4(out, img);
    // relief: brightness as a height map, lit from the angle
    var H = A.lumPlane(img); if (noise) for (q = 0; q < n; q++) H[q] += noise[q] * bris * 6;
    A.blur(H, w, h, Math.max(0.5, 0.8 * S));
    var lx = Math.cos(lightA), ly = -Math.sin(lightA);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      q = y * w + x; i = q * 4;
      var hx = H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)], hy = H[Math.min(h - 1, y + 1) * w + x] - H[Math.max(0, y - 1) * w + x];
      var v = (hx * lx + hy * ly) * shine * 0.35;
      d[i] = c255(d[i] + v); d[i + 1] = c255(d[i + 1] + v); d[i + 2] = c255(d[i + 2] + v);
    }
    return img;
  }));

  // ---------- wind: streaks from bright edges, to the left or right ----------
  A.reg("wind", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, S = sc(p), dir = p.direction === "left" ? -1 : 1, mode = p.method || "wind", R = A.rng(17);
    var fall = mode === "blast" ? 0.6 / S : mode === "stagger" ? 2.5 / S : 1.6 / S, src = new Uint8ClampedArray(d);
    for (var y = 0; y < h; y++) {
      var acc = [0, 0, 0];
      for (var k = 0; k < w; k++) {
        var x = dir > 0 ? k : w - 1 - k, i = (y * w + x) * 4;
        if (mode === "stagger" && R() < 0.04) { acc = [0, 0, 0]; }
        for (var c = 0; c < 3; c++) {
          var v = src[i + c];
          acc[c] = Math.max(v, acc[c] - fall * (0.6 + R() * 0.8));
          d[i + c] = Math.max(v, acc[c]);
        }
      }
    }
    return img;
  }));

  // ---------- diffuse: each pixel swapped with a random neighbour ----------
  A.reg("diffuse", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, src = new Uint8ClampedArray(d), R = A.rng(5), mode = p.mode || "normal", rad = Math.max(1, Math.round(clamp(num(p.radius, 2), 1, 10) * sc(p)));
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var nx = clamp(x + Math.round((R() * 2 - 1) * rad), 0, w - 1), ny = clamp(y + Math.round((R() * 2 - 1) * rad), 0, h - 1), i = (y * w + x) * 4, j = (ny * w + nx) * 4;
      if (mode === "aniso") { var gx = Math.abs(src[(y * w + clamp(x + 1, 0, w - 1)) * 4] - src[(y * w + clamp(x - 1, 0, w - 1)) * 4]), gy = Math.abs(src[(clamp(y + 1, 0, h - 1) * w + x) * 4] - src[(clamp(y - 1, 0, h - 1) * w + x) * 4]); j = gx > gy ? (ny * w + x) * 4 : (y * w + nx) * 4; }
      var ls = src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11, ln = src[j] * 0.3 + src[j + 1] * 0.59 + src[j + 2] * 0.11;
      if ((mode === "darken" && ln >= ls) || (mode === "lighten" && ln <= ls)) continue;
      d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = src[j + 3];
    }
    return img;
  }));

  // ---------- tiles: a grid of tiles, each nudged at random ----------
  A.reg("tiles", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, src = new Uint8ClampedArray(d), R = A.rng(23), cnt = clamp(Math.round(num(p.count, 10)), 1, 99), off = clamp(num(p.offset, 10), 1, 99) / 100;
    var ts = Math.max(2, Math.min(w, h) / cnt), fill = p.fill || "inverse", fc = A.hex(p.fillColor, [255, 255, 255]), i;
    for (i = 0; i < d.length; i += 4) {
      if (fill === "inverse") { d[i] = 255 - src[i]; d[i + 1] = 255 - src[i + 1]; d[i + 2] = 255 - src[i + 2]; }
      else if (fill === "color") { d[i] = fc[0]; d[i + 1] = fc[1]; d[i + 2] = fc[2]; d[i + 3] = 255; }
      else if (fill === "transparent") d[i + 3] = 0;
    }
    for (var ty = 0; ty < h; ty += ts) for (var tx = 0; tx < w; tx += ts) {
      var x0 = Math.round(tx), y0 = Math.round(ty), x1 = Math.min(w, Math.round(tx + ts)), y1 = Math.min(h, Math.round(ty + ts));
      var dx = Math.round((R() * 2 - 1) * off * ts), dy = Math.round((R() * 2 - 1) * off * ts);
      for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
        var X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        var s = (y * w + x) * 4, t = (Y * w + X) * 4; d[t] = src[s]; d[t + 1] = src[s + 1]; d[t + 2] = src[s + 2]; d[t + 3] = src[s + 3];
      }
    }
    return img;
  }));

  // ---------- extrude: the image broken into blocks or pyramids pushed out towards the viewer ----------
  A.reg("extrude", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, src = PIX.copyImg(img), S = sc(p), size = Math.max(2, Math.round(clamp(num(p.size, 30), 2, 255) * S)), depth = clamp(num(p.depth, 30), 1, 255);
    var pyr = p.type === "pyramids", byLevel = p.depthBy !== "random", solid = !!p.solid, R = A.rng(19), cx = w / 2, cy = h / 2, cells = [];
    for (var by = 0; by < h; by += size) for (var bx = 0; bx < w; bx += size) {
      var x1 = Math.min(w, bx + size), y1 = Math.min(h, by + size), sr = 0, sg = 0, sb = 0, n = 0;
      for (var y = by; y < y1; y++) for (var x = bx; x < x1; x++) { var i = (y * w + x) * 4; sr += src.data[i]; sg += src.data[i + 1]; sb += src.data[i + 2]; n++; }
      var lum = (0.299 * sr + 0.587 * sg + 0.114 * sb) / n / 255, z = (byLevel ? lum : R()) * depth / 255;
      cells.push({ x0: bx, y0: by, x1: x1, y1: y1, z: z, c: [sr / n, sg / n, sb / n] });
    }
    cells.sort(function (a, b) { return a.z - b.z; });      // far first, near last
    for (var q = 0; q < d.length; q += 4) { d[q] = d[q + 1] = d[q + 2] = 0; d[q + 3] = 255; }
    cells.forEach(function (cl) {
      var k = 1 + cl.z * 0.8, mx = (cl.x0 + cl.x1) / 2, my = (cl.y0 + cl.y1) / 2, ox = (mx - cx) * (k - 1), oy = (my - cy) * (k - 1), hs = (cl.x1 - cl.x0) / 2;
      for (var y = Math.max(0, Math.floor(cl.y0 + oy)); y < Math.min(h, Math.ceil(cl.y1 + oy)); y++) for (var x = Math.max(0, Math.floor(cl.x0 + ox)); x < Math.min(w, Math.ceil(cl.x1 + ox)); x++) {
        var u = x - ox - cl.x0, v = y - oy - cl.y0, i = (y * w + x) * 4, col;
        if (pyr) {      // four sloped faces, lit from the top left
          var dx = u - hs, dy = v - hs, f = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1.15 : 0.7) : (dy < 0 ? 1.3 : 0.6);
          col = cl.c.map(function (c0) { return c0 * f; });
        } else if (solid) col = cl.c;
        else { var sx = Math.min(cl.x1 - 1, Math.max(cl.x0, Math.round(cl.x0 + u))), sy = Math.min(cl.y1 - 1, Math.max(cl.y0, Math.round(cl.y0 + v))), j = (sy * w + sx) * 4; col = [src.data[j], src.data[j + 1], src.data[j + 2]]; }
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
      if (!pyr && ox * ox + oy * oy > 1) {        // the block's side towards the centre, a little darker
        var steps = Math.ceil(Math.sqrt(ox * ox + oy * oy));
        for (var s2 = 0; s2 < steps; s2++) {
          var t = s2 / steps, ex = ox * t, ey = oy * t;
          [[cl.x0, cl.y0, cl.x1, cl.y0 + 1], [cl.x0, cl.y1 - 1, cl.x1, cl.y1], [cl.x0, cl.y0, cl.x0 + 1, cl.y1], [cl.x1 - 1, cl.y0, cl.x1, cl.y1]].forEach(function (e) {
            for (var y2 = Math.max(0, Math.floor(e[1] + ey)); y2 < Math.min(h, Math.ceil(e[3] + ey)); y2++) for (var x2 = Math.max(0, Math.floor(e[0] + ex)); x2 < Math.min(w, Math.ceil(e[2] + ex)); x2++) {
              var i2 = (y2 * w + x2) * 4; if (d[i2 + 3] === 255 && d[i2] + d[i2 + 1] + d[i2 + 2] > 0 && t > 0.98) continue;
              d[i2] = cl.c[0] * 0.55; d[i2 + 1] = cl.c[1] * 0.55; d[i2 + 2] = cl.c[2] * 0.55;
            }
          });
        }
        // redraw the front face over its sides
        for (var y3 = Math.max(0, Math.floor(cl.y0 + oy)); y3 < Math.min(h, Math.ceil(cl.y1 + oy)); y3++) for (var x3 = Math.max(0, Math.floor(cl.x0 + ox)); x3 < Math.min(w, Math.ceil(cl.x1 + ox)); x3++) {
          var i3 = (y3 * w + x3) * 4, col2;
          if (solid) col2 = cl.c; else { var sx3 = Math.min(cl.x1 - 1, Math.max(cl.x0, Math.round(x3 - ox))), sy3 = Math.min(cl.y1 - 1, Math.max(cl.y0, Math.round(y3 - oy))), j3 = (sy3 * w + sx3) * 4; col2 = [src.data[j3], src.data[j3 + 1], src.data[j3 + 2]]; }
          d[i3] = col2[0]; d[i3 + 1] = col2[1]; d[i3 + 2] = col2[2];
        }
      }
    });
    return img;
  }));
})(typeof self !== "undefined" ? self : this);
