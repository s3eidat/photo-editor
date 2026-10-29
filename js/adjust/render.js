/* Adjust lane: render filters (clouds, difference clouds, fibers, lens flare, lighting effects). Pure maths, page +
   worker. Patterns are laid out in full-size pixels (x / p._scale) so a reduced preview shows the same picture. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, c255 = A.c255;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }

  // ---------- value noise with smooth interpolation, fractal sum ----------
  function hash(x, y, s) { var h = (x * 374761393 + y * 668265263 + s * 144665) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, s) {
    var x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    var a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  A.vnoise = vnoise;
  // Fractal clouds 0..1 at full-size pixel position (x, y): base feature size `size` px, 8 octaves.
  A.fbm = function (x, y, size, seed, oct) {
    var f = 1 / size, amp = 0.5, s = 0, norm = 0;
    for (var o = 0; o < (oct || 8); o++) { s += vnoise(x * f, y * f, seed + o * 31) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
  function cloudsInto(img, p, diff) {
    var w = img.width, h = img.height, d = img.data, S = sc(p), fg = A.hex(p.fg, [0, 0, 0]), bg = A.hex(p.bg, [255, 255, 255]), seed = (num(p.seed, 1) | 0) * 101, size = clamp(num(p.size, 256), 8, 2048);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var v = A.fbm(x / S, y / S, size, seed), t = clamp((v - 0.5) * 1.6 + 0.5, 0, 1), i = (y * w + x) * 4;
      for (var c = 0; c < 3; c++) { var cv = fg[c] + (bg[c] - fg[c]) * t; d[i + c] = diff ? Math.abs(d[i + c] - cv) : cv; }
      if (!diff) d[i + 3] = 255;
    }
    return img;
  }
  A.reg("clouds", A.filter(function (img, p) { return cloudsInto(img, p, false); }));
  A.reg("differenceClouds", A.filter(function (img, p) { return cloudsInto(img, p, true); }));

  // ---------- fibers: vertical streaks between the two colours ----------
  A.reg("fibers", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, S = sc(p), fg = A.hex(p.fg, [0, 0, 0]), bg = A.hex(p.bg, [255, 255, 255]), seed = (num(p.seed, 1) | 0) * 77;
    var vr = clamp(num(p.variance, 16), 1, 64), st = clamp(num(p.strength, 4), 1, 64), fx = 1 / (1.5 + 18 / vr), fy = 1 / (6 + st * 18);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var X = x / S, Y = y / S, v = 0, amp = 0.55, ff = 1, norm = 0;
      for (var o = 0; o < 5; o++) { v += vnoise(X * fx * ff, Y * fy * ff, seed + o * 13) * amp; norm += amp; amp *= 0.55; ff *= 2.1; }
      v = clamp((v / norm - 0.5) * 2.2 + 0.5, 0, 1);
      var i = (y * w + x) * 4; for (var c = 0; c < 3; c++) d[i + c] = fg[c] + (bg[c] - fg[c]) * v; d[i + 3] = 255;
    }
    return img;
  }));

  // ---------- lens flare: glow, rays, halo ring and ghosts along the line through the image centre ----------
  A.reg("lensFlare", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, br = clamp(num(p.brightness, 100), 10, 300) / 100, fx = clamp(num(p.x, 30), 0, 100) / 100 * w, fy = clamp(num(p.y, 30), 0, 100) / 100 * h;
    var type = p.lens || "zoom", D = Math.sqrt(w * w + h * h), cx = w / 2, cy = h / 2, ghosts = [], R = A.rng(type === "prime" ? 5 : type === "movie" ? 9 : 3);
    var gn = type === "movie" ? 3 : type === "prime" ? 5 : 7;
    for (var k = 0; k < gn; k++) { var t = 0.35 + R() * 1.6; ghosts.push({ x: fx + (cx - fx) * t * 1.2, y: fy + (cy - fy) * t * 1.2, r: D * (0.01 + R() * 0.045), c: [0.6 + R() * 0.4, 0.5 + R() * 0.4, 0.3 + R() * 0.7], a: 0.06 + R() * 0.12 }); }
    var rays = type === "prime" ? 6 : type === "movie" ? 2 : 12, ringR = D * (type === "movie" ? 0.12 : 0.08), wide = type === "movie";
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dx = x - fx, dy = y - fy, r = Math.sqrt(dx * dx + dy * dy) / D, ang = Math.atan2(dy, dx), i = (y * w + x) * 4;
      var core = Math.exp(-r * r / 0.00012) * 1.2 + Math.exp(-r / 0.045) * 0.55 + Math.exp(-r / 0.2) * 0.12;
      var ray = Math.pow(Math.abs(Math.cos(ang * rays / 2)), 60) * Math.exp(-r / 0.12) * 0.35;
      if (wide) ray = Math.exp(-Math.pow(dy / D / 0.004, 2)) * Math.exp(-Math.abs(dx / D) / 0.35) * 0.6;
      var ring = Math.exp(-Math.pow((r * D - ringR) / (D * 0.006), 2)) * 0.12;
      var lr = core + ray + ring * 0.8, lg = core * 0.92 + ray * 0.95 + ring * 0.9, lb = core * 0.75 + ray * 0.9 + ring * 1.1;
      for (var k2 = 0; k2 < ghosts.length; k2++) {
        var g = ghosts[k2], gd = Math.sqrt((x - g.x) * (x - g.x) + (y - g.y) * (y - g.y)) / g.r;
        if (gd < 1.2) { var e = (gd < 1 ? 1 - gd * gd * 0.4 : (1.2 - gd) / 0.2 * 0.6) * g.a; lr += e * g.c[0]; lg += e * g.c[1]; lb += e * g.c[2]; }
      }
      // screen the light over the image
      var L = [lr * br * 255, lg * br * 255, lb * br * 255];
      for (var c = 0; c < 3; c++) { var v = d[i + c], l = clamp(L[c], 0, 255); d[i + c] = c255(255 - (255 - v) * (255 - l) / 255); }
    }
    return img;
  }));

  // ---------- lighting effects: one light on a bump surface (Phong) ----------
  // height from the image's luminance (or none); light: spot / point / infinite; ambient, gloss, metallic.
  A.reg("lighting", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, S = sc(p), n = w * h, q, i;
    var type = p.light || "spot", inten = clamp(num(p.intensity, 35), -100, 100) / 50, lc = A.hex(p.color, [255, 255, 255]).map(function (v) { return v / 255; });
    var lx = clamp(num(p.x, 50), -50, 150) / 100 * w, ly = clamp(num(p.y, 35), -50, 150) / 100 * h, lz = clamp(num(p.height, 50), 1, 100) / 100 * Math.max(w, h) * 0.6;
    var focus = clamp(num(p.focus, 50), 1, 100) / 100, size = clamp(num(p.size, 60), 1, 200) / 100 * Math.max(w, h), amb = clamp(num(p.ambient, 15), -100, 100) / 100;
    var gloss = clamp(num(p.gloss, 0), -100, 100) / 100, metal = clamp(num(p.metallic, 0), -100, 100) / 100, bump = clamp(num(p.bump, 30), 0, 100) / 100, ang = num(p.angle, -45) * Math.PI / 180;
    var H = bump ? A.blur(A.lumPlane(img, 1 / 255), w, h, Math.max(0.6, 1.5 * S)) : null, bk = bump * 6 / S;
    var dirx = Math.cos(ang), diry = -Math.sin(ang), shin = 4 + (gloss + 1) * 30, ks = 0.15 + (gloss + 1) * 0.35;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      q = y * w + x; i = q * 4;
      var nx = 0, ny = 0, nz = 1;
      if (H) { nx = -(H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)]) * bk; ny = -(H[Math.min(h - 1, y + 1) * w + x] - H[Math.max(0, y - 1) * w + x]) * bk; var nl = Math.sqrt(nx * nx + ny * ny + 1); nx /= nl; ny /= nl; nz = 1 / nl; }
      var Lx, Ly, Lz, att = 1;
      if (type === "infinite") { Lx = dirx * 0.7; Ly = diry * 0.7; Lz = 0.7; }
      else {
        Lx = lx - x; Ly = ly - y; Lz = lz; var dist = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz); Lx /= dist; Ly /= dist; Lz /= dist;
        var rr = Math.sqrt((x - lx) * (x - lx) + (y - ly) * (y - ly)) / size;
        att = type === "spot" ? Math.pow(Math.max(0, 1 - rr), 0.5 + focus * 3) : 1 / (1 + rr * rr * 2);
      }
      var ndl = Math.max(0, nx * Lx + ny * Ly + nz * Lz), hz = Lz + 1, hl = Math.sqrt(Lx * Lx + Ly * Ly + hz * hz), spec = Math.pow(Math.max(0, (nx * Lx + ny * Ly + nz * hz) / hl), shin) * ks * att * inten;
      for (var c = 0; c < 3; c++) {
        var alb = d[i + c] / 255, light = amb + inten * att * ndl * lc[c], sp = spec * (metal > 0 ? alb * metal + (1 - metal) : 1) * lc[c];
        d[i + c] = c255((alb * Math.max(0, light) + sp) * 255);
      }
    }
    return img;
  }));
})(typeof self !== "undefined" ? self : this);
