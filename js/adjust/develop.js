/* Adjust lane: the "Develop" pipeline (raw-style editing of a pixel layer in one pass).
   Order: lens geometry -> linear light (white balance, exposure, dehaze) -> display space (noise reduction, tone,
   presence, colour) -> sharpening -> vignette -> grain. Pure maths, runs in page and worker. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num, smooth = A.smooth;
  function n100(v) { return clamp(num(v, 0), -100, 100) / 100; }

  // Float sRGB transfer with linear interpolation (keeps smooth gradients smooth); extends above 1 for headroom.
  var LS = new Float32Array(4097);
  for (var q = 0; q <= 4096; q++) LS[q] = A.l2s(q / 4096) / 255;
  function toDisp(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    var f = x * 4096, i = f | 0, t = f - i; return LS[i] + (LS[i + 1] - LS[i]) * t;
  }
  A.toDisp = toDisp;

  // Hue bands of the colour mixer (degrees, HSV hue).
  var BANDS = A.DEV_BANDS = [0, 30, 60, 120, 180, 225, 270, 315];
  function bandWeights(hue, w) {
    for (var i = 0; i < 8; i++) w[i] = 0;
    for (var j = 0; j < 8; j++) {
      var a = BANDS[j], b = j < 7 ? BANDS[j + 1] : 360;
      if (hue >= a && hue < b) { var t = (hue - a) / (b - a); w[j] = 1 - t; w[(j + 1) % 8] = t; return w; }
    }
    w[0] = 1; return w;
  }
  A.bandWeights = bandWeights;
  // Unit-ish chroma direction for a hue (what a colour-grading wheel adds), zero luminance.
  function hueVec(hDeg) {
    var c = PIX.hsl2rgb(hDeg, 1, 0.5), r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [r - y, g - y, b - y];
  }
  // Rotate an RGB chroma vector around the grey axis by `deg` (Rodrigues formula on axis (1,1,1)/sqrt3).
  function rotMat(deg) {
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = (1 - c) / 3, r3 = Math.sqrt(1 / 3) * s;
    return [c + k, k - r3, k + r3, k + r3, c + k, k - r3, k - r3, k + r3, c + k];
  }

  A.devDefaults = function () {
    return { temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
      tcHigh: 0, tcLight: 0, tcDark: 0, tcShadow: 0, curve: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
      hslH: [0, 0, 0, 0, 0, 0, 0, 0], hslS: [0, 0, 0, 0, 0, 0, 0, 0], hslL: [0, 0, 0, 0, 0, 0, 0, 0],
      cgShadow: [0, 0, 0], cgMid: [0, 0, 0], cgHigh: [0, 0, 0], cgGlobal: [0, 0, 0], cgBlend: 50, cgBalance: 0,
      sharpen: 0, sharpRadius: 1, sharpDetail: 25, sharpMask: 0, nrLum: 0, nrColor: 0,
      distort: 0, caRed: 0, caBlue: 0, vignette: 0, vigMid: 50, vigRound: 0, vigFeather: 50,
      grain: 0, grainSize: 25, grainRough: 50 };
  };

  // White balance that makes a sampled colour (0..255 sRGB) neutral: inverse of the temp / tint gains above.
  A.devNeutral = function (r, g, b) {
    var R = Math.max(1e-4, A.S2L[r | 0]), Gg = Math.max(1e-4, A.S2L[g | 0]), B = Math.max(1e-4, A.S2L[b | 0]);
    return { temp: clamp(Math.round(Math.log2(B / R) / 1.4 * 100), -100, 100), tint: clamp(Math.round(-Math.log2(Math.sqrt(R * B) / Gg) / 0.45 * 100), -100, 100) };
  };
  // Suggested basic settings from the image's luminance histogram (exposure to a mid median, whites / blacks to
  // the ends, highlights / shadows when much of the image sits near them).
  A.devAuto = function (img, sel) {
    var H = A.hists(img, sel).l, tot = 0, i; for (i = 0; i < 256; i++) tot += H[i];
    if (!tot) return {};
    function pct(f) { var acc = 0; for (var k = 0; k < 256; k++) { acc += H[k]; if (acc >= tot * f) return k; } return 255; }
    var med = pct(0.5), lo = pct(0.005), hi = pct(0.995), dark = 0, bright = 0;
    for (i = 0; i < 40; i++) dark += H[i]; for (i = 216; i < 256; i++) bright += H[i];
    var ev = clamp(Math.log2(A.S2L[118] / Math.max(1e-4, A.S2L[med])) * 0.7, -2, 2);
    return { exposure: Math.round(ev * 20) / 20, contrast: clamp(Math.round((150 - (hi - lo)) / 6), -20, 25), whites: clamp(Math.round((250 - hi) / 2), -30, 40), blacks: clamp(Math.round((5 - lo) / 2), -40, 20),
      highlights: -clamp(Math.round(bright / tot * 300), 0, 60), shadows: clamp(Math.round(dark / tot * 250), 0, 60), vibrance: 10 };
  };

  // ---------- lens: distortion + lateral chromatic aberration (resample, per channel) ----------
  function lens(img, dist, caR, caB) {
    var w = img.width, h = img.height, src = PIX.copyImg(img), d = img.data, cx = w / 2, cy = h / 2, R = Math.sqrt(cx * cx + cy * cy) || 1;
    var k = -dist * 0.35, fit = k > 0 ? 1 / (1 + k) : 1, sR = 1 + caR * 0.006, sB = 1 + caB * 0.006, o = [0, 0, 0, 0];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - cy) / R, r2 = dx * dx + dy * dy, f = (1 + k * r2) * fit, i = (y * w + x) * 4;
      A.sample(src, cx + dx * f * R, cy + dy * f * R, o, "clamp");
      var gG = o[1], aA = o[3];
      if (caR || caB) {
        A.sample(src, cx + dx * f * sR * R, cy + dy * f * sR * R, o, "clamp"); var rr = o[0];
        A.sample(src, cx + dx * f * sB * R, cy + dy * f * sB * R, o, "clamp");
        d[i] = rr; d[i + 1] = gG; d[i + 2] = o[2];
      } else { d[i] = o[0]; d[i + 1] = gG; d[i + 2] = o[2]; }
      d[i + 3] = aA;
    }
  }

  A.reg("develop", function (img, p, sel) {
    var w = img.width, h = img.height, n = w * h, d = img.data, diag = Math.sqrt(w * w + h * h), i, q, PS = clamp(num(p._scale, 1), 0.01, 1);
    var before = sel ? PIX.copyImg(img) : null;
    var dist = n100(p.distort), caR = n100(p.caRed), caB = n100(p.caBlue);
    if (dist || caR || caB) lens(img, dist, caR, caB);

    // ---- linear light: white balance, exposure ----
    var t = n100(p.temp), ti = n100(p.tint), ev = clamp(num(p.exposure, 0), -5, 5);
    var gr = Math.pow(2, t * 0.7), gb = Math.pow(2, -t * 0.7), gg = Math.pow(2, -ti * 0.45), nrm = 0.2126 * gr + 0.7152 * gg + 0.0722 * gb, kx = Math.pow(2, ev) / nrm;
    gr *= kx; gg *= kx; gb *= kx;
    var R = new Float32Array(n), Gc = new Float32Array(n), B = new Float32Array(n), S2L = A.S2L;
    for (q = 0, i = 0; q < n; q++, i += 4) { R[q] = S2L[d[i]] * gr; Gc[q] = S2L[d[i + 1]] * gg; B[q] = S2L[d[i + 2]] * gb; }

    // ---- dehaze (linear): haze = smooth estimate of the darkest channel; remove (or add) it ----
    var dh = n100(p.dehaze);
    if (dh) {
      var dark = new Float32Array(n), Y0 = new Float32Array(n), hist = new Uint32Array(1024), amb = 0;
      for (q = 0; q < n; q++) { dark[q] = Math.min(R[q], Gc[q], B[q]); Y0[q] = 0.2126 * R[q] + 0.7152 * Gc[q] + 0.0722 * B[q]; }
      var rad = Math.max(2, Math.round(diag / 60)), dsm = A.guided(Y0, A.boxMean(dark, w, h, Math.max(1, rad >> 2)), w, h, rad, 1e-3);
      for (q = 0; q < n; q++) hist[clamp(Math.floor(dsm[q] * 1023), 0, 1023)]++;
      for (var acc = 0, hb = 1023; hb >= 0; hb--) { acc += hist[hb]; if (acc > n * 0.002) { amb = Math.max(0.2, (hb + 0.5) / 1023); break; } }
      for (q = 0; q < n; q++) {
        var hz = clamp(dsm[q] / amb, 0, 1);
        if (dh > 0) { var tr = Math.max(0.12, 1 - 0.92 * dh * hz); R[q] = (R[q] - amb) / tr + amb; Gc[q] = (Gc[q] - amb) / tr + amb; B[q] = (B[q] - amb) / tr + amb; }
        else { var mix = -dh * 0.75; R[q] += (amb - R[q]) * mix; Gc[q] += (amb - Gc[q]) * mix; B[q] += (amb - B[q]) * mix; }
      }
    }

    // ---- display space ----
    for (q = 0; q < n; q++) { R[q] = toDisp(R[q]); Gc[q] = toDisp(Gc[q]); B[q] = toDisp(B[q]); }
    var Y = new Float32Array(n);
    function lum() { for (var z = 0; z < n; z++) Y[z] = 0.2126 * R[z] + 0.7152 * Gc[z] + 0.0722 * B[z]; }
    function applyY(Y2) { for (var z = 0; z < n; z++) { var dy = Y2[z] - Y[z]; R[z] += dy; Gc[z] += dy; B[z] += dy; Y[z] = Y2[z]; } }
    lum();

    // noise reduction: luminance through an edge-aware smoother, colour by blurring the chroma
    var nl = clamp(num(p.nrLum, 0), 0, 100) / 100, nc = clamp(num(p.nrColor, 0), 0, 100) / 100;
    if (nl) {
      var base = A.guided(Y, Y, w, h, Math.max(1, Math.round((1 + nl * 3) * PS)), Math.pow(0.004 + nl * 0.05, 2)), Yn = new Float32Array(n);
      for (q = 0; q < n; q++) Yn[q] = Y[q] + (base[q] - Y[q]) * Math.min(1, nl * 1.5);
      applyY(Yn);
    }
    if (nc) {
      var cr = new Float32Array(n), cb = new Float32Array(n), sg = (1 + nc * 6) * PS;
      for (q = 0; q < n; q++) { cr[q] = R[q] - Y[q]; cb[q] = B[q] - Y[q]; }
      A.blur(cr, w, h, sg); A.blur(cb, w, h, sg);
      for (q = 0; q < n; q++) { R[q] = Y[q] + cr[q]; B[q] = Y[q] + cb[q]; Gc[q] = (Y[q] - 0.2126 * R[q] - 0.0722 * B[q]) / 0.7152; }
    }

    // tone: local highlights / shadows (edge-aware base), whites / blacks, contrast, parametric curve
    var sh = n100(p.shadows), hl = n100(p.highlights), wv = n100(p.whites), bv = n100(p.blacks), ct = n100(p.contrast);
    var tc = [n100(p.tcShadow), n100(p.tcDark), n100(p.tcLight), n100(p.tcHigh)];
    if (sh || hl || wv || bv || ct || tc[0] || tc[1] || tc[2] || tc[3]) {
      var Bs = sh || hl ? A.guided(Y, Y, w, h, Math.max(3, Math.round(diag * 0.015)), 0.012) : Y, Yt = new Float32Array(n);
      for (q = 0; q < n; q++) {
        var y = Y[q], b0 = Bs[q], y1 = y;
        if (sh && b0 > 1e-4) {
          var ws = 1 - smooth(0, 0.6, b0), tg = sh > 0 ? Math.pow(Math.min(b0, 1), 1 / (1 + 1.6 * sh * ws)) : Math.pow(Math.min(b0, 1), 1 + 1.4 * -sh * ws);
          y1 *= Math.min(8, tg / Math.min(b0, 1));
        }
        if (hl) y1 *= 1 + hl * 0.45 * smooth(0.35, 1, b0) * Math.min(b0, 1.5);
        if (wv) y1 += wv * 0.3 * smooth(0.45, 1, y1) * Math.min(y1, 1.2);
        if (bv) y1 += bv * 0.12 * (1 - smooth(0, 0.4, y1));
        if (ct && y1 > 0 && y1 < 1) y1 += ct * (y1 * y1 * (3 - 2 * y1) - y1);
        if (tc[0] || tc[1] || tc[2] || tc[3]) {
          var yc = clamp(y1, 0, 1);
          for (var z = 0; z < 4; z++) if (tc[z]) { var cz = 0.125 + z * 0.25, hz2 = Math.max(0, 1 - Math.abs(yc - cz) / 0.25); y1 += tc[z] * 0.16 * hz2 * hz2 * (3 - 2 * hz2); }
        }
        Yt[q] = y1;
      }
      for (q = 0; q < n; q++) {      // move RGB with the luminance: ratio for most pixels, additive near black
        var y0 = Y[q], ynew = Yt[q];
        if (y0 > 0.02) { var kk = ynew / y0; R[q] *= kk; Gc[q] *= kk; B[q] *= kk; } else { var ad = ynew - y0; R[q] += ad; Gc[q] += ad; B[q] += ad; }
        Y[q] = ynew;
      }
    }

    // point curve (master + per channel), in display space with interpolation between table entries
    var cv = p.curve || {}, isId = function (pts) { return !Array.isArray(pts) || pts.length < 2 || pts.every(function (q) { return q[0] === q[1]; }) && pts.length === 2 && pts[0][0] === 0 && pts[1][0] === 255; };
    if (!(isId(cv.rgb) && isId(cv.r) && isId(cv.g) && isId(cv.b))) {
      var LM = PIX.lutCurve(isId(cv.rgb) ? null : cv.rgb), LR = PIX.lutCurve(isId(cv.r) ? null : cv.r), LG = PIX.lutCurve(isId(cv.g) ? null : cv.g), LB = PIX.lutCurve(isId(cv.b) ? null : cv.b);
      var T3 = [new Float32Array(257), new Float32Array(257), new Float32Array(257)];
      for (var z2 = 0; z2 < 256; z2++) { T3[0][z2] = LM[LR[z2]] / 255; T3[1][z2] = LM[LG[z2]] / 255; T3[2][z2] = LM[LB[z2]] / 255; }
      T3.forEach(function (T) { T[256] = T[255]; });
      var look = function (T, v) { if (v <= 0) return T[0] + v; if (v >= 1) return T[255] + (v - 1); var f = v * 255, k = f | 0, t2 = f - k; return T[k] + (T[k + 1] - T[k]) * t2; };
      for (q = 0; q < n; q++) { R[q] = look(T3[0], R[q]); Gc[q] = look(T3[1], Gc[q]); B[q] = look(T3[2], B[q]); }
      lum();
    }

    // presence: texture (fine detail), clarity (midtone local contrast)
    var tx = n100(p.texture), cl = n100(p.clarity);
    if (tx || cl) {
      var Y2 = new Float32Array(Y);
      if (cl) {
        var bc = A.guided(Y, Y, w, h, Math.max(4, Math.round(diag * 0.012)), 0.02);
        for (q = 0; q < n; q++) { var ym = clamp(Y[q], 0, 1), mm = 1 - Math.pow(2 * ym - 1, 2); Y2[q] += cl * 0.9 * (Y[q] - bc[q]) * (0.35 + 0.65 * mm); }
      }
      if (tx) {
        var bt = A.blur(new Float32Array(Y), w, h, Math.max(1.2 * PS, diag / 1500)), bf = A.blur(new Float32Array(Y), w, h, 0.6 * PS);
        for (q = 0; q < n; q++) Y2[q] += tx * 1.2 * (bf[q] - bt[q]);
      }
      applyY(Y2);
    }

    // colour: mixer (per hue band), vibrance / saturation, grading
    var hH = p.hslH || [], hS = p.hslS || [], hL = p.hslL || [], anyHsl = false, HSLh = [], HSLs = [], HSLl = [];
    for (i = 0; i < 8; i++) { HSLh[i] = n100(hH[i]) * 30; HSLs[i] = n100(hS[i]); HSLl[i] = n100(hL[i]); if (HSLh[i] || HSLs[i] || HSLl[i]) anyHsl = true; }
    var vib = n100(p.vibrance), sat = n100(p.saturation);
    var cg = [p.cgShadow, p.cgMid, p.cgHigh, p.cgGlobal].map(function (v) { v = Array.isArray(v) ? v : [0, 0, 0]; var s = clamp(num(v[1], 0), 0, 100) / 100; return { vec: hueVec(num(v[0], 0)), s: s, l: n100(v[2]) }; });
    var anyCg = cg.some(function (z) { return z.s || z.l; }), bal = n100(p.cgBalance), blend = clamp(num(p.cgBlend, 50), 0, 100) / 100;
    var pivot = 0.5 - 0.22 * bal, wid = 0.08 + 0.34 * blend;
    if (anyHsl || vib || sat || anyCg) {
      var bw = new Float32Array(8), mats = {};
      for (q = 0; q < n; q++) {
        var r = R[q], g = Gc[q], bb = B[q], yy = 0.2126 * r + 0.7152 * g + 0.0722 * bb;
        var mx = Math.max(r, g, bb), mn = Math.min(r, g, bb), s0 = mx > 1e-5 ? (mx - mn) / mx : 0;
        var cr0 = r - yy, cg0 = g - yy, cb0 = bb - yy, ck = 1, dy2 = 0;
        if (anyHsl && mx - mn > 1e-5) {
          var hue = mx === r ? ((g - bb) / (mx - mn) + 6) % 6 * 60 : mx === g ? ((bb - r) / (mx - mn) + 2) * 60 : ((r - g) / (mx - mn) + 4) * 60;
          bandWeights(hue, bw);
          var dh2 = 0, ds = 0, dl = 0;
          for (var j = 0; j < 8; j++) if (bw[j]) { dh2 += bw[j] * HSLh[j]; ds += bw[j] * HSLs[j]; dl += bw[j] * HSLl[j]; }
          if (dh2) {
            var key = Math.round(dh2 * 4), M = mats[key] || (mats[key] = rotMat(key / 4));
            var a1 = M[0] * cr0 + M[1] * cg0 + M[2] * cb0, a2 = M[3] * cr0 + M[4] * cg0 + M[5] * cb0, a3 = M[6] * cr0 + M[7] * cg0 + M[8] * cb0;
            var ya = 0.2126 * a1 + 0.7152 * a2 + 0.0722 * a3; cr0 = a1 - ya; cg0 = a2 - ya; cb0 = a3 - ya;
          }
          ck *= Math.max(0, 1 + ds);
          dy2 += dl * 0.35 * Math.min(1, s0 * 1.5) * Math.max(0.05, Math.min(yy, 1));
        }
        if (vib) ck *= Math.max(0, 1 + vib * (vib > 0 ? 1.4 * (1 - s0) * (1 - s0 * 0.5) : 1));
        if (sat) ck *= Math.max(0, 1 + sat);
        r = yy + dy2 + cr0 * ck; g = yy + dy2 + cg0 * ck; bb = yy + dy2 + cb0 * ck;
        if (anyCg) {
          var yv = clamp(yy, 0, 1), wsh = 1 - smooth(0, pivot + wid, yv), whi = smooth(pivot - wid, 1, yv), wmi = Math.max(0, 1 - wsh - whi), zw = [wsh, wmi, whi, 1];
          for (var zz = 0; zz < 4; zz++) {
            var Z = cg[zz], wz = zw[zz]; if (!wz || !(Z.s || Z.l)) continue;
            var amt = Z.s * 0.32 * wz, lz = Z.l * 0.2 * wz;
            r += Z.vec[0] * amt + lz; g += Z.vec[1] * amt + lz; bb += Z.vec[2] * amt + lz;
          }
        }
        R[q] = r; Gc[q] = g; B[q] = bb;
      }
      lum();
    }

    // sharpening on luminance: amount, radius, detail (halo limit), masking (only edges)
    var sa = clamp(num(p.sharpen, 0), 0, 150) / 100;
    if (sa) {
      var sr = clamp(num(p.sharpRadius, 1), 0.5, 3) * PS, sd = clamp(num(p.sharpDetail, 25), 0, 100) / 100, sm = clamp(num(p.sharpMask, 0), 0, 100) / 100;
      var bl = A.blur(new Float32Array(Y), w, h, sr), lim = 0.02 + sd * 0.25, Ys = new Float32Array(n), em = null;
      if (sm) { em = new Float32Array(n); for (q = 0; q < n; q++) em[q] = Math.abs(Y[q] - bl[q]); em = A.boxMean(em, w, h, 2); }
      for (q = 0; q < n; q++) {
        var dd = clamp(Y[q] - bl[q], -lim, lim), mk = em ? smooth(sm * 0.012, sm * 0.04 + 0.002, em[q]) : 1;
        Ys[q] = Y[q] + sa * 1.6 * dd * mk;
      }
      applyY(Ys);
    }

    // vignette (midpoint, roundness, feather) and grain
    var va = n100(p.vignette), ga = clamp(num(p.grain, 0), 0, 100) / 100, gn = null;
    if (ga) {
      var gsz = (0.25 + clamp(num(p.grainSize, 25), 0, 100) / 100 * 2.2) * PS, rough = clamp(num(p.grainRough, 50), 0, 100) / 100, rnd = A.rng(4242);
      gn = new Float32Array(n);
      for (q = 0; q < n; q++) { var u1 = rnd() || 1e-9, u2 = rnd(); gn[q] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(6.2831853 * u2); }
      if (gsz > 0.4) {
        var fine = rough ? new Float32Array(gn) : null; A.blur(gn, w, h, gsz);
        var gsd = 0; for (q = 0; q < n; q += 7) gsd += gn[q] * gn[q]; gsd = Math.sqrt(gsd / Math.ceil(n / 7)) || 1;
        for (q = 0; q < n; q++) gn[q] = gn[q] / gsd * (1 - rough * 0.5) + (fine ? fine[q] * rough * 0.5 : 0);
      }
    }
    if (va || gn) {
      var mid = clamp(num(p.vigMid, 50), 0, 100) / 100, rnd2 = n100(p.vigRound), fea = Math.max(0.02, clamp(num(p.vigFeather, 50), 0, 100) / 100);
      var ax = w / 2, ay = h / 2, m0 = Math.min(ax, ay);
      ax = ax + (m0 - ax) * Math.max(0, rnd2); ay = ay + (m0 - ay) * Math.max(0, rnd2);
      var stretch = 1 - Math.min(0, rnd2) * 0.6;
      for (var yy2 = 0; yy2 < h; yy2++) for (var xx = 0; xx < w; xx++) {
        q = yy2 * w + xx;
        if (va) {
          var ex = (xx + 0.5 - w / 2) / ax, ey = (yy2 + 0.5 - h / 2) / (ay * stretch), rr = Math.sqrt(ex * ex + ey * ey) / Math.SQRT2;
          var s1 = 0.15 + mid * 0.75, vf = smooth(s1, s1 + fea * (1.25 - s1) + 0.02, rr);
          if (vf) { if (va < 0) { var kv = 1 + va * vf; R[q] *= kv; Gc[q] *= kv; B[q] *= kv; } else { var lv = va * vf; R[q] += (1 - R[q]) * lv; Gc[q] += (1 - Gc[q]) * lv; B[q] += (1 - B[q]) * lv; } }
        }
        if (gn) { var yg = clamp(0.2126 * R[q] + 0.7152 * Gc[q] + 0.0722 * B[q], 0, 1), gv = gn[q] * ga * 0.09 * (0.45 + 2.2 * yg * (1 - yg)); R[q] += gv; Gc[q] += gv; B[q] += gv; }
      }
    }

    for (q = 0, i = 0; q < n; q++, i += 4) { d[i] = R[q] * 255; d[i + 1] = Gc[q] * 255; d[i + 2] = B[q] * 255; }
    return before ? PIX.mixSel(before, img, sel) : img;
  });
})(typeof self !== "undefined" ? self : this);
