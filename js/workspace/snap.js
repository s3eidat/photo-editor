/* Workspace (files lane): snapping and smart guides. While moving a layer (or selected pixels) its edges and centre
   snap to guides, the grid, the document edges and centre, and other layers' edges and centres; matching layer
   alignments draw magenta smart guides. Marquee, crop, shape, gradient and transform handles snap their pointer.
   Hold Ctrl while dragging to turn snapping off for that drag. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, PIX = window.PIX;
  var S = WS.snap = {};
  S.lines = null;

  // ---------- layer bounds (cached per canvas version) ----------
  var BC = new WeakMap();
  function boundsOf(L, alt) {
    var o = alt || L;
    if (o.kind === "raster") {
      var c = o.canvas, v = PE.ver(c), hit = BC.get(c);
      if (!hit || hit.v !== v) { hit = { v: v, b: PIX.alphaBounds(PE.getData(c)) }; BC.set(c, hit); }
      return hit.b ? { x: o.x + hit.b.x, y: o.y + hit.b.y, w: hit.b.w, h: hit.b.h } : null;
    }
    if (o.kind === "text" || o.kind === "shape") return PE.aabbOf(PE.boxCorners(PE.vbox(o)));
    return null;
  }
  S.boundsOf = boundsOf;
  function tol() { return 8 / ED.zoom; }
  function on(k) { return WS.p.snap && WS.p[k]; }

  // candidate lines along one axis: [{v, kind: guide|grid|doc|layer, b (layer box for smart lines)}]
  function cands(axis, skip) {
    var d = ED.doc, out = [];
    if (on("snapGuides") && WS.p.guides) (d.guides || []).forEach(function (g) { if ((g.dir === "v") === (axis === "x")) out.push({ v: g.pos, kind: "guide" }); });
    if (on("snapDoc") || WS.p.smart) { var L = axis === "x" ? d.w : d.h; out.push({ v: 0, kind: "doc" }, { v: L / 2, kind: "doc", c: true }, { v: L, kind: "doc" }); }
    if (on("snapLayers") || WS.p.smart) d.layers.forEach(function (L) {
      if (!L.visible || (skip && skip.indexOf(L) >= 0)) return;
      var b = boundsOf(L); if (!b) return;
      var a0 = axis === "x" ? b.x : b.y, a1 = a0 + (axis === "x" ? b.w : b.h);
      out.push({ v: a0, kind: "layer", b: b }, { v: (a0 + a1) / 2, kind: "layer", b: b, c: true }, { v: a1, kind: "layer", b: b });
    });
    return out;
  }
  function gridNear(v, axis) {
    if (!(on("snapGrid") && WS.p.grid)) return null;
    var e = WS.fromUnit(WS.p.gridEvery, WS.p.gridUnit, axis) / Math.max(1, WS.p.gridSub);
    return e > 0 ? Math.round(v / e) * e : null;
  }
  // best snap for any of the given edge values; returns {delta, hit} or null
  function best(edges, cs, axis, t) {
    var bd = t + 1e-9, out = null;
    edges.forEach(function (e, i) {
      cs.forEach(function (c) { var dd = c.v - e; if (Math.abs(dd) < Math.abs(bd) || (Math.abs(dd) === Math.abs(bd) && out && out.hit.kind === "grid")) { bd = dd; out = { delta: dd, hit: c, edge: i }; } });
      var g = gridNear(e, axis); if (g != null && Math.abs(g - e) < Math.abs(bd)) { bd = g - e; out = { delta: g - e, hit: { v: g, kind: "grid" }, edge: i }; }
    });
    return out;
  }
  S.best = best;

  // ---------- moving a layer / selected pixels ----------
  var dragC = null;
  ED.snapMove = function (dr, dx, dy, e) {
    S.lines = null;
    if ((!WS.p.snap && !WS.p.smart) || (e && (e.ctrlKey || e.metaKey))) return { dx: dx, dy: dy };
    if (!dr._snap) {
      var b0 = dr.kind === "float" ? { x: dr.b.x, y: dr.b.y, w: dr.b.w, h: dr.b.h } : boundsOf(dr.L, { kind: dr.L.kind, canvas: dr.L.canvas, x: dr.x, y: dr.y, text: dr.t, shape: dr.s });
      dr._snap = b0 ? { b: b0, cx: cands("x", dr.kind === "float" ? null : [dr.L]), cy: cands("y", dr.kind === "float" ? null : [dr.L]) } : { none: true };
      dragC = dr;
    }
    var sn = dr._snap; if (sn.none) return { dx: dx, dy: dy };
    var b = sn.b, t = tol(), lines = [];
    function allowed(c) { return c.kind !== "doc" || on("snapDoc") || (WS.p.smart && c.c); }
    function axis(d, cs, a0, len, ax) {
      var r = best([a0 + d, a0 + len / 2 + d, a0 + len + d], cs.filter(allowed), ax, t);
      if (!r) return d;
      if (WS.p.smart && (r.hit.kind === "layer" || (r.hit.kind === "doc" && r.hit.c))) lines.push({ ax: ax, v: r.hit.v, b: r.hit.b || null });
      return d + Math.round(r.delta);
    }
    var nx = axis(dx, sn.cx, b.x, b.w, "x"), ny = axis(dy, sn.cy, b.y, b.h, "y");
    if (lines.length) S.lines = lines.map(function (l) { return Object.assign(l, { mb: { x: b.x + nx, y: b.y + ny, w: b.w, h: b.h } }); });
    return { dx: nx, dy: ny };
  };
  window.addEventListener("pointerup", function () { if (S.lines || dragC) { S.lines = null; dragC = null; ED.renderOvl(); } });

  // ---------- pointer snapping for drawing tools ----------
  var PT = { marquee: 1, ellipse: 1, crop: 1, shape: 1, polygon: 1, gradient: 1, text: 1 };
  ED.snapPt = function (p, e) {
    if (!ED.doc || !WS.p.snap || (e && (e.ctrlKey || e.metaKey))) return p;
    if (!PT[ED.tool] && !(ED.tool === "move" && ED.xf)) return p;
    var t = tol(), rx = best([p.x], cands("x", ED.xf ? [ED.xf.L] : null).filter(nonSmart), "x", t), ry = best([p.y], cands("y", ED.xf ? [ED.xf.L] : null).filter(nonSmart), "y", t);
    return { x: rx ? p.x + rx.delta : p.x, y: ry ? p.y + ry.delta : p.y };
  };
  function nonSmart(c) { return c.kind === "guide" || (c.kind === "doc" && on("snapDoc")) || (c.kind === "layer" && on("snapLayers")); }
  // one value (dragging a guide): grid, document, layer edges
  WS.snap1 = function (v, axis) {
    if (!ED.doc || !WS.p.snap) return v;
    var r = best([v], cands(axis).filter(function (c) { return c.kind !== "guide" && nonSmart(c); }), axis, tol());
    return r ? v + r.delta : v;
  };

  // ---------- smart guide lines ----------
  (ED.ovlExt = ED.ovlExt || []).push(function (c) {
    if (!S.lines || !ED.doc) return;
    c.strokeStyle = WS.p.smartColor; c.lineWidth = 1;
    S.lines.forEach(function (l) {
      var m = l.mb, o = l.b || { x: 0, y: 0, w: ED.doc.w, h: ED.doc.h }, a, b2;
      c.beginPath();
      if (l.ax === "x") { a = ED.toScr(l.v, Math.min(m.y, o.y)); b2 = ED.toScr(l.v, Math.max(m.y + m.h, o.y + o.h)); var x = Math.round(a.x) + 0.5; c.moveTo(x, a.y); c.lineTo(x, b2.y); }
      else { a = ED.toScr(Math.min(m.x, o.x), l.v); b2 = ED.toScr(Math.max(m.x + m.w, o.x + o.w), l.v); var y = Math.round(a.y) + 0.5; c.moveTo(a.x, y); c.lineTo(b2.x, y); }
      c.stroke();
    });
  });

  // ---------- self-test ----------
  FX.tests.push(async function (ok, near, px, solid) {
    var keep = { doc: ED.doc, hist: ED.hist, p: Object.assign({}, WS.p), zoom: ED.zoom };
    var d = PE.newDoc(400, 300, "s"), A = PE.rasterFromCanvas(solid(50, 40, "#f00"), "A", 100, 100), B = PE.rasterFromCanvas(solid(60, 30, "#00f"), "B", 250, 180);
    d.layers = [A, B]; d.guides = [{ dir: "v", pos: 200 }]; ED.doc = d; ED.zoom = 1;
    Object.assign(WS.p, { snap: true, snapGuides: true, snapDoc: true, snapLayers: true, smart: true, guides: true, grid: false });
    var dr = { kind: "move", L: B, x: 250, y: 180, t: null, s: null };
    var r = ED.snapMove(dr, -48, 0, {}); ok(r.dx === -50, "snap left edge to guide (" + r.dx + ")");             // B.x 250-48=202 -> 200
    var r2 = ED.snapMove(dr, -97, -73, {}); ok(r2.dx === -100 && r2.dy === -75 && S.lines && S.lines.length >= 1, "snap to layer edges with smart guide (" + r2.dx + "," + r2.dy + ")");   // B.y 180-75=105 near A.y 100
    ok(ED.snapMove(dr, -48, 0, { ctrlKey: true }).dx === -48, "Ctrl turns snapping off");
    WS.p.snap = false; WS.p.smart = false; ok(ED.snapMove({ kind: "move", L: B, x: 250, y: 180 }, -48, 0, {}).dx === -48, "snapping off");
    WS.p.snap = true; WS.p.grid = true; WS.p.gridEvery = 100; WS.p.gridUnit = "px"; WS.p.gridSub = 4;
    var keepTool = ED.tool; ED.tool = "marquee";
    var q = ED.snapPt({ x: 73, y: 3 }, {}); ok(q.x === 75 && q.y === 0, "pointer snaps to grid / document edge (" + q.x + "," + q.y + ")");
    ED.tool = "brush"; ok(ED.snapPt({ x: 73, y: 3 }, {}).x === 73, "brush never snaps");
    ED.tool = keepTool;
    ok(near(WS.snap1(98, "x"), 100, 1e-9), "guide drag snaps to layer edge");
    S.lines = null; Object.assign(WS.p, keep.p); ED.doc = keep.doc; ED.hist = keep.hist; ED.zoom = keep.zoom;
  });
})();
