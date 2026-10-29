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

  // ---------- generic dispatcher (the worker calls this) ----------
  PPX.ping = function () { return true; };
  PPX.ALLOWED = ["ping"];
  PPX.call = function (fn, args) {
    if (PPX.ALLOWED.indexOf(fn) < 0 || typeof PPX[fn] !== "function") throw new Error("Not allowed: " + fn);
    return PPX[fn].apply(null, args || []);
  };
  G.PPX = PPX;
})(typeof self !== "undefined" ? self : this);
