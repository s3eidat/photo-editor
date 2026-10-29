/* Vector lane model: live vector shape layers drawn from paths (parametric rect / ellipse / polygon / star / line with
   arrowheads / custom shapes / free paths with unite-subtract-intersect-exclude components), stroke styles (dash, caps,
   joins, inside / centre / outside), the document's saved paths, and the whitelist for their project-file fields.
   Shape layers keep kind "shape": everything new is optional fields on L.shape, so the existing move / transform /
   undo / save code keeps working and older files open unchanged. */
(function () {
  "use strict";
  var PE = window.PE, VG = PE.VG, ED = PE.ed;
  var VX = PE.VX = PE.VX || {};
  VX.TYPES = ["rect", "ellipse", "triangle", "star", "arrow", "line", "polygon", "path"];
  var DASHES = VX.DASHES = { solid: null, dash: [4, 2], dot: [0, 2], dashdot: [4, 2, 0, 2], long: [8, 3] };

  // ---------- shape -> components (in the shape's box, doc units, before rotation) ----------
  function unitToBox(cs, b) { return VG.map(cs, function (u, v) { return [b.x + u * b.w, b.y + v * b.h]; }); }
  VX.unitToBox = unitToBox;
  function shapeComps(s, b) {
    var x = b.x, y = b.y, w = b.w, h = b.h, t = s.type, P = VG.P;
    if (t === "path") return unitToBox(s.comps || [], b);
    if (t === "ellipse") return [VG.ellipse(x, y, w, h)];
    if (t === "triangle") return [VG.comp([P(x + w / 2, y), P(x + w, y + h), P(x, y + h)])];
    if (t === "star" && s.sides == null) {      // the original 5-point star, kept pixel-identical
      var pts = [];
      for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; pts.push(P(x + w / 2 + Math.cos(a) * w / 2 * r, y + h / 2 + Math.sin(a) * h / 2 * r + h * 0.04)); }
      return [VG.comp(pts)];
    }
    if (t === "polygon" || t === "star") return [VG.roundPoly(VG.polyPts(x, y, w, h, s.sides || 5, t === "star" ? (s.indent == null ? 0.5 : s.indent) : (s.indent || 0)), s.radius || 0)];
    if (t === "arrow") {
      var sh = h * 0.36, hw = Math.min(w * 0.45, h * 0.9);
      return [VG.comp([P(x, y + h / 2 - sh / 2), P(x + w - hw, y + h / 2 - sh / 2), P(x + w - hw, y), P(x + w, y + h / 2), P(x + w - hw, y + h), P(x + w - hw, y + h / 2 + sh / 2), P(x, y + h / 2 + sh / 2)])];
    }
    if (t === "line") return [VG.comp([P(x, y + h / 2), P(x + w, y + h / 2)], false)];
    var r2 = PE.clamp(s.radius || 0, 0, Math.min(Math.abs(w), Math.abs(h)) / 2);
    if (r2 > 0) return [VG.roundPoly([{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }], r2)];
    return [VG.comp([P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)])];
  }
  VX.shapeComps = shapeComps;

  // Shape box <-> document: the box is rotated about its centre and may be flipped (same as core drawVector).
  function boxMatrix(s) {
    var cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = (s.rot || 0) * Math.PI / 180, c = Math.cos(a), n = Math.sin(a), fx = s.flipX ? -1 : 1, fy = s.flipY ? -1 : 1;
    var m = PE.mMul([1, 0, 0, 1, cx, cy], [c, n, -n, c, 0, 0]);
    m = PE.mMul(m, [fx, 0, 0, fy, 0, 0]);
    return PE.mMul(m, [1, 0, 0, 1, -cx, -cy]);
  }
  VX.boxMatrix = boxMatrix;
  // The layer's outline in document coordinates (what the direct-selection tool edits).
  VX.docComps = function (L) { var s = L.shape; return VG.affine(shapeComps(s, { x: s.x, y: s.y, w: s.w, h: s.h }), boxMatrix(s)); };
  // Store document-space components into a shape layer as a free path, keeping its rotation (box re-fitted).
  VX.setDocComps = function (L, cs) {
    var s = L.shape, a = (s.rot || 0) * Math.PI / 180, c = Math.cos(-a), n = Math.sin(-a), fx = s.flipX ? -1 : 1, fy = s.flipY ? -1 : 1;
    var loc = VG.map(cs, function (x, y) { return [(c * x - n * y) * fx, (n * x + c * y) * fy]; });     // un-rotate about the origin
    var b = VG.bounds(loc) || { x: 0, y: 0, w: 1, h: 1 }, bw = Math.max(b.w, 1e-6), bh = Math.max(b.h, 1e-6);
    var lc = { x: (b.x + b.w / 2) * fx, y: (b.y + b.h / 2) * fy }, cc = Math.cos(a), cn = Math.sin(a), dc = { x: cc * lc.x - cn * lc.y, y: cn * lc.x + cc * lc.y };
    s.comps = VG.map(loc, function (x, y) { return [r6((x - b.x) / bw), r6((y - b.y) / bh)]; });
    s.type = "path"; s.w = Math.max(1, b.w); s.h = Math.max(1, b.h); s.x = dc.x - s.w / 2; s.y = dc.y - s.h / 2;
    if (b.w < 1) s.comps = VG.map(s.comps, function (u, v) { return [0.5 + (u - 0.5) * b.w, v]; });
    if (b.h < 1) s.comps = VG.map(s.comps, function (u, v) { return [u, 0.5 + (v - 0.5) * b.h]; });
    delete s.radius; delete s.sides; delete s.indent;
  };
  function r6(v) { return Math.round(v * 1e8) / 1e8; }

  // ---------- drawing ----------
  var BOOL = new Map();      // cache of boolean results per layer
  function outline(L, s, b) {
    var cs = shapeComps(s, b);
    if (!VG.needsBool(cs) && !(cs.length > 1 && (s.sw || 0) > 0 && cs.every(function (c) { return c.closed; }) && s.type === "path")) return { cs: cs };
    var key = JSON.stringify(cs), hit = BOOL.get(L);
    if (hit && hit.key === key) return hit.v;
    var v = { rings: VG.combine(cs, Math.max(0.05, Math.min(b.w, b.h) / 2000)) };
    BOOL.set(L, { key: key, v: v });
    return v;
  }
  VX.outline = outline;
  function tracePath(c, o) { c.beginPath(); if (o.rings) VG.traceRings(c, o.rings, true); else VG.trace(c, o.cs); }
  VX.draw = function (c, L, b) {
    if (L.kind === "text") return VX.drawText ? VX.drawText(c, L, b) : false;
    var s = L.shape, line = s.type === "line", o = outline(L, s, b);
    var sw = line ? Math.max(1, s.sw || b.h) : s.sw || 0, al = line ? "center" : s.align || "center";
    if (!line && s.fill) { tracePath(c, o); c.fillStyle = PE.hex(s.fill, "#cccccc"); if (s.fillOp != null) c.globalAlpha = s.fillOp; c.fill("nonzero"); c.globalAlpha = 1; }
    if (sw > 0) {
      c.save();
      c.lineJoin = s.join || "round"; c.lineCap = s.cap || "round"; c.miterLimit = 10;
      c.strokeStyle = PE.hex(s.stroke, "#111111");
      var dash = s.dash && s.dash.length ? s.dash.map(function (d) { return Math.max(d * sw, d ? 0.01 : 0.0001); }) : null;
      if (dash) { c.setLineDash(dash); c.lineDashOffset = (s.dashOff || 0) * sw; if (!s.cap && dash.some(function (d) { return d < 0.01; })) c.lineCap = "round"; }
      if (al !== "center" && o.cs && o.cs.some(function (k) { return !k.closed; })) al = "center";
      if (al === "inside") { tracePath(c, o); c.clip("nonzero"); c.lineWidth = sw * 2; }
      else if (al === "outside") { c.beginPath(); c.rect(-1e6, -1e6, 2e6, 2e6); if (o.rings) VG.traceRings(c, o.rings, true); else VG.trace(c, o.cs); c.clip("evenodd"); c.lineWidth = sw * 2; }
      else c.lineWidth = sw;
      tracePath(c, o); c.stroke();
      c.restore();
    }
    if (line && (s.arrowS || s.arrowE)) drawArrows(c, s, b, sw);
    return true;
  };
  function drawArrows(c, s, b, sw) {
    var y = b.y + b.h / 2, w = (s.aw || 5) * sw, l = (s.al || 5) * sw, cc = (s.ac || 0) / 100;
    c.save(); c.fillStyle = PE.hex(s.stroke, "#111111"); c.setLineDash([]);
    [[s.arrowE, b.x + b.w, 0], [s.arrowS, b.x, Math.PI]].forEach(function (z) {
      if (!z[0]) return;
      var hd = VG.arrowHead(z[1], y, z[2], w, l, cc);
      c.beginPath(); hd.forEach(function (p, i) { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.closePath(); c.fill();
    });
    c.restore();
  }
  VX.pad = function (L, pad) {
    if (L.kind === "text") return VX.padText ? VX.padText(L, pad) : pad;
    var s = L.shape, sw = s.sw || 0, k = (s.align === "outside" ? 2 : 1) * (s.join === "miter" ? 5 : 1);
    if (s.type === "line" && (s.arrowS || s.arrowE)) k = Math.max(k, Math.max(s.aw || 5, s.al || 5));
    return Math.max(pad, sw * k + 4);
  };

  // ---------- project files: whitelist the extra fields ----------
  function num(v, a, b, d) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }
  VX.num = num;
  function cleanPts(pts, lim) {
    if (!Array.isArray(pts)) return null;
    return pts.slice(0, 4000).map(function (p) {
      if (!Array.isArray(p) || p.length < 2) return null;
      var o = [];
      for (var i = 0; i < 6; i++) o.push(num(p[i < p.length ? i : i % 2], -lim, lim, 0));
      if (p.length < 6) { o[2] = o[4] = o[0]; o[3] = o[5] = o[1]; }
      o.push(p[6] === 2 ? 2 : p[6] ? 1 : 0);
      return o;
    }).filter(Boolean);
  }
  function cleanComps(cs, lim) {
    if (!Array.isArray(cs)) return null;
    return cs.slice(0, 500).map(function (c) {
      if (!c || typeof c !== "object") return null;
      var pts = cleanPts(c.pts, lim); if (!pts || !pts.length) return null;
      return { op: ["add", "sub", "int", "xor"].indexOf(c.op) >= 0 ? c.op : "add", closed: c.closed !== false, pts: pts };
    }).filter(Boolean);
  }
  VX.cleanComps = cleanComps;
  VX.cleanShapeExtra = function (raw, s) {
    if (!raw || typeof raw !== "object") return;
    if (VX.TYPES.indexOf(raw.type) >= 0) s.type = raw.type;
    if (s.type === "path") { s.comps = cleanComps(raw.comps, 1e3) || []; if (!s.comps.length) s.type = "rect"; }
    if (raw.sides != null) s.sides = Math.round(num(raw.sides, 3, 100, 5));
    if (raw.indent != null) s.indent = num(raw.indent, 0, 0.99, 0.5);
    if (Array.isArray(raw.dash) && raw.dash.length) s.dash = raw.dash.slice(0, 8).map(function (d) { return num(d, 0, 1000, 1); });
    if (raw.dashOff != null) s.dashOff = num(raw.dashOff, -1e4, 1e4, 0);
    if (["butt", "round", "square"].indexOf(raw.cap) >= 0) s.cap = raw.cap;
    if (["miter", "round", "bevel"].indexOf(raw.join) >= 0) s.join = raw.join;
    if (["inside", "center", "outside"].indexOf(raw.align) >= 0) s.align = raw.align;
    if (raw.fillOp != null) s.fillOp = num(raw.fillOp, 0, 1, 1);
    if (raw.arrowS === true) s.arrowS = true;
    if (raw.arrowE === true) s.arrowE = true;
    ["aw", "al"].forEach(function (k) { if (raw[k] != null) s[k] = num(raw[k], 1, 50, 5); });
    if (raw.ac != null) s.ac = num(raw.ac, -50, 50, 0);
    if (typeof raw.lib === "string" && /^[a-z]{1,20}$/.test(raw.lib)) s.lib = raw.lib;
  };
  var layerParsers = [];
  VX.onParseLayer = function (f) { layerParsers.push(f); };
  VX.parseLayer = function (raw, out) {
    if (out.kind === "shape" && raw.shape) VX.cleanShapeExtra(raw.shape, out.shape);
    layerParsers.forEach(function (f) { f(raw, out); });
  };

  // ---------- the document's paths (Paths panel): doc.vpaths = [{ id, name, comps (doc coords) }], doc.work = work path ----------
  VX.saveDoc = function (doc, meta) {
    if (doc.vpaths && doc.vpaths.length) meta.vpaths = doc.vpaths.map(function (p) { return { name: p.name, comps: p.comps }; });
    if (doc.work && doc.work.comps.length) meta.work = { comps: doc.work.comps };
  };
  VX.openDoc = function (doc, text) {
    var d; try { d = JSON.parse(text); } catch (e) { return; }
    var lim = 3 * PE.LIM.side;
    if (Array.isArray(d.vpaths)) doc.vpaths = d.vpaths.slice(0, 200).map(function (p) {
      if (!p || typeof p !== "object") return null;
      var cs = cleanComps(p.comps, lim); if (!cs) return null;
      return { id: PE.uid("p"), name: (typeof p.name === "string" ? p.name : "Path").replace(/[\u0000-\u001f]/g, " ").slice(0, 100) || "Path", comps: cs };
    }).filter(Boolean);
    if (d.work && typeof d.work === "object") { var w = cleanComps(d.work.comps, lim); if (w && w.length) doc.work = { id: "work", name: "Work path", comps: w }; }
  };
  // Undoable change to the document's paths (they live outside the layer snapshots).
  function pathsState(doc) { return { vpaths: (doc.vpaths || []).map(function (p) { return { id: p.id, name: p.name, comps: VG.clone(p.comps) }; }), work: doc.work ? { id: "work", name: "Work path", comps: VG.clone(doc.work.comps) } : null, ap: doc.apath || null }; }
  function setPaths(doc, st) { doc.vpaths = st.vpaths.map(function (p) { return { id: p.id, name: p.name, comps: VG.clone(p.comps) }; }); doc.work = st.work ? { id: "work", name: "Work path", comps: VG.clone(st.work.comps) } : null; doc.apath = st.ap; }
  VX.pathEdit = function (label, fn) {
    var doc = ED.doc, before = pathsState(doc), r = fn(), after = pathsState(doc);
    if (JSON.stringify(before) === JSON.stringify(after)) return r;
    var bytes = 400 + JSON.stringify(after).length * 2;
    ED.push({ label: label, bytes: bytes, undo: function () { setPaths(doc, before); ED.emit("paths"); }, redo: function () { setPaths(doc, after); ED.emit("paths"); } });
    ED.emit("paths");
    return r;
  };
  // Start a change to the paths that is committed (one history step) later: dragging anchors of a saved path.
  VX.pathBegin = function () {
    var doc = ED.doc, before = pathsState(doc);
    return {
      commit: function (label) {
        var after = pathsState(doc);
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        ED.push({ label: label, bytes: 400 + JSON.stringify(after).length * 2, undo: function () { setPaths(doc, before); ED.emit("paths"); }, redo: function () { setPaths(doc, after); ED.emit("paths"); } });
        ED.emit("paths");
      },
      cancel: function () { setPaths(doc, before); ED.emit("paths"); }
    };
  };
  VX.findPath = function (doc, id) {
    if (!doc) return null;
    if (id === "work") return doc.work || null;
    return (doc.vpaths || []).filter(function (p) { return p.id === id; })[0] || null;
  };
})();
