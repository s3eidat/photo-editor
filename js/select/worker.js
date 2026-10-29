/* Selection-lane worker: runs PIXS (js/select/selpix.js) and PIX maths off the main thread.
   Messages: {id, fn, args} -> {id, ok, result} | {id, ok: false, error}. Nothing leaves this device. */
"use strict";
importScripts("../pix.js", "selpix.js");
function transfers(v, out) {
  if (!v || typeof v !== "object") return out;
  if (ArrayBuffer.isView(v)) { if (out.indexOf(v.buffer) < 0) out.push(v.buffer); return out; }
  if (v.data && ArrayBuffer.isView(v.data)) return transfers(v.data, out);
  if (Array.isArray(v)) v.forEach(function (x) { transfers(x, out); });
  else Object.keys(v).forEach(function (k) { if (ArrayBuffer.isView(v[k])) transfers(v[k], out); });
  return out;
}
self.onmessage = function (e) {
  var m = e.data || {};
  try {
    var result = PIXS.call(m.fn, m.args || []);
    self.postMessage({ id: m.id, ok: true, result: result }, transfers(result, []));
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
