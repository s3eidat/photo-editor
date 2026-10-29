/* Photo Editor paint lane: pure pixel maths (no DOM), shared by the page and js/paint/pworker.js.
   Colour models, tone tools, gradients, red eye, filling a hole from its surroundings, brush file parsing. */
(function (G) {
  "use strict";
  var PPX = {};
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function c255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  PPX.clamp = clamp; PPX.c255 = c255;

  // ---------- colour models ----------
  // HSB (a.k.a. HSV): h 0..360, s and b 0..100. RGB 0..255.
  PPX.rgb2hsb = function (r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, mx ? d / mx * 100 : 0, mx / 255 * 100];
  };
  PPX.hsb2rgb = function (h, s, v) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; v = clamp(v, 0, 100) / 100;
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  };
  // CIE L*a*b* (D65, sRGB primaries).
  function s2l(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function l2s(v) { return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255; }
  PPX.s2l = s2l; PPX.l2s = l2s;
  var XN = 0.95047, YN = 1, ZN = 1.08883;
  function fLab(t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; }
  function fInv(t) { var t3 = t * t * t; return t3 > 216 / 24389 ? t3 : (116 * t - 16) / (24389 / 27); }
  PPX.rgb2lab = function (r, g, b) {
    var R = s2l(r), Gc = s2l(g), B = s2l(b);
    var X = (0.4124564 * R + 0.3575761 * Gc + 0.1804375 * B) / XN, Y = (0.2126729 * R + 0.7151522 * Gc + 0.0721750 * B) / YN, Z = (0.0193339 * R + 0.1191920 * Gc + 0.9503041 * B) / ZN;
    var fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  // Returns unclamped linear-light-derived sRGB 0..255 (may be out of gamut: check with inGamut).
  PPX.lab2rgbRaw = function (L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    var X = fInv(fx) * XN, Y = fInv(fy) * YN, Z = fInv(fz) * ZN;
    var R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, Gc = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    return [R, Gc, B].map(function (v) { return v < 0 ? -l2s(-v) : l2s(v); });
  };
  PPX.lab2rgb = function (L, a, b) { return PPX.lab2rgbRaw(L, a, b).map(c255); };
  PPX.inGamut = function (rgb) { return rgb.every(function (v) { return v > -0.5 && v < 255.5; }); };
  // Naive device-independent CMYK (0..100), for the picker's numeric fields.
  PPX.rgb2cmyk = function (r, g, b) {
    var k = 1 - Math.max(r, g, b) / 255; if (k >= 1) return [0, 0, 0, 100];
    return [(1 - r / 255 - k) / (1 - k) * 100, (1 - g / 255 - k) / (1 - k) * 100, (1 - b / 255 - k) / (1 - k) * 100, k * 100];
  };
  PPX.cmyk2rgb = function (c, m, y, k) { k = clamp(k, 0, 100) / 100; return [255 * (1 - clamp(c, 0, 100) / 100) * (1 - k), 255 * (1 - clamp(m, 0, 100) / 100) * (1 - k), 255 * (1 - clamp(y, 0, 100) / 100) * (1 - k)]; };
  // Nearest of the 216 web-safe colours (each channel a multiple of 0x33).
  PPX.webSafe = function (rgb) { return rgb.map(function (v) { return Math.round(clamp(v, 0, 255) / 51) * 51; }); };

  // W3C non-separable blend helpers (0..1 floats), used by colour replacement and the mixer.
  function lumF(c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }
  function clipC(c) {
    var l = lumF(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
    if (n < 0) c = c.map(function (v) { return l + (v - l) * l / (l - n); });
    if (x > 1) c = c.map(function (v) { return l + (v - l) * (1 - l) / (x - l); });
    return c;
  }
  function setLum(c, l) { var d = l - lumF(c); return clipC([c[0] + d, c[1] + d, c[2] + d]); }
  function satF(c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); }
  function setSat(c, s) {
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), o = [0, 0, 0];
    if (mx === mn) return o;
    for (var i = 0; i < 3; i++) o[i] = c[i] === mx ? s : c[i] === mn ? 0 : (c[i] - mn) * s / (mx - mn);
    return o;
  }
  PPX.lumF = lumF; PPX.setLum = setLum; PPX.setSat = setSat; PPX.satF = satF;
  // Recolour `b` (base) with `s` (source colour) by mode: "color", "hue", "saturation", "luminosity". 0..255 arrays.
  PPX.recolor = function (mode, b, s) {
    var B = [b[0] / 255, b[1] / 255, b[2] / 255], S = [s[0] / 255, s[1] / 255, s[2] / 255], o;
    if (mode === "hue") o = setLum(setSat(S, satF(B)), lumF(B));
    else if (mode === "saturation") o = setLum(setSat(B, satF(S)), lumF(B));
    else if (mode === "luminosity") o = setLum(B, lumF(S));
    else o = setLum(S, lumF(B));
    return [o[0] * 255, o[1] * 255, o[2] * 255];
  };

  // ---------- fill a hole from its surroundings (multi-scale PatchMatch + voting) ----------
  // img: {data RGBA, width, height}; hole: Uint8Array (>0 = fill; the value blends the result in);
  // opts: {patch (odd, 7), avoid: Uint8Array of pixels never to copy from, seed, quality 1..3}.
  // Returns {data, width, height}. Deterministic for a given seed.
  PPX.inpaint = function (img, hole, opts) {
    opts = opts || {};
    var P = Math.max(3, (opts.patch | 0) || 7) | 1, r = P >> 1, W = img.width, H = img.height, n = W * H, q = opts.quality || 2;
    var rnd = (function (s) { s = (s >>> 0) || 1; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(opts.seed || 12345);
    // level 0
    var L0 = { w: W, h: H, d: new Float32Array(n * 4), hole: new Uint8Array(n), avoid: new Uint8Array(n) }, i, k, any = false;
    for (i = 0; i < n; i++) { for (k = 0; k < 4; k++) L0.d[i * 4 + k] = img.data[i * 4 + k]; if (hole[i]) { L0.hole[i] = 1; any = true; } if (opts.avoid && opts.avoid[i]) L0.avoid[i] = 1; }
    if (!any) return { data: new Uint8ClampedArray(img.data), width: W, height: H };
    var levels = [L0];
    function extent(L) { var x0 = L.w, y0 = L.h, x1 = -1, y1 = -1; for (var y = 0; y < L.h; y++) for (var x = 0; x < L.w; x++) if (L.hole[y * L.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return Math.max(x1 - x0 + 1, y1 - y0 + 1); }
    while (levels.length < 9) {
      var A = levels[levels.length - 1];
      if (Math.min(A.w, A.h) < 6 * P || extent(A) <= 2 * P) break;
      var w2 = A.w >> 1, h2 = A.h >> 1, B = { w: w2, h: h2, d: new Float32Array(w2 * h2 * 4), hole: new Uint8Array(w2 * h2), avoid: new Uint8Array(w2 * h2) };
      for (var y = 0; y < h2; y++) for (var x = 0; x < w2; x++) {
        var o = y * w2 + x, cnt = 0, s0 = 0, s1 = 0, s2 = 0, s3 = 0, hl = 0, av = 0;
        for (var yy = 0; yy < 2; yy++) for (var xx = 0; xx < 2; xx++) {
          var a = (y * 2 + yy) * A.w + x * 2 + xx;
          if (A.hole[a]) { hl = 1; continue; }
          if (A.avoid[a]) av = 1;
          cnt++; s0 += A.d[a * 4]; s1 += A.d[a * 4 + 1]; s2 += A.d[a * 4 + 2]; s3 += A.d[a * 4 + 3];
        }
        B.hole[o] = hl; B.avoid[o] = av;
        if (cnt) { B.d[o * 4] = s0 / cnt; B.d[o * 4 + 1] = s1 / cnt; B.d[o * 4 + 2] = s2 / cnt; B.d[o * 4 + 3] = s3 / cnt; }
      }
      levels.push(B);
    }
    // per level: valid source centres (whole patch inside, away from the hole and avoided pixels) and the target centres
    function prep(L) {
      var w = L.w, h = L.h, N = w * h, bad = new Uint8Array(N), x, y, dx, dy;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var p = y * w + x; if (!L.hole[p] && !L.avoid[p]) continue;
        for (dy = -r; dy <= r; dy++) { var yy2 = y + dy; if (yy2 < 0 || yy2 >= h) continue; for (dx = -r; dx <= r; dx++) { var xx2 = x + dx; if (xx2 >= 0 && xx2 < w) bad[yy2 * w + xx2] = 1; } }
      }
      var list = [], tgt = [];
      for (y = r; y < h - r; y++) for (x = r; x < w - r; x++) if (!bad[y * w + x]) list.push(y * w + x);
      for (var p2 = 0; p2 < N; p2++) if (bad[p2] && (L.hole[p2] || nearHole(L, p2))) tgt.push(p2);
      L.valid = new Uint8Array(N); list.forEach(function (v) { L.valid[v] = 1; });
      L.list = list; L.tgt = tgt;
    }
    function nearHole(L, p) { var w = L.w, x = p % w, y = (p - x) / w; for (var dy = -r; dy <= r; dy++) { var yy3 = y + dy; if (yy3 < 0 || yy3 >= L.h) continue; for (var dx = -r; dx <= r; dx++) { var xx3 = x + dx; if (xx3 >= 0 && xx3 < w && L.hole[yy3 * w + xx3]) return true; } } return false; }
    levels.forEach(prep);
    if (!levels[0].list.length) throw new Error("There is not enough area around the selection to fill it from");
    // patch distance (SSD over RGBA), with early exit
    function dist(L, t, s, best) {
      var w = L.w, h = L.h, d = L.d, tx = t % w, ty = (t - tx) / w, sx = s % w, sy = (s - sx) / w, sum = 0, cnt = 0;
      for (var dy = -r; dy <= r; dy++) {
        var yt = ty + dy; if (yt < 0 || yt >= h) continue;
        var rt = yt * w, rs = (sy + dy) * w;
        for (var dx = -r; dx <= r; dx++) {
          var xt = tx + dx; if (xt < 0 || xt >= w) continue;
          var a = (rt + xt) * 4, b = (rs + sx + dx) * 4, e0 = d[a] - d[b], e1 = d[a + 1] - d[b + 1], e2 = d[a + 2] - d[b + 2], e3 = d[a + 3] - d[b + 3];
          sum += e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3; cnt++;
        }
        if (sum > best && cnt) return Infinity;
      }
      return cnt ? sum * (P * P) / cnt : Infinity;
    }
    function randValid(L) { return L.list[Math.floor(rnd() * L.list.length)]; }
    function patchmatch(L, nnf, nd, iters) {
      var w = L.w, h = L.h, T = L.tgt, maxR = Math.max(w, h);
      for (var it = 0; it < iters; it++) {
        var fwd = it % 2 === 0, step = fwd ? 1 : -1;
        for (var j = fwd ? 0 : T.length - 1; fwd ? j < T.length : j >= 0; j += step) {
          var t = T[j], tx = t % w, ty = (t - tx) / w, best = nd[t], bs = nnf[t];
          // propagation from the left/up (forward) or right/down (backward) neighbour
          for (var c = 0; c < 2; c++) {
            var nx = c === 0 ? tx - step : tx, ny = c === 0 ? ty : ty - step;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            var np = ny * w + nx, ns = nnf[np]; if (ns < 0) continue;
            var cs = ns + (c === 0 ? step : step * w);
            var csx = ns % w + (c === 0 ? step : 0); if (csx < 0 || csx >= w || cs < 0 || cs >= w * h || !L.valid[cs]) continue;
            var dd = dist(L, t, cs, best); if (dd < best) { best = dd; bs = cs; }
          }
          // random search around the current best
          var bx = bs % w, by = (bs - bx) / w;
          for (var R = maxR; R >= 1; R >>= 1) {
            var rx = Math.round(bx + (rnd() * 2 - 1) * R), ry = Math.round(by + (rnd() * 2 - 1) * R);
            if (rx < r || ry < r || rx >= w - r || ry >= h - r) continue;
            var cand = ry * w + rx; if (!L.valid[cand]) continue;
            var d2 = dist(L, t, cand, best); if (d2 < best) { best = d2; bs = cand; }
          }
          nnf[t] = bs; nd[t] = best;
        }
      }
    }
    function vote(L, nnf, nd) {
      var w = L.w, h = L.h, T = L.tgt, N = w * h, acc = new Float32Array(N * 4), ws = new Float32Array(N), d = L.d;
      var sample = [];
      for (var j = 0; j < T.length; j += Math.max(1, Math.floor(T.length / 400))) if (isFinite(nd[T[j]])) sample.push(nd[T[j]]);
      sample.sort(function (a, b) { return a - b; });
      var s2 = Math.max(1, sample.length ? sample[Math.floor(sample.length * 0.75)] : 1);
      for (j = 0; j < T.length; j++) {
        var t = T[j], s = nnf[t]; if (s < 0) continue;
        var wt = Math.exp(-(isFinite(nd[t]) ? nd[t] : s2 * 4) / (2 * s2)) + 1e-6;
        var tx = t % w, ty = (t - tx) / w, sx = s % w, sy = (s - sx) / w;
        for (var dy = -r; dy <= r; dy++) {
          var yt = ty + dy; if (yt < 0 || yt >= h) continue;
          for (var dx = -r; dx <= r; dx++) {
            var xt = tx + dx; if (xt < 0 || xt >= w) continue;
            var p = yt * w + xt; if (!L.hole[p]) continue;
            var b = ((sy + dy) * w + sx + dx) * 4;
            acc[p * 4] += d[b] * wt; acc[p * 4 + 1] += d[b + 1] * wt; acc[p * 4 + 2] += d[b + 2] * wt; acc[p * 4 + 3] += d[b + 3] * wt; ws[p] += wt;
          }
        }
      }
      for (var p2 = 0; p2 < N; p2++) if (L.hole[p2] && ws[p2] > 0) for (var c = 0; c < 4; c++) d[p2 * 4 + c] = acc[p2 * 4 + c] / ws[p2];
    }
    // coarsest level: rough fill by peeling the hole from its edge inwards
    function peel(L) {
      var w = L.w, h = L.h, known = new Uint8Array(w * h), front = [], p, x, y;
      for (p = 0; p < w * h; p++) known[p] = L.hole[p] ? 0 : 1;
      for (var pass = 0; pass < w + h; pass++) {
        front.length = 0;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          p = y * w + x; if (known[p]) continue;
          if ((x > 0 && known[p - 1]) || (x < w - 1 && known[p + 1]) || (y > 0 && known[p - w]) || (y < h - 1 && known[p + w])) front.push(p);
        }
        if (!front.length) break;
        front.forEach(function (p3) {
          var x3 = p3 % w, y3 = (p3 - x3) / w, c = [0, 0, 0, 0], m = 0;
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x3 + dx, yy = y3 + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; var q2 = yy * w + xx; if (!known[q2]) continue; for (var k2 = 0; k2 < 4; k2++) c[k2] += L.d[q2 * 4 + k2]; m++; }
          for (var k3 = 0; k3 < 4; k3++) L.d[p3 * 4 + k3] = c[k3] / m;
        });
        front.forEach(function (p3) { known[p3] = 1; });
      }
    }
    var top = levels.length - 1, nnf = null, nd = null;
    for (var lv = top; lv >= 0; lv--) {
      var L = levels[lv], N2 = L.w * L.h, nn = new Int32Array(N2).fill(-1), dd = new Float32Array(N2).fill(Infinity);
      if (!L.list.length) { nnf = null; continue; }      // nothing to copy from at this scale
      if (!nnf) {
        peel(L);            // rough start: peel the hole from its edge inwards
        L.tgt.forEach(function (t) { nn[t] = randValid(L); });
      } else {
        var U = levels[lv + 1];
        L.tgt.forEach(function (t) {
          var x = t % L.w, y = (t - x) / L.w, cx = Math.min(U.w - 1, x >> 1), cy = Math.min(U.h - 1, y >> 1), cs = nnf[cy * U.w + cx];
          if (cs >= 0) { var sx = (cs % U.w) * 2 + (x & 1), sy = Math.floor(cs / U.w) * 2 + (y & 1), s = sy * L.w + sx; if (sx >= r && sy >= r && sx < L.w - r && sy < L.h - r && L.valid[s]) { nn[t] = s; return; } }
          nn[t] = randValid(L);
        });
        vote(L, nn, dd);       // the finer hole starts from the coarse solution
      }
      L.tgt.forEach(function (t) { dd[t] = dist(L, t, nn[t], Infinity); });
      var em = lv === top ? 3 + 2 * q : lv === 0 ? q : 1 + q;
      for (var e = 0; e < em; e++) {
        patchmatch(L, nn, dd, lv === 0 ? 1 + (q > 1 ? 1 : 0) : 2);
        vote(L, nn, dd);
        if (e < em - 1) L.tgt.forEach(function (t) { dd[t] = dist(L, t, nn[t], Infinity); });
      }
      nnf = nn; nd = dd;
    }
    void nd;
    var out = new Uint8ClampedArray(img.data);
    for (i = 0; i < n; i++) if (hole[i]) {
      var kk = hole[i] / 255;
      for (k = 0; k < 4; k++) out[i * 4 + k] = c255(img.data[i * 4 + k] + (L0.d[i * 4 + k] - img.data[i * 4 + k]) * kk);
    }
    return { data: out, width: W, height: H };
  };

  // ---------- generic dispatcher (the worker calls this) ----------
  PPX.ping = function () { return true; };
  PPX.ALLOWED = ["ping", "inpaint"];
  PPX.call = function (fn, args) {
    if (PPX.ALLOWED.indexOf(fn) < 0 || typeof PPX[fn] !== "function") throw new Error("Not allowed: " + fn);
    return PPX[fn].apply(null, args || []);
  };
  G.PPX = PPX;
})(typeof self !== "undefined" ? self : this);
