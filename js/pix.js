/* Photo Editor pixel maths. Pure functions on plain arrays: no DOM, so the same file runs in the page
   (self-test, small jobs) and in the Web Worker (big jobs). Images are {data: Uint8ClampedArray RGBA, width, height};
   masks/selections are Uint8Array (0 = out, 255 = fully in). */
(function (G) {
  "use strict";
  var PIX = {};
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function c255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

  // ---------- blend modes (W3C Compositing and Blending Level 1), channel values 0..1 ----------
  var BLEND = {
    normal: function (b, s) { return s; },
    multiply: function (b, s) { return b * s; },
    screen: function (b, s) { return b + s - b * s; },
    overlay: function (b, s) { return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); },   // hard-light with layers swapped
    darken: function (b, s) { return Math.min(b, s); },
    lighten: function (b, s) { return Math.max(b, s); },
    difference: function (b, s) { return Math.abs(b - s); }
  };
  PIX.BLEND_MODES = Object.keys(BLEND);
  // Source-over with a separable blend mode; back/src are [r,g,b,a] 0..255, opacity 0..1. Straight alpha out.
  PIX.compositePixel = function (mode, back, src, opacity) {
    var f = BLEND[mode] || BLEND.normal, ab = back[3] / 255, as = src[3] / 255 * (opacity == null ? 1 : opacity);
    var ao = as + ab * (1 - as), out = [0, 0, 0, Math.round(ao * 255)];
    if (ao <= 0) return [0, 0, 0, 0];
    for (var i = 0; i < 3; i++) {
      var cb = back[i] / 255, cs = src[i] / 255;
      var mixed = (1 - ab) * cs + ab * f(cb, cs);
      out[i] = c255((as * mixed + ab * cb * (1 - as)) / ao * 255);
    }
    return out;
  };

  // ---------- lookup tables ----------
  function idLut() { var l = new Uint8Array(256); for (var i = 0; i < 256; i++) l[i] = i; return l; }
  PIX.lutBrightnessContrast = function (b, c) {
    // b: -150..150 (added), c: -100..100 (classic contrast factor around mid-grey)
    var k = c * 2.55, f = (259 * (k + 255)) / (255 * (259 - k)), l = new Uint8Array(256);
    for (var i = 0; i < 256; i++) l[i] = c255(f * (i - 128) + 128 + b);
    return l;
  };
  PIX.lutLevels = function (inB, inW, gamma, outB, outW) {
    var l = new Uint8Array(256), span = Math.max(1, inW - inB), g = 1 / clamp(gamma || 1, 0.1, 9.99);
    for (var i = 0; i < 256; i++) {
      var v = clamp((i - inB) / span, 0, 1);
      l[i] = c255(outB + Math.pow(v, g) * (outW - outB));
    }
    return l;
  };
  // Monotone cubic (Fritsch-Carlson) through control points [[x,y],...] in 0..255 -> 256-entry table.
  PIX.lutCurve = function (pts) {
    var p = (pts || []).map(function (q) { return [clamp(+q[0] || 0, 0, 255), clamp(+q[1] || 0, 0, 255)]; })
      .sort(function (a, b) { return a[0] - b[0]; })
      .filter(function (q, i, a) { return i === 0 || q[0] > a[i - 1][0]; });
    var l = new Uint8Array(256), n = p.length;
    if (n === 0) return idLut();
    if (n === 1) { for (var z = 0; z < 256; z++) l[z] = c255(p[0][1]); return l; }
    var d = [], m = [];
    for (var i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    var seg = 0;
    for (var x = 0; x < 256; x++) {
      if (x <= p[0][0]) { l[x] = c255(p[0][1]); continue; }
      if (x >= p[n - 1][0]) { l[x] = c255(p[n - 1][1]); continue; }
      while (seg < n - 2 && x > p[seg + 1][0]) seg++;
      var x0 = p[seg][0], x1 = p[seg + 1][0], hh = x1 - x0, tt = (x - x0) / hh, t2 = tt * tt, t3 = t2 * tt;
      var v = (2 * t3 - 3 * t2 + 1) * p[seg][1] + (t3 - 2 * t2 + tt) * hh * m[seg] + (-2 * t3 + 3 * t2) * p[seg + 1][1] + (t3 - t2) * hh * m[seg + 1];
      l[x] = c255(v);
    }
    return l;
  };
  function s2l(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function l2s(v) { v = clamp(v, 0, 1); return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255; }
  PIX.lutExposure = function (ev, offset, gamma) {
    var l = new Uint8Array(256), k = Math.pow(2, ev || 0), g = 1 / clamp(gamma || 1, 0.1, 9.99);
    for (var i = 0; i < 256; i++) l[i] = c255(255 * Math.pow(clamp(l2s(s2l(i) * k + (offset || 0)) / 255, 0, 1), g));
    return l;
  };
  PIX.lutInvert = function () { var l = new Uint8Array(256); for (var i = 0; i < 256; i++) l[i] = 255 - i; return l; };
  // Colour balance: shifts per tonal range (each [-100..100] x 3 for cyan-red, magenta-green, yellow-blue).
  PIX.lutsColorBalance = function (sh, mid, hi) {
    var out = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    for (var i = 0; i < 256; i++) {
      var t = i / 255, ws = clamp(1 - t * 2.2, 0, 1), wh = clamp(t * 2.2 - 1.2, 0, 1), wm = Math.max(0, 1 - Math.abs(t - 0.5) * 2.4);
      for (var c = 0; c < 3; c++) out[c][i] = c255(i + 1.1 * ((sh[c] || 0) * ws + (mid[c] || 0) * wm + (hi[c] || 0) * wh));
    }
    return out;
  };

  // ---------- applying ----------
  // Apply per-channel tables (lr, lg, lb) to img.data in place. sel: optional Uint8Array weights (same size).
  PIX.applyLuts = function (img, lr, lg, lb, sel) {
    var d = img.data, n = d.length;
    lg = lg || lr; lb = lb || lr;
    for (var i = 0, p = 0; i < n; i += 4, p++) {
      if (sel && !sel[p]) continue;
      var r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
      if (sel && sel[p] < 255) { var k = sel[p] / 255; r = d[i] + (r - d[i]) * k; g = d[i + 1] + (g - d[i + 1]) * k; b = d[i + 2] + (b - d[i + 2]) * k; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    return img;
  };
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d > 0) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hue2(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s <= 0) { var v = l * 255; return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue2(p, q, h + 1 / 3) * 255, hue2(p, q, h) * 255, hue2(p, q, h - 1 / 3) * 255];
  }
  PIX.rgb2hsl = rgb2hsl; PIX.hsl2rgb = hsl2rgb;
  function perPixel(img, sel, fn) {
    var d = img.data, n = d.length;
    for (var i = 0, p = 0; i < n; i += 4, p++) {
      if (sel && !sel[p]) continue;
      var r = fn(d[i], d[i + 1], d[i + 2]);
      if (sel && sel[p] < 255) {
        var k = sel[p] / 255;
        d[i] = d[i] + (r[0] - d[i]) * k; d[i + 1] = d[i + 1] + (r[1] - d[i + 1]) * k; d[i + 2] = d[i + 2] + (r[2] - d[i + 2]) * k;
      } else { d[i] = r[0]; d[i + 1] = r[1]; d[i + 2] = r[2]; }
    }
    return img;
  }
  // hue -180..180, sat -100..100, light -100..100, colorize: {on, hue, sat}
  PIX.hueSat = function (img, p, sel) {
    var H = +p.hue || 0, S = (+p.sat || 0) / 100, L = (+p.light || 0) / 100, col = !!p.colorize;
    return perPixel(img, sel, function (r, g, b) {
      var hsl = rgb2hsl(r, g, b), h = hsl[0], s = hsl[1], l = hsl[2];
      if (col) { h = H < 0 ? H + 360 : H; s = clamp(0.25 + S * 0.75, 0, 1); }
      else { h += H; s = S >= 0 ? s + (1 - s) * S * (s > 0 ? 1 : 0) : s * (1 + S); }
      l = L >= 0 ? l + (1 - l) * L : l * (1 + L);
      return hsl2rgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    });
  };
  // vibrance -100..100 (protects already-saturated colours), sat -100..100
  PIX.vibrance = function (img, p, sel) {
    var V = (+p.vibrance || 0) / 100, S = (+p.sat || 0) / 100;
    return perPixel(img, sel, function (r, g, b) {
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      var k = (1 + S) * (1 + V * (1 - sat) * (V > 0 ? 1.5 : 1)), lum = 0.299 * r + 0.587 * g + 0.114 * b;
      k = Math.max(0, k);
      return [c255(lum + (r - lum) * k), c255(lum + (g - lum) * k), c255(lum + (b - lum) * k)];
    });
  };
  // Black & white with colour-range weights in % (classic defaults 40/60/40/60/20/80).
  PIX.BW_DEFAULT = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
  PIX.bwGray = function (r, g, b, w) {
    var mn = Math.min(r, g, b), mx = Math.max(r, g, b), mid = r + g + b - mn - mx, wp, ws;
    if (mx === mn) return mn;
    if (r === mx) { wp = w.reds; ws = g >= b ? w.yellows : w.magentas; }
    else if (g === mx) { wp = w.greens; ws = r >= b ? w.yellows : w.cyans; }
    else { wp = w.blues; ws = r >= g ? w.magentas : w.cyans; }
    return c255(mn + (mx - mid) * wp / 100 + (mid - mn) * ws / 100);
  };
  PIX.blackWhite = function (img, w, sel) {
    var W = {}; Object.keys(PIX.BW_DEFAULT).forEach(function (k) { W[k] = w && isFinite(w[k]) ? +w[k] : PIX.BW_DEFAULT[k]; });
    return perPixel(img, sel, function (r, g, b) { var v = PIX.bwGray(r, g, b, W); return [v, v, v]; });
  };
  PIX.desaturate = function (img, sel) {
    return perPixel(img, sel, function (r, g, b) { var v = c255(0.299 * r + 0.587 * g + 0.114 * b); return [v, v, v]; });
  };
  PIX.threshold = function (img, level, sel) {
    return perPixel(img, sel, function (r, g, b) { var v = 0.299 * r + 0.587 * g + 0.114 * b >= level ? 255 : 0; return [v, v, v]; });
  };
  PIX.histogram = function (img) {
    var d = img.data, hl = new Uint32Array(256), hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    for (var i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      hr[d[i]]++; hg[d[i + 1]]++; hb[d[i + 2]]++; hl[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
    }
    return { l: hl, r: hr, g: hg, b: hb };
  };

  // ---------- blur (3 box passes ~ gaussian) on premultiplied channels ----------
  function boxSizes(sigma) {   // standard: 3 boxes approximating a gaussian of std-dev sigma
    var n = 3, wI = Math.floor(Math.sqrt(12 * sigma * sigma / n + 1)); if (wI % 2 === 0) wI--;
    var wu = wI + 2, mI = Math.round((12 * sigma * sigma - n * wI * wI - 4 * n * wI - 3 * n) / (-4 * wI - 4)), out = [];
    for (var i = 0; i < n; i++) out.push(i < mI ? wI : wu);
    return out;
  }
  function boxH(src, dst, w, h, r) {
    var iarr = 1 / (r + r + 1);
    for (var y = 0; y < h; y++) {
      var ti = y * w, li = ti, ri = ti + r, fv = src[ti], lv = src[ti + w - 1], val = (r + 1) * fv, j;
      for (j = 0; j < r; j++) val += src[ti + Math.min(j, w - 1)];
      for (j = 0; j <= r; j++) { val += (ri < y * w + w ? src[ri] : lv) - fv; dst[ti++] = val * iarr; ri++; }
      for (j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr; }
      for (j = Math.max(w - r, r + 1); j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr; }
    }
  }
  function boxV(src, dst, w, h, r) {
    var iarr = 1 / (r + r + 1);
    for (var x = 0; x < w; x++) {
      var ti = x, li = ti, ri = ti + r * w, fv = src[ti], lv = src[ti + w * (h - 1)], val = (r + 1) * fv, j;
      for (j = 0; j < r; j++) val += src[ti + Math.min(j, h - 1) * w];
      for (j = 0; j <= r; j++) { val += (ri < w * h ? src[ri] : lv) - fv; dst[ti] = val * iarr; ri += w; ti += w; }
      for (j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; dst[ti] = val * iarr; li += w; ri += w; ti += w; }
      for (j = Math.max(h - r, r + 1); j < h; j++) { val += lv - src[li]; dst[ti] = val * iarr; li += w; ti += w; }
    }
  }
  // Blur a single Float32 plane in place.
  function blurPlane(a, w, h, sigma) {
    if (sigma < 0.3) return a;
    var tmp = new Float32Array(a.length), bx = boxSizes(sigma);
    for (var i = 0; i < 3; i++) {
      var r = (bx[i] - 1) / 2, rh = Math.min(r, (w - 1) >> 1), rv = Math.min(r, (h - 1) >> 1);
      if (rh >= 1) boxH(a, tmp, w, h, rh); else tmp.set(a);
      if (rv >= 1) boxV(tmp, a, w, h, rv); else a.set(tmp);
    }
    return a;
  }
  PIX.blurPlane = blurPlane;
  // Gaussian-like blur of an RGBA image (alpha-correct: works on premultiplied colour). radius ~ 2 sigma.
  PIX.gaussian = function (img, radius) {
    var w = img.width, h = img.height, d = img.data, n = w * h, sigma = Math.max(0, radius) / 2;
    if (sigma < 0.3) return img;
    var R = new Float32Array(n), Gc = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), i, p;
    for (p = 0, i = 0; p < n; p++, i += 4) { var a = d[i + 3] / 255; R[p] = d[i] * a; Gc[p] = d[i + 1] * a; B[p] = d[i + 2] * a; A[p] = d[i + 3]; }
    blurPlane(R, w, h, sigma); blurPlane(Gc, w, h, sigma); blurPlane(B, w, h, sigma); blurPlane(A, w, h, sigma);
    for (p = 0, i = 0; p < n; p++, i += 4) {
      var al = A[p], k = al > 0.001 ? 255 / al : 0;
      d[i] = c255(R[p] * k); d[i + 1] = c255(Gc[p] * k); d[i + 2] = c255(B[p] * k); d[i + 3] = c255(al);
    }
    return img;
  };
  function copyImg(img) { return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }; }
  PIX.copyImg = copyImg;
  // Unsharp mask: amount %, radius px, threshold 0..255.
  PIX.unsharp = function (img, amount, radius, thr) {
    var bl = PIX.gaussian(copyImg(img), radius), d = img.data, b = bl.data, k = (amount || 0) / 100;
    thr = thr || 0;
    for (var i = 0; i < d.length; i += 4) {
      for (var c = 0; c < 3; c++) {
        var diff = d[i + c] - b[i + c];
        if (Math.abs(diff) >= thr) d[i + c] = c255(d[i + c] + diff * k);
      }
    }
    return img;
  };
  PIX.sharpen = function (img) { return PIX.unsharp(img, 60, 1.6, 0); };
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  PIX.rng = rng;
  // Add noise: amount 0..100 (% of full range), mono = same for all channels, gaussian or uniform.
  PIX.noise = function (img, amount, mono, gauss, seed) {
    var d = img.data, R = rng(seed || 7), a = (amount || 0) / 100 * 255;
    function n1() { if (!gauss) return (R() * 2 - 1); var u = R() || 1e-9, v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * v) * 0.5; }
    for (var i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      if (mono) { var v = n1() * a; d[i] = c255(d[i] + v); d[i + 1] = c255(d[i + 1] + v); d[i + 2] = c255(d[i + 2] + v); }
      else { d[i] = c255(d[i] + n1() * a); d[i + 1] = c255(d[i + 1] + n1() * a); d[i + 2] = c255(d[i + 2] + n1() * a); }
    }
    return img;
  };
  // Pixelate into size x size cells (alpha-weighted average).
  PIX.pixelate = function (img, size) {
    var w = img.width, h = img.height, d = img.data, s = Math.max(1, Math.round(size));
    if (s < 2) return img;
    for (var by = 0; by < h; by += s) for (var bx = 0; bx < w; bx += s) {
      var r = 0, g = 0, b = 0, a = 0, cnt = 0, x, y, i, ex = Math.min(w, bx + s), ey = Math.min(h, by + s);
      for (y = by; y < ey; y++) for (x = bx; x < ex; x++) { i = (y * w + x) * 4; var al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; cnt++; }
      var R = a ? r / a : 0, Gg = a ? g / a : 0, B = a ? b / a : 0, A = a / cnt;
      for (y = by; y < ey; y++) for (x = bx; x < ex; x++) { i = (y * w + x) * 4; d[i] = R; d[i + 1] = Gg; d[i + 2] = B; d[i + 3] = A; }
    }
    return img;
  };
  // Vignette: amount -100..100 (negative darkens edges, positive lightens), size 0..100 (start of falloff), soft 0..100.
  PIX.vignette = function (img, amount, size, soft) {
    var w = img.width, h = img.height, d = img.data, cx = w / 2, cy = h / 2, A = (amount || 0) / 100;
    var start = clamp((size == null ? 50 : size) / 100, 0, 0.99), sf = Math.max(0.02, (soft == null ? 50 : soft) / 100);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dx = (x + 0.5 - cx) / cx, dy = (y + 0.5 - cy) / cy, r = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
      var t = clamp((r - start * 0.7) / (sf * (1 - start * 0.7) + 1e-6), 0, 1), f = t * t * (3 - 2 * t), i = (y * w + x) * 4;
      if (!f) continue;
      for (var c = 0; c < 3; c++) d[i + c] = A < 0 ? c255(d[i + c] * (1 + A * f)) : c255(d[i + c] + (255 - d[i + c]) * A * f);
    }
    return img;
  };
  // Restrict a finished filter to the selection: out = orig + (out - orig) * sel/255 (alpha too).
  PIX.mixSel = function (orig, out, sel) {
    var o = orig.data, d = out.data;
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      var k = sel[p];
      if (k === 255) continue;
      if (!k) { d[i] = o[i]; d[i + 1] = o[i + 1]; d[i + 2] = o[i + 2]; d[i + 3] = o[i + 3]; continue; }
      k /= 255;
      for (var c = 0; c < 4; c++) d[i + c] = o[i + c] + (d[i + c] - o[i + c]) * k;
    }
    return out;
  };

  // ---------- adjustments by name (used by the worker and the dialogs) ----------
  PIX.adjust = function (img, op, p, sel) {
    p = p || {};
    switch (op) {
      case "brightness": return PIX.applyLuts(img, PIX.lutBrightnessContrast(+p.b || 0, +p.c || 0), null, null, sel);
      case "levels": {
        var m = PIX.lutLevels(+p.inB || 0, p.inW == null ? 255 : +p.inW, p.gamma == null ? 1 : +p.gamma, +p.outB || 0, p.outW == null ? 255 : +p.outW);
        return PIX.applyLuts(img, m, m, m, sel);
      }
      case "curves": {
        var mm = PIX.lutCurve(p.rgb || [[0, 0], [255, 255]]), cr = PIX.lutCurve(p.r || [[0, 0], [255, 255]]), cg = PIX.lutCurve(p.g || [[0, 0], [255, 255]]), cb = PIX.lutCurve(p.b || [[0, 0], [255, 255]]);
        var R = new Uint8Array(256), Gt = new Uint8Array(256), B = new Uint8Array(256);
        for (var i = 0; i < 256; i++) { R[i] = mm[cr[i]]; Gt[i] = mm[cg[i]]; B[i] = mm[cb[i]]; }
        return PIX.applyLuts(img, R, Gt, B, sel);
      }
      case "exposure": return PIX.applyLuts(img, PIX.lutExposure(+p.ev || 0, +p.offset || 0, p.gamma == null ? 1 : +p.gamma), null, null, sel);
      case "invert": return PIX.applyLuts(img, PIX.lutInvert(), null, null, sel);
      case "colorBalance": {
        var orig = p.keepLum ? copyImg(img) : null, L = PIX.lutsColorBalance(p.sh || [0, 0, 0], p.mid || [0, 0, 0], p.hi || [0, 0, 0]);
        PIX.applyLuts(img, L[0], L[1], L[2], sel);
        if (orig) {           // keep each pixel's luminance
          var d = img.data, o = orig.data;
          for (var k = 0; k < d.length; k += 4) {
            var l0 = 0.299 * o[k] + 0.587 * o[k + 1] + 0.114 * o[k + 2], l1 = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2], dl = l0 - l1;
            d[k] = c255(d[k] + dl); d[k + 1] = c255(d[k + 1] + dl); d[k + 2] = c255(d[k + 2] + dl);
          }
        }
        return img;
      }
      case "hueSat": return PIX.hueSat(img, p, sel);
      case "vibrance": return PIX.vibrance(img, p, sel);
      case "bw": return PIX.blackWhite(img, p, sel);
      case "desaturate": return PIX.desaturate(img, sel);
      case "threshold": return PIX.threshold(img, p.level == null ? 128 : +p.level, sel);
      // filters: computed on the whole image, then mixed into the selection
      case "blur": case "unsharp": case "sharpen": case "noise": case "pixelate": case "vignette": {
        var before = sel ? copyImg(img) : null;
        if (op === "blur") PIX.gaussian(img, +p.radius || 0);
        else if (op === "unsharp") PIX.unsharp(img, +p.amount || 0, +p.radius || 1, +p.threshold || 0);
        else if (op === "sharpen") PIX.sharpen(img);
        else if (op === "noise") PIX.noise(img, +p.amount || 0, !!p.mono, !!p.gauss, p.seed || 7);
        else if (op === "pixelate") PIX.pixelate(img, +p.size || 1);
        else PIX.vignette(img, +p.amount || 0, p.size == null ? 50 : +p.size, p.soft == null ? 50 : +p.soft);
        return before ? PIX.mixSel(before, img, sel) : img;
      }
    }
    throw new Error("Unknown adjustment " + op);
  };

  // ---------- selections / masks ----------
  PIX.combine = function (a, b, mode) {     // a = existing (or null), b = new shape; returns a new mask
    var n = b.length, out = new Uint8Array(n), i;
    if (!a || mode === "new") { out.set(b); return out; }
    if (mode === "add") for (i = 0; i < n; i++) out[i] = a[i] > b[i] ? a[i] : b[i];
    else if (mode === "subtract") for (i = 0; i < n; i++) out[i] = Math.min(a[i], 255 - b[i]);
    else if (mode === "intersect") for (i = 0; i < n; i++) out[i] = a[i] < b[i] ? a[i] : b[i];
    else out.set(b);
    return out;
  };
  PIX.invertMask = function (m) { var o = new Uint8Array(m.length); for (var i = 0; i < m.length; i++) o[i] = 255 - m[i]; return o; };
  PIX.rectMask = function (w, h, x, y, rw, rh) {
    var m = new Uint8Array(w * h), x0 = clamp(Math.round(x), 0, w), y0 = clamp(Math.round(y), 0, h), x1 = clamp(Math.round(x + rw), 0, w), y1 = clamp(Math.round(y + rh), 0, h);
    for (var yy = y0; yy < y1; yy++) m.fill(255, yy * w + x0, yy * w + x1);
    return m;
  };
  PIX.feather = function (m, w, h, radius) {
    if (!(radius > 0)) return new Uint8Array(m);
    var f = new Float32Array(m.length), i;
    for (i = 0; i < m.length; i++) f[i] = m[i];
    blurPlane(f, w, h, radius / 2);
    var o = new Uint8Array(m.length);
    for (i = 0; i < m.length; i++) o[i] = c255(f[i]);
    return o;
  };
  // Grow (r > 0) or shrink (r < 0) by r pixels (square structuring element, separable).
  PIX.grow = function (m, w, h, r) {
    var R = Math.round(Math.abs(r)); if (!R) return new Uint8Array(m);
    var max = r > 0, tmp = new Uint8Array(m.length), out = new Uint8Array(m.length), x, y, k;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var v = max ? 0 : 255;
      for (k = Math.max(0, x - R); k <= Math.min(w - 1, x + R); k++) { var q = m[y * w + k]; v = max ? (q > v ? q : v) : (q < v ? q : v); }
      tmp[y * w + x] = v;
    }
    for (x = 0; x < w; x++) for (y = 0; y < h; y++) {
      var u = max ? 0 : 255;
      for (k = Math.max(0, y - R); k <= Math.min(h - 1, y + R); k++) { var s = tmp[k * w + x]; u = max ? (s > u ? s : u) : (s < u ? s : u); }
      out[y * w + x] = u;
    }
    return out;
  };
  PIX.bounds = function (m, w, h, thr) {
    thr = thr || 0;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      var row = y * w, any = false;
      for (var x = 0; x < w; x++) if (m[row + x] > thr) { any = true; if (x < x0) x0 = x; break; }
      if (!any) continue;
      for (var xx = w - 1; xx >= 0; xx--) if (m[row + xx] > thr) { if (xx > x1) x1 = xx; break; }
      if (y < y0) y0 = y; y1 = y;
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  PIX.alphaBounds = function (img) {
    var w = img.width, h = img.height, d = img.data, a = new Uint8Array(w * h);
    for (var i = 0, p = 0; p < a.length; i += 4, p++) a[p] = d[i + 3];
    return PIX.bounds(a, w, h, 0);
  };
  // Magic wand / bucket region. tol 0..255 on the largest channel difference (alpha included).
  PIX.wand = function (img, sx, sy, tol, contiguous) {
    var w = img.width, h = img.height, d = img.data, m = new Uint8Array(w * h);
    sx = Math.floor(sx); sy = Math.floor(sy);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return m;
    var si = (sy * w + sx) * 4, r0 = d[si], g0 = d[si + 1], b0 = d[si + 2], a0 = d[si + 3];
    function ok(p) {
      var i = p * 4, a = d[i + 3];
      if (a0 === 0 && a === 0) return true;
      var dr = Math.abs(d[i] - r0), dg = Math.abs(d[i + 1] - g0), db = Math.abs(d[i + 2] - b0), da = Math.abs(a - a0);
      return Math.max(dr, dg, db, da) <= tol;
    }
    if (!contiguous) { for (var p = 0; p < w * h; p++) if (ok(p)) m[p] = 255; return m; }
    var stack = [sx, sy];
    while (stack.length) {
      var y = stack.pop(), x = stack.pop(), row = y * w, l = x, r = x;
      if (m[row + x] || !ok(row + x)) continue;
      while (l > 0 && !m[row + l - 1] && ok(row + l - 1)) l--;
      while (r < w - 1 && !m[row + r + 1] && ok(row + r + 1)) r++;
      m.fill(255, row + l, row + r + 1);
      for (var dy = -1; dy <= 1; dy += 2) {
        var ny = y + dy; if (ny < 0 || ny >= h) continue;
        var nrow = ny * w, inRun = false;
        for (var xx = l; xx <= r; xx++) {
          var good = !m[nrow + xx] && ok(nrow + xx);
          if (good && !inRun) { stack.push(xx, ny); inRun = true; } else if (!good) inRun = false;
        }
      }
    }
    return m;
  };

  // ---------- healing: texture from the source, tone from the destination's edge ----------
  // dst, src: images of the same size; mask: Uint8Array stroke coverage. Returns a new image with the
  // stroke area replaced by src + a smooth correction that matches dst along the stroke's border.
  PIX.heal = function (dst, src, mask) {
    var w = dst.width, h = dst.height, n = w * h, D = dst.data, S = src.data, out = copyImg(dst), O = out.data, p, i, c;
    var inside = new Uint8Array(n), ring = new Float32Array(n);
    for (p = 0; p < n; p++) inside[p] = mask[p] > 8 ? 1 : 0;
    var grown = PIX.grow(mask, w, h, 3), cnt = 0;
    for (p = 0; p < n; p++) if (grown[p] > 8 && !inside[p] && S[p * 4 + 3] > 0 && D[p * 4 + 3] > 0) { ring[p] = 1; cnt++; }
    var bb = PIX.bounds(mask, w, h, 8);
    if (!bb) return out;
    var sigma = Math.max(2, Math.max(bb.w, bb.h) / 3);
    var Wt = new Float32Array(ring), planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    if (cnt) {
      for (p = 0; p < n; p++) if (ring[p]) for (c = 0; c < 3; c++) planes[c][p] = D[p * 4 + c] - S[p * 4 + c];
      blurPlane(Wt, w, h, sigma);
      for (c = 0; c < 3; c++) blurPlane(planes[c], w, h, sigma);
    }
    for (p = 0, i = 0; p < n; p++, i += 4) {
      if (!mask[p]) continue;
      var k = mask[p] / 255, wt = Wt[p];
      for (c = 0; c < 3; c++) {
        var corr = cnt && wt > 1e-4 ? planes[c][p] / wt : 0;
        O[i + c] = c255(D[i + c] + (S[i + c] + corr - D[i + c]) * k);
      }
      O[i + 3] = c255(D[i + 3] + (S[i + 3] - D[i + 3]) * k);
    }
    return out;
  };

  // ---------- selection outline: edge segments between in (>=128) and out pixels ----------
  // Returns a Float32Array of [x0,y0,x1,y1,...] in pixel units of the mask (runs merged).
  PIX.outline = function (m, w, h) {
    var seg = [], x, y, s;
    function inn(xx, yy) { return xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx] >= 128; }
    for (y = 0; y <= h; y++) {           // horizontal edges along row boundary y
      s = -1;
      for (x = 0; x <= w; x++) {
        var e = x < w && inn(x, y) !== inn(x, y - 1);
        if (e && s < 0) s = x; else if (!e && s >= 0) { seg.push(s, y, x, y); s = -1; }
      }
    }
    for (x = 0; x <= w; x++) {           // vertical edges along column boundary x
      s = -1;
      for (y = 0; y <= h; y++) {
        var ev = y < h && inn(x, y) !== inn(x - 1, y);
        if (ev && s < 0) s = y; else if (!ev && s >= 0) { seg.push(x, s, x, y); s = -1; }
      }
    }
    return new Float32Array(seg);
  };
  // Nearest-neighbour downscale of a mask by an integer step (for drawing outlines of huge selections).
  PIX.shrinkMask = function (m, w, h, step) {
    var W = Math.ceil(w / step), H = Math.ceil(h / step), o = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) o[y * W + x] = m[Math.min(h - 1, y * step + (step >> 1)) * w + Math.min(w - 1, x * step + (step >> 1))];
    return { m: o, w: W, h: H };
  };

  // ---------- generic dispatcher (the worker calls this) ----------
  PIX.call = function (fn, args) {
    if (fn === "adjust") return PIX.adjust(args[0], args[1], args[2], args[3]);
    if (["wand", "feather", "grow", "heal", "combine", "invertMask", "outline", "histogram", "alphaBounds", "bounds"].indexOf(fn) < 0) throw new Error("Not allowed: " + fn);
    return PIX[fn].apply(null, args);
  };
  G.PIX = PIX;
})(typeof self !== "undefined" ? self : this);
