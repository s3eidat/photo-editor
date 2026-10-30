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

  // ---------- dodge / burn / sponge ----------
  // How much a tone range applies at lightness l (0..1).
  PPX.toneW = function (range, l) { return range === "shadows" ? (1 - l) * (1 - l) : range === "highlights" ? l * l : 4 * l * (1 - l); };
  // Full-strength dodge / burn of lightness l (the tool blends towards this by exposure x coverage).
  PPX.tone = function (kind, range, l) { var w = PPX.toneW(range, l) * 0.5; return kind === "burn" ? l - l * w : l + (1 - l) * w; };
  // protect: change lightness only (hue and saturation kept); otherwise each channel on its own.
  PPX.toneRGB = function (kind, range, protect, r, g, b) {
    var c = [r / 255, g / 255, b / 255];
    if (!protect) return c.map(function (v) { return PPX.tone(kind, range, v) * 255; });
    var o = setLum(c, PPX.tone(kind, range, lumF(c)));
    return [o[0] * 255, o[1] * 255, o[2] * 255];
  };
  // Sponge at full strength: mode "sat" | "desat"; vibrance goes easy on colours that are already strong / weak.
  PPX.sponge = function (mode, vib, r, g, b) {
    var c = [r / 255, g / 255, b / 255], s = satF(c), l = lumF(c), s2;
    if (mode === "sat") { if (s <= 0) return [r, g, b]; s2 = s + (1 - s) * (vib ? 0.6 * (1 - s) : 0.6); }
    else s2 = vib ? s * s : 0;
    var o = setLum(s2 > 0 ? setSat(c, s2) : [0, 0, 0], l);
    return [o[0] * 255, o[1] * 255, o[2] * 255];
  };

  // ---------- gradients ----------
  // g: {kind: "solid", stops: [{p, c: [r,g,b], m}], alpha: [{p, a, m}]} or {kind: "noise", rough, seed, restrict, transp}
  // (p and m are 0..1; m is the midpoint towards the next stop). Returns a Float32Array LUT of n RGBA (0..255, alpha 0..1).
  function ramp(list, t, get) {
    if (!list.length) return null;
    if (t <= list[0].p) return get(list[0]);
    for (var i = 0; i < list.length - 1; i++) {
      var a = list[i], b = list[i + 1];
      if (t <= b.p) {
        var u = b.p > a.p ? (t - a.p) / (b.p - a.p) : 1, m = clamp(a.m == null ? 0.5 : a.m, 0.01, 0.99);
        u = u < m ? 0.5 * u / m : 0.5 + 0.5 * (u - m) / (1 - m);
        var A = get(a), B = get(b);
        return A.map(function (v, k) { return v + (B[k] - v) * u; });
      }
    }
    return get(list[list.length - 1]);
  }
  PPX.noiseStops = function (g) {
    var R = PPX.rng(g.seed || 1), rough = clamp(g.rough == null ? 50 : g.rough, 0, 100) / 100, n = 2 + Math.round(rough * 28), stops = [], alpha = [];
    for (var i = 0; i < n; i++) {
      var p = i / (n - 1), c = [R() * 255, R() * 255, R() * 255];
      if (g.restrict) { var hsb = PPX.rgb2hsb(c[0], c[1], c[2]); c = PPX.hsb2rgb(hsb[0], 20 + hsb[1] * 0.6, 35 + hsb[2] * 0.6); }
      stops.push({ p: p, c: c, m: 0.5 + (R() - 0.5) * rough * 0.9 });
      alpha.push({ p: p, a: g.transp ? R() : 1, m: 0.5 });
    }
    return { stops: stops, alpha: alpha };
  };
  PPX.gradLut = function (g, n) {
    n = n || 1024;
    var s = g.kind === "noise" ? PPX.noiseStops(g) : g, lut = new Float32Array(n * 4);
    var cs = (s.stops || []).slice().sort(function (a, b) { return a.p - b.p; }), as = (s.alpha || []).slice().sort(function (a, b) { return a.p - b.p; });
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), c = ramp(cs, t, function (q) { return q.c; }) || [0, 0, 0], a = ramp(as, t, function (q) { return [q.a]; }) || [1];
      lut[i * 4] = c[0]; lut[i * 4 + 1] = c[1]; lut[i * 4 + 2] = c[2]; lut[i * 4 + 3] = a[0];
    }
    return lut;
  };
  // Position of a pixel along the gradient, 0..1 (before reverse). type: linear radial angle reflected diamond.
  PPX.gradT = function (type, px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, vx = px - ax, vy = py - ay;
    if (type === "radial") return Math.sqrt((vx * vx + vy * vy) / L2);
    if (type === "angle") { var t = (Math.atan2(vy, vx) - Math.atan2(dy, dx)) / (2 * Math.PI); t -= Math.floor(t); return 1 - t; }
    var u = (vx * dx + vy * dy) / L2;
    if (type === "reflected") return Math.abs(u);
    if (type === "diamond") return Math.abs(u) + Math.abs((vx * dy - vy * dx) / L2);
    return u;
  };
  // Render rect (x, y, w, h) of a gradient into RGBA bytes. o: {type, a, b, rev, dither}
  PPX.gradRender = function (lut, w, h, x0, y0, o) {
    var out = new Uint8ClampedArray(w * h * 4), n = lut.length / 4, a = o.a, b = o.b;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var t = PPX.gradT(o.type, x0 + x + 0.5, y0 + y + 0.5, a.x, a.y, b.x, b.y);
      t = clamp(t, 0, 1); if (o.rev) t = 1 - t;
      var f = t * (n - 1), i = Math.floor(f), k = f - i, j = Math.min(n - 1, i + 1), q = (y * w + x) * 4, dn = 0;
      if (o.dither) { var hsh = Math.imul((x0 + x) * 73856093 ^ (y0 + y) * 19349663, 2654435761) >>> 0; dn = (hsh / 4294967296) - 0.5; }
      for (var c = 0; c < 3; c++) out[q + c] = lut[i * 4 + c] + (lut[j * 4 + c] - lut[i * 4 + c]) * k + dn;
      out[q + 3] = (lut[i * 4 + 3] + (lut[j * 4 + 3] - lut[i * 4 + 3]) * k) * 255 + dn;
    }
    return out;
  };
  PPX.rng = function (seed) { var s = seed >>> 0 || 1; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // ---------- .abr brush files (sampled tips) ----------
  // Returns [{name, w, h, data: Uint8Array (255 = paint), spacing}]. Versions 1, 2 and 6+ ("samp" section).
  // Every length is checked against the file; tips are limited to 2500 x 2500 and 500 per file.
  PPX.readAbr = function (u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 0, out = [], MAXS = 2500, budget = 64e6;
    function need(n) { if (n < 0 || p + n > u8.length) throw new Error("This brush file is damaged or truncated"); }
    function u8r() { need(1); return u8[p++]; }
    function u16() { need(2); var v = dv.getUint16(p); p += 2; return v; }
    function i16() { need(2); var v = dv.getInt16(p); p += 2; return v; }
    function u32() { need(4); var v = dv.getUint32(p); p += 4; return v; }
    function i32() { need(4); var v = dv.getInt32(p); p += 4; return v; }
    function ustr() { var n = u32(); if (n > 1024) throw new Error("This brush file is damaged"); var s = ""; for (var i = 0; i < n; i++) { var c = u16(); if (c) s += String.fromCharCode(c); } return s; }
    function pixels(w, h, depth, comp) {
      if (w < 1 || h < 1 || w > MAXS || h > MAXS) throw new Error("A brush in this file is too large (" + w + " × " + h + ")");
      budget -= w * h; if (budget < 0) throw new Error("This brush file holds more brush pixels than can be imported at once");
      var bpp = depth === 16 ? 2 : 1, rowBytes = w * bpp, data = new Uint8Array(w * h), row = new Uint8Array(rowBytes), y, x;
      if (!comp) {
        for (y = 0; y < h; y++) { need(rowBytes); for (x = 0; x < w; x++) data[y * w + x] = u8[p + x * bpp]; p += rowBytes; }
        return data;
      }
      var lens = [], minRow = Math.ceil(rowBytes / 128) * 2;    // PackBits needs at least 2 bytes per 128 output bytes
      for (y = 0; y < h; y++) { var ln = u16(); if (ln < minRow) throw new Error("This brush file is damaged"); lens.push(ln); }
      for (y = 0; y < h; y++) {        // PackBits
        var end = p + lens[y], k = 0; need(lens[y]);
        while (p < end && k < rowBytes) {
          var n = dv.getInt8(p); p++;
          if (n >= 0) { var cnt = n + 1; need(cnt); for (var i = 0; i < cnt && k < rowBytes; i++) row[k++] = u8[p + i]; p += cnt; }
          else if (n !== -128) { var rep = 1 - n, v = u8r(); for (var j = 0; j < rep && k < rowBytes; j++) row[k++] = v; }
        }
        if (k < rowBytes) throw new Error("This brush file is damaged");
        p = end;
        for (x = 0; x < w; x++) data[y * w + x] = row[x * bpp];
      }
      return data;
    }
    var ver = u16();
    if (ver === 1 || ver === 2) {
      var count = u16(); if (count > 500) throw new Error("Too many brushes in this file");
      for (var b = 0; b < count; b++) {
        var type = u16(), size = u32(), next = p + size; need(size);
        if (type === 2) {
          u32(); var spacing = u16(), name = ver === 2 ? ustr() : "Brush " + (b + 1);
          u8r(); p += 8; need(0);
          var top = i32(), left = i32(), bottom = i32(), right = i32(), depth = u16(), comp = u8r();
          out.push({ name: name || "Brush " + (b + 1), w: right - left, h: bottom - top, data: pixels(right - left, bottom - top, depth, comp), spacing: spacing });
        }
        p = next;
      }
      return out;
    }
    if (ver >= 6 && ver <= 10) {
      var sub = u16(), presets = null;
      while (p + 12 <= u8.length) {
        var sig = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]), key = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]); p += 8;
        var len = u32();
        if (sig !== "8BIM") throw new Error("This brush file is damaged");
        need(len);
        var stop = p + len;
        if (key === "desc") { try { presets = PPX.readDescriptor(u8, p + 4).d; } catch (e) { presets = null; } p = stop; continue; }       // names and settings (optional)
        if (key !== "samp") { p = stop; continue; }
        while (p < stop - 4 && out.length < 500) {
          var bl = u32(), bend = bl; while (bend % 4) bend++;
          var nb = p + bend; need(bend);
          var hs = p, il = Math.min(u8[p], 36), uid = ""; for (var c = 0; c < il; c++) uid += String.fromCharCode(u8[p + 1 + c]);
          p = hs + (sub === 1 ? 47 : 301);
          var t = i32(), l = i32(), bo = i32(), r = i32(), dp = u16(), cp = u8r();
          out.push({ name: "Brush " + (out.length + 1), uid: uid, w: r - l, h: bo - t, data: pixels(r - l, bo - t, dp, cp), spacing: 25 });
          p = nb;
        }
        p = stop;
      }
      if (!out.length) throw new Error("No sampled brushes found in this file");
      if (presets) PPX.abrSettings(presets, out);
      return out;
    }
    throw new Error("Not a supported .abr brush file (version " + ver + ")");
  };

  // ---------- .pat pattern files ----------
  // Returns [{name, w, h, data: RGBA}]. Grey, indexed and RGB patterns, raw or PackBits channels. Checked lengths,
  // 4096 px a side, 200 patterns, 64 MP decoded in all; tiles over 1024 px are shrunk here (that is all that is kept).
  PPX.readPat = function (u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 0, out = [], budget = 64e6;
    function need(n) { if (n < 0 || p + n > u8.length) throw new Error("This pattern file is damaged or truncated"); }
    function u8r() { need(1); return u8[p++]; }
    function u16() { need(2); var v = dv.getUint16(p); p += 2; return v; }
    function u32() { need(4); var v = dv.getUint32(p); p += 4; return v; }
    function i32() { need(4); var v = dv.getInt32(p); p += 4; return v; }
    need(4); if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "8BPT") throw new Error("Not a .pat pattern file"); p = 4;
    if (u16() !== 1) throw new Error("Unsupported .pat version");
    var count = u32(); if (count > 200) throw new Error("Too many patterns in this file");
    function channel(w, h) {
      var written = u32(); if (!written) return null;
      var len = u32(); if (!len) return null;
      var end = p + len; need(len);
      u32(); var t = i32(), l = i32(), b = i32(), r = i32(), depth = u16(), comp = u8r();
      var cw = r - l, ch = b - t; if (cw !== w || ch !== h) { p = end; return null; }
      var bpp = depth === 16 ? 2 : 1, rowBytes = w * bpp, data = new Uint8Array(w * h), row = new Uint8Array(rowBytes), y, x;
      if (!comp) { for (y = 0; y < h; y++) { need(rowBytes); for (x = 0; x < w; x++) data[y * w + x] = u8[p + x * bpp]; p += rowBytes; } }
      else {
        var lens = [], minRow = Math.ceil(rowBytes / 128) * 2;
        for (y = 0; y < h; y++) { var ln = u16(); if (ln < minRow) throw new Error("This pattern file is damaged"); lens.push(ln); }
        for (y = 0; y < h; y++) {
          var e2 = p + lens[y], k = 0; need(lens[y]);
          while (p < e2 && k < rowBytes) {
            var n = dv.getInt8(p); p++;
            if (n >= 0) { var cnt = n + 1; need(cnt); for (var i = 0; i < cnt && k < rowBytes; i++) row[k++] = u8[p + i]; p += cnt; }
            else if (n !== -128) { var rep = 1 - n, v = u8r(); for (var j = 0; j < rep && k < rowBytes; j++) row[k++] = v; }
          }
          if (k < rowBytes) throw new Error("This pattern file is damaged");
          p = e2; for (x = 0; x < w; x++) data[y * w + x] = row[x * bpp];
        }
      }
      p = end;
      return data;
    }
    for (var n2 = 0; n2 < count; n2++) {
      u32(); var mode = u32(), h = u16(), w = u16(), nl = u32();
      if (nl > 1024) throw new Error("This pattern file is damaged");
      var name = ""; for (var c = 0; c < nl; c++) { var ch = u16(); if (ch) name += String.fromCharCode(ch); }
      var idl = u8r(); need(idl); p += idl;
      var pal = null; if (mode === 2) { need(768); pal = u8.subarray(p, p + 768); p += 768; }
      if (w < 1 || h < 1 || w > 4096 || h > 4096) throw new Error("A pattern in this file is too large");
      budget -= w * h; if (budget < 0) throw new Error("This pattern file holds more pixels than can be imported at once");
      u32(); var vlen = u32(), vend = p + vlen; need(vlen);
      i32(); i32(); i32(); i32(); var nch = u32(), chans = [];
      for (var k2 = 0; k2 < nch && k2 < 4 && p < vend; k2++) chans.push(channel(w, h));
      p = vend;
      var rgba = new Uint8ClampedArray(w * h * 4), q;
      for (q = 0; q < w * h; q++) {
        var r0, g0, b0;
        if (mode === 3 && chans[0] && chans[1] && chans[2]) { r0 = chans[0][q]; g0 = chans[1][q]; b0 = chans[2][q]; }
        else if (mode === 2 && pal && chans[0]) { var ix = chans[0][q] * 3; r0 = pal[ix]; g0 = pal[ix + 1]; b0 = pal[ix + 2]; }
        else if (chans[0]) { r0 = g0 = b0 = chans[0][q]; }
        else throw new Error("Pattern “" + name + "” uses a colour mode this editor cannot read");
        rgba[q * 4] = r0; rgba[q * 4 + 1] = g0; rgba[q * 4 + 2] = b0; rgba[q * 4 + 3] = mode === 3 && chans[3] ? chans[3][q] : 255;
      }
      if (w > 1024 || h > 1024) {       // kept at most 1024 px a side: shrink here (box filter) so big tiles are not held
        var k3 = 1024 / Math.max(w, h), w2 = Math.max(1, Math.round(w * k3)), h2 = Math.max(1, Math.round(h * k3)), small = new Uint8ClampedArray(w2 * h2 * 4);
        for (var yy = 0; yy < h2; yy++) for (var xx = 0; xx < w2; xx++) {
          var x0 = Math.floor(xx * w / w2), x1 = Math.max(x0 + 1, Math.floor((xx + 1) * w / w2)), y0 = Math.floor(yy * h / h2), y1 = Math.max(y0 + 1, Math.floor((yy + 1) * h / h2)), acc = [0, 0, 0, 0], cnt2 = 0;
          for (var sy = y0; sy < y1; sy++) for (var sx = x0; sx < x1; sx++) { var si = (sy * w + sx) * 4; acc[0] += rgba[si]; acc[1] += rgba[si + 1]; acc[2] += rgba[si + 2]; acc[3] += rgba[si + 3]; cnt2++; }
          for (var z = 0; z < 4; z++) small[(yy * w2 + xx) * 4 + z] = acc[z] / cnt2;
        }
        rgba = small; w = w2; h = h2;
      }
      out.push({ name: name || "Pattern " + (n2 + 1), w: w, h: h, data: rgba });
    }
    return out;
  };

  // ---------- .grd gradient files (version 5 descriptors) ----------
  // Returns gradients in this editor's model: {name, kind: "solid", stops, alpha} or {name, kind: "noise", ...}.
  PPX.readDescriptor = function (u8, start) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = start || 0, items = 0;
    function need(n) { if (n < 0 || p + n > u8.length) throw new Error("This file is damaged or truncated"); }
    function u32() { need(4); var v = dv.getUint32(p); p += 4; return v; }
    function str4() { need(4); var s = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]); p += 4; return s; }
    function id() { var n = u32(); if (!n) return str4(); if (n > 512) throw new Error("This file is damaged"); need(n); var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]); p += n; return s; }
    function ustr() { var n = u32(); if (n > 4096) throw new Error("This file is damaged"); need(n * 2); var s = ""; for (var i = 0; i < n; i++) { var c = dv.getUint16(p + i * 2); if (c) s += String.fromCharCode(c); } p += n * 2; return s; }
    function value(type, depth) {
      if (++items > 200000 || depth > 24) throw new Error("This file is too complex");
      switch (type) {
        case "Objc": case "GlbO": return desc(depth + 1);
        case "VlLs": { var n = u32(), a = []; if (n > 100000) throw new Error("This file is damaged"); for (var i = 0; i < n; i++) a.push(value(str4(), depth + 1)); return a; }
        case "doub": need(8); var d = dv.getFloat64(p); p += 8; return d;
        case "UntF": { var unit = str4(); need(8); var v = dv.getFloat64(p); p += 8; return { unit: unit, v: v }; }
        case "TEXT": return ustr();
        case "enum": { var t = id(), e = id(); return { type: t, e: e }; }
        case "long": need(4); var l = dv.getInt32(p); p += 4; return l;
        case "comp": need(8); p += 8; return 0;
        case "bool": need(1); return !!u8[p++];
        case "type": case "GlbC": ustr(); return id();
        case "alis": case "tdta": case "Pth ": { var len = u32(); need(len); p += len; return null; }
        default: throw new Error("This file uses something this editor cannot read (" + type.replace(/[^\x20-\x7e]/g, "?") + ")");
      }
    }
    function desc(depth) {
      // no prototype: keys from the file ("__proto__" included) are only ever plain own properties
      var o = Object.create(null), n; o._name = ustr(); o._class = id(); n = u32();
      if (n > 10000) throw new Error("This file is damaged");
      for (var i = 0; i < n; i++) { var k = id(), v = value(str4(), depth); if (k !== "_name" && k !== "_class") o[k] = v; }
      return o;
    }
    var out = desc(0);
    return { d: out, end: p };
  };
  function grdColor(c) {
    if (!c || typeof c !== "object") return [0, 0, 0];
    var num = function (v) { return typeof v === "number" ? v : v && typeof v.v === "number" ? v.v : 0; };
    if (c._class === "HSBC") return PPX.hsb2rgb(num(c["H   "]), num(c.Strt), num(c.Brgh));
    if (c._class === "Grsc") { var g = 255 * (1 - num(c["Gry "]) / 100); return [g, g, g]; }
    if (c._class === "CMYC") return PPX.cmyk2rgb(num(c["Cyn "]), num(c.Mgnt), num(c["Ylw "]), num(c.Blck));
    if (c._class === "LbCl") return PPX.lab2rgb(num(c.Lmnc), num(c["A   "]), num(c["B   "]));
    return [num(c["Rd  "]), num(c["Grn "]), num(c["Bl  "])];
  }
  PPX.readGrd = function (u8) {
    if (u8.length < 12 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "8BGR") throw new Error("Not a .grd gradient file");
    var ver = (u8[4] << 8) | u8[5];
    if (ver !== 5) throw new Error("Only version 5 .grd files can be read (this one is version " + ver + ")");
    var r = PPX.readDescriptor(u8, 10), list = Array.isArray(r.d.GrdL) ? r.d.GrdL : [], out = [];
    function hex(c) { return "#" + c.map(function (v) { return ("0" + c255(v).toString(16)).slice(-2); }).join(""); }
    list.slice(0, 1000).forEach(function (item, n) {
      var g = item && item.Grad ? item.Grad : item; if (!g || typeof g !== "object") return;
      var name = typeof g["Nm  "] === "string" ? g["Nm  "].replace(/^\$\$\$\/[^=]*=/, "") : "Gradient " + (n + 1);
      if (g.GrdF && g.GrdF.e === "ClNs") {
        out.push({ name: name, kind: "noise", rough: clamp((+g.Smth || 2048) / 4096 * 100, 0, 100), seed: (+g.RndS >>> 0) || 1, restrict: !!g.VctC, transp: !!g.ShTr });
        return;
      }
      var stops = (Array.isArray(g.Clrs) ? g.Clrs : []).slice(0, 64).map(function (s) {
        var t = s && s.Type && s.Type.e, c = t === "FrgC" ? "fg" : t === "BckC" ? "bg" : hex(grdColor(s && s["Clr "]));
        return { p: clamp((+(s && s.Lctn) || 0) / 4096, 0, 1), c: c, m: clamp((s && s.Mdpn != null ? +s.Mdpn : 50) / 100, 0, 1) };
      });
      var alpha = (Array.isArray(g.Trns) ? g.Trns : []).slice(0, 64).map(function (s) {
        var o = s && s.Opct; return { p: clamp((+(s && s.Lctn) || 0) / 4096, 0, 1), a: clamp((o && typeof o.v === "number" ? o.v : 100) / 100, 0, 1), m: clamp((s && s.Mdpn != null ? +s.Mdpn : 50) / 100, 0, 1) };
      });
      if (stops.length) out.push({ name: name, kind: "solid", stops: stops, alpha: alpha.length ? alpha : [{ p: 0, a: 1 }, { p: 1, a: 1 }] });
    });
    if (!out.length) throw new Error("No gradients found in this file");
    return out;
  };

  // Brush names and the basic settings from an .abr "desc" section, matched to the sampled tips by their id.
  PPX.abrSettings = function (d, tips) {
    var list = Array.isArray(d.Brsh) ? d.Brsh : [], by = {};
    tips.forEach(function (t) { if (t.uid) by[t.uid] = t; });
    function n(v) { return typeof v === "number" ? v : v && typeof v.v === "number" ? v.v : NaN; }
    var CTL = { 1: "fade", 2: "pressure", 3: "tilt" };
    list.slice(0, 2000).forEach(function (b) {
      var tip = b && b.Brsh; if (!tip || typeof tip !== "object" || typeof tip.sampledData !== "string") return;
      var t = by[tip.sampledData]; if (!t || t.s) return;
      if (typeof b["Nm  "] === "string" && b["Nm  "].trim()) t.name = b["Nm  "].replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
      var s = {}, v;
      if (isFinite(v = n(tip.Dmtr))) s.size = clamp(Math.round(v), 1, 1000);
      if (isFinite(v = n(tip.Spcn))) s.spacing = clamp(Math.round(v), 1, 1000);
      if (isFinite(v = n(tip.Angl))) s.angle = clamp(Math.round(v), -360, 360);
      if (isFinite(v = n(tip.Rndn))) s.round = clamp(Math.round(v), 1, 100);
      if (tip.flipX === true) s.flipX = true;
      if (b.useTipDynamics && b.szVr) { s.sizeC = CTL[n(b.szVr.bVTy)] || "off"; if (isFinite(v = n(b.szVr.jitter))) s.sizeJ = clamp(v, 0, 100); if (isFinite(v = n(b.minimumDiameter))) s.sizeMin = clamp(v, 0, 100); }
      else s.sizeC = "off";
      if (b.useTipDynamics && b.angleDynamics && isFinite(v = n(b.angleDynamics.jitter))) s.angleJ = clamp(v, 0, 100);
      if (b.useScatter) { if (b.scatterDynamics && isFinite(v = n(b.scatterDynamics.jitter))) s.scatter = clamp(v, 0, 1000); if (isFinite(v = n(b["Cnt "]))) s.count = clamp(Math.round(v), 1, 16); s.scatterBoth = b.bothAxes === true; }
      if (b.usePaintDynamics && b.opVr && CTL[n(b.opVr.bVTy)] === "pressure") s.opC = "pressure";
      t.s = s;
    });
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
    for (i = 0; i < n; i++) if (hole[i]) for (k = 0; k < 4; k++) out[i * 4 + k] = c255(L0.d[i * 4 + k]);      // callers blend soft edges
    return { data: out, width: W, height: H };
  };

  // ---------- generic dispatcher (the worker calls this) ----------
  PPX.ping = function () { return true; };
  PPX.ALLOWED = ["ping", "inpaint", "gradRender", "readAbr", "readPat", "readGrd"];
  PPX.call = function (fn, args) {
    if (PPX.ALLOWED.indexOf(fn) < 0 || typeof PPX[fn] !== "function") throw new Error("Not allowed: " + fn);
    return PPX[fn].apply(null, args || []);
  };
  G.PPX = PPX;
})(typeof self !== "undefined" ? self : this);
