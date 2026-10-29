/* Adjust lane: more filter-gallery effects (made for this app): artistic, brush strokes, distort, sketch, texture.
   Same format as gallery.js: A.GALLERY[id] = {name, cat, params, fn(img, p, S)}. Pure maths, page + worker. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, c255 = A.c255, smooth = A.smooth, GAL = A.GALLERY;
  function noise(n, seed) { var R = A.rng(seed), t = new Float32Array(n); for (var q = 0; q < n; q++) t[q] = R(); return t; }
  function norm(t) { var mn = Infinity, mx = -Infinity, q; for (q = 0; q < t.length; q += 3) { if (t[q] < mn) mn = t[q]; if (t[q] > mx) mx = t[q]; } var s = mx - mn || 1; for (q = 0; q < t.length; q++) t[q] = clamp((t[q] - mn) / s, 0, 1); return t; }
  function edges(Y, w, h) { var g = A.sobel(Y, w, h), m = new Float32Array(Y.length); for (var q = 0; q < m.length; q++) m[q] = Math.sqrt(g.gx[q] * g.gx[q] + g.gy[q] * g.gy[q]); return m; }
  function relief(img, H, k, ang) {      // light a height plane over the image
    var w = img.width, h = img.height, d = img.data, lx = Math.cos(ang), ly = -Math.sin(ang);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var q = y * w + x, i = q * 4, hx = H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)], hy = H[Math.min(h - 1, y + 1) * w + x] - H[Math.max(0, y - 1) * w + x], v = (hx * lx + hy * ly) * k;
      d[i] = c255(d[i] + v); d[i + 1] = c255(d[i + 1] + v); d[i + 2] = c255(d[i + 2] + v);
    }
    return img;
  }
  function twoTone(img, t, fg, bg) { var d = img.data; for (var q = 0, i = 0; q < t.length; q++, i += 4) for (var c = 0; c < 3; c++) d[i + c] = fg[c] + (bg[c] - fg[c]) * t[q]; return img; }
  function fgbg(p) { return [A.hex(p.fg, [0, 0, 0]), A.hex(p.bg, [255, 255, 255])]; }
  function warpBy(img, U, V, amt) { var w = img.width; return A.warp(img, function (x, y, s) { var q = Math.floor(y) * w + Math.floor(x); s[0] = x + (U[q] - 0.5) * amt; s[1] = y + (V[q] - 0.5) * amt; }, "clamp"); }
  function add(id, name, cat, params, fn) { GAL[id] = { name: name, cat: cat, params: params, fn: fn }; }
  Object.keys(GAL).forEach(function (k) { GAL[k].cat = GAL[k].cat || ({ pencil: "sketch", colorPencil: "artistic", charcoal: "sketch", ink: "brush", graphicPen: "sketch", canvas: "texture", stainedGlass: "texture", spatter: "brush", neon: "artistic", comic: "artistic", gloss: "artistic", posterEdges: "artistic", cutout: "artistic", dryBrush: "artistic", watercolor: "artistic" })[k] || "artistic"; });

  // ----- artistic -----
  add("fresco", "Fresco", "artistic", [["size", "Brush size", 0, 10, 1, 2], ["detail", "Brush detail", 0, 10, 1, 8], ["texture", "Texture", 1, 3, 1, 1]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h;
    A.kuwahara(img, Math.max(2, (2 + p.size) * S));
    var Y = A.lumPlane(img), E = edges(A.blur(new Float32Array(Y), w, h, Math.max(0.6, S)), w, h), T = A.blur(noise(n, 71), w, h, Math.max(0.6, 1.2 * S));
    for (var q = 0, i = 0; q < n; q++, i += 4) for (var c = 0; c < 3; c++) { var v = d[i + c] / 255; v = v + (v * v * (3 - 2 * v) - v) * 1.1; d[i + c] = c255(v * 255 - E[q] * 0.1 * (11 - p.detail) * 0.3 - (T[q] - 0.5) * 18 * p.texture); }
    return img;
  });
  add("paintDaubs", "Paint daubs", "artistic", [["size", "Brush size", 1, 50, 1, 8], ["sharp", "Sharpness", 0, 40, 1, 7]], function (img, p, S) {
    var r = Math.max(1, Math.round(p.size * 0.35 * S));
    A.planes8(img, function (s, o, w, h) { A.median8(s, o, w, h, r); });
    return PIX.unsharp(img, p.sharp * 12, Math.max(0.6, r * 0.8), 0);
  });
  add("paletteKnife", "Palette knife", "artistic", [["size", "Stroke size", 1, 50, 1, 25], ["soft", "Softness", 0, 10, 1, 0]], function (img, p, S) {
    var r = Math.max(2, p.size * 0.4 * S); A.kuwahara(img, r); A.kuwahara(img, r * 0.7);
    return p.soft ? PIX.gaussian(img, p.soft * 0.4 * S) : img;
  });
  add("roughPastels", "Rough pastels", "artistic", [["length", "Stroke length", 0, 40, 1, 6], ["detail", "Stroke detail", 1, 20, 1, 4], ["relief", "Texture relief", 0, 50, 1, 20]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h; A.kuwahara(img, Math.max(2, (22 - p.detail) * 0.25 * S));
    var T = norm(A.lineBlur(noise(n, 73), w, h, 45, Math.max(1, (2 + p.length) * S)));
    for (var q = 0, i = 0; q < n; q++, i += 4) for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] + (T[q] - 0.5) * 70);
    return relief(img, A.blur(noise(n, 79), w, h, Math.max(0.6, 1.5 * S)), p.relief * 1.2, Math.PI * 0.75);
  });
  add("smudge", "Smudge stick", "artistic", [["length", "Stroke length", 0, 10, 1, 2], ["hi", "Highlight area", 0, 20, 1, 0], ["intensity", "Intensity", 0, 10, 1, 10]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, pl = [0, 1, 2].map(function (c) { var a = new Float32Array(n); for (var q = 0; q < n; q++) a[q] = d[q * 4 + c]; return A.lineBlur(a, w, h, -45, Math.max(1, (2 + p.length * 2) * S)); });
    for (var q = 0, i = 0; q < n; q++, i += 4) { var y = (pl[0][q] * 0.3 + pl[1][q] * 0.59 + pl[2][q] * 0.11) / 255, hb = smooth(1 - p.hi * 0.03 - 0.1, 1, y) * p.intensity * 9; for (var c = 0; c < 3; c++) d[i + c] = c255(pl[c][q] + hb); }
    return img;
  });
  add("sponge", "Sponge", "artistic", [["size", "Brush size", 0, 10, 1, 2], ["definition", "Definition", 0, 25, 1, 12], ["smooth", "Smoothness", 1, 15, 1, 5]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h; A.kuwahara(img, Math.max(2, (1 + p.size) * S));
    var T = norm(A.blur(noise(n, 83), w, h, Math.max(0.6, (0.6 + p.smooth * 0.25) * S)));
    for (var q = 0, i = 0; q < n; q++, i += 4) { var k = smooth(0.35, 0.75, T[q]) * p.definition * 2.2; for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] - k); }
    return img;
  });
  add("underpainting", "Underpainting", "artistic", [["size", "Brush size", 0, 40, 1, 6], ["coverage", "Texture coverage", 0, 40, 1, 16]], function (img, p, S) {
    var w = img.width, h = img.height; PIX.gaussian(img, (1 + p.size * 0.3) * S); A.kuwahara(img, Math.max(2, (2 + p.size * 0.3) * S));
    GAL.canvas.fn(img, { scale: 100, relief: p.coverage * 0.4 }, S);
    return relief(img, A.blur(noise(w * h, 89), w, h, Math.max(0.6, S)), p.coverage * 0.5, 2.3);
  });
  add("filmGrain", "Film grain", "artistic", [["grain", "Grain", 0, 20, 1, 4], ["hi", "Highlight area", 0, 20, 1, 0], ["intensity", "Intensity", 0, 10, 1, 10]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, T = A.blur(noise(n, 97), w, h, Math.max(0.3, 0.5 * S));
    for (var q = 0, i = 0; q < n; q++, i += 4) { var y = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, g = (T[q] - 0.5) * p.grain * 9, hb = smooth(1 - p.hi * 0.035 - 0.05, 1, y) * p.intensity * 6; for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] + g + hb); }
    return img;
  });

  // ----- brush strokes -----
  add("accentedEdges", "Accented edges", "brush", [["width", "Edge width", 1, 14, 1, 2], ["bright", "Edge brightness", 0, 50, 1, 38], ["smooth", "Smoothness", 1, 15, 1, 5]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, Y = A.blur(A.lumPlane(img), w, h, Math.max(0.5, p.smooth * 0.3 * S)), E = A.blur(edges(Y, w, h), w, h, Math.max(0.5, p.width * 0.5 * S));
    for (var q = 0, i = 0; q < n; q++, i += 4) { var k = clamp(E[q] / 120, 0, 1), t = (p.bright - 25) * 8 * k; for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] + t); }
    return img;
  });
  add("angledStrokes", "Angled strokes", "brush", [["balance", "Direction balance", 0, 100, 1, 50], ["length", "Stroke length", 3, 50, 1, 15], ["sharp", "Sharpness", 0, 10, 1, 3]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, L = Math.max(2, p.length * S), Y = A.lumPlane(img, 1 / 255);
    var a = [0, 1, 2].map(function (c) { var t = new Float32Array(n); for (var q = 0; q < n; q++) t[q] = d[q * 4 + c]; return t; });
    var b1 = a.map(function (t) { return A.lineBlur(new Float32Array(t), w, h, 45, L); }), b2 = a.map(function (t) { return A.lineBlur(new Float32Array(t), w, h, -45, L); });
    for (var q = 0, i = 0; q < n; q++, i += 4) { var k = smooth(0.3, 0.7, Y[q] + (p.balance - 50) / 100); for (var c = 0; c < 3; c++) { var v = b1[c][q] * (1 - k) + b2[c][q] * k; d[i + c] = c255(v + (a[c][q] - v) * p.sharp * 0.08); } }
    return img;
  });
  add("crosshatch", "Crosshatch", "brush", [["length", "Stroke length", 3, 50, 1, 9], ["sharp", "Sharpness", 0, 20, 1, 6], ["strength", "Strength", 1, 3, 1, 1]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, L = Math.max(2, p.length * S), t1 = norm(A.lineBlur(noise(n, 101), w, h, 45, L)), t2 = norm(A.lineBlur(noise(n, 103), w, h, -45, L));
    for (var q = 0, i = 0; q < n; q++, i += 4) { var y = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, hv = (y < t1[q] ? 1 : 0) + (y < t2[q] * 0.8 ? 1 : 0), k = 1 - hv * 0.12 * p.strength * (0.5 + p.sharp * 0.05); for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] * k); }
    return img;
  });
  add("darkStrokes", "Dark strokes", "brush", [["balance", "Balance", 0, 10, 1, 5], ["black", "Black intensity", 0, 10, 1, 6], ["white", "White intensity", 0, 10, 1, 2]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, a = [0, 1, 2].map(function (c) { var t = new Float32Array(n); for (var q = 0; q < n; q++) t[q] = d[q * 4 + c]; return t; });
    var s1 = a.map(function (t) { return A.lineBlur(new Float32Array(t), w, h, 45, Math.max(2, 4 * S)); }), s2 = a.map(function (t) { return A.lineBlur(new Float32Array(t), w, h, -45, Math.max(2, 12 * S)); });
    for (var q = 0, i = 0; q < n; q++, i += 4) { var y = (a[0][q] * 0.3 + a[1][q] * 0.59 + a[2][q] * 0.11) / 255, dark = y < 0.35 + (p.balance - 5) * 0.04; for (var c = 0; c < 3; c++) d[i + c] = dark ? c255(s1[c][q] * (1 - p.black * 0.07)) : c255(s2[c][q] + (255 - s2[c][q]) * p.white * 0.04); }
    return img;
  });
  add("sumi", "Ink wash", "brush", [["width", "Stroke width", 3, 15, 1, 10], ["pressure", "Stroke pressure", 0, 15, 1, 2], ["contrast", "Contrast", 0, 40, 1, 16]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, Y = A.blur(A.lumPlane(img), w, h, Math.max(0.6, p.width * 0.25 * S)), E = edges(Y, w, h), paper = [248, 244, 234];
    for (var q = 0, i = 0; q < n; q++, i += 4) {
      var v = Math.pow(Y[q] / 255, 0.55); v = 0.5 + (v - 0.5) * (1 + p.contrast * 0.06); v -= E[q] / 255 * (0.3 + p.pressure * 0.05);
      var k = clamp(v, 0, 1), ink = 1 - k;
      for (var c = 0; c < 3; c++) d[i + c] = c255(paper[c] * (1 - ink * 0.92) + d[i + c] * 0.08 * ink);
    }
    return img;
  });
  add("sprayedStrokes", "Sprayed strokes", "brush", [["length", "Stroke length", 0, 20, 1, 12], ["radius", "Spray radius", 0, 25, 1, 7]], function (img, p, S) {
    var w = img.width, h = img.height, U = A.lineBlur(noise(w * h, 107), w, h, 45, Math.max(1, (1 + p.length) * S)), V = A.lineBlur(noise(w * h, 109), w, h, 45, Math.max(1, (1 + p.length) * S));
    norm(U); norm(V); return warpBy(img, U, V, p.radius * 2.5 * S);
  });

  // ----- distort -----
  add("diffuseGlow", "Diffuse glow", "distort", [["grain", "Graininess", 0, 10, 1, 6], ["glow", "Glow amount", 0, 20, 1, 10], ["clear", "Clear amount", 0, 20, 1, 15]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, bg = A.hex(p.bg, [255, 255, 255]), T = noise(n, 113);
    for (var q = 0, i = 0; q < n; q++, i += 4) { var y = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, k = smooth(p.clear / 20 * 0.8, 1, y) * p.glow / 20 * (1 - p.grain * 0.07 + T[q] * p.grain * 0.14); for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] + (bg[c] - d[i + c]) * clamp(k, 0, 1)); }
    return img;
  });
  add("glass", "Glass", "distort", [["distortion", "Distortion", 0, 20, 1, 5], ["smooth", "Smoothness", 1, 15, 1, 3], ["scale", "Scaling", 50, 200, 1, 100]], function (img, p, S) {
    var w = img.width, h = img.height, k = p.scale / 100 * S, sz = (3 + p.smooth * 1.5) * k * 4, U = new Float32Array(w * h), V = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { U[y * w + x] = A.vnoise(x / sz, y / sz, 5); V[y * w + x] = A.vnoise(x / sz, y / sz, 9); }
    return warpBy(img, U, V, p.distortion * 4 * S);
  });
  add("oceanRipple", "Ocean ripple", "distort", [["size", "Ripple size", 1, 15, 1, 9], ["magnitude", "Ripple magnitude", 0, 20, 1, 9]], function (img, p, S) {
    var w = img.width, h = img.height, sz = (1 + p.size) * 1.2 * S, U = new Float32Array(w * h), V = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var nx = x / sz, ny = y / sz; U[y * w + x] = 0.5 + 0.5 * Math.sin(nx + A.vnoise(nx * 0.3, ny * 0.3, 3) * 6); V[y * w + x] = 0.5 + 0.5 * Math.sin(ny + A.vnoise(nx * 0.3, ny * 0.3, 7) * 6); }
    return warpBy(img, U, V, p.magnitude * 1.6 * S);
  });

  // ----- sketch (foreground / background colours) -----
  add("basRelief", "Bas relief", "sketch", [["detail", "Detail", 1, 15, 1, 13], ["smooth", "Smoothness", 1, 15, 1, 3]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, Y = A.blur(A.lumPlane(img), w, h, Math.max(0.5, (p.smooth + 15 - p.detail) * 0.2 * S)), C = fgbg(p), t = new Float32Array(n);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var q = y * w + x; t[q] = clamp(0.5 + (Y[Math.min(h - 1, y + 1) * w + x] - Y[Math.max(0, y - 1) * w + x] + Y[y * w + Math.min(w - 1, x + 1)] - Y[y * w + Math.max(0, x - 1)]) * 0.012 * p.detail, 0, 1); }
    return twoTone(img, t, C[0], C[1]);
  });
  add("chalkCharcoal", "Chalk and charcoal", "sketch", [["charcoal", "Charcoal area", 0, 20, 1, 6], ["chalk", "Chalk area", 0, 20, 1, 6], ["pressure", "Stroke pressure", 0, 5, 1, 1]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, Y = A.lumPlane(img, 1 / 255), C = fgbg(p), T = norm(A.lineBlur(noise(n, 127), w, h, 45, Math.max(2, 6 * S)));
    for (var q = 0, i = 0; q < n; q++, i += 4) {
      var y = Y[q], ch = y < 0.4 + p.charcoal * 0.02 && T[q] > 0.5 - p.pressure * 0.08, wh = y > 0.6 - p.chalk * 0.02 && T[q] < 0.5 + p.pressure * 0.08, g = 128;
      for (var c = 0; c < 3; c++) d[i + c] = ch ? C[0][c] : wh ? C[1][c] : g;
    }
    return img;
  });
  add("chrome", "Chrome", "sketch", [["detail", "Detail", 0, 10, 1, 4], ["smooth", "Smoothness", 0, 10, 1, 7]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, Y = A.blur(A.lumPlane(img, 1 / 255), w, h, Math.max(0.6, (1 + p.smooth) * S));
    for (var q = 0, i = 0; q < Y.length; q++, i += 4) { var v = c255(128 + 127 * Math.sin(Y[q] * Math.PI * (2 + p.detail * 0.6))); d[i] = d[i + 1] = d[i + 2] = v; }
    return img;
  });
  add("photocopy", "Photocopy", "sketch", [["detail", "Detail", 1, 24, 1, 7], ["dark", "Darkness", 1, 50, 1, 8]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, Y = A.lumPlane(img), B = A.blur(new Float32Array(Y), w, h, Math.max(0.8, p.detail * 0.6 * S)), C = fgbg(p), t = new Float32Array(n);
    for (var q = 0; q < n; q++) t[q] = smooth(-p.dark * 0.6, 2, Y[q] - B[q] + 4);
    return twoTone(img, t, C[0], C[1]);
  });
  add("plaster", "Plaster", "sketch", [["balance", "Image balance", 0, 50, 1, 20], ["smooth", "Smoothness", 1, 15, 1, 2]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, Y = A.blur(A.lumPlane(img, 1 / 255), w, h, Math.max(0.6, p.smooth * 0.8 * S)), C = fgbg(p), t = new Float32Array(n);
    for (var q = 0; q < n; q++) t[q] = smooth(p.balance / 50 - 0.08, p.balance / 50 + 0.08, Y[q]);
    twoTone(img, t, C[0], C[1]);
    return relief(img, A.blur(t, w, h, Math.max(0.6, 1.5 * S)), 160, Math.PI * 0.75);
  });
  add("reticulation", "Reticulation", "sketch", [["density", "Density", 0, 50, 1, 12], ["fore", "Foreground level", 0, 50, 1, 40], ["back", "Background level", 0, 50, 1, 5]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, Y = A.lumPlane(img, 1 / 255), T = norm(A.blur(noise(n, 131), w, h, Math.max(0.5, 0.9 * S))), C = fgbg(p), t = new Float32Array(n);
    for (var q = 0; q < n; q++) t[q] = Y[q] + (T[q] - 0.5) * (0.3 + p.density * 0.02) > 0.5 + (p.fore - p.back) * 0.008 ? 1 : 0;
    return twoTone(img, t, C[0], C[1]);
  });
  add("stamp", "Stamp", "sketch", [["balance", "Light/dark balance", 0, 50, 1, 25], ["smooth", "Smoothness", 1, 50, 1, 5]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, Y = A.blur(A.lumPlane(img, 1 / 255), w, h, Math.max(0.6, p.smooth * 0.4 * S)), C = fgbg(p), t = new Float32Array(n);
    for (var q = 0; q < n; q++) t[q] = smooth(p.balance / 50 - 0.03, p.balance / 50 + 0.03, Y[q]);
    return twoTone(img, t, C[0], C[1]);
  });
  add("tornEdges", "Torn edges", "sketch", [["balance", "Image balance", 0, 50, 1, 25], ["smooth", "Smoothness", 1, 15, 1, 11], ["contrast", "Contrast", 1, 25, 1, 17]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, Y = A.blur(A.lumPlane(img, 1 / 255), w, h, Math.max(0.6, p.smooth * 0.3 * S)), T = A.blur(noise(n, 137), w, h, Math.max(0.5, 0.7 * S)), C = fgbg(p), t = new Float32Array(n), k = 0.12 - p.contrast * 0.004;
    for (var q = 0; q < n; q++) { var v = Y[q] + (T[q] - 0.5) * 0.35; t[q] = smooth(p.balance / 50 - k, p.balance / 50 + k, v); }
    return twoTone(img, t, C[0], C[1]);
  });

  // ----- texture -----
  add("craquelure", "Craquelure", "texture", [["spacing", "Crack spacing", 2, 100, 1, 15], ["depth", "Crack depth", 0, 10, 1, 6], ["bright", "Crack brightness", 0, 10, 1, 9]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, s = Math.max(3, p.spacing * 1.2 * S), GWd = Math.ceil(w / s) + 2, R = A.rng(139), sx = [], sy = [], H = new Float32Array(n);
    for (var gy = 0; gy < Math.ceil(h / s) + 2; gy++) for (var gx = 0; gx < GWd; gx++) { sx.push((gx - 1 + 0.15 + R() * 0.7) * s); sy.push((gy - 1 + 0.15 + R() * 0.7) * s); }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var cx = Math.floor(x / s) + 1, cy = Math.floor(y / s) + 1, d1 = 1e9, d2 = 1e9;
      for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) { var k = (cy + j) * GWd + cx + i; if (k < 0 || k >= sx.length) continue; var dd = Math.hypot(sx[k] - x, sy[k] - y); if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd; }
      H[y * w + x] = smooth(0, 2.5 * S + 0.5, d2 - d1);
    }
    var d = img.data; for (var q = 0, ii = 0; q < n; q++, ii += 4) for (var c = 0; c < 3; c++) d[ii + c] = c255(d[ii + c] * (1 - (1 - H[q]) * p.depth * 0.06) + (1 - H[q]) * (p.bright - 5) * 3);
    return relief(img, H, p.depth * 10, Math.PI * 0.75);
  });
  add("mosaicTiles", "Mosaic tiles", "texture", [["size", "Tile size", 2, 100, 1, 12], ["grout", "Grout width", 1, 15, 1, 3], ["lighten", "Lighten grout", 0, 10, 1, 9]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, s = Math.max(3, p.size * S), gw = Math.max(1, p.grout * 0.5 * S);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var u = x % s, v = y % s, i = (y * w + x) * 4, inG = u < gw || v < gw, edge = Math.min(u - gw, v - gw, s - u, s - v);
      if (inG) { for (var c = 0; c < 3; c++) d[i + c] = c255(d[i + c] * 0.5 + p.lighten * 12); }
      else { var sh = edge < 1.5 ? (u < s / 2 || v < s / 2 ? 18 : -18) : 0; for (var c2 = 0; c2 < 3; c2++) d[i + c2] = c255(d[i + c2] + sh); }
    }
    return img;
  });
  add("patchwork", "Patchwork", "texture", [["size", "Square size", 1, 10, 1, 4], ["relief", "Relief", 0, 25, 1, 8]], function (img, p, S) {
    var w = img.width, h = img.height, n = w * h, s = Math.max(2, Math.round((2 + p.size * 2) * S)), R = A.rng(149), H = new Float32Array(n), q;
    PIX.pixelate(img, s);
    var d = img.data, hts = {};
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var key = Math.floor(y / s) * 9973 + Math.floor(x / s); if (hts[key] == null) hts[key] = R(); q = y * w + x; H[q] = (d[q * 4] * 0.3 + d[q * 4 + 1] * 0.59 + d[q * 4 + 2] * 0.11) / 255 * 0.7 + hts[key] * 0.3; }
    return relief(img, H, p.relief * 12, Math.PI * 0.75);
  });
  add("grain", "Grain", "texture", [["intensity", "Intensity", 0, 100, 1, 40], ["contrast", "Contrast", 0, 100, 1, 50]], function (img, p, S) {
    var w = img.width, h = img.height, d = img.data, n = w * h, T = norm(A.blur(noise(n, 151), w, h, Math.max(0.3, 0.6 * S)));
    for (var q = 0, i = 0; q < n; q++, i += 4) for (var c = 0; c < 3; c++) { var v = d[i + c] + (T[q] - 0.5) * p.intensity * 1.6; d[i + c] = c255(128 + (v - 128) * (0.5 + p.contrast / 100)); }
    return img;
  });
})(typeof self !== "undefined" ? self : this);
