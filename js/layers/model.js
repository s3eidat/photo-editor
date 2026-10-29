/* Selection lane, layer model extensions: extra per-layer fields (fill opacity, groups, clipping, styles,
   adjustment / fill / smart layers…), their undo snapshots and how they are saved in .s3photo projects.
   Fields are optional: a layer without them behaves exactly as before. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;

  // Extra keys snapshotted for undo. Values are plain data; canvases inside are kept by reference (they are never mutated in place).
  var KEYS = SX.KEYS = ["fillOp", "clip", "parent", "open", "adj", "fillSpec", "smart", "fx", "vmask", "link"];
  function keep(v) {
    if (v == null || typeof v !== "object") return v;
    if (typeof HTMLCanvasElement !== "undefined" && v instanceof HTMLCanvasElement) return v;
    if (ArrayBuffer.isView(v)) return v;
    if (Array.isArray(v)) return v.map(keep);
    var o = {}; Object.keys(v).forEach(function (k) { o[k] = keep(v[k]); }); return o;
  }
  SX.keep = keep;
  PE.snapExt = function (L, p) { var x = {}; KEYS.forEach(function (k) { if (L[k] !== undefined) x[k] = keep(L[k]); }); p.ext = x; };
  PE.restoreExt = function (L, p) { var x = p.ext || {}; KEYS.forEach(function (k) { if (x[k] !== undefined) L[k] = keep(x[k]); else delete L[k]; }); };

  // ---------- project files ----------
  // Each feature registers SX.fields[key] = { save(L) -> JSON or undefined, parse(raw value, out layer) -> clean value or undefined }.
  var F = SX.fields = {};
  PE.kindsExt = PE.kindsExt || [];
  var ID = /^[a-z0-9]{1,40}$/;
  PE.saveExt = function (L, l, i, jobs, files) {
    l.uid = L.id;
    Object.keys(F).forEach(function (k) { if (L[k] === undefined || !F[k].save) return; var v = F[k].save(L, l, i, jobs, files); if (v !== undefined) l[k] = v; });
  };
  PE.parseExt = function (raw, out, i, ids) {
    if (typeof raw.uid === "string" && ID.test(raw.uid)) out.uid = raw.uid;
    Object.keys(F).forEach(function (k) { if (raw[k] === undefined || !F[k].parse) return; var v = F[k].parse(raw[k], out, raw, i, ids); if (v !== undefined) out[k] = v; });
    (SX.parseFix || []).forEach(function (f) { f(raw, out, i, ids); });
  };
  PE.openExt = function (l, L, img, jobs) {
    if (l.uid) L.id = l.uid;
    Object.keys(F).forEach(function (k) { if (l[k] === undefined) return; if (F[k].open) F[k].open(l, L, img, jobs); else L[k] = PE.clone(l[k]); });
  };
  function num(v, a, b) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : undefined; }
  SX.num = num;
  SX.idOk = function (v) { return typeof v === "string" && ID.test(v) ? v : undefined; };

  F.fillOp = { save: function (L) { return L.fillOp < 1 ? Math.round(L.fillOp * 1000) / 1000 : undefined; }, parse: function (v) { return num(v, 0, 1); } };

  // ---------- small accessors ----------
  SX.fillOf = function (L) { return L.fillOp == null ? 1 : L.fillOp; };
  SX.byId = function (doc) { var m = {}; doc.layers.forEach(function (L) { m[L.id] = L; }); return m; };
})();
