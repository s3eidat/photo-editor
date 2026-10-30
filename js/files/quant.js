/* Files lane: colour reduction and indexed formats, written for this app. Median-cut palettes (weighted by pixel count,
   alpha-aware), uniform / web / black-and-white palettes, nearest-colour mapping with a cache, Floyd–Steinberg and
   ordered (Bayer) dithering, and encoders for indexed PNG (PLTE + tRNS) and GIF (LZW), plus palette files (.act colour
   table, .gpl, hex list). Pure functions on RGBA bytes: they run in the worker and on this thread. */
(function (G) {
  "use strict";
  var Q = G.FQUANT = G.FQUANT || {};

  // ---------- palettes: arrays of [r,g,b] ----------
  Q.median = function (img, n) {     // adaptive palette with up to n colours (opaque pixels only)
    var d = img.data, hist = new Map(), i;
    var step = Math.max(1, Math.floor(d.length / 4 / 400000));       // sample big images
    for (i = 0; i < d.length; i += 4 * step) { if (d[i + 3] < 128) continue; var k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3); hist.set(k, (hist.get(k) || 0) + 1); }
    var cols = []; hist.forEach(function (c, k) { cols.push([((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4, c]); });
    if (!cols.length) return [[0, 0, 0]];
    if (cols.length <= n) return cols.map(function (c) { return [c[0], c[1], c[2]]; });
    var boxes = [cols];
    function range(b) { var mn = [255, 255, 255], mx = [0, 0, 0]; b.forEach(function (c) { for (var j = 0; j < 3; j++) { if (c[j] < mn[j]) mn[j] = c[j]; if (c[j] > mx[j]) mx[j] = c[j]; } }); return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]; }
    function weight(b) { var s = 0; b.forEach(function (c) { s += c[3]; }); return s; }
    while (boxes.length < n) {
      var bi = -1, best = -1;
      boxes.forEach(function (b, j) { if (b.length < 2) return; var r = range(b), sc = Math.max(r[0], r[1], r[2]) * Math.sqrt(weight(b)); if (sc > best) { best = sc; bi = j; } });
      if (bi < 0) break;
      var b = boxes[bi], r = range(b), ax = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
      b.sort(function (p, q) { return p[ax] - q[ax]; });
      var half = weight(b) / 2, acc = 0, cut = 1;
      for (var j = 0; j < b.length - 1; j++) { acc += b[j][3]; if (acc >= half) { cut = j + 1; break; } }
      boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
    }
    return boxes.map(function (b) { var s = [0, 0, 0], w = 0; b.forEach(function (c) { s[0] += c[0] * c[3]; s[1] += c[1] * c[3]; s[2] += c[2] * c[3]; w += c[3]; }); return [Math.round(s[0] / w), Math.round(s[1] / w), Math.round(s[2] / w)]; });
  };
  Q.web = function () { var p = []; for (var r = 0; r < 6; r++) for (var g = 0; g < 6; g++) for (var b = 0; b < 6; b++) p.push([r * 51, g * 51, b * 51]); return p; };
  Q.uniform = function (n) { var k = Math.max(2, Math.floor(Math.cbrt(n))), p = []; for (var r = 0; r < k; r++) for (var g = 0; g < k; g++) for (var b = 0; b < k; b++) p.push([Math.round(r * 255 / (k - 1)), Math.round(g * 255 / (k - 1)), Math.round(b * 255 / (k - 1))]); return p; };
  Q.grey = function (n) { var p = []; for (var i = 0; i < n; i++) { var v = Math.round(i * 255 / (n - 1)); p.push([v, v, v]); } return p; };
  Q.palette = function (img, kind, n) { return kind === "web" ? Q.web() : kind === "uniform" ? Q.uniform(n) : kind === "bw" ? [[0, 0, 0], [255, 255, 255]] : kind === "grey" ? Q.grey(Math.max(2, n)) : Q.median(img, n); };

  // ---------- mapping ----------
  function nearestFn(pal) {      // exact search, cached per 6-bit cell (error at most 2 levels per channel)
    var cache = new Int16Array(1 << 18).fill(-1), n = pal.length, pr = new Int32Array(n), pg = new Int32Array(n), pb = new Int32Array(n);
    for (var i = 0; i < n; i++) { pr[i] = pal[i][0]; pg[i] = pal[i][1]; pb[i] = pal[i][2]; }
    return function (r, g, b) {
      var k = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2), v = cache[k]; if (v >= 0) return v;
      var bd = 1e9, bi = 0;
      for (var j = 0; j < n; j++) { var dr = r - pr[j], dg = g - pg[j], db = b - pb[j], dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (dd < bd) { bd = dd; bi = j; } }
      cache[k] = bi; return bi;
    };
  }
  var BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  // -> { idx: Uint8Array (index per pixel; transparent pixels get index pal.length if keepAlpha), pal }
  Q.map = function (img, pal, o) {
    o = o || {};
    var w = img.width, hh = img.height, d = img.data, idx = new Uint8Array(w * hh), near = nearestFn(pal), dith = o.dither || "none", amt = o.amount == null ? 1 : o.amount, ta = pal.length;
    var err = dith === "diffusion" ? new Float32Array((w + 2) * 3 * 2) : null, x, y;
    var spread = 255 / Math.max(2, Math.cbrt(pal.length)) * amt;
    for (y = 0; y < hh; y++) {
      if (err) { var cur = (y & 1) * (w + 2) * 3, nxt = ((y + 1) & 1) * (w + 2) * 3; for (x = 0; x < (w + 2) * 3; x++) err[nxt + x] = 0; }
      for (x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (o.keepAlpha && d[i + 3] < 128) { idx[y * w + x] = ta; continue; }
        var r = d[i], g = d[i + 1], b = d[i + 2];
        if (dith === "pattern") { var t = (BAYER[(y & 7) * 8 + (x & 7)] / 64 - 0.5) * spread; r += t; g += t; b += t; }
        if (err) { var e = cur + (x + 1) * 3; r += err[e]; g += err[e + 1]; b += err[e + 2]; }
        r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
        var k = near(Math.round(r), Math.round(g), Math.round(b)); idx[y * w + x] = k;
        if (err) {
          var p = pal[k], er = (r - p[0]) * amt, eg = (g - p[1]) * amt, eb = (b - p[2]) * amt, c1 = cur + (x + 2) * 3, c2 = nxt + x * 3, c3 = nxt + (x + 1) * 3, c4 = nxt + (x + 2) * 3;
          err[c1] += er * 7 / 16; err[c1 + 1] += eg * 7 / 16; err[c1 + 2] += eb * 7 / 16;
          err[c2] += er * 3 / 16; err[c2 + 1] += eg * 3 / 16; err[c2 + 2] += eb * 3 / 16;
          err[c3] += er * 5 / 16; err[c3 + 1] += eg * 5 / 16; err[c3 + 2] += eb * 5 / 16;
          err[c4] += er / 16; err[c4 + 1] += eg / 16; err[c4 + 2] += eb / 16;
        }
      }
    }
    return { idx: idx, pal: pal, width: w, height: hh, transparent: o.keepAlpha ? ta : -1 };
  };
  Q.toRGBA = function (m) {
    var n = m.width * m.height, out = new Uint8ClampedArray(n * 4);
    for (var i = 0; i < n; i++) { var k = m.idx[i]; if (k === m.transparent) continue; var p = m.pal[k]; out[i * 4] = p[0]; out[i * 4 + 1] = p[1]; out[i * 4 + 2] = p[2]; out[i * 4 + 3] = 255; }
    return { data: out, width: m.width, height: m.height };
  };
  Q.reduce = function (img, o) { var pal = Q.palette(img, o.kind || "adaptive", o.colors || 256); if (o.keepAlpha && pal.length > 255) pal = pal.slice(0, 255); return Q.map(img, pal, o); };

  // ---------- indexed PNG ----------
  // zlib(u8) -> Promise<u8>; crc(u8) -> uint32
  Q.png8 = function (m, zlib, crc) {
    var n = m.pal.length + (m.transparent >= 0 ? 1 : 0), bits = n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8, W = m.width, H = m.height, row = Math.ceil(W * bits / 8), raw = new Uint8Array((row + 1) * H);
    for (var y = 0; y < H; y++) {
      var o = y * (row + 1); raw[o] = 0;
      for (var x = 0; x < W; x++) { var v = m.idx[y * W + x]; if (bits === 8) raw[o + 1 + x] = v; else { var bi = x * bits, sh = 8 - bits - (bi & 7); raw[o + 1 + (bi >> 3)] |= v << sh; } }
    }
    return zlib(raw).then(function (z) {
      var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
      function chunk(type, data) {
        var c = new Uint8Array(12 + data.length), dv = new DataView(c.buffer);
        dv.setUint32(0, data.length); for (var i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i); c.set(data, 8); dv.setUint32(8 + data.length, crc(c.subarray(4, 8 + data.length))); parts.push(c);
      }
      var ih = new Uint8Array(13), dv = new DataView(ih.buffer); dv.setUint32(0, W); dv.setUint32(4, H); ih[8] = bits; ih[9] = 3; chunk("IHDR", ih);
      var pl = new Uint8Array(n * 3); m.pal.forEach(function (p, i) { pl[i * 3] = p[0]; pl[i * 3 + 1] = p[1]; pl[i * 3 + 2] = p[2]; }); chunk("PLTE", pl);
      if (m.transparent >= 0) { var tr = new Uint8Array(m.transparent + 1).fill(255); tr[m.transparent] = 0; chunk("tRNS", tr); }
      chunk("IDAT", z); chunk("IEND", new Uint8Array(0));
      var len = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(len), q = 0; parts.forEach(function (p) { out.set(p, q); q += p.length; });
      return out;
    });
  };

  // ---------- GIF (89a, one frame, optional transparency) ----------
  Q.gif = function (m) {
    var ncol = m.pal.length + (m.transparent >= 0 ? 1 : 0), bits = 1; while ((1 << bits) < ncol) bits++; var size = 1 << bits;
    var out = [], W = m.width, H = m.height;
    function u16(v) { out.push(v & 255, (v >> 8) & 255); }
    "GIF89a".split("").forEach(function (c) { out.push(c.charCodeAt(0)); });
    u16(W); u16(H); out.push(0xF0 | (bits - 1), 0, 0);
    for (var i = 0; i < size; i++) { var p = m.pal[i] || [0, 0, 0]; out.push(p[0], p[1], p[2]); }
    if (m.transparent >= 0) out.push(0x21, 0xF9, 4, 1, 0, 0, m.transparent, 0);
    out.push(0x2C); u16(0); u16(0); u16(W); u16(H); out.push(0);
    var min = Math.max(2, bits); out.push(min);
    // LZW, LSB-first codes, variable width, reset when the table fills
    var clear = 1 << min, eoi = clear + 1, next = eoi + 1, width = min + 1, dict = new Map(), acc = 0, nb = 0, bytes = [];
    function put(c) { acc |= c << nb; nb += width; while (nb >= 8) { bytes.push(acc & 255); acc >>>= 8; nb -= 8; } }
    put(clear);
    var px = m.idx, pre = px[0];
    for (i = 1; i < px.length; i++) {
      var c = px[i], key = pre * 4096 + c, v = dict.get(key);
      if (v !== undefined) { pre = v; continue; }
      put(pre);
      if (next < 4096) { dict.set(key, next++); if (next > (1 << width) && width < 12) width++; }
      else { put(clear); dict.clear(); next = eoi + 1; width = min + 1; }
      pre = c;
    }
    put(pre); put(eoi); if (nb > 0) bytes.push(acc & 255);
    for (i = 0; i < bytes.length; i += 255) { var blk = bytes.slice(i, i + 255); out.push(blk.length); Array.prototype.push.apply(out, blk); }
    out.push(0, 0x3B);
    return new Uint8Array(out);
  };

  // ---------- palette files ----------
  Q.act = function (pal, transparent) {      // 768-byte colour table + count + transparent index
    var o = new Uint8Array(772); pal.slice(0, 256).forEach(function (p, i) { o[i * 3] = p[0]; o[i * 3 + 1] = p[1]; o[i * 3 + 2] = p[2]; });
    var n = Math.min(256, pal.length); o[768] = n >> 8; o[769] = n & 255; var t = transparent >= 0 ? transparent : 0xFFFF; o[770] = t >> 8; o[771] = t & 255; return o;
  };
  Q.gpl = function (pal, name) { return "GIMP Palette\nName: " + String(name || "Palette").replace(/[\r\n]/g, " ") + "\nColumns: 16\n#\n" + pal.map(function (p, i) { return ("  " + p[0]).slice(-3) + " " + ("  " + p[1]).slice(-3) + " " + ("  " + p[2]).slice(-3) + "\tColour " + (i + 1); }).join("\n") + "\n"; };
  Q.hexList = function (pal) { return pal.map(function (p) { return "#" + p.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join(""); }).join("\n") + "\n"; };
})(typeof self !== "undefined" ? self : window);
