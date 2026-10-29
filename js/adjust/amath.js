/* Adjust lane: shared pixel helpers for the extra adjustments and filters in js/adjust/*.js.
   Pure maths, no DOM: the same files run in the page and in the Web Worker (js/worker.js imports them).
   Every op is registered as PIX.EXT[name] = function (img, p, sel) and reached through PIX.adjust(img, name, p, sel). */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A = PIX.A || {};
  PIX.EXT = PIX.EXT || {};
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function c255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }
  A.clamp = clamp; A.c255 = c255; A.num = num;

  // Per-pixel colour op honouring a soft selection. fn(r, g, b, out, i) works on 0..255 floats, writes out[0..2].
  A.perPixel = function (img, sel, fn) {
    var d = img.data, n = d.length, o = [0, 0, 0];
    for (var i = 0, p = 0; i < n; i += 4, p++) {
      if (sel && !sel[p]) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      fn(r, g, b, o, i);
      if (sel && sel[p] < 255) { var k = sel[p] / 255; o[0] = r + (o[0] - r) * k; o[1] = g + (o[1] - g) * k; o[2] = b + (o[2] - b) * k; }
      d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
    }
    return img;
  };
  // A filter that works on the whole image, then is mixed back into the selection.
  A.filter = function (fn) {
    return function (img, p, sel) {
      var before = sel ? PIX.copyImg(img) : null;
      var out = fn(img, p || {}, sel) || img;
      if (out !== img) { img.data.set(out.data); }
      return before ? PIX.mixSel(before, img, sel) : img;
    };
  };
  A.reg = function (name, fn) { PIX.EXT[name] = fn; return fn; };

  // Luminance (Rec. 601 like the rest of the app) of a 0..255 triple.
  A.lum = function (r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; };

  // ---------- planes ----------
  A.lumPlane = function (img, scale) {
    var d = img.data, n = img.width * img.height, L = new Float32Array(n), k = scale || 1;
    for (var p = 0, i = 0; p < n; p++, i += 4) L[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * k;
    return L;
  };
  A.copyPlane = function (a) { return new Float32Array(a); };
  // One reusable scratch plane (all of this is synchronous, so a single buffer is enough); keeps memory flat.
  var SCR = null;
  function scratch(n) { if (!SCR || SCR.length !== n) SCR = new Float32Array(n); return SCR; }
  // Box mean of a plane with radius r (clamped edges), separable running sums; the vertical pass runs row by row
  // (sequential memory, much faster than walking columns on big images). Returns `out` (a new plane if omitted;
  // out may be `a` itself).
  A.boxMean = function (a, w, h, r, out) {
    r = Math.max(0, Math.round(r));
    out = out || new Float32Array(a.length);
    if (!r) { out.set(a); return out; }
    var tmp = scratch(a.length), inv = 1 / (2 * r + 1), x, y, s, k, row, col = new Float64Array(w);
    for (y = 0; y < h; y++) {
      row = y * w; s = 0;
      for (k = -r; k <= r; k++) s += a[row + clamp(k, 0, w - 1)];
      for (x = 0; x < w; x++) {
        tmp[row + x] = s * inv;
        s += a[row + (x + r + 1 < w ? x + r + 1 : w - 1)] - a[row + (x - r > 0 ? x - r : 0)];
      }
    }
    for (k = -r; k <= r; k++) { row = clamp(k, 0, h - 1) * w; for (x = 0; x < w; x++) col[x] += tmp[row + x]; }
    for (y = 0; y < h; y++) {
      var o = y * w, add = (y + r + 1 < h ? y + r + 1 : h - 1) * w, sub = (y - r > 0 ? y - r : 0) * w;
      for (x = 0; x < w; x++) { out[o + x] = col[x] * inv; col[x] += tmp[add + x] - tmp[sub + x]; }
    }
    return out;
  };
  // Gaussian-like blur of a plane in place: three box passes (same box sizes as PIX.blurPlane), row-sequential.
  A.blur = function (a, w, h, sigma) {
    if (!(sigma >= 0.3)) return a;
    var wI = Math.floor(Math.sqrt(12 * sigma * sigma / 3 + 1)); if (wI % 2 === 0) wI--;
    var mI = Math.round((12 * sigma * sigma - 3 * wI * wI - 12 * wI - 9) / (-4 * wI - 4));
    for (var i = 0; i < 3; i++) { var bs = i < mI ? wI : wI + 2, r = (bs - 1) / 2; A.boxMean(a, w, h, r, a); }
    return a;
  };
  // Guided filter (He et al.) of plane P guided by plane I (same size), radius r, regulariser eps. Edge-preserving,
  // O(n) in time; I === P (self-guided smoothing) needs only two extra planes.
  A.guided = function (I, P, w, h, r, eps) {
    var n = I.length, i, v;
    if (I === P) {
      var m = A.boxMean(I, w, h, r), q = new Float32Array(n);
      for (i = 0; i < n; i++) q[i] = I[i] * I[i];
      A.boxMean(q, w, h, r, q);
      for (i = 0; i < n; i++) { v = q[i] - m[i] * m[i]; var a0 = v / (v + eps); q[i] = a0; m[i] = m[i] - a0 * m[i]; }
      A.boxMean(q, w, h, r, q); A.boxMean(m, w, h, r, m);
      for (i = 0; i < n; i++) q[i] = q[i] * I[i] + m[i];
      return q;
    }
    var mI = A.boxMean(I, w, h, r), mP = A.boxMean(P, w, h, r), II = new Float32Array(n), IP = new Float32Array(n);
    for (i = 0; i < n; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * P[i]; }
    A.boxMean(II, w, h, r, II); A.boxMean(IP, w, h, r, IP);
    for (i = 0; i < n; i++) { v = II[i] - mI[i] * mI[i]; var a1 = (IP[i] - mI[i] * mP[i]) / (v + eps); II[i] = a1; IP[i] = mP[i] - a1 * mI[i]; }
    A.boxMean(II, w, h, r, II); A.boxMean(IP, w, h, r, IP);
    for (i = 0; i < n; i++) mI[i] = II[i] * I[i] + IP[i];
    return mI;
  };

  // ---------- colour spaces ----------
  var S2L = new Float32Array(256);
  for (var q = 0; q < 256; q++) { var v = q / 255; S2L[q] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  A.S2L = S2L;
  A.s2l = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  A.l2s = function (v) { v = clamp(v, 0, 1); return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255; };
  // Fast linear -> sRGB 0..255 through a 4096-entry table.
  var L2S = new Uint8Array(4097);
  for (q = 0; q <= 4096; q++) L2S[q] = c255(A.l2s(q / 4096));
  A.l2sFast = function (v) { return v <= 0 ? 0 : v >= 1 ? 255 : L2S[(v * 4096 + 0.5) | 0]; };
  // sRGB (0..255) -> CIE Lab (D65), out [L 0..100, a, b].
  function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  A.rgb2lab = function (r, g, b, o) {
    var R = S2L[r | 0], Gg = S2L[g | 0], B = S2L[b | 0];
    var X = (0.4124 * R + 0.3576 * Gg + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * Gg + 0.0722 * B, Z = (0.0193 * R + 0.1192 * Gg + 0.9505 * B) / 1.08883;
    var fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
    o = o || [0, 0, 0]; o[0] = 116 * fy - 16; o[1] = 500 * (fx - fy); o[2] = 200 * (fy - fz); return o;
  };
  function iLab(t) { var t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; }
  A.lab2rgb = function (L, a, bb, o) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
    var X = iLab(fx) * 0.95047, Y = iLab(fy), Z = iLab(fz) * 1.08883;
    var R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, Gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
    o = o || [0, 0, 0]; o[0] = A.l2s(R); o[1] = A.l2s(Gg); o[2] = A.l2s(B); return o;
  };
  A.rgb2hsl = PIX.rgb2hsl; A.hsl2rgb = PIX.hsl2rgb;
  // HSV helpers (h 0..360, s,v 0..1)
  A.rgb2hsv = function (r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d > 0) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
    return [h, mx ? d / mx : 0, mx / 255];
  };
  A.hex = function (hx, d) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hx || ""));
    if (!m) return d || [0, 0, 0];
    var v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };

  // ---------- statistics over (selected) pixels ----------
  // Weighted histograms of r, g, b, luminance. Selection weights and alpha count (fully transparent pixels skipped).
  A.hists = function (img, sel) {
    var d = img.data, r = new Float64Array(256), g = new Float64Array(256), b = new Float64Array(256), l = new Float64Array(256), tot = 0;
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      var w = d[i + 3] / 255; if (sel) w *= sel[p] / 255;
      if (w <= 0) continue;
      r[d[i]] += w; g[d[i + 1]] += w; b[d[i + 2]] += w; l[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8] += w; tot += w;
    }
    return { r: r, g: g, b: b, l: l, n: tot };
  };
  // Value below which `frac` of the histogram's weight lies (from the dark end), and from the bright end.
  A.clipLo = function (H, frac) { var tot = 0, i; for (i = 0; i < 256; i++) tot += H[i]; var acc = 0; for (i = 0; i < 256; i++) { acc += H[i]; if (acc > tot * frac) return i; } return 0; };
  A.clipHi = function (H, frac) { var tot = 0, i; for (i = 0; i < 256; i++) tot += H[i]; var acc = 0; for (i = 255; i >= 0; i--) { acc += H[i]; if (acc > tot * frac) return i; } return 255; };
  // Linear stretch table lo -> 0, hi -> 255 with optional gamma.
  A.stretch = function (lo, hi, gamma) {
    var l = new Uint8Array(256), s = Math.max(1, hi - lo), g = 1 / (gamma || 1);
    for (var i = 0; i < 256; i++) l[i] = c255(Math.pow(clamp((i - lo) / s, 0, 1), g) * 255);
    return l;
  };

  // ---------- misc ----------
  A.smooth = function (e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  A.rng = PIX.rng;
  // Bilinear sample of an RGBA image at (x, y) into o (premultiplied-correct enough for distorts); edge: "clamp" | "wrap" | "transparent".
  A.sample = function (img, x, y, o, edge) {
    var w = img.width, h = img.height, d = img.data;
    if (edge === "wrap") { x = ((x % w) + w) % w; y = ((y % h) + h) % h; }
    else if (edge === "transparent" && (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5)) { o[0] = o[1] = o[2] = o[3] = 0; return o; }
    var fx = x - 0.5, fy = y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    if (edge === "wrap") { x0 = (x0 + w) % w; x1 = x1 % w; y0 = (y0 + h) % h; y1 = y1 % h; }
    else { x0 = clamp(x0, 0, w - 1); x1 = clamp(x1, 0, w - 1); y0 = clamp(y0, 0, h - 1); y1 = clamp(y1, 0, h - 1); }
    var i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
    var w00 = (1 - tx) * (1 - ty) * d[i00 + 3], w10 = tx * (1 - ty) * d[i10 + 3], w01 = (1 - tx) * ty * d[i01 + 3], w11 = tx * ty * d[i11 + 3], wa = w00 + w10 + w01 + w11;
    o[3] = wa;
    if (wa <= 0) { o[0] = o[1] = o[2] = 0; return o; }
    for (var c = 0; c < 3; c++) o[c] = (d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11) / wa;
    return o;
  };
  // Decode a base64 string to bytes (worker-safe: atob exists in workers).
  A.b64 = function (s) { var bin = atob(String(s || "")), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
})(typeof self !== "undefined" ? self : this);
