/* Files lane: image encoders written for this app (no libraries): TIFF (none / LZW / ZIP, horizontal predictor),
   BMP (24/32-bit), and metadata blocks for JPEG / PNG (XMP author + copyright). Pure functions on RGBA bytes, so they
   run the same in the export worker (js/files/enc-worker.js) and on this thread. */
(function (G) {
  "use strict";
  var E = G.FENC = G.FENC || {};

  // ---------- byte writer ----------
  function Buf(n) { this.u = new Uint8Array(n || 1024); this.n = 0; }
  Buf.prototype.need = function (k) { if (this.n + k <= this.u.length) return; var m = Math.max(this.u.length * 2, this.n + k); var u = new Uint8Array(m); u.set(this.u.subarray(0, this.n)); this.u = u; };
  Buf.prototype.u8 = function (v) { this.need(1); this.u[this.n++] = v & 255; };
  Buf.prototype.u16 = function (v) { this.need(2); this.u[this.n++] = v & 255; this.u[this.n++] = (v >>> 8) & 255; };
  Buf.prototype.u32 = function (v) { this.need(4); this.u[this.n++] = v & 255; this.u[this.n++] = (v >>> 8) & 255; this.u[this.n++] = (v >>> 16) & 255; this.u[this.n++] = (v >>> 24) & 255; };
  Buf.prototype.bytes = function (b) { this.need(b.length); this.u.set(b, this.n); this.n += b.length; };
  Buf.prototype.out = function () { return this.u.slice(0, this.n); };
  E.Buf = Buf;
  function ascii(s) { var o = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); o.push(c < 128 ? c : 63); } return o; }
  function utf8(s) { return new TextEncoder().encode(s); }

  // ---------- TIFF LZW (MSB-first codes, 9..12 bits, clear at 4094, libtiff-compatible width switch) ----------
  var HT = null, gen = 0;
  E.lzw = function (data) {
    if (!HT) HT = new Int32Array(1 << 20);
    var out = new Buf(Math.max(1024, data.length >> 1)), acc = 0, nb = 0, width = 9, next = 258;
    function put(code) { acc = (acc << width) | code; nb += width; while (nb >= 8) { out.u8(acc >>> (nb - 8)); nb -= 8; } acc &= (1 << nb) - 1; }
    function reset() { gen++; if (gen > 0x7ffff) { HT.fill(0); gen = 1; } next = 258; width = 9; }
    reset(); put(256);
    if (!data.length) { put(257); if (nb) out.u8(acc << (8 - nb)); return out.out(); }
    var prefix = data[0], tag = gen << 12;
    for (var i = 1; i < data.length; i++) {
      var c = data[i], key = (prefix << 8) | c, v = HT[key];
      if ((v >>> 12) === gen && v !== 0) { prefix = v & 4095; continue; }
      put(prefix);
      HT[key] = tag | next; next++;
      if (next === 4094) { put(256); reset(); tag = gen << 12; }
      else if (next > (1 << width) - 1) width++;
      prefix = c;
    }
    put(prefix); next++;
    if (next === 4094) { put(256); reset(); } else if (next > (1 << width) - 1) width++;
    put(257);
    if (nb) out.u8(acc << (8 - nb));
    return out.out();
  };
  // Matching decoder (used by the self-test and the TIFF reader).
  E.unlzw = function (src, max) {
    var out = new Uint8Array(max), o = 0, tab = new Array(4096), i, pos = 0, width = 9, next = 258, prev = null, bitbuf = 0, nb = 0;
    function get() { while (nb < width) { if (pos >= src.length) return 257; bitbuf = ((bitbuf << 8) | src[pos++]) >>> 0; nb += 8; } var v = (bitbuf >>> (nb - width)) & ((1 << width) - 1); nb -= width; bitbuf &= (1 << nb) - 1; return v; }
    for (i = 0; i < 256; i++) tab[i] = [i];
    for (;;) {
      var code = get();
      if (code === 257) break;
      if (code === 256) { next = 258; width = 9; prev = null; continue; }
      var entry = code < next && tab[code] ? tab[code] : prev ? prev.concat(prev[0]) : null;
      if (!entry) break;
      for (i = 0; i < entry.length && o < max; i++) out[o++] = entry[i];
      if (prev) { tab[next++] = prev.concat(entry[0]); }
      prev = entry;
      if (next + 1 > (1 << width) - 1 && width < 12) width++;
      if (o >= max) break;
    }
    return out.subarray(0, o);
  };

  // ---------- TIFF ----------
  // img: {data (RGBA), width, height}; o: {alpha, compression: "none"|"lzw"|"zip", dpi, artist, copyright, software}; zip(u8) -> Promise<u8> (zlib)
  E.tiff = function (img, o, zip) {
    o = o || {};
    var W = img.width, H = img.height, spp = o.alpha ? 4 : 3, d = img.data, comp = o.compression || "lzw";
    var rowB = W * spp, rps = Math.max(1, Math.min(H, Math.floor(65536 / rowB) || 1)), strips = Math.ceil(H / rps);
    function stripBytes(s) {
      var y0 = s * rps, y1 = Math.min(H, y0 + rps), b = new Uint8Array((y1 - y0) * rowB), k = 0;
      for (var y = y0; y < y1; y++) {
        var row = y * W * 4;
        if (spp === 4) { b.set(d.subarray(row, row + W * 4), k); k += W * 4; }
        else for (var x = 0; x < W; x++, k += 3) { b[k] = d[row + x * 4]; b[k + 1] = d[row + x * 4 + 1]; b[k + 2] = d[row + x * 4 + 2]; }
        if (comp !== "none") for (var q = k - 1, s0 = k - rowB; q >= s0 + spp; q--) b[q] = (b[q] - b[q - spp]) & 255;   // horizontal predictor
      }
      return b;
    }
    var jobs = [];
    for (var s = 0; s < strips; s++) {
      var raw = stripBytes(s);
      jobs.push(comp === "lzw" ? E.lzw(raw) : comp === "zip" ? zip(raw) : raw);
    }
    return Promise.all(jobs).then(function (parts) {
      var tags = [], extra = new Buf(256);
      var hdr = 8, dataLen = parts.reduce(function (a, p) { return a + p.length; }, 0);
      // layout: header | strip data | extra (arrays, strings, rationals) | IFD
      var extraBase = hdr + dataLen + (dataLen & 1);
      function ext(bytes) { var off = extraBase + extra.n; extra.bytes(bytes); if (extra.n & 1) extra.u8(0); return off; }
      function T(tag, type, count, val) { tags.push({ tag: tag, type: type, count: count, val: val }); }
      var offs = [], cur = hdr; parts.forEach(function (p) { offs.push(cur); cur += p.length; });
      function longs(a) { var b = new Buf(a.length * 4); a.forEach(function (v) { b.u32(v); }); return b.out(); }
      function shorts(a) { var b = new Buf(a.length * 2); a.forEach(function (v) { b.u16(v); }); return b.out(); }
      function rational(v) { var b = new Buf(8); b.u32(Math.round(v * 1000)); b.u32(1000); return b.out(); }
      function str(s, enc) { var a = enc === "utf8" ? Array.from(utf8(s)) : ascii(s); a.push(0); return new Uint8Array(a); }
      T(256, 4, 1, W); T(257, 4, 1, H);
      T(258, 3, spp, ext(shorts(spp === 4 ? [8, 8, 8, 8] : [8, 8, 8])));
      T(259, 3, 1, comp === "lzw" ? 5 : comp === "zip" ? 8 : 1);
      T(262, 3, 1, 2);
      if (o.description) { var ds = str(o.description); T(270, 2, ds.length, ext(ds)); }
      T(273, 4, strips, strips === 1 ? offs[0] : ext(longs(offs)));
      T(277, 3, 1, spp);
      T(278, 4, 1, rps);
      T(279, 4, strips, strips === 1 ? parts[0].length : ext(longs(parts.map(function (p) { return p.length; }))));
      var dpi = o.dpi > 0 ? o.dpi : 72;
      T(282, 5, 1, ext(rational(dpi))); T(283, 5, 1, ext(rational(dpi)));
      T(284, 3, 1, 1); T(296, 3, 1, 2);
      var sw = str(o.software || "S3eidat Photo Editor"); T(305, 2, sw.length, ext(sw));
      if (o.artist) { var ar = str(o.artist); T(315, 2, ar.length, ext(ar)); }
      if (comp !== "none") T(317, 3, 1, 2);
      if (spp === 4) T(338, 3, 1, 2);       // unassociated alpha
      if (o.copyright) { var cr = str(o.copyright); T(33432, 2, cr.length, ext(cr)); }
      var ifdOff = extraBase + extra.n, b = new Buf(ifdOff + 2 + tags.length * 12 + 4);
      b.u8(0x49); b.u8(0x49); b.u16(42); b.u32(ifdOff);
      parts.forEach(function (p) { b.bytes(p); });
      if (dataLen & 1) b.u8(0);
      b.bytes(extra.out());
      tags.sort(function (a, c) { return a.tag - c.tag; });
      b.u16(tags.length);
      tags.forEach(function (t) {
        b.u16(t.tag); b.u16(t.type); b.u32(t.count);
        if (t.type === 3 && t.count === 1) { b.u16(t.val); b.u16(0); } else b.u32(t.val);
      });
      b.u32(0);
      return b.out();
    });
  };

  // ---------- TIFF reader (baseline: strips or tiles; none / LZW / ZIP / PackBits; predictor 2; 8- or 16-bit
  // RGB, RGBA, grey, grey+alpha, palette; first image only) -> {data RGBA, width, height, dpi}. inflate(u8) -> Promise<u8>
  E.readTiff = function (u8, inflate, limits) {
    if (u8.length < 16) throw new Error("This TIFF file is too short");
    var le = u8[0] === 0x49 && u8[1] === 0x49, be = u8[0] === 0x4D && u8[1] === 0x4D;
    if (!le && !be) throw new Error("This is not a TIFF file");
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    function U16(o) { return dv.getUint16(o, le); } function U32(o) { return dv.getUint32(o, le); }
    var magic = U16(2);
    if (magic === 43) throw new Error("BigTIFF files are not supported");
    if (magic !== 42) throw new Error("This is not a TIFF file");
    var ifd = U32(4), SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
    if (ifd + 2 > u8.length) throw new Error("This TIFF file is damaged");
    var n = U16(ifd), tags = {};
    if (n > 1000 || ifd + 2 + n * 12 > u8.length) throw new Error("This TIFF file is damaged");
    for (var i = 0; i < n; i++) {
      var e = ifd + 2 + i * 12, tag = U16(e), type = U16(e + 2), cnt = U32(e + 4), sz = SZ[type] || 1, tot = sz * cnt, off = tot <= 4 ? e + 8 : U32(e + 8);
      if (cnt > 1e7 || off + tot > u8.length) continue;
      var vals = [];
      for (var k = 0; k < Math.min(cnt, 1 << 20); k++) {
        var p = off + k * sz;
        vals.push(type === 3 || type === 8 ? U16(p) : type === 4 || type === 9 || type === 16 ? U32(p) : type === 5 ? U32(p) / (U32(p + 4) || 1) : u8[p]);
      }
      tags[tag] = vals;
    }
    function T(t, d) { return tags[t] ? tags[t][0] : d; }
    var W = T(256, 0), H = T(257, 0), bps = tags[258] || [1], spp = T(277, 1), comp = T(259, 1), photo = T(262, 2), pred = T(317, 1), planar = T(284, 1), sf = T(339, 1), bits = bps[0];
    if (!(W > 0 && H > 0)) throw new Error("This TIFF has no image size");
    if (limits) limits(W, H);
    if (planar !== 1 && spp > 1) throw new Error("Planar TIFF files are not supported");
    if (bits !== 8 && bits !== 16 && !(bits === 1 && spp === 1) && !(bits === 4 && photo === 3)) throw new Error("Unsupported TIFF bit depth (" + bits + ")");
    if (sf === 3) throw new Error("Floating-point TIFF files are not supported");
    if ([0, 1, 2, 3].indexOf(photo) < 0) throw new Error(photo === 5 ? "CMYK TIFF files are not supported yet: convert to RGB first" : "Unsupported TIFF colour type (" + photo + ")");
    if ([1, 5, 8, 32946, 32773].indexOf(comp) < 0) throw new Error(comp === 7 ? "JPEG-compressed TIFF files are not supported" : "Unsupported TIFF compression (" + comp + ")");
    var tiled = !!tags[322], tw = tiled ? T(322) : W, th = tiled ? T(323) : T(278, H), offs = tags[tiled ? 324 : 273] || [], cnts = tags[tiled ? 325 : 279] || [];
    if (!offs.length || offs.length !== cnts.length) throw new Error("This TIFF file is damaged (no image data)");
    var bpp = bits * spp / 8, rowB = Math.ceil(tw * spp * bits / 8), chunkB = rowB * Math.min(th, tiled ? th : H);
    var out = new Uint8ClampedArray(W * H * 4), xr = T(282, 72), unit = T(296, 2), dpi = unit === 3 ? xr * 2.54 : xr;
    var extra = tags[338] ? tags[338][0] : 0, cmap = tags[320], hasA = (photo === 2 && spp >= 4) || ((photo === 0 || photo === 1) && spp >= 2);
    function unpack(src) {
      var o = new Uint8Array(chunkB), q = 0, p = 0;
      while (p < src.length && q < chunkB) { var c = src[p++]; if (c < 128) { for (var j = 0; j <= c && q < chunkB; j++) o[q++] = src[p++]; } else if (c > 128) { var v = src[p++]; for (j = 0; j < 257 - c && q < chunkB; j++) o[q++] = v; } }
      return o;
    }
    function chunk(k) {
      var raw = u8.subarray(offs[k], offs[k] + cnts[k]);
      if (comp === 1) return Promise.resolve(raw);
      if (comp === 5) return Promise.resolve(E.unlzw(raw, chunkB));
      if (comp === 32773) return Promise.resolve(unpack(raw));
      return inflate(raw);
    }
    function place(k, b) {
      var across = Math.ceil(W / tw), x0 = tiled ? (k % across) * tw : 0, y0 = tiled ? Math.floor(k / across) * th : k * th, rows = Math.min(th, H - y0);
      for (var r = 0; r < rows; r++) {
        var ro = r * rowB;
        if (pred === 2 && bits === 8) for (var j = ro + spp; j < ro + tw * spp && j < b.length; j++) b[j] = (b[j] + b[j - spp]) & 255;
        if (pred === 2 && bits === 16) for (j = ro + spp * 2; j + 1 < ro + tw * spp * 2 && j + 1 < b.length; j += 2) { var prev = le ? b[j - spp * 2] | (b[j - spp * 2 + 1] << 8) : (b[j - spp * 2] << 8) | b[j - spp * 2 + 1], cur = le ? b[j] | (b[j + 1] << 8) : (b[j] << 8) | b[j + 1], v = (cur + prev) & 65535; if (le) { b[j] = v & 255; b[j + 1] = v >> 8; } else { b[j] = v >> 8; b[j + 1] = v & 255; } }
        for (var x = 0; x < tw && x0 + x < W; x++) {
          var y = y0 + r, oi = (y * W + x0 + x) * 4, s = [];
          for (var c = 0; c < spp; c++) {
            if (bits === 8) s.push(b[ro + x * spp + c]);
            else if (bits === 16) { var bi = ro + (x * spp + c) * 2; s.push((le ? b[bi] | (b[bi + 1] << 8) : (b[bi] << 8) | b[bi + 1]) / 257); }
            else if (bits === 4) s.push((b[ro + (x >> 1)] >> ((x & 1) ? 0 : 4)) & 15);
            else s.push((b[ro + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0);
          }
          var R, Gc, B, A = 255;
          if (photo === 2) { R = s[0]; Gc = s[1]; B = s[2]; if (hasA) A = s[3]; }
          else if (photo === 3 && cmap) { var ix = s[0], m = cmap.length / 3; R = cmap[ix] / 257; Gc = cmap[m + ix] / 257; B = cmap[2 * m + ix] / 257; }
          else { var g = photo === 0 ? 255 - s[0] : s[0]; R = Gc = B = g; if (hasA) A = s[1]; }
          if (hasA && extra === 1 && A > 0 && A < 255) { R = R * 255 / A; Gc = Gc * 255 / A; B = B * 255 / A; }      // associated alpha -> straight
          out[oi] = R; out[oi + 1] = Gc; out[oi + 2] = B; out[oi + 3] = A;
        }
      }
    }
    var chain = Promise.resolve();
    offs.forEach(function (o, k) { chain = chain.then(function () { return chunk(k); }).then(function (b) { place(k, b); }); });
    return chain.then(function () { return { data: out, width: W, height: H, dpi: Math.round(dpi * 100) / 100 }; });
  };

  // ---------- BMP (bottom-up; 24-bit, or 32-bit BGRA with a V4 header when there is transparency) ----------
  E.bmp = function (img, o) {
    o = o || {};
    var W = img.width, H = img.height, d = img.data, a = !!o.alpha, bpp = a ? 4 : 3, row = a ? W * 4 : (W * 3 + 3) & ~3, hs = a ? 108 : 40, off = 14 + hs, size = off + row * H;
    var b = new Buf(size), ppm = Math.round((o.dpi > 0 ? o.dpi : 72) / 0.0254);
    b.u8(0x42); b.u8(0x4D); b.u32(size); b.u32(0); b.u32(off);
    b.u32(hs); b.u32(W); b.u32(H); b.u16(1); b.u16(bpp * 8); b.u32(a ? 3 : 0); b.u32(row * H); b.u32(ppm); b.u32(ppm); b.u32(0); b.u32(0);
    if (a) { b.u32(0x00FF0000); b.u32(0x0000FF00); b.u32(0x000000FF); b.u32(0xFF000000); b.u32(0x73524742); for (var k = 0; k < 12; k++) b.u32(0); }
    var line = new Uint8Array(row);
    for (var y = H - 1; y >= 0; y--) {
      for (var x = 0; x < W; x++) { var i = (y * W + x) * 4, j = x * bpp; line[j] = d[i + 2]; line[j + 1] = d[i + 1]; line[j + 2] = d[i]; if (a) line[j + 3] = d[i + 3]; }
      b.bytes(line);
    }
    return b.out();
  };

  // ---------- metadata ----------
  function xmlEsc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  E.xmp = function (m) {
    var p = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">' +
      '<xmp:CreatorTool>S3eidat Photo Editor</xmp:CreatorTool>';
    if (m.title) p += '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(m.title) + '</rdf:li></rdf:Alt></dc:title>';
    if (m.artist) p += '<dc:creator><rdf:Seq><rdf:li>' + xmlEsc(m.artist) + '</rdf:li></rdf:Seq></dc:creator>';
    if (m.copyright) p += '<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(m.copyright) + '</rdf:li></rdf:Alt></dc:rights><xmpRights:Marked>True</xmpRights:Marked>';
    return p + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  };
  // JPEG: an APP1 XMP segment right after SOI (and after JFIF APP0 if present)
  E.jpegMeta = function (u8, m) {
    var x = utf8("http://ns.adobe.com/xap/1.0/\u0000" + E.xmp(m));
    if (x.length > 65533 || u8[0] !== 0xFF || u8[1] !== 0xD8) return u8;
    var at = 2;
    if (u8[2] === 0xFF && u8[3] === 0xE0) at = 4 + ((u8[4] << 8) | u8[5]);
    var seg = new Uint8Array(4 + x.length); seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = (x.length + 2) >> 8; seg[3] = (x.length + 2) & 255; seg.set(x, 4);
    var o = new Uint8Array(u8.length + seg.length); o.set(u8.subarray(0, at)); o.set(seg, at); o.set(u8.subarray(at), at + seg.length);
    return o;
  };
  // PNG: tEXt Author / Copyright and an iTXt XMP chunk after IHDR. crc: function(Uint8Array) -> uint32
  E.pngMeta = function (u8, m, crc) {
    if (u8.length < 33 || u8[12] !== 0x49 || u8[13] !== 0x48) return u8;
    var chunks = [];
    function chunk(type, data) {
      var c = new Uint8Array(12 + data.length), dv = new DataView(c.buffer);
      dv.setUint32(0, data.length); for (var i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i); c.set(data, 8);
      dv.setUint32(8 + data.length, crc(c.subarray(4, 8 + data.length))); chunks.push(c);
    }
    function latin(s) { return new Uint8Array(ascii(s)); }
    if (m.artist) chunk("tEXt", new Uint8Array([].concat(ascii("Author"), [0], ascii(m.artist))));
    if (m.copyright) chunk("tEXt", new Uint8Array([].concat(ascii("Copyright"), [0], ascii(m.copyright))));
    var key = latin("XML:com.adobe.xmp"), body = utf8(E.xmp(m)), it = new Uint8Array(key.length + 5 + body.length);
    it.set(key); it.set(body, key.length + 5); chunk("iTXt", it);
    var add = chunks.reduce(function (a, c) { return a + c.length; }, 0), at = 33, o = new Uint8Array(u8.length + add), p = at;
    o.set(u8.subarray(0, at)); chunks.forEach(function (c) { o.set(c, p); p += c.length; }); o.set(u8.subarray(at), p);
    return o;
  };
})(typeof self !== "undefined" ? self : window);
