/* Files lane: encoders that are too slow for the main thread on big images (TIFF, BMP) and the TIFF reader. */
"use strict";
importScripts("encode.js", "quant.js");
function zlib(u8, inflate) {
  var s = new (inflate ? DecompressionStream : CompressionStream)("deflate"), w = s.writable.getWriter();
  w.write(u8).catch(function () {}); w.close().catch(function () {});
  return new Response(s.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
}
var CRCT = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
onmessage = function (e) {
  var m = e.data, p;
  try {
    if (m.op === "indexed") { var r = FQUANT.reduce(m.img, m.o); p = m.fmt === "gif" ? Promise.resolve(FQUANT.gif(r)) : FQUANT.png8(r, function (u) { return zlib(u); }, crc32); }
    else if (m.op === "quantize") { var q = FQUANT.reduce(m.img, m.o), rgba = FQUANT.toRGBA(q); p = Promise.resolve({ data: rgba.data, width: rgba.width, height: rgba.height, pal: q.pal, transparent: q.transparent }); }
    else if (m.op === "tiff") p = FENC.tiff(m.img, m.o, function (u) { return zlib(u); });
    else if (m.op === "bmp") p = Promise.resolve(FENC.bmp(m.img, m.o));
    else if (m.op === "readTiff") p = FENC.readTiff(m.bytes, function (u) { return zlib(u, true); }, function (w, h) { if (w * h > m.maxPx || w > m.maxSide || h > m.maxSide) throw new Error("This TIFF is too large (" + w + " × " + h + ")"); }).then(function (r) { return r; });
    else throw new Error("Unknown job");
  } catch (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); return; }
  p.then(function (r) {
    var buf = r.data ? r.data.buffer : r.buffer;
    postMessage({ id: m.id, ok: true, result: r }, [buf]);
  }, function (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); });
};
