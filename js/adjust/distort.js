/* Adjust lane: distort filters (offset, ripple, twirl, spherize, pinch, wave, zigzag, polar coordinates, shear,
   displace). Each is an inverse map: for every output pixel, where in the source to read (bilinear, alpha-aware).
   Pure maths, page + worker. Pixel amounts scale with p._scale (reduced-size previews). */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }
  // fn(x, y, out) sets out[0], out[1] = source position (pixel centres at +0.5); edge: wrap | repeat | transparent.
  A.warp = function (img, fn, edge) {
    var w = img.width, h = img.height, src = PIX.copyImg(img), d = img.data, s = [0, 0], o = [0, 0, 0, 0], mode = edge === "wrap" ? "wrap" : edge === "transparent" ? "transparent" : "clamp";
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      s[0] = x + 0.5; s[1] = y + 0.5;
      if (fn(x + 0.5, y + 0.5, s) === false) continue;
      A.sample(src, s[0], s[1], o, mode);
      var i = (y * w + x) * 4; d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3];
    }
    return img;
  };
  // Polar helpers around the centre, radius normalised to the half short side (or each half side for "ellipse").
  function radial(img, fn, edge, ellipse) {
    var w = img.width, h = img.height, cx = w / 2, cy = h / 2, rx = ellipse ? cx : Math.min(cx, cy), ry = ellipse ? cy : Math.min(cx, cy);
    return A.warp(img, function (x, y, s) {
      var dx = (x - cx) / rx, dy = (y - cy) / ry, r = Math.sqrt(dx * dx + dy * dy);
      var o = fn(r, Math.atan2(dy, dx), dx, dy); if (!o) return false;
      s[0] = cx + o[0] * rx; s[1] = cy + o[1] * ry;
    }, edge);
  }

  A.reg("offset", A.filter(function (img, p) {
    var S = sc(p), dx = Math.round(num(p.dx, 50) * S), dy = Math.round(num(p.dy, 0) * S);
    return A.warp(img, function (x, y, s) { s[0] = x - dx; s[1] = y - dy; }, p.edge || "wrap");
  }));
  A.reg("ripple", A.filter(function (img, p) {
    var S = sc(p), amt = clamp(num(p.amount, 100), -999, 999) / 100, size = p.size === "small" ? 6 : p.size === "large" ? 26 : 13, lam = size * S, a = amt * size * 0.45 * S, R = A.rng(7), ph = [];
    for (var k = 0; k < 4; k++) ph.push(R() * 6.283);
    return A.warp(img, function (x, y, s) {
      s[0] = x + a * Math.sin(y / lam + ph[0] + 0.35 * Math.sin(y / (lam * 3.7) + ph[1]));
      s[1] = y + a * Math.sin(x / lam + ph[2] + 0.35 * Math.sin(x / (lam * 3.3) + ph[3]));
    }, "clamp");
  }));
  A.reg("twirl", A.filter(function (img, p) {
    var ang = clamp(num(p.angle, 50), -999, 999) * Math.PI / 180;
    return radial(img, function (r, t) { if (r >= 1) return false; var f = (1 - r) * (1 - r), a = t - ang * f; return [Math.cos(a) * r, Math.sin(a) * r]; }, "clamp");
  }));
  A.reg("spherize", A.filter(function (img, p) {
    var k = clamp(num(p.amount, 100), -100, 100) / 100, mode = p.mode || "normal";
    function f(rn) { return k >= 0 ? rn + (Math.asin(rn) * 2 / Math.PI - rn) * k : rn + (Math.sin(rn * Math.PI / 2) - rn) * -k; }
    if (mode !== "normal") {
      var w = img.width, h = img.height;
      return A.warp(img, function (x, y, s) {
        if (mode === "horizontal") { var u = (x - w / 2) / (w / 2); s[0] = w / 2 + Math.sign(u) * f(Math.min(1, Math.abs(u))) * w / 2; }
        else { var v = (y - h / 2) / (h / 2); s[1] = h / 2 + Math.sign(v) * f(Math.min(1, Math.abs(v))) * h / 2; }
      }, "clamp");
    }
    return radial(img, function (r, t, dx, dy) { if (r >= 1) return false; var rs = f(r), q = r > 1e-9 ? rs / r : 1; return [dx * q, dy * q]; }, "clamp", true);
  }));
  A.reg("pinch", A.filter(function (img, p) {
    var e = 1 - 0.5 * clamp(num(p.amount, 50), -100, 100) / 100;
    return radial(img, function (r, t, dx, dy) { if (r >= 1 || r < 1e-9) return false; var q = Math.pow(r, e) / r; return [dx * q, dy * q]; }, "clamp", true);
  }));
  // wave: several random sine / triangle / square waves added up, in x and in y
  A.reg("wave", A.filter(function (img, p) {
    var S = sc(p), n = clamp(Math.round(num(p.generators, 5)), 1, 99), l0 = clamp(num(p.wlMin, 10), 1, 998), l1 = Math.max(l0 + 1, clamp(num(p.wlMax, 120), 2, 999));
    var a0 = clamp(num(p.ampMin, 5), 1, 998), a1 = Math.max(a0, clamp(num(p.ampMax, 35), 1, 999)), kx = clamp(num(p.scaleX, 100), 0, 100) / 100, ky = clamp(num(p.scaleY, 100), 0, 100) / 100;
    var type = p.type || "sine", R = A.rng((num(p.seed, 1) | 0) + 11), W = [];
    for (var k = 0; k < n; k++) W.push({ l: (l0 + R() * (l1 - l0)) * S, a: (a0 + R() * (a1 - a0)) * S / n * 1.6, ph: R() * 6.283, ang: R() * 6.283 });
    function f(t) { if (type === "triangle") { var u = t / 6.2832 % 1; if (u < 0) u += 1; return u < 0.5 ? 4 * u - 1 : 3 - 4 * u; } if (type === "square") return Math.sin(t) >= 0 ? 1 : -1; return Math.sin(t); }
    return A.warp(img, function (x, y, s) {
      var dx = 0, dy = 0;
      for (var k2 = 0; k2 < W.length; k2++) { var g = W[k2], t = (x * Math.cos(g.ang) + y * Math.sin(g.ang)) / g.l * 6.2832 + g.ph; dx += g.a * f(t); dy += g.a * f(t + 1.7); }
      s[0] = x + dx * kx; s[1] = y + dy * ky;
    }, p.edge === "wrap" ? "wrap" : "clamp");
  }));
  A.reg("zigzag", A.filter(function (img, p) {
    var k = clamp(num(p.amount, 10), -100, 100) / 100, ridges = clamp(num(p.ridges, 5), 1, 20), style = p.style || "pond";
    return radial(img, function (r, t, dx, dy) {
      if (r >= 1) return false;
      var wv = Math.sin(r * ridges * Math.PI * 2) * (1 - r), a = t, rr = r;
      if (style === "around") a = t + k * wv * 1.2;
      else if (style === "out") rr = r + k * wv * 0.15;
      else { rr = r + k * wv * 0.12; a = t + k * wv * 0.35; }
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    }, "clamp");
  }));
  A.reg("polar", A.filter(function (img, p) {
    var w = img.width, h = img.height, cx = w / 2, cy = h / 2, toPolar = p.mode !== "toRect";
    return A.warp(img, function (x, y, s) {
      if (toPolar) {      // output is polar: angle -> source x, radius -> source y
        var dx = (x - cx) / cx, dy = (y - cy) / cy, r = Math.sqrt(dx * dx + dy * dy), t = Math.atan2(dx, -dy);
        s[0] = ((t / (2 * Math.PI) + 1) % 1) * w; s[1] = Math.min(r, 1) * (h - 0.5);
      } else {
        var ang = x / w * 2 * Math.PI, rad = y / h;
        s[0] = cx + Math.sin(ang) * rad * cx; s[1] = cy - Math.cos(ang) * rad * cy;
      }
    }, "clamp");
  }));
  // shear: each row moves sideways by an amount drawn from a smooth curve through top / middle / bottom offsets
  A.reg("shear", A.filter(function (img, p) {
    var w = img.width, h = img.height, t0 = num(p.top, 20) / 100 * w, m0 = num(p.middle, 0) / 100 * w, b0 = num(p.bottom, -20) / 100 * w;
    return A.warp(img, function (x, y, s) {
      var u = y / h, off = t0 * (1 - u) * (1 - 2 * u) + m0 * 4 * u * (1 - u) + b0 * u * (2 * u - 1);   // quadratic through the three points
      s[0] = x - off;
    }, p.edge === "repeat" ? "clamp" : "wrap");
  }));
  // displace: p.map = {w, h, b64 of R,G bytes}; red moves pixels sideways, green up and down; 128 = no move.
  A.reg("displace", A.filter(function (img, p) {
    if (!p.map || !p.map.b64) return img;
    var w = img.width, h = img.height, S = sc(p), m = A.b64(p.map.b64), mw = p.map.w | 0, mh = p.map.h | 0, tile = p.fit === "tile";
    if (m.length < mw * mh * 2 || mw < 1 || mh < 1) return img;
    var hx = clamp(num(p.hScale, 10), -999, 999) * S, vy = clamp(num(p.vScale, 10), -999, 999) * S, R = new Float32Array(mw * mh), Gm = new Float32Array(mw * mh);
    for (var q = 0; q < mw * mh; q++) { R[q] = m[q * 2]; Gm[q] = m[q * 2 + 1]; }
    return A.warp(img, function (x, y, s) {
      var u, v;
      if (tile) { var ts = Math.max(1, (p.map.tileScale || 1) * S); u = ((x / ts) % mw + mw) % mw; v = ((y / ts) % mh + mh) % mh; }
      else { u = x / w * mw; v = y / h * mh; }
      var dr = A.bilin(R, mw, mh, u - 0.5, v - 0.5), dg = A.bilin(Gm, mw, mh, u - 0.5, v - 0.5);
      s[0] = x + (dr - 128) / 128 * hx; s[1] = y + (dg - 128) / 128 * vy;
    }, p.edge === "wrap" ? "wrap" : "clamp");
  }));

  // ---------- lens correction: scale, rotation, perspective, barrel / pincushion, colour fringes, vignette ----------
  A.reg("lensCorrection", A.filter(function (img, p) {
    var w = img.width, h = img.height, d = img.data, src = PIX.copyImg(img), cx = w / 2, cy = h / 2, R = Math.sqrt(cx * cx + cy * cy) || 1;
    var k = -clamp(num(p.distort, 0), -100, 100) / 100 * 0.35, sR = 1 + clamp(num(p.caRed, 0), -100, 100) / 100 * 0.006, sB = 1 + clamp(num(p.caBlue, 0), -100, 100) / 100 * 0.006;
    var pv = clamp(num(p.vertical, 0), -100, 100) / 100 * 0.6, ph = clamp(num(p.horizontal, 0), -100, 100) / 100 * 0.6, ang = -num(p.angle, 0) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    var scl = clamp(num(p.scale, 100), 25, 400) / 100, va = clamp(num(p.vignette, 0), -100, 100) / 100, vm = clamp(num(p.vigMid, 50), 0, 100) / 100, edge = p.edge || "transparent";
    var fill = A.hex(p.fillColor, [255, 255, 255]), o = [0, 0, 0, 0], mode = edge === "extend" ? "clamp" : "transparent";
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var u = (x + 0.5 - cx) / R / scl, v = (y + 0.5 - cy) / R / scl, uu = u * ca - v * sa, vv = u * sa + v * ca;
      var den = 1 + ph * uu + pv * vv; if (den < 0.05) den = 0.05;
      uu /= den; vv /= den;
      var r2 = uu * uu + vv * vv, f = 1 + k * r2, i = (y * w + x) * 4, X = cx + uu * f * R, Y = cy + vv * f * R;
      A.sample(src, X, Y, o, mode); var gg = o[1], aa = o[3], rr = o[0], bb = o[2];
      if (sR !== 1) { A.sample(src, cx + uu * f * sR * R, cy + vv * f * sR * R, o, mode); rr = o[0]; }
      if (sB !== 1) { A.sample(src, cx + uu * f * sB * R, cy + vv * f * sB * R, o, mode); bb = o[2]; }
      if (edge === "color" && aa < 255) { var t = aa / 255; rr = rr * t + fill[0] * (1 - t); gg = gg * t + fill[1] * (1 - t); bb = bb * t + fill[2] * (1 - t); aa = 255; }
      if (va) {
        var dx = (x + 0.5 - cx) / cx, dy = (y + 0.5 - cy) / cy, rn = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2, vf = A.smooth(0.15 + vm * 0.7, 1.15, rn);
        if (va < 0) { var kv = 1 + va * vf; rr *= kv; gg *= kv; bb *= kv; } else { rr += (255 - rr) * va * vf; gg += (255 - gg) * va * vf; bb += (255 - bb) * va * vf; }
      }
      d[i] = rr; d[i + 1] = gg; d[i + 2] = bb; d[i + 3] = aa;
    }
    return img;
  }));

  // ---------- wide-angle correction ----------
  // fisheye (equidistant) -> rectilinear; 360° equirectangular panorama -> a rectilinear view (yaw, pitch, roll, field
  // of view); rectilinear wide shot -> Pannini-style view that keeps verticals straight and squeezes stretched edges.
  A.reg("wideAngle", A.filter(function (img, p) {
    var w = img.width, h = img.height, cx = w / 2, cy = h / 2, D = Math.sqrt(cx * cx + cy * cy), type = p.type || "fisheye", DEG = Math.PI / 180;
    var fovIn = clamp(num(p.fovIn, 180), 60, 360) * DEG, fovOut = clamp(num(p.fovOut, 100), 20, 170) * DEG, scl = clamp(num(p.scale, 100), 25, 400) / 100;
    if (type === "spherical") {
      var yaw = num(p.yaw, 0) * DEG, pitch = num(p.pitch, 0) * DEG, roll = num(p.roll, 0) * DEG, fo = Math.tan(fovOut / 2), cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      return A.warp(img, function (x, y, s) {
        var u = (x - cx) / cx * fo / scl, v = (y - cy) / cx * fo / scl, ru = u * cr - v * sr, rv = u * sr + v * cr;
        var X = ru, Y = rv, Z = 1, y2 = Y * cp - Z * sp, z2 = Y * sp + Z * cp, x3 = X * cyw + z2 * syw, z3 = -X * syw + z2 * cyw;
        var lon = Math.atan2(x3, z3), lat = Math.atan2(y2, Math.sqrt(x3 * x3 + z3 * z3));
        s[0] = ((lon / (2 * Math.PI) + 0.5) % 1 + 1) % 1 * w; s[1] = (lat / Math.PI + 0.5) * h;
      }, "clamp");
    }
    if (type === "pannini") {
      var dP = clamp(num(p.pannini, 100), 0, 200) / 100, half = fovOut / 2, sMax = (dP + 1) * Math.sin(half) / (dP + Math.cos(half)), fl = cx / Math.tan(half);
      return A.warp(img, function (x, y, s) {
        var X = (x - cx) / cx * sMax / scl, Y = (y - cy) / cx * sMax / scl;      // Pannini plane -> angle, then rectilinear
        var k = X * X / ((dP + 1) * (dP + 1)), dsc = k * k * dP * dP - (k + 1) * (k * dP * dP - 1), ct = (-k * dP + Math.sqrt(Math.max(0, dsc))) / (k + 1), S = (dP + 1) / (dP + ct);
        var phi = Math.atan2(X / S, ct), tl = Y / S;
        if (Math.abs(phi) >= Math.PI / 2 - 0.01) return false;
        s[0] = cx + fl * Math.tan(phi); s[1] = cy + fl * tl / Math.cos(phi);
      }, p.edge === "transparent" ? "transparent" : "clamp");
    }
    // fisheye: equidistant r_in = f_in * theta (f_in from the lens field of view over the image diagonal)
    var fIn = D / (fovIn / 2), fOut = D / Math.tan(Math.min(fovOut, 179 * DEG) / 2);
    return A.warp(img, function (x, y, s) {
      var dx = (x - cx) / scl, dy = (y - cy) / scl, r = Math.sqrt(dx * dx + dy * dy); if (r < 1e-6) return;
      var th = Math.atan(r / fOut), rin = fIn * th; s[0] = cx + dx / r * rin; s[1] = cy + dy / r * rin;
    }, p.edge === "transparent" ? "transparent" : "clamp");
  }));
})(typeof self !== "undefined" ? self : this);
