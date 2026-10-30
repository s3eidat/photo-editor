/* Adjust lane: colour and tone adjustments (auto tone / contrast / colour and more). Pure maths, runs in page and worker. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, c255 = A.c255, num = A.num;

  // ---------- auto tone / auto contrast / auto colour ----------
  // Each works out a levels-style table from the (selected) pixels' histograms and applies it to the same pixels.
  // auto tone: every channel stretched on its own (also removes colour casts in the black and white points).
  // auto contrast: one stretch for all channels together (keeps the colours' balance).
  // auto colour: per-channel stretch, then a per-channel gamma that makes the average midtone neutral grey.
  A.autoLuts = function (img, kind, sel, clipPct) {
    var H = A.hists(img, sel), f = clamp(clipPct == null ? 0.1 : +clipPct, 0, 10) / 100, lr, lg, lb;
    if (!H.n) return null;
    if (kind === "autoContrast") {
      var all = new Float64Array(256);
      for (var i = 0; i < 256; i++) all[i] = H.r[i] + H.g[i] + H.b[i];
      lr = lg = lb = A.stretch(A.clipLo(all, f), A.clipHi(all, f));
      return [lr, lg, lb];
    }
    lr = A.stretch(A.clipLo(H.r, f), A.clipHi(H.r, f)); lg = A.stretch(A.clipLo(H.g, f), A.clipHi(H.g, f)); lb = A.stretch(A.clipLo(H.b, f), A.clipHi(H.b, f));
    if (kind === "autoColor") {
      var d = img.data, s = [0, 0, 0], cnt = 0;
      for (var k = 0, p = 0; k < d.length; k += 4, p++) {
        if (!d[k + 3] || (sel && sel[p] < 128)) continue;
        var r = lr[d[k]], g = lg[d[k + 1]], b = lb[d[k + 2]], l = A.lum(r, g, b);
        if (l < 48 || l > 208) continue;
        s[0] += r; s[1] += g; s[2] += b; cnt++;
      }
      if (cnt > 16) {
        var m = [s[0] / cnt / 255, s[1] / cnt / 255, s[2] / cnt / 255], t = (m[0] + m[1] + m[2]) / 3;
        var luts = [lr, lg, lb].map(function (L0, c) {
          var gm = m[c] > 0.01 && m[c] < 0.99 && t > 0.01 && t < 0.99 ? clamp(Math.log(m[c]) / Math.log(t), 0.6, 1.6) : 1, out = new Uint8Array(256);
          for (var q = 0; q < 256; q++) out[q] = c255(Math.pow(L0[q] / 255, 1 / gm) * 255);
          return out;
        });
        lr = luts[0]; lg = luts[1]; lb = luts[2];
      }
    }
    return [lr, lg, lb];
  };
  ["autoTone", "autoContrast", "autoColor"].forEach(function (kind) {
    A.reg(kind, function (img, p, sel) {
      var L = A.autoLuts(img, kind, sel, p.clip);
      return L ? PIX.applyLuts(img, L[0], L[1], L[2], sel) : img;
    });
  });

  // ---------- shadows / highlights ----------
  // Lifts dark areas and recovers bright ones by their neighbourhood brightness (a blurred luminance B), so whole
  // regions move together and the texture inside them is kept: L' = L * target(B) / B (B is edge-aware, so no halos). Tonal width limits the range
  // of B that is touched, radius sets the neighbourhood size. Colour sets how much the colours follow the gain.
  A.reg("shadowsHighlights", function (img, p, sel) {
    var w = img.width, h = img.height, n = w * h, d = img.data;
    var aS = clamp(num(p.sAmt, 35), 0, 100) / 100, tS = 0.02 + clamp(num(p.sTone, 50), 0, 100) / 100 * 0.98, rS = clamp(num(p.sRad, 30), 0, 500);
    var aH = clamp(num(p.hAmt, 0), 0, 100) / 100, tH = 0.02 + clamp(num(p.hTone, 50), 0, 100) / 100 * 0.98, rH = clamp(num(p.hRad, 30), 0, 500);
    var col = clamp(num(p.color, 20), -100, 100) / 100, mid = clamp(num(p.mid, 0), -100, 100) / 100;
    var S = clamp(num(p._scale, 1), 0.01, 1); rS = Math.max(rS ? 1 : 0, Math.round(rS * S)); rH = Math.max(rH ? 1 : 0, Math.round(rH * S));
    var L = A.lumPlane(img, 1 / 255), Bs = aS ? A.guided(L, L, w, h, rS, 0.01) : null;     // edge-aware: no halos along strong edges
    var Bh = aH ? (Bs && rH === rS ? Bs : A.guided(L, L, w, h, rH, 0.01)) : null, ce = 0.5 + col / 2;
    for (var q = 0, i = 0; q < n; q++, i += 4) {
      if (sel && !sel[q]) continue;
      var l = L[q], l2 = l;
      if (aS) {
        var b = Bs[q], ws = 1 - A.smooth(0, tS, b);
        if (ws > 0 && b > 1e-4) l2 = l * Math.min(10, Math.pow(b, 1 / (1 + 3 * aS * ws)) / b);
      }
      if (aH) {
        var bh = Bh[q], wh = A.smooth(1 - tH, 1, bh);
        if (wh > 0 && bh < 1 - 1e-4) l2 = 1 - (1 - Math.min(1, l2)) * Math.min(10, (1 - (1 - Math.pow(1 - bh, 1 / (1 + 3 * aH * wh)))) / (1 - bh));
      }
      if (mid) l2 = 0.5 + (l2 - 0.5) * (1 + mid * 4 * l2 * (1 - l2));
      l2 = clamp(l2, 0, 1);
      if (l2 === l && !mid) continue;
      var k = l > 1e-4 ? l2 / l : 1, ck = Math.pow(k, ce), L255 = l * 255, T = l2 * 255;
      var r = T + (d[i] - L255) * ck, g = T + (d[i + 1] - L255) * ck, bb = T + (d[i + 2] - L255) * ck;
      if (l <= 1e-4) { r = g = bb = T; }
      if (sel && sel[q] < 255) { var f = sel[q] / 255; r = d[i] + (r - d[i]) * f; g = d[i + 1] + (g - d[i + 1]) * f; bb = d[i + 2] + (bb - d[i + 2]) * f; }
      d[i] = r; d[i + 1] = g; d[i + 2] = bb;
    }
    return img;
  });

  // ---------- photo filter ----------
  // Like a coloured gel in front of the lens: multiply by the filter colour at `density`, then (optionally)
  // put each pixel's luminance back so only the colour shifts.
  A.reg("photoFilter", function (img, p, sel) {
    var C = A.hex(p.color, [236, 138, 0]), k = clamp(num(p.density, 25), 0, 100) / 100, keep = p.keepLum !== false;
    var fr = 1 + (C[0] / 255 - 1) * k, fg = 1 + (C[1] / 255 - 1) * k, fb = 1 + (C[2] / 255 - 1) * k;
    return A.perPixel(img, sel, function (r, g, b, o) {
      var R = r * fr, Gg = g * fg, B = b * fb;
      if (keep) { var dl = A.lum(r, g, b) - A.lum(R, Gg, B); R += dl; Gg += dl; B += dl; }
      o[0] = R; o[1] = Gg; o[2] = B;
    });
  });

  // ---------- desaturate with a choice of grey ----------
  var GREY = {
    lum601: function (r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; },
    lum709: function (r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; },
    average: function (r, g, b) { return (r + g + b) / 3; },
    lightness: function (r, g, b) { return (Math.max(r, g, b) + Math.min(r, g, b)) / 2; },
    max: function (r, g, b) { return Math.max(r, g, b); },
    min: function (r, g, b) { return Math.min(r, g, b); },
    red: function (r) { return r; }, green: function (r, g) { return g; }, blue: function (r, g, b) { return b; }
  };
  A.GREY = GREY;
  A.reg("desatMethod", function (img, p, sel) {
    var f = GREY[p.method] || GREY.lum601, k = clamp(num(p.amount, 100), 0, 100) / 100;
    return A.perPixel(img, sel, function (r, g, b, o) { var v = f(r, g, b); o[0] = r + (v - r) * k; o[1] = g + (v - g) * k; o[2] = b + (v - b) * k; });
  });

  // ---------- posterize ----------
  A.lutPosterize = function (n) {
    n = clamp(Math.round(num(n, 4)), 2, 255);
    var l = new Uint8Array(256);
    for (var i = 0; i < 256; i++) l[i] = c255(Math.round(i * (n - 1) / 255) * 255 / (n - 1));
    return l;
  };
  A.reg("posterize", function (img, p, sel) { var l = A.lutPosterize(p.levels); return PIX.applyLuts(img, l, l, l, sel); });

  // ---------- equalize ----------
  // One table for all three channels from their combined histogram (keeps hues), so brightness values are spread
  // evenly. basis "sel": histogram of the selection, applied to it; "image": histogram of the selection, applied to all.
  A.lutEqualize = function (img, sel) {
    var H = A.hists(img, sel), all = new Float64Array(256), i, tot = 0;
    for (i = 0; i < 256; i++) { all[i] = H.r[i] + H.g[i] + H.b[i]; tot += all[i]; }
    var l = new Uint8Array(256); if (!tot) { for (i = 0; i < 256; i++) l[i] = i; return l; }
    var acc = 0, first = 0; for (i = 0; i < 256; i++) if (all[i] > 0) { first = all[i]; break; }
    for (i = 0; i < 256; i++) { acc += all[i]; l[i] = c255(tot - first > 0 ? (acc - first) / (tot - first) * 255 : i); }
    return l;
  };
  A.reg("equalize", function (img, p, sel) { var l = A.lutEqualize(img, sel); return PIX.applyLuts(img, l, l, l, p.basis === "image" ? null : sel); });

  // ---------- gradient map ----------
  // stops: [[position 0..1, "#rrggbb"], ...] -> 256 colours, looked up by each pixel's luminance.
  A.gradientTable = function (stops, reverse) {
    var st = (Array.isArray(stops) ? stops : []).map(function (s) { return [clamp(num(s && s[0], 0), 0, 1), A.hex(s && s[1], [0, 0, 0])]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!st.length) st = [[0, [0, 0, 0]], [1, [255, 255, 255]]];
    var t = new Float32Array(256 * 3);
    for (var i = 0; i < 256; i++) {
      var x = reverse ? 1 - i / 255 : i / 255, j = 0;
      while (j < st.length - 1 && st[j + 1][0] < x) j++;
      var a = st[j], b = st[Math.min(st.length - 1, j + 1)], k = b[0] > a[0] ? clamp((x - a[0]) / (b[0] - a[0]), 0, 1) : (x > a[0] ? 1 : 0);
      if (x <= st[0][0]) { a = b = st[0]; k = 0; }
      for (var c = 0; c < 3; c++) t[i * 3 + c] = a[1][c] + (b[1][c] - a[1][c]) * k;
    }
    return t;
  };
  A.reg("gradientMap", function (img, p, sel) {
    var T = A.gradientTable(p.stops, !!p.reverse), R = p.dither ? A.rng(p.seed || 3) : null;
    return A.perPixel(img, sel, function (r, g, b, o) {
      var l = A.lum(r, g, b);
      if (R) l += R() - 0.5;
      var x = clamp(l, 0, 255), i0 = Math.floor(x), i1 = Math.min(255, i0 + 1), f = x - i0;
      for (var c = 0; c < 3; c++) o[c] = T[i0 * 3 + c] + (T[i1 * 3 + c] - T[i0 * 3 + c]) * f;
    });
  });

  // ---------- channel mixer ----------
  // Each output channel = sum of input channels x percent + constant (% of full scale). Monochrome: one mix for all.
  A.reg("channelMixer", function (img, p, sel) {
    function row(v, d) { v = Array.isArray(v) ? v : d; return [num(v[0], d[0]) / 100, num(v[1], d[1]) / 100, num(v[2], d[2]) / 100, num(v[3], d[3]) / 100 * 255]; }
    var mono = !!p.mono, M = mono ? row(p.gray, [40, 40, 20, 0]) : null, R = row(p.r, [100, 0, 0, 0]), Gg = row(p.g, [0, 100, 0, 0]), B = row(p.b, [0, 0, 100, 0]);
    return A.perPixel(img, sel, function (r, g, b, o) {
      if (mono) { var v = r * M[0] + g * M[1] + b * M[2] + M[3]; o[0] = o[1] = o[2] = v; return; }
      o[0] = r * R[0] + g * R[1] + b * R[2] + R[3]; o[1] = r * Gg[0] + g * Gg[1] + b * Gg[2] + Gg[3]; o[2] = r * B[0] + g * B[1] + b * B[2] + B[3];
    });
  });

  // ---------- selective colour ----------
  // Nine ranges (six hues + whites, neutrals, blacks). Each pixel belongs to a range with a weight (its share of
  // chroma for hues, its distance from mid grey for whites/blacks). The range's cyan/magenta/yellow/black change the
  // "ink" (1 - channel) of red/green/blue by that weight: absolute adds, relative scales the ink already there.
  A.SC_RANGES = ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"];
  A.scWeights = function (r, g, b, w) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), mid = r + g + b - mx - mn;
    for (var i = 0; i < 9; i++) w[i] = 0;
    if (mx > mn) {
      if (r === mx) w[0] = mx - mid; else if (g === mx) w[2] = mx - mid; else w[4] = mx - mid;
      if (b === mn) w[1] = Math.min(r, g) - b; else if (r === mn) w[3] = Math.min(g, b) - r; else w[5] = Math.min(r, b) - g;
    }
    w[6] = Math.max(0, (mn - 0.5) * 2); w[8] = Math.max(0, (0.5 - mx) * 2); w[7] = clamp(1 - (Math.abs(mx - 0.5) + Math.abs(mn - 0.5)), 0, 1);
    return w;
  };
  A.reg("selectiveColor", function (img, p, sel) {
    var adj = p.adj || {}, rel = p.method !== "absolute", R = [], any = false, w = new Float32Array(9);
    A.SC_RANGES.forEach(function (k, i) { var a = Array.isArray(adj[k]) ? adj[k] : [0, 0, 0, 0]; R[i] = [0, 1, 2, 3].map(function (j) { return clamp(num(a[j], 0), -100, 100) / 100; }); if (R[i].some(Boolean)) any = true; });
    if (!any) return img;
    return A.perPixel(img, sel, function (r, g, b, o) {
      var v = [r / 255, g / 255, b / 255], ink = [1 - v[0], 1 - v[1], 1 - v[2]], d = [0, 0, 0];
      A.scWeights(v[0], v[1], v[2], w);
      for (var i = 0; i < 9; i++) {
        var wi = w[i]; if (!wi) continue;
        var a = R[i];
        for (var c = 0; c < 3; c++) { var t = a[c] + a[3]; if (t) d[c] += rel ? ink[c] * t * wi : t * wi; }
      }
      o[0] = (1 - clamp(ink[0] + d[0], 0, 1)) * 255; o[1] = (1 - clamp(ink[1] + d[1], 0, 1)) * 255; o[2] = (1 - clamp(ink[2] + d[2], 0, 1)) * 255;
    });
  });

  // ---------- levels per channel ----------
  // p.rgb / p.r / p.g / p.b = [inBlack, gamma, inWhite, outBlack, outWhite]; each channel's table, then the master.
  function lv(a) { a = Array.isArray(a) ? a : []; return PIX.lutLevels(clamp(num(a[0], 0), 0, 253), clamp(num(a[2], 255), 2, 255), clamp(num(a[1], 1), 0.1, 9.99), clamp(num(a[3], 0), 0, 255), clamp(num(a[4], 255), 0, 255)); }
  A.reg("levelsPlus", function (img, p, sel) {
    var M = lv(p.rgb), R = lv(p.r), Gt = lv(p.g), B = lv(p.b), lr = new Uint8Array(256), lg = new Uint8Array(256), lb = new Uint8Array(256);
    for (var i = 0; i < 256; i++) { lr[i] = M[R[i]]; lg[i] = M[Gt[i]]; lb[i] = M[B[i]]; }
    return PIX.applyLuts(img, lr, lg, lb, sel);
  });
  // Levels settings for the auto button: "tone" per channel, "contrast" all together, "color" per channel + neutral gamma.
  A.levelsAuto = function (img, sel, kind, clipPct) {
    var H = A.hists(img, sel), f = clamp(clipPct == null ? 0.1 : +clipPct, 0, 10) / 100, out = { rgb: [0, 1, 255, 0, 255], r: [0, 1, 255, 0, 255], g: [0, 1, 255, 0, 255], b: [0, 1, 255, 0, 255] };
    if (!H.n) return out;
    if (kind === "contrast") { var all = new Float64Array(256); for (var i = 0; i < 256; i++) all[i] = H.r[i] + H.g[i] + H.b[i]; out.rgb = [A.clipLo(all, f), 1, Math.max(A.clipLo(all, f) + 2, A.clipHi(all, f)), 0, 255]; return out; }
    ["r", "g", "b"].forEach(function (c) { var lo = Math.min(253, A.clipLo(H[c], f)); out[c] = [lo, 1, Math.max(lo + 2, A.clipHi(H[c], f)), 0, 255]; });
    if (kind === "color") {
      var L = A.autoLuts(img, "autoColor", sel, clipPct), T = A.autoLuts(img, "autoTone", sel, clipPct);
      ["r", "g", "b"].forEach(function (c, k) {      // gamma that maps the tone-only result of mid grey onto the colour result
        var a = T[k][128] / 255, b = L[k][128] / 255; out[c][1] = a > 0.01 && a < 0.99 && b > 0.01 && b < 0.99 ? clamp(Math.log(a) / Math.log(b), 0.1, 9.99) : 1;
      });
    }
    return out;
  };

  // ---------- hue / saturation per colour range ----------
  // p.master = [hue, sat, light]; p.ranges[i] = [hue, sat, light, a, b, c, d] for reds, yellows, greens, cyans,
  // blues, magentas: full effect between b and c degrees, fading from a and to d. colorize = [hue, sat, light].
  A.HS_RANGES = [["reds", 345, 15], ["yellows", 45, 75], ["greens", 105, 135], ["cyans", 165, 195], ["blues", 225, 255], ["magentas", 285, 315]];
  function inRange(hh, a, b, c, d) {
    function wrap(x) { return ((x % 360) + 360) % 360; }
    var t = wrap(hh - a), lb = wrap(b - a), lc = wrap(c - a), ld = wrap(d - a);
    if (t <= lb) return lb ? t / lb : 1;
    if (t <= lc) return 1;
    if (t <= ld) return ld > lc ? 1 - (t - lc) / (ld - lc) : 0;
    return 0;
  }
  A.hsRangeWeight = inRange;
  A.reg("hueSatPlus", function (img, p, sel) {
    var M = Array.isArray(p.master) ? p.master : [0, 0, 0], col = Array.isArray(p.colorize) ? p.colorize : null, RG = Array.isArray(p.ranges) ? p.ranges : [];
    return A.perPixel(img, sel, function (r, g, b, o) {
      var hsl = A.rgb2hsl(r, g, b), h = hsl[0], s = hsl[1], l = hsl[2], dh = num(M[0], 0), ds = num(M[1], 0) / 100, dl = num(M[2], 0) / 100;
      if (col) { h = num(col[0], 0); s = clamp(num(col[1], 25), 0, 100) / 100; dl = num(col[2], 0) / 100; }
      else if (s > 0) for (var k = 0; k < RG.length && k < 6; k++) {
        var q = RG[k]; if (!q || !(q[0] || q[1] || q[2])) continue;
        var wgt = inRange(hsl[0], num(q[3], 0), num(q[4], 0), num(q[5], 0), num(q[6], 0)) * Math.min(1, s * 4);
        if (wgt) { dh += num(q[0], 0) * wgt; ds += num(q[1], 0) / 100 * wgt; dl += num(q[2], 0) / 100 * wgt; }
      }
      if (!col) { h += dh; s = ds >= 0 ? s + (1 - s) * Math.min(1, ds) * (s > 0 ? 1 : 0) : s * (1 + Math.max(-1, ds)); }
      l = dl >= 0 ? l + (1 - l) * Math.min(1, dl) : l * (1 + Math.max(-1, dl));
      var c = A.hsl2rgb(h, clamp(s, 0, 1), clamp(l, 0, 1)); o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
  });

  // ---------- black & white with tint ----------
  A.reg("bwPlus", function (img, p, sel) {
    var W = {}; Object.keys(PIX.BW_DEFAULT).forEach(function (k) { W[k] = isFinite(+p[k]) ? +p[k] : PIX.BW_DEFAULT[k]; });
    var tint = !!p.tint, th = num(p.tintHue, 35), ts = clamp(num(p.tintSat, 25), 0, 100) / 100;
    return A.perPixel(img, sel, function (r, g, b, o) {
      var v = PIX.bwGray(r, g, b, W);
      if (tint && ts) { var c = A.hsl2rgb(th, ts, v / 255); o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; } else { o[0] = o[1] = o[2] = v; }
    });
  });
  // Auto weights: spread the six colour ranges' greys apart according to how much of each the image has.
  A.bwAuto = function (img, sel) {
    var d = img.data, acc = [0, 0, 0, 0, 0, 0], tot = 0;
    for (var i = 0, q = 0; i < d.length; i += 16, q += 4) {
      if (sel && sel[q] < 128) continue;
      var hs = A.rgb2hsv(d[i], d[i + 1], d[i + 2]); if (hs[1] < 0.15) continue;
      acc[Math.round(hs[0] / 60) % 6] += hs[1]; tot += hs[1];
    }
    var names = ["reds", "yellows", "greens", "cyans", "blues", "magentas"], out = {};
    names.forEach(function (k, j) { var share = tot ? acc[j] / tot : 0; out[k] = Math.round(clamp(PIX.BW_DEFAULT[k] + (share - 1 / 6) * 120 * (j % 2 ? -1 : 1), -200, 300)); });
    return out;
  };
  A.reg("curvesPlus", function (img, p, sel) { return PIX.adjust(img, "curves", p, sel); });

  // ---------- brightness / contrast (modern: a curve that keeps black and white, or the classic linear one) ----------
  A.lutBrightnessModern = function (b, c) {
    var l = new Uint8Array(256), bb = clamp(b, -150, 150) / 150, cc = clamp(c, -50, 100) / 100;
    for (var i = 0; i < 256; i++) {
      var x = i / 255;
      x = bb >= 0 ? 1 - Math.pow(1 - x, 1 + bb * 1.6) : Math.pow(x, 1 - bb * 1.6);            // brightness bends the curve, ends stay put
      if (cc) { var s2 = x * x * (3 - 2 * x); x = cc > 0 ? x + (s2 - x) * Math.min(1, cc * 1.3) : x + (x - s2) * -cc; }
      l[i] = c255(x * 255);
    }
    return l;
  };
  A.reg("brightnessPlus", function (img, p, sel) {
    var l = p.legacy ? PIX.lutBrightnessContrast(num(p.b, 0), num(p.c, 0)) : A.lutBrightnessModern(num(p.b, 0), num(p.c, 0));
    return PIX.applyLuts(img, l, l, l, sel);
  });

  // ---------- video: de-interlace, broadcast-safe colours ----------
  A.reg("deinterlace", function (img, p, sel) {
    var w = img.width, h = img.height, d = img.data, src = new Uint8ClampedArray(d), odd = p.field !== "even", interp = p.mode !== "duplicate";
    for (var y = odd ? 1 : 0; y < h; y += 2) for (var x = 0; x < w; x++) {
      var q = y * w + x, i = q * 4; if (sel && !sel[q]) continue;
      var a = (Math.max(0, y - 1) * w + x) * 4, b = (Math.min(h - 1, y + 1) * w + x) * 4, k = sel ? sel[q] / 255 : 1;
      for (var c = 0; c < 4; c++) { var v = interp ? (src[a + c] + src[b + c]) / 2 : src[(y > 0 ? a : b) + c]; d[i + c] = src[i + c] + (v - src[i + c]) * k; }
    }
    return img;
  });
  // Broadcast-safe: limit saturation so the composite signal stays inside the legal range (YIQ chroma limit).
  A.reg("broadcastSafe", function (img, p, sel) {
    var lim = clamp(num(p.limit, 110), 50, 130) / 100;
    return A.perPixel(img, sel, function (r, g, b, o) {
      var R = r / 255, G2 = g / 255, B = b / 255, Y = 0.299 * R + 0.587 * G2 + 0.114 * B, I = 0.596 * R - 0.274 * G2 - 0.322 * B, Q = 0.211 * R - 0.523 * G2 + 0.312 * B, C = Math.sqrt(I * I + Q * Q), k = 1;
      if (Y + C > lim) k = Math.max(0, (lim - Y) / C); if (Y - C < -0.2) k = Math.min(k, (Y + 0.2) / C);
      if (k >= 1) { o[0] = r; o[1] = g; o[2] = b; return; }
      I *= k; Q *= k;
      o[0] = (Y + 0.956 * I + 0.621 * Q) * 255; o[1] = (Y - 0.272 * I - 0.647 * Q) * 255; o[2] = (Y - 1.106 * I + 1.703 * Q) * 255;
    });
  });

  // ---------- the editor's own filters, with pixel sizes that follow p._scale (for reduced-size previews) ----------
  A.reg("blurS", A.filter(function (img, p) { return PIX.gaussian(img, clamp(num(p.radius, 4), 0, 250) * clamp(num(p._scale, 1), 0.01, 1)); }));
  A.reg("unsharpS", A.filter(function (img, p) { var S = clamp(num(p._scale, 1), 0.01, 1); return PIX.unsharp(img, num(p.amount, 120), Math.max(0.1, num(p.radius, 2) * S), num(p.threshold, 0)); }));
  A.reg("pixelateS", A.filter(function (img, p) { return PIX.pixelate(img, Math.max(1, Math.round(num(p.size, 12) * clamp(num(p._scale, 1), 0.01, 1)))); }));
  A.reg("colorBalancePlus", function (img, p, sel) { return PIX.adjust(img, "colorBalance", p, sel); });
})(typeof self !== "undefined" ? self : this);
