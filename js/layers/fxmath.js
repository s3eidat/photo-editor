/* Selection lane: layer-style maths on float alpha planes (0..1). Pure functions, no DOM.
   Every effect is computed from the layer's (masked) alpha, inside a padded box around its pixels. */
(function (G) {
  "use strict";
  var FX = {}, PIX = G.PIX, PIXS = G.PIXS;
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  FX.blur = function (a, w, h, radius) { var o = Float32Array.from(a); if (radius > 0.4) PIX.blurPlane(o, w, h, radius / 2); return o; };
  FX.shift = function (a, w, h, dx, dy) {
    dx = Math.round(dx); dy = Math.round(dy);
    var o = new Float32Array(a.length);
    for (var y = 0; y < h; y++) { var sy = y - dy; if (sy < 0 || sy >= h) continue; for (var x = 0; x < w; x++) { var sx = x - dx; if (sx >= 0 && sx < w) o[y * w + x] = a[sy * w + sx]; } }
    return o;
  };
  // Distance (px) from each pixel to the nearest pixel that is at least half covered (0 inside).
  FX.distOut = function (a, w, h) { var D = PIXS.edt(w, h, function (p) { return a[p] >= 0.5; }), o = new Float32Array(a.length); for (var i = 0; i < o.length; i++) o[i] = Math.sqrt(D[i]); return o; };
  FX.distIn = function (a, w, h) { var D = PIXS.edt(w, h, function (p) { return a[p] < 0.5; }), o = new Float32Array(a.length); for (var i = 0; i < o.length; i++) o[i] = Math.sqrt(D[i]); return o; };
  // Grow the shape by r px (round), keeping soft edges.
  FX.dilate = function (a, w, h, r) {
    if (!(r > 0.25)) return a;
    var d = FX.distOut(a, w, h), o = new Float32Array(a.length);
    for (var i = 0; i < o.length; i++) o[i] = Math.max(a[i], clamp01(r + 1 - d[i]));
    return o;
  };
  FX.invert = function (a) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = 1 - a[i]; return o; };
  FX.mul = function (a, b) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] * b[i]; return o; };

  // Each returns an alpha plane (0..1) for the effect; `a` is the layer alpha.
  function offsetOf(e) { var t = (e.angle == null ? 120 : e.angle) * Math.PI / 180, d = e.dist || 0; return { dx: -Math.cos(t) * d, dy: Math.sin(t) * d }; }
  FX.offsetOf = offsetOf;
  FX.dropShadow = function (a, w, h, e) {
    var o = offsetOf(e), sp = clamp01((e.spread || 0) / 100), size = Math.max(0, e.size || 0);
    var s = FX.shift(a, w, h, o.dx, o.dy);
    s = FX.dilate(s, w, h, size * sp);
    return FX.blur(s, w, h, size * (1 - sp));
  };
  FX.outerGlow = function (a, w, h, e) {
    var sp = clamp01((e.spread || 0) / 100), size = Math.max(0, e.size || 0), g = FX.blur(FX.dilate(a, w, h, size * sp), w, h, size * (1 - sp));
    for (var i = 0; i < g.length; i++) g[i] = clamp01(g[i] * 1.6);
    return g;
  };
  FX.innerShadow = function (a, w, h, e) {
    var o = offsetOf(e), ch = clamp01((e.choke || 0) / 100), size = Math.max(0, e.size || 0);
    var inv = FX.invert(FX.shift(a, w, h, o.dx, o.dy));
    // outside the box counts as "outside the shape" so shadows also come in from the box edges
    var s = FX.blur(FX.dilate(inv, w, h, size * ch), w, h, size * (1 - ch));
    return FX.mul(s, a);
  };
  FX.innerGlow = function (a, w, h, e) {
    var ch = clamp01((e.choke || 0) / 100), size = Math.max(0, e.size || 0), g = FX.blur(FX.dilate(FX.invert(a), w, h, size * ch), w, h, size * (1 - ch));
    for (var i = 0; i < g.length; i++) { var v = clamp01(g[i] * 1.6); g[i] = (e.source === "center" ? 1 - v : v) * a[i]; }
    return g;
  };
  FX.satin = function (a, w, h, e) {
    var o = offsetOf({ angle: e.angle == null ? 19 : e.angle, dist: e.dist == null ? 11 : e.dist }), size = Math.max(0, e.size == null ? 14 : e.size);
    var s1 = FX.blur(FX.shift(a, w, h, o.dx, o.dy), w, h, size), s2 = FX.blur(FX.shift(a, w, h, -o.dx, -o.dy), w, h, size), out = new Float32Array(a.length);
    for (var i = 0; i < out.length; i++) { var v = Math.abs(s1[i] - s2[i]); out[i] = (e.invert ? 1 - v : v) * a[i]; }
    return out;
  };
  // Stroke ring: "outside", "inside" or "center" of the edge, `size` px wide, anti-aliased.
  FX.stroke = function (a, w, h, e) {
    var size = Math.max(0, e.size || 0), pos = e.pos || "outside", out = new Float32Array(a.length), i;
    var so = pos === "outside" ? size : pos === "center" ? size / 2 : 0, si = pos === "inside" ? size : pos === "center" ? size / 2 : 0;
    var dO = so > 0 ? FX.distOut(a, w, h) : null, dI = si > 0 ? FX.distIn(a, w, h) : null;
    for (i = 0; i < out.length; i++) {
      var v = 0;
      if (dO) v = Math.max(v, clamp01(so + 1 - dO[i]) * (1 - a[i]));
      if (dI) v = Math.max(v, clamp01(si + 1 - dI[i]) * a[i]);
      out[i] = v;
    }
    return out;
  };
  // Bevel & emboss: highlight and shadow planes from a soft height map lit from angle / altitude.
  FX.bevel = function (a, w, h, e) {
    var size = Math.max(1, e.size || 5), style = e.style || "inner", depth = (e.depth == null ? 100 : e.depth) / 100, up = e.dir !== "down";
    var hm = FX.blur(a, w, h, size * 1.2);
    if (style === "pillow") for (var q = 0; q < hm.length; q++) hm[q] = a[q] >= 0.5 ? hm[q] : -hm[q] * 0.8 + 0.0;
    var t = (e.angle == null ? 120 : e.angle) * Math.PI / 180, al = (e.altitude == null ? 30 : e.altitude) * Math.PI / 180;
    var Lx = Math.cos(al) * Math.cos(t), Ly = -Math.cos(al) * Math.sin(t), Lz = Math.sin(al), k = depth * size * 1.5;
    var hi = new Float32Array(a.length), sh = new Float32Array(a.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, gx = (hm[i + (x < w - 1 ? 1 : 0)] - hm[i - (x > 0 ? 1 : 0)]) / 2, gy = (hm[i + (y < h - 1 ? w : 0)] - hm[i - (y > 0 ? w : 0)]) / 2;
      var nx = -gx * k, ny = -gy * k, nl = Math.sqrt(nx * nx + ny * ny + 1), d = (nx * Lx + ny * Ly + Lz) / nl - Lz;
      if (!up) d = -d;
      var region = style === "inner" ? a[i] : style === "outer" ? 1 - a[i] : 1;
      hi[i] = clamp01(d * 2.5) * region; sh[i] = clamp01(-d * 2.5) * region;
    }
    var sf = e.soften || 0;
    return { hi: sf > 0 ? FX.blur(hi, w, h, sf) : hi, sh: sf > 0 ? FX.blur(sh, w, h, sf) : sh };
  };
  G.FXM = FX;
})(typeof self !== "undefined" ? self : this);
