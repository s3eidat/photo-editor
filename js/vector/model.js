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
    if (!line && s.fill) { tracePath(c, o); c.fillStyle = s.grad ? gradient(c, s.grad, b) : PE.hex(s.fill, "#cccccc"); if (s.fillOp != null) c.globalAlpha = s.fillOp; c.fill("nonzero"); c.globalAlpha = 1; }
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
  // gradient fill across the shape's box (in its own rotated frame): linear at an angle, or radial from the centre
  function gradient(c, G, b) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, g, a = (G.angle || 0) * Math.PI / 180;
    if (G.type === "radial") g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.max(b.w, b.h) / 2 * (G.scale || 1)));
    else { var hl = (Math.abs(b.w * Math.cos(a)) + Math.abs(b.h * Math.sin(a))) / 2 * (G.scale || 1), dx = Math.cos(a) * hl, dy = -Math.sin(a) * hl; g = c.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy); }
    (G.stops || []).forEach(function (st) { var q = PE.rgbOf(st[1]); g.addColorStop(PE.clamp(st[0], 0, 1), "rgba(" + q.join(",") + "," + (st[2] == null ? 1 : st[2]) + ")"); });
    return g;
  }
  VX.gradient = gradient;
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
    if (typeof raw.lib === "string" && /^[a-z0-9]{1,24}$/.test(raw.lib)) s.lib = raw.lib;
    if (raw.grad && typeof raw.grad === "object" && Array.isArray(raw.grad.stops)) {
      var st = raw.grad.stops.slice(0, 16).map(function (q) { return Array.isArray(q) ? [num(q[0], 0, 1, 0), PE.hex(q[1], "#000000"), num(q[2], 0, 1, 1)] : null; }).filter(Boolean);
      if (st.length >= 2) s.grad = { type: raw.grad.type === "radial" ? "radial" : "linear", angle: num(raw.grad.angle, -360, 360, 0), scale: num(raw.grad.scale, 0.1, 10, 1), stops: st };
    }
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
/* worker bridge for the vector lane's heavy pixel jobs (falls back to this thread) */
(function () {
  "use strict";
  var PE = window.PE, VX = PE.VX;
  var W = null, alive = false, jid = 0, pend = {};
  function start() {
    if (W !== null) return;
    try {
      W = new Worker("js/vector/vworker.js");
      W.onmessage = function (e) { var m = e.data, p = pend[m.id]; if (m.id === 0) { alive = true; return; } if (!p) return; delete pend[m.id]; if (m.ok) p.res(m.result); else p.rej(new Error(m.error)); };
      W.onerror = function () { alive = false; W = false; Object.keys(pend).forEach(function (k) { var p = pend[k]; delete pend[k]; p.local(); }); };
      W.postMessage({ id: 0, fn: "traceMask", args: [new Uint8Array(1), 1, 1, 128] });
    } catch (e) { W = false; }
  }
  // VX.work(fn, args, transfer?) runs VPIX[fn](...args) in the worker (copies the inputs unless transfer lists buffers)
  VX.work = function (fn, args, transfer) {
    start();
    function local() { return window.VPIX.call(fn, args); }
    if (!alive || !W) return Promise.resolve().then(local);
    return new Promise(function (res, rej) {
      var id = ++jid;
      pend[id] = { res: res, rej: rej, local: function () { try { res(local()); } catch (e) { rej(e); } } };
      W.postMessage({ id: id, fn: fn, args: args }, transfer || []);
    });
  };
  VX.workerAlive = function () { start(); return alive; };
  setTimeout(start, 400);
})();
/* fast live preview while dragging: draw a vector layer at screen resolution into one reused, viewport-sized canvas
   instead of re-rendering its full-size surface on every move (big shapes on big documents stay smooth) */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, fc = null;
  VX.fastLive = function (L) {
    var d = ED.doc;
    if (!d || !L || L.kind === "raster" || (L.mask && L.maskOn) || !ED.stage || (PE.sx && PE.sx.special && PE.sx.special(d))) { ED.render(); return; }
    var st = ED.stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), k = ED.zoom * dpr;
    var x0 = Math.max(-64, -ED.panX / ED.zoom), y0 = Math.max(-64, -ED.panY / ED.zoom), x1 = Math.min(d.w + 64, (st.width - ED.panX) / ED.zoom), y1 = Math.min(d.h + 64, (st.height - ED.panY) / ED.zoom);
    if (x1 <= x0 || y1 <= y0) { ED.render(); return; }
    var W = Math.max(1, Math.ceil((x1 - x0) * k)), H = Math.max(1, Math.ceil((y1 - y0) * k));
    if (W * H > 16e6) { ED.render(); return; }
    if (!fc || fc.width !== W || fc.height !== H) fc = PE.mk(W, H);
    var c = PE.cx2(fc); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    c.setTransform(k, 0, 0, k, -x0 * k, -y0 * k); PE.drawVector(c, L); c.setTransform(1, 0, 0, 1, 0, 0);
    ED.live.over[L.id] = { canvas: PE.touch(fc), x: 0, y: 0, m: [1 / k, 0, 0, 1 / k, x0, y0] };
    ED.render();
  };
})();
