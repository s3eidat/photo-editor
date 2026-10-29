/* Photo Editor worker: runs the heavy pixel maths from pix.js off the main thread.
   Messages: {id, fn, args} -> {id, ok, result} | {id, ok: false, error}. Images can be "loaded" once
   under a key ({id, load: key, img, sel}) and then used by {id, fn: "adjust", key, op, p}: dialogs preview
   many settings against the same source without sending the pixels each time. Nothing leaves this device. */
"use strict";
importScripts("pix.js");
importScripts("adjust/amath.js", "adjust/tone.js");   // lane:adjust
var held = {};
function transfers(v, out) {
  if (!v || typeof v !== "object") return out;
  if (ArrayBuffer.isView(v)) { if (out.indexOf(v.buffer) < 0) out.push(v.buffer); return out; }
  if (v.data && ArrayBuffer.isView(v.data)) return transfers(v.data, out);
  if (Array.isArray(v)) v.forEach(function (x) { transfers(x, out); });
  return out;
}
self.onmessage = function (e) {
  var m = e.data || {};
  try {
    if (m.load) { held = {}; held[m.load] = { img: m.img, sel: m.sel || null }; self.postMessage({ id: m.id, ok: true, result: true }); return; }
    if (m.drop) { delete held[m.drop]; self.postMessage({ id: m.id, ok: true, result: true }); return; }
    var result;
    if (m.key) {
      var h = held[m.key];
      if (!h) throw new Error("Source not loaded");
      var img = PIX.copyImg(h.img);
      result = PIX.adjust(img, m.op, m.p, h.sel);
    } else result = PIX.call(m.fn, m.args || []);
    self.postMessage({ id: m.id, ok: true, result: result }, transfers(result, []));
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
