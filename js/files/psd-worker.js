/* Files lane: PSD reading and writing off the main thread (vendored ag-psd, MIT, see lib/ag-psd.LICENSE).
   Pixels travel as raw RGBA arrays (useImageData) so nothing is lost to premultiplied canvases. */
"use strict";
importScripts("../../lib/ag-psd.js");
agPsd.initializeCanvas(function (w, h) { return new OffscreenCanvas(w, h); }, function (w, h) { return new ImageData(w, h); });

// Keep only structured-cloneable values and collect pixel buffers to hand back without copying.
function plain(v, out, depth) {
  if (v == null || typeof v !== "object") return typeof v === "function" ? undefined : v;
  if (depth > 40) return undefined;
  if (typeof OffscreenCanvas !== "undefined" && v instanceof OffscreenCanvas) return undefined;
  if (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap) return undefined;
  if (ArrayBuffer.isView(v)) { if (out.indexOf(v.buffer) < 0 && v.byteLength > 4096) out.push(v.buffer); return v; }
  if (v instanceof ImageData) { if (out.indexOf(v.data.buffer) < 0) out.push(v.data.buffer); return { data: v.data, width: v.width, height: v.height }; }
  if (Array.isArray(v)) return v.map(function (x) { return plain(x, out, depth + 1); });
  var o = {};
  for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) { var x = plain(v[k], out, depth + 1); if (x !== undefined) o[k] = x; }
  return o;
}

onmessage = function (e) {
  var m = e.data;
  try {
    if (m.op === "read") {
      var psd = agPsd.readPsd(m.buf, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true, skipCompositeImageData: !!m.noComposite, totalMemoryLimit: m.limit || 1.5e9 });
      var tr = [], res = plain(psd, tr, 0);
      postMessage({ id: m.id, ok: true, result: res }, tr);
    } else if (m.op === "write") {
      var ab = agPsd.writePsd(m.psd, m.opts || {});
      postMessage({ id: m.id, ok: true, result: ab }, [ab]);
    } else throw new Error("Unknown job");
  } catch (err) {
    postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
