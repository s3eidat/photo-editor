/* Files lane: encoders that are too slow for the main thread on big images (TIFF, BMP) and the TIFF reader. */
"use strict";
importScripts("encode.js");
function zlib(u8, inflate) {
  var s = new (inflate ? DecompressionStream : CompressionStream)("deflate"), w = s.writable.getWriter();
  w.write(u8).catch(function () {}); w.close().catch(function () {});
  return new Response(s.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
}
onmessage = function (e) {
  var m = e.data, p;
  try {
    if (m.op === "tiff") p = FENC.tiff(m.img, m.o, function (u) { return zlib(u); });
    else if (m.op === "bmp") p = Promise.resolve(FENC.bmp(m.img, m.o));
    else if (m.op === "readTiff") p = FENC.readTiff(m.bytes, function (u) { return zlib(u, true); }, function (w, h) { if (w * h > m.maxPx || w > m.maxSide || h > m.maxSide) throw new Error("This TIFF is too large (" + w + " × " + h + ")"); }).then(function (r) { return r; });
    else throw new Error("Unknown job");
  } catch (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); return; }
  p.then(function (r) {
    var buf = r.data ? r.data.buffer : r.buffer;
    postMessage({ id: m.id, ok: true, result: r }, [buf]);
  }, function (err) { postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); });
};
