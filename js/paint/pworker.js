/* Photo Editor paint lane worker: runs js/paint/pmath.js off the main thread ({id, fn, args} -> {id, ok, result}).
   Only whitelisted functions (PPX.ALLOWED) can be called. Nothing leaves this device. */
"use strict";
importScripts("../pix.js", "pmath.js");
function transfers(v, out) {
  if (!v || typeof v !== "object") return out;
  if (ArrayBuffer.isView(v)) { if (out.indexOf(v.buffer) < 0) out.push(v.buffer); return out; }
  if (Array.isArray(v)) { v.forEach(function (x) { transfers(x, out); }); return out; }
  Object.keys(v).forEach(function (k) { transfers(v[k], out); });
  return out;
}
self.onmessage = function (e) {
  var m = e.data || {};
  try {
    var result = PPX.call(m.fn, m.args || []);
    self.postMessage({ id: m.id, ok: true, result: result }, transfers(result, []));
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
