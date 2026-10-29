/* Selection lane: all 27 layer blend modes. Formulas follow the W3C Compositing and Blending spec where it has
   one (the canvas does those natively); the rest (dissolve, linear burn/dodge, vivid/linear/pin light, hard mix,
   subtract, divide, darker/lighter colour) are done here in JS on straight-alpha pixels. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX;

  var MODES = [["normal", "Normal"], ["dissolve", "Dissolve"],
    ["darken", "Darken"], ["multiply", "Multiply"], ["color-burn", "Colour burn"], ["linear-burn", "Linear burn"], ["darker-color", "Darker colour"],
    ["lighten", "Lighten"], ["screen", "Screen"], ["color-dodge", "Colour dodge"], ["linear-dodge", "Linear dodge (add)"], ["lighter-color", "Lighter colour"],
    ["overlay", "Overlay"], ["soft-light", "Soft light"], ["hard-light", "Hard light"], ["vivid-light", "Vivid light"], ["linear-light", "Linear light"], ["pin-light", "Pin light"], ["hard-mix", "Hard mix"],
    ["difference", "Difference"], ["exclusion", "Exclusion"], ["subtract", "Subtract"], ["divide", "Divide"],
    ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Colour"], ["luminosity", "Luminosity"]];
  var GROUPS = [["", 0, 2], ["Darken", 2, 7], ["Lighten", 7, 12], ["Contrast", 12, 19], ["Inversion", 19, 23], ["Component", 23, 27]];
  var LABEL = {}; MODES.forEach(function (m) { LABEL[m[0]] = m[1]; }); LABEL.pass = "Pass through";
  // The canvas implements these exactly (W3C); everything else goes through the pixel path.
  var NATIVE = { normal: "source-over", multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten", "color-dodge": "color-dodge",
    "color-burn": "color-burn", "hard-light": "hard-light", "soft-light": "soft-light", difference: "difference", exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity" };
  // Keep the same array object (core.js validates projects against it), in the usual menu order.
  PE.BLENDS.length = 0; MODES.forEach(function (m) { PE.BLENDS.push(m[0]); });

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function burn(b, s) { return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s); }
  function dodge(b, s) { return b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)); }
  var SEP = {
    normal: function (b, s) { return s; }, dissolve: function (b, s) { return s; },
    multiply: function (b, s) { return b * s; }, screen: function (b, s) { return b + s - b * s; },
    overlay: function (b, s) { return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); },
    darken: Math.min, lighten: Math.max, difference: function (b, s) { return Math.abs(b - s); },
    "color-dodge": dodge, "color-burn": burn,
    "hard-light": function (b, s) { return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); },
    "soft-light": function (b, s) { if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b); var D = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b); return b + (2 * s - 1) * (D - b); },
    exclusion: function (b, s) { return b + s - 2 * b * s; },
    "linear-burn": function (b, s) { return Math.max(0, b + s - 1); }, "linear-dodge": function (b, s) { return Math.min(1, b + s); },
    "vivid-light": function (b, s) { return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1); },
    "linear-light": function (b, s) { return clamp01(b + 2 * s - 1); },
    "pin-light": function (b, s) { return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1); },
    "hard-mix": function (b, s) { return b + s >= 1 ? 1 : 0; },
    subtract: function (b, s) { return Math.max(0, b - s); },
    divide: function (b, s) { return s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s); }
  };
  function lum(c) { return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; }
  function clipColor(c) {
    var l = lum(c), n = Math.min(c[0], c[1], c[2]), x = Math.max(c[0], c[1], c[2]);
    if (n < 0) c = c.map(function (v) { return l + (v - l) * l / (l - n); });
    if (x > 1) c = c.map(function (v) { return l + (v - l) * (1 - l) / (x - l); });
    return c;
  }
  function setLum(c, l) { var d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); }
  function sat(c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); }
  function setSat(c, s) {
    var o = [0, 0, 0], i = [0, 1, 2].sort(function (a, b) { return c[a] - c[b]; }), mn = i[0], md = i[1], mx = i[2];
    if (c[mx] > c[mn]) { o[md] = (c[md] - c[mn]) * s / (c[mx] - c[mn]); o[mx] = s; }
    return o;
  }
  var NONSEP = {
    hue: function (b, s) { return setLum(setSat(s, sat(b)), lum(b)); },
    saturation: function (b, s) { return setLum(setSat(b, sat(s)), lum(b)); },
    color: function (b, s) { return setLum(s, lum(b)); },
    luminosity: function (b, s) { return setLum(b, lum(s)); },
    "darker-color": function (b, s) { return lum(s) < lum(b) ? s : b; },
    "lighter-color": function (b, s) { return lum(s) > lum(b) ? s : b; }
  };
  // Deterministic per-pixel noise for dissolve (document pixel coordinates).
  function hash(x, y) { var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  PIX.dissolveHash = hash;
  // Blend result B(Cb, Cs) for colours in 0..1.
  function mixRGB(mode, b, s) {
    if (NONSEP[mode]) return NONSEP[mode](b, s);
    var f = SEP[mode] || SEP.normal; return [f(b[0], s[0]), f(b[1], s[1]), f(b[2], s[2])];
  }
  PIX.blendRGB = mixRGB;
  PIX.blendLabel = function (m) { return LABEL[m] || m; };
  PIX.BLEND_GROUPS = GROUPS; PIX.BLEND_LIST = MODES; PIX.BLEND_NATIVE = NATIVE;

  // Source-over with any blend mode; back/src [r,g,b,a] 0..255, opacity 0..1, x/y = document pixel (dissolve). Straight alpha out.
  PIX.compositePixel = function (mode, back, src, opacity, x, y) {
    var ab = back[3] / 255, as = src[3] / 255 * (opacity == null ? 1 : opacity);
    if (mode === "dissolve") as = hash(x || 0, y || 0) < as ? 1 : 0;
    var ao = as + ab * (1 - as);
    if (ao <= 0) return [0, 0, 0, 0];
    var cb = [back[0] / 255, back[1] / 255, back[2] / 255], cs = [src[0] / 255, src[1] / 255, src[2] / 255], B = mixRGB(mode, cb, cs), out = [0, 0, 0, Math.round(ao * 255)];
    for (var i = 0; i < 3; i++) { var mixed = (1 - ab) * cs[i] + ab * B[i]; out[i] = Math.round(clamp01((as * mixed + ab * cb[i] * (1 - as)) / ao) * 255); }
    return out;
  };

  // Byte lookup table of B(b, s) for a separable mode (index b*256+s).
  var LUTS = {};
  function lut8(mode) {
    if (LUTS[mode]) return LUTS[mode];
    var f = SEP[mode] || SEP.normal, t = new Uint8Array(65536);
    for (var b = 0; b < 256; b++) for (var s = 0; s < 256; s++) t[b * 256 + s] = Math.round(clamp01(f(b / 255, s / 255)) * 255);
    return (LUTS[mode] = t);
  }
  // Non-separable modes without allocations: results land in OR/OG/OB (0..1).
  var OR = 0, OG = 0, OB = 0;
  function setLumS(r, g, b, l) {
    var d = l - (0.3 * r + 0.59 * g + 0.11 * b); r += d; g += d; b += d;
    var L = 0.3 * r + 0.59 * g + 0.11 * b, n = Math.min(r, g, b), x = Math.max(r, g, b), k;
    if (n < 0) { k = L / (L - n); r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k; }
    if (x > 1) { k = (1 - L) / (x - L); r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k; }
    OR = r; OG = g; OB = b;
  }
  function setSatS(r, g, b, s) {     // -> OR/OG/OB
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx <= mn) { OR = OG = OB = 0; return; }
    var k = s / (mx - mn);
    OR = (r - mn) * k; OG = (g - mn) * k; OB = (b - mn) * k;
  }
  function nonsepS(mode, br, bg, bb, sr, sg, sb) {
    var lb = 0.3 * br + 0.59 * bg + 0.11 * bb, ls = 0.3 * sr + 0.59 * sg + 0.11 * sb;
    switch (mode) {
      case "hue": setSatS(sr, sg, sb, Math.max(br, bg, bb) - Math.min(br, bg, bb)); setLumS(OR, OG, OB, lb); return;
      case "saturation": setSatS(br, bg, bb, Math.max(sr, sg, sb) - Math.min(sr, sg, sb)); setLumS(OR, OG, OB, lb); return;
      case "color": setLumS(sr, sg, sb, lb); return;
      case "luminosity": setLumS(br, bg, bb, ls); return;
      case "darker-color": if (ls < lb) { OR = sr; OG = sg; OB = sb; } else { OR = br; OG = bg; OB = bb; } return;
      default: if (ls > lb) { OR = sr; OG = sg; OB = sb; } else { OR = br; OG = bg; OB = bb; }
    }
  }
  // Blend src over dst in place (both straight RGBA bytes of the same region). k: optional per-pixel weights 0..255 (mask),
  // opacity 0..1, pos = {x0, y0, w, sx, sy, ox, oy}: maps region pixel -> document pixel for dissolve.
  PIX.blendRegion = function (dst, src, mode, opacity, k, pos) {
    var n = dst.length >> 2, ns = !!NONSEP[mode], T = ns ? null : lut8(mode), dis = mode === "dissolve", op = opacity / 255;
    for (var p = 0, i = 0; p < n; p++, i += 4) {
      var sa = src[i + 3]; if (!sa) continue;
      var as = sa * op; if (k) as *= k[p] / 255;
      if (dis) { var rx = p % pos.w, ry = (p - rx) / pos.w; as = hash(Math.floor((pos.x0 + rx - pos.ox) / pos.sx), Math.floor((pos.y0 + ry - pos.oy) / pos.sy)) < as ? 1 : 0; }
      if (as <= 0) continue;
      var da = dst[i + 3], r, g, b;
      if (da === 0) { dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = as * 255; continue; }
      if (ns) { nonsepS(mode, dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255, src[i] / 255, src[i + 1] / 255, src[i + 2] / 255); r = clamp01(OR) * 255; g = clamp01(OG) * 255; b = clamp01(OB) * 255; }
      else { r = T[(dst[i] << 8) | src[i]]; g = T[(dst[i + 1] << 8) | src[i + 1]]; b = T[(dst[i + 2] << 8) | src[i + 2]]; }
      if (da === 255) { dst[i] += as * (r - dst[i]); dst[i + 1] += as * (g - dst[i + 1]); dst[i + 2] += as * (b - dst[i + 2]); continue; }
      var ab = da / 255, ao = as + ab * (1 - as), w1 = as * (1 - ab) / ao, w2 = as * ab / ao, w3 = ab * (1 - as) / ao;
      dst[i] = w1 * src[i] + w2 * r + w3 * dst[i]; dst[i + 1] = w1 * src[i + 1] + w2 * g + w3 * dst[i + 1]; dst[i + 2] = w1 * src[i + 2] + w2 * b + w3 * dst[i + 2];
      dst[i + 3] = ao * 255;
    }
    return dst;
  };
  // Clipping: blend src into dst only inside `shape` (the base layer's alpha, 0..255 per pixel). dst alpha never grows
  // past the shape: the backdrop is treated as covering the shape, composited, then scaled back by the shape.
  PIX.clipRegion = function (dst, src, shape, mode, opacity, pos) {
    var n = dst.length >> 2, ns = !!NONSEP[mode], T = ns ? null : lut8(mode), dis = mode === "dissolve", op = opacity / 255;
    for (var p = 0, i = 0; p < n; p++, i += 4) {
      var S = shape[p], sa = src[i + 3]; if (!S || !sa) continue;
      var as = sa * op;
      if (dis) { var rx = p % pos.w, ry = (p - rx) / pos.w; as = hash(Math.floor((pos.x0 + rx - pos.ox) / pos.sx), Math.floor((pos.y0 + ry - pos.oy) / pos.sy)) < as ? 1 : 0; }
      if (as <= 0) continue;
      var s01 = S / 255, ab = Math.min(1, dst[i + 3] / 255 / s01), r, g, b;
      if (ns) { nonsepS(mode, dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255, src[i] / 255, src[i + 1] / 255, src[i + 2] / 255); r = clamp01(OR) * 255; g = clamp01(OG) * 255; b = clamp01(OB) * 255; }
      else { r = T[(dst[i] << 8) | src[i]]; g = T[(dst[i + 1] << 8) | src[i + 1]]; b = T[(dst[i + 2] << 8) | src[i + 2]]; }
      var ao = as + ab * (1 - as), w1 = as * (1 - ab) / ao, w2 = as * ab / ao, w3 = ab * (1 - as) / ao;
      dst[i] = w1 * src[i] + w2 * r + w3 * dst[i]; dst[i + 1] = w1 * src[i + 1] + w2 * g + w3 * dst[i + 1]; dst[i + 2] = w1 * src[i + 2] + w2 * b + w3 * dst[i + 2];
      dst[i + 3] = ao * S;
    }
    return dst;
  };
})();
