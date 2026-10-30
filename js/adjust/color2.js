/* Adjust lane: replace colour, match colour, HDR toning. Pure maths, runs in page and worker. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num;

  // ---------- replace colour ----------
  // Pixels close to any sample colour (CIE Lab distance under the fuzziness) get a hue / saturation / lightness
  // shift, scaled by how close they are. showMask: output the selection as grey (white = fully selected).
  A.rcWeight = function (lab, samples, fuzz) {
    var best = 0, R = 0.6 * fuzz + 1;
    for (var k = 0; k < samples.length; k++) {
      var s = samples[k], dL = lab[0] - s[0], da = lab[1] - s[1], db = lab[2] - s[2], dE = Math.sqrt(dL * dL * 0.6 + da * da + db * db), w = 1 - dE / R;
      if (w > best) best = w;
    }
    return best <= 0 ? 0 : best >= 0.5 ? 1 : best * 2;      // flat top (within 0.3 * fuzziness fully selected), soft edge
  };
  A.reg("replaceColor", function (img, p, sel) {
    var cols = (Array.isArray(p.colors) && p.colors.length ? p.colors : [p.color || "#ff0000"]).slice(0, 16).map(function (hx) { var c = A.hex(hx, [255, 0, 0]); return A.rgb2lab(c[0], c[1], c[2]); });
    var fuzz = clamp(num(p.fuzz, 40), 0, 200), H = clamp(num(p.hue, 0), -180, 180), S = clamp(num(p.sat, 0), -100, 100) / 100, Lg = clamp(num(p.light, 0), -100, 100) / 100, show = !!p.showMask, lab = [0, 0, 0];
    return A.perPixel(img, sel, function (r, g, b, o) {
      A.rgb2lab(r, g, b, lab);
      var w = A.rcWeight(lab, cols, fuzz);
      if (show) { o[0] = o[1] = o[2] = w * 255; return; }
      if (!w) { o[0] = r; o[1] = g; o[2] = b; return; }
      var hsl = A.rgb2hsl(r, g, b), hh = hsl[0] + H, s = S >= 0 ? hsl[1] + (1 - hsl[1]) * S : hsl[1] * (1 + S), l = Lg >= 0 ? hsl[2] + (1 - hsl[2]) * Lg : hsl[2] * (1 + Lg);
      var c = A.hsl2rgb(hh, clamp(s, 0, 1), clamp(l, 0, 1));
      o[0] = r + (c[0] - r) * w; o[1] = g + (c[1] - g) * w; o[2] = b + (c[2] - b) * w;
    });
  });

  // ---------- match colour ----------
  // Statistics (mean, standard deviation of L, a, b) of the (selected) opaque pixels, sampled.
  A.labStats = function (img, sel, maxN) {
    var d = img.data, n = img.width * img.height, step = Math.max(1, Math.floor(n / (maxN || 250000))), s = [0, 0, 0], s2 = [0, 0, 0], c = 0, lab = [0, 0, 0];
    for (var q = 0; q < n; q += step) {
      var i = q * 4; if (d[i + 3] < 128 || (sel && sel[q] < 128)) continue;
      A.rgb2lab(d[i], d[i + 1], d[i + 2], lab);
      for (var k = 0; k < 3; k++) { s[k] += lab[k]; s2[k] += lab[k] * lab[k]; }
      c++;
    }
    if (!c) return null;
    var m = s.map(function (v) { return v / c; });
    return { m: m, sd: s2.map(function (v, k) { return Math.sqrt(Math.max(1e-6, v / c - m[k] * m[k])); }), n: c };
  };
  // p.src = stats of the source; luminance %, intensity % (colour), fade %, neutralize (drop the target's cast).
  A.reg("matchColor", function (img, p, sel) {
    var T = A.labStats(img, sel), S = p.src && p.src.m ? p.src : T;
    if (!T || !S) return img;
    var lk = clamp(num(p.luminance, 100), 1, 200) / 100, ck = clamp(num(p.intensity, 100), 0, 200) / 100, fade = clamp(num(p.fade, 0), 0, 100) / 100, neu = !!p.neutralize;
    var sm = S.m.slice(), ss = S.sd.slice();
    if (neu) { sm[1] = 0; sm[2] = 0; if (S === T) { ss = T.sd; } }
    var kL = ss[0] / T.sd[0], ka = ss[1] / T.sd[1], kb = ss[2] / T.sd[2], lab = [0, 0, 0], out = [0, 0, 0];
    if (S === T && !neu) { kL = ka = kb = 1; }
    return A.perPixel(img, sel, function (r, g, b, o) {
      A.rgb2lab(r, g, b, lab);
      var L = ((lab[0] - T.m[0]) * kL + sm[0]) * lk, a = ((lab[1] - T.m[1]) * ka + sm[1]) * ck, bb = ((lab[2] - T.m[2]) * kb + sm[2]) * ck;
      A.lab2rgb(clamp(L, 0, 100), a, bb, out);
      o[0] = out[0] + (r - out[0]) * fade; o[1] = out[1] + (g - out[1]) * fade; o[2] = out[2] + (b - out[2]) * fade;
    });
  });

  // ---------- HDR toning (one image) ----------
  // Log-luminance split into a smooth base (edge-aware) and detail; the base is compressed by `strength`, detail
  // boosted, then exposure / gamma / shadow / highlight and colour. Colours follow the luminance ratio.
  A.reg("hdrToning", function (img, p, sel) {
    var w = img.width, h = img.height, n = w * h, d = img.data, q, i;
    var S = clamp(num(p._scale, 1), 0.01, 1), rad = Math.max(1, Math.round(clamp(num(p.radius, 60), 1, 500) * S)), str = clamp(num(p.strength, 0.5), 0.1, 4);
    var gam = clamp(num(p.gamma, 1), 0.1, 3), ev = clamp(num(p.exposure, 0), -5, 5), det = clamp(num(p.detail, 30), -100, 300) / 100;
    var shd = clamp(num(p.shadow, 0), -100, 100) / 100, hil = clamp(num(p.highlight, 0), -100, 100) / 100, vib = clamp(num(p.vibrance, 0), -100, 100) / 100, sat = clamp(num(p.saturation, 20), -100, 100) / 100;
    var lg = new Float32Array(n), Y = new Float32Array(n);
    for (q = 0, i = 0; q < n; q++, i += 4) { var y = (0.2126 * A.S2L[d[i]] + 0.7152 * A.S2L[d[i + 1]] + 0.0722 * A.S2L[d[i + 2]]); Y[q] = y; lg[q] = Math.log(y + 1e-4); }
    var base = p.smooth ? A.guided(lg, lg, w, h, rad, 0.08) : A.blur(new Float32Array(lg), w, h, rad / 2);
    var bmax = -Infinity, bmin = Infinity; for (q = 0; q < n; q += 3) { if (base[q] > bmax) bmax = base[q]; if (base[q] < bmin) bmin = base[q]; }
    var comp = 1 / (1 + str), mid = (bmax + bmin) / 2, gain = Math.pow(2, ev);
    for (q = 0, i = 0; q < n; q++, i += 4) {
      var l2 = (base[q] - mid) * comp + mid + (lg[q] - base[q]) * (1 + det) + (bmax - mid) * (1 - comp) * 0.6;
      var y2 = Math.max(0, Math.exp(l2) - 1e-4) * gain;
      var v = A.toDisp(y2);
      if (gam !== 1) v = Math.pow(Math.max(0, v), 1 / gam);
      if (shd) v += shd * 0.25 * (1 - A.smooth(0, 0.5, v)) * (1 - v);
      if (hil) v += hil * 0.25 * A.smooth(0.5, 1, v) * v;
      var v0 = A.toDisp(Y[q]), k = v0 > 1e-4 ? v / v0 : 1;
      var r = A.toDisp(A.S2L[d[i]]) * k, g = A.toDisp(A.S2L[d[i + 1]]) * k, b = A.toDisp(A.S2L[d[i + 2]]) * k;
      if (v0 <= 1e-4) { r = g = b = v; }
      var yy = 0.2126 * r + 0.7152 * g + 0.0722 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b), s0 = mx > 1e-5 ? (mx - mn) / mx : 0;
      var ck = (1 + sat) * (1 + vib * (vib > 0 ? 1.3 * (1 - s0) : 1));
      ck = Math.max(0, ck);
      var R = (yy + (r - yy) * ck) * 255, Gg = (yy + (g - yy) * ck) * 255, B = (yy + (b - yy) * ck) * 255;
      if (sel && sel[q] < 255) { var f = sel[q] / 255; R = d[i] + (R - d[i]) * f; Gg = d[i + 1] + (Gg - d[i + 1]) * f; B = d[i + 2] + (B - d[i + 2]) * f; }
      if (sel && !sel[q]) continue;
      d[i] = R; d[i + 1] = Gg; d[i + 2] = B;
    }
    return img;
  });
})(typeof self !== "undefined" ? self : this);
