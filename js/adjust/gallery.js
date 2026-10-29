/* Adjust lane: filter gallery — artistic and sketch effects made for this app, built from the lane's primitives.
   A.GALLERY[id] = {name, params: [[key, label, min, max, step, default]], fn(img, p, S)}; op "gallery" runs p.effect.
   Pure maths, page + worker. S = preview scale (pixel sizes scale with it). */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, c255 = A.c255;
  function lumP(img) { return A.lumPlane(img); }
  function edgeMag(Y, w, h) { var g = A.sobel(Y, w, h), m = new Float32Array(Y.length); for (var q = 0; q < m.length; q++) m[q] = Math.sqrt(g.gx[q] * g.gx[q] + g.gy[q] * g.gy[q]); return m; }
  function noisePlane(n, seed) { var R = A.rng(seed), t = new Float32Array(n); for (var q = 0; q < n; q++) t[q] = R(); return t; }
  function posterLut(levels) { return A.lutPosterize(levels); }
  // pencil-style sketch luminance: colour dodge of the grey image by its blurred negative
  function sketch(Y, w, h, rad, dark) {
    var inv = new Float32Array(Y.length); for (var q = 0; q < Y.length; q++) inv[q] = 255 - Y[q];
    A.blur(inv, w, h, Math.max(0.7, rad));
    var o = new Float32Array(Y.length);
    for (q = 0; q < Y.length; q++) { var v = inv[q] >= 254.5 ? 255 : Math.min(255, Y[q] * 255 / (255 - inv[q])); o[q] = 255 - (255 - v) * dark; }
    return o;
  }
  var GAL = A.GALLERY = {
    watercolor: { name: "Watercolour", params: [["detail", "Brush detail", 1, 14, 1, 8], ["shadow", "Shadow intensity", 0, 10, 1, 2], ["texture", "Paper texture", 0, 10, 1, 3]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h;
      A.kuwahara(img, Math.max(2, (16 - p.detail) * 0.7 * S)); A.kuwahara(img, Math.max(2, (16 - p.detail) * 0.5 * S));
      var Y = lumP(img), E = edgeMag(A.blur(new Float32Array(Y), w, h, Math.max(0.6, S)), w, h), T = noisePlane(n, 9);
      A.blur(T, w, h, Math.max(0.6, 2 * S));
      for (var q = 0, i = 0; q < n; q++, i += 4) {
        var dk = Math.min(70, E[q] * 0.12 * (1 + p.shadow * 0.4)) + (T[q] - 0.5) * p.texture * 9, wash = 1.06;
        for (var c = 0; c < 3; c++) d[i + c] = c255(255 - (255 - d[i + c]) * wash - dk * 0.6 - (Y[q] < 60 ? p.shadow * 3 : 0));
      }
      return img;
    } },
    pencil: { name: "Pencil sketch", params: [["width", "Stroke width", 1, 20, 1, 4], ["dark", "Darkness", 0, 100, 1, 60], ["grain", "Paper grain", 0, 100, 1, 30]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, Y = lumP(img), o = sketch(Y, w, h, p.width * 1.5 * S, 0.4 + p.dark / 100 * 1.6), T = noisePlane(n, 3);
      A.blur(T, w, h, 0.6);
      for (var q = 0, i = 0; q < n; q++, i += 4) { var v = c255(o[q] - (T[q] - 0.5) * p.grain * 0.5 * (1 - o[q] / 300)); d[i] = d[i + 1] = d[i + 2] = v; }
      return img;
    } },
    colorPencil: { name: "Coloured pencil", params: [["width", "Pencil width", 1, 20, 1, 3], ["pressure", "Stroke pressure", 0, 100, 1, 60], ["paper", "Paper brightness", 0, 100, 1, 70]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, Y = lumP(img), o = sketch(Y, w, h, p.width * 1.5 * S, 1 + p.pressure / 100), T = noisePlane(n, 5);
      T = A.lineBlur(T, w, h, 45, Math.max(2, 8 * S));
      var pb = 200 + p.paper * 0.55;
      for (var q = 0, i = 0; q < n; q++, i += 4) {
        var hatch = (T[q] - 0.5) * 60 * p.pressure / 100, k = o[q] / 255;
        for (var c = 0; c < 3; c++) d[i + c] = c255(pb - (pb - d[i + c]) * (1 - k) * 1.1 + hatch * (1 - k) - (1 - k) * 25);
      }
      return img;
    } },
    charcoal: { name: "Charcoal", params: [["thick", "Thickness", 1, 7, 1, 2], ["detail", "Detail", 0, 5, 1, 3], ["balance", "Light/dark balance", 0, 100, 1, 50]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, Y = A.blur(lumP(img), w, h, Math.max(0.6, (6 - p.detail) * 0.6 * S)), T = noisePlane(n, 7), fg = A.hex(p.fg, [0, 0, 0]), bg = A.hex(p.bg, [255, 255, 255]);
      T = A.lineBlur(T, w, h, 45, Math.max(2, p.thick * 4 * S));
      var mn = Infinity, mx = -Infinity; for (var q = 0; q < n; q += 3) { if (T[q] < mn) mn = T[q]; if (T[q] > mx) mx = T[q]; }
      for (q = 0; q < n; q++) {
        var t = (T[q] - mn) / (mx - mn || 1), lv = Y[q] / 255 + (p.balance - 50) / 120, k = clamp((lv - t * 0.9 + 0.05) * 4 + 0.5, 0, 1), i = q * 4;
        for (var c = 0; c < 3; c++) d[i + c] = fg[c] + (bg[c] - fg[c]) * k;
      }
      return img;
    } },
    ink: { name: "Ink outlines", params: [["edge", "Edge sensitivity", 0, 100, 1, 50], ["width", "Line width", 1, 6, 1, 1], ["levels", "Colour levels", 2, 12, 1, 6]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, Y = A.blur(lumP(img), w, h, Math.max(0.5, S)), E = edgeMag(Y, w, h), m = new Uint8Array(n), thr = 220 - p.edge * 1.9, L = posterLut(p.levels);
      for (var q = 0; q < n; q++) m[q] = E[q] > thr ? 255 : 0;
      var wd = Math.max(0, Math.round((p.width - 1) * S)); if (wd) { var t = new Uint8Array(n); A.morph8(m, t, w, h, wd, true, true); m = t; }
      for (q = 0; q < n; q++) { var i = q * 4; for (var c = 0; c < 3; c++) d[i + c] = m[q] ? 20 : L[d[i + c]]; }
      return img;
    } },
    posterEdges: { name: "Poster edges", params: [["thick", "Edge thickness", 0, 10, 1, 2], ["intensity", "Edge intensity", 0, 10, 1, 1], ["levels", "Posterisation", 2, 6, 1, 3]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, L = posterLut(p.levels + 1);
      A.kuwahara(img, Math.max(2, 3 * S));
      var Y = lumP(img), E = edgeMag(A.blur(Y, w, h, Math.max(0.5, (1 + p.thick * 0.4) * S)), w, h);
      for (var q = 0, i = 0; q < n; q++, i += 4) { var k = clamp(E[q] * 0.02 * (0.5 + p.intensity), 0, 1); for (var c = 0; c < 3; c++) d[i + c] = L[d[i + c]] * (1 - k); }
      return img;
    } },
    cutout: { name: "Cut-out", params: [["levels", "Number of levels", 2, 8, 1, 4], ["simple", "Edge simplicity", 0, 10, 1, 4], ["fidelity", "Edge fidelity", 1, 3, 1, 2]], fn: function (img, p, S) {
      var r = Math.max(1, Math.round((1 + p.simple) * (4 - p.fidelity) * 0.6 * S));
      A.planes8(img, function (s, o, w, h) { A.median8(s, o, w, h, r); });
      A.kuwahara(img, Math.max(2, r));
      var L = posterLut(p.levels), d = img.data;
      for (var i = 0; i < d.length; i += 4) { d[i] = L[d[i]]; d[i + 1] = L[d[i + 1]]; d[i + 2] = L[d[i + 2]]; }
      return img;
    } },
    dryBrush: { name: "Dry brush", params: [["size", "Brush size", 0, 10, 1, 2], ["detail", "Brush detail", 0, 10, 1, 8], ["texture", "Texture", 1, 3, 1, 1]], fn: function (img, p, S) {
      PIX.EXT.oilPaint(img, { stylization: 1 + p.size * 0.8, cleanliness: 10 - p.detail, scale: 1 + p.size * 0.5, bristle: p.texture * 3, shine: 0.6, angle: 120, _scale: S }, null);
      var L = posterLut(10 - Math.round(p.detail / 2)), d = img.data;
      for (var i = 0; i < d.length; i += 4) { d[i] = (d[i] + L[d[i]]) / 2; d[i + 1] = (d[i + 1] + L[d[i + 1]]) / 2; d[i + 2] = (d[i + 2] + L[d[i + 2]]) / 2; }
      return img;
    } },
    gloss: { name: "Glossy wrap", params: [["strength", "Highlight strength", 0, 20, 1, 12], ["detail", "Detail", 1, 15, 1, 8], ["smooth", "Smoothness", 1, 15, 1, 8]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, Y = A.blur(lumP(img), w, h, Math.max(0.8, p.smooth * 0.8 * S)), g = A.sobel(Y, w, h);
      for (var q = 0, i = 0; q < n; q++, i += 4) {
        var nx = g.gx[q] * 0.02 * p.detail, ny = g.gy[q] * 0.02 * p.detail, nl = Math.sqrt(nx * nx + ny * ny + 1), sp = Math.pow(Math.max(0, (nx * 0.5 - ny * 0.6 + 0.62) / nl), 24) * p.strength * 22;
        for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] * 0.92 + sp);
      }
      return img;
    } },
    comic: { name: "Comic", params: [["levels", "Colour levels", 2, 8, 1, 4], ["dots", "Dot size", 1, 10, 1, 3], ["lines", "Outline strength", 0, 10, 1, 6]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, L = posterLut(p.levels), Y = lumP(img), E = edgeMag(A.blur(new Float32Array(Y), w, h, Math.max(0.6, 1.2 * S)), w, h), s = Math.max(2, p.dots * 2 * S);
      var ink = new Float32Array(n); for (var q = 0; q < n; q++) ink[q] = clamp((140 - Y[q]) / 140, 0, 1) * 0.8;
      var cov = new Float32Array(n), a = Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var u = x * ca + y * sa, v = -x * sa + y * ca, cu = (Math.floor(u / s) + 0.5) * s, cv = (Math.floor(v / s) + 0.5) * s, du = u - cu, dv = v - cv; q = y * w + x; cov[q] = clamp(Math.sqrt(ink[q]) * s * 0.62 - Math.sqrt(du * du + dv * dv) + 0.5, 0, 1); }
      for (q = 0; q < n; q++) { var i = q * 4, ed = clamp((E[q] - 120 + p.lines * 8) * 0.03 * p.lines / 6, 0, 1); for (var c = 0; c < 3; c++) d[i + c] = L[d[i + c]] * (1 - cov[q] * 0.75) * (1 - ed); }
      return img;
    } },
    neon: { name: "Neon glow", params: [["size", "Glow size", 1, 24, 1, 6], ["bright", "Glow brightness", 0, 50, 1, 20]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, gc = A.hex(p.color, [80, 220, 255]), Y = lumP(img), E = edgeMag(A.blur(new Float32Array(Y), w, h, Math.max(0.6, S)), w, h);
      for (var q = 0; q < n; q++) E[q] = Math.min(255, E[q] * 0.5);
      var G2 = A.blur(new Float32Array(E), w, h, Math.max(0.8, p.size * S));
      for (q = 0; q < n; q++) { var i = q * 4, k = clamp((E[q] * 0.6 + G2[q] * 2.2) * p.bright / 2000, 0, 1.2); for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] * 0.25 + gc[c] * k + 255 * Math.max(0, k - 0.9)); }
      return img;
    } },
    stainedGlass: { name: "Stained glass", params: [["size", "Cell size", 4, 100, 1, 18], ["border", "Border thickness", 1, 20, 1, 4], ["light", "Light intensity", 0, 10, 1, 3]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h;
      PIX.EXT.crystallize(img, { size: p.size, _scale: S }, null);
      var lab = A.lumPlane(img), b = new Uint8Array(n);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var q = y * w + x; if ((x < w - 1 && Math.abs(lab[q] - lab[q + 1]) > 0.5) || (y < h - 1 && Math.abs(lab[q] - lab[q + w]) > 0.5)) b[q] = 255; }
      var bw = Math.max(0, Math.round((p.border - 1) * 0.5 * S)); if (bw) { var t = new Uint8Array(n); A.morph8(b, t, w, h, bw, true, false); b = t; }
      var cx = w / 2, cy = h / 2, R = Math.sqrt(cx * cx + cy * cy);
      for (q = 0; q < n; q++) { var i = q * 4, yy = Math.floor(q / w), xx = q % w, gl = 1 + p.light * 0.06 * (1 - Math.sqrt((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy)) / R); for (var c = 0; c < 3; c++) d[i + c] = b[q] ? 22 : c255(d[i + c] * gl); }
      return img;
    } },
    canvas: { name: "Canvas texture", params: [["scale", "Scale", 50, 200, 1, 100], ["relief", "Relief", 0, 50, 1, 6]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, k = p.scale / 100 * S, rel = p.relief * 2.2, N = noisePlane(w * h, 31);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var u = x / (k * 4), v = y / (k * 4), warp = Math.sin(u * Math.PI) * Math.cos(v * 0.5 * Math.PI), weft = Math.sin(v * Math.PI) * Math.cos(u * 0.5 * Math.PI);
        var hgt = ((Math.floor(u) + Math.floor(v)) % 2 ? warp : weft) + (N[y * w + x] - 0.5) * 0.3, i = (y * w + x) * 4;
        for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] + hgt * rel);
      }
      return img;
    } },
    graphicPen: { name: "Graphic pen", params: [["length", "Stroke length", 1, 15, 1, 12], ["balance", "Light/dark balance", 0, 100, 1, 50]], fn: function (img, p, S) {
      var w = img.width, h = img.height, d = img.data, n = w * h, Y = lumP(img), T = noisePlane(n, 37), fg = A.hex(p.fg, [0, 0, 0]), bg = A.hex(p.bg, [255, 255, 255]);
      T = A.lineBlur(T, w, h, 45, Math.max(2, p.length * 2 * S));
      var mn = Infinity, mx = -Infinity; for (var q = 0; q < n; q += 3) { if (T[q] < mn) mn = T[q]; if (T[q] > mx) mx = T[q]; }
      for (q = 0; q < n; q++) { var t = (T[q] - mn) / (mx - mn || 1), on = Y[q] / 255 + (p.balance - 50) / 100 < t, i = q * 4; for (var c = 0; c < 3; c++) d[i + c] = on ? fg[c] : bg[c]; }
      return img;
    } },
    spatter: { name: "Spatter", params: [["radius", "Spray radius", 0, 25, 1, 10], ["smooth", "Smoothness", 1, 15, 1, 5]], fn: function (img, p, S) {
      PIX.EXT.diffuse(img, { radius: Math.max(1, p.radius * 0.6), mode: "normal", _scale: S }, null);
      return A.planes8(img, function (s, o, w, h) { A.median8(s, o, w, h, Math.max(1, Math.round((16 - p.smooth) * 0.15 * S))); });
    } }
  };
  A.galleryDefaults = function (id) { var g = GAL[id], o = {}; if (g) g.params.forEach(function (q) { o[q[0]] = q[5]; }); return o; };
  A.reg("gallery", A.filter(function (img, p) {
    var g = GAL[p.effect] || GAL.watercolor, q = Object.assign(A.galleryDefaults(p.effect in GAL ? p.effect : "watercolor"), {}), S = clamp(num(p._scale, 1), 0.01, 1);
    g.params.forEach(function (d) { q[d[0]] = clamp(num(p[d[0]], d[5]), d[2], d[3]); });
    q.fg = p.fg; q.bg = p.bg; q.color = p.color;
    return g.fn(img, q, S) || img;
  }));
})(typeof self !== "undefined" ? self : this);
