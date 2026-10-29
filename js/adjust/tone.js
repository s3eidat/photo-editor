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
})(typeof self !== "undefined" ? self : this);
