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
})(typeof self !== "undefined" ? self : this);
