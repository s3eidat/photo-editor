/* Vector lane: Edit › Perspective warp. Two steps: Layout — drag out one quad per plane in the photo (a wall, a
   road, a building side) and fit its corners to the plane; corners that touch snap together so planes stay joined.
   Warp — move the corners (joined ones move together) or straighten verticals / horizontals in one click. Each quad
   carries a projective map; the rest of the layer follows the nearest quad. The full layer is resampled in the worker. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, WF = PE.WF, UI = VX.ui, PIX = window.PIX, h = S3.h;
  var P = null;
  VX.pwSession = function () { return P; };
  function cl(q) { return q.map(function (p) { return { x: p.x, y: p.y }; }); }

  VX.startPerspectiveWarp = function () {
    if (!ED.doc || ED.busyCheck()) return;
    var L = ED.layer(); if (!ED.editable(L, "pixels")) return;
    if (ED.xf) ED.applyTransform();
    ED.cancelModes();
    var ab = PIX.alphaBounds(PE.getData(L.canvas)); if (!ab) { S3.toast("This layer is empty", "error"); return; }
    var r = { x: L.x + ab.x, y: L.y + ab.y, w: ab.w, h: ab.h }, k = Math.min(1, 1000 / Math.max(r.w, r.h)), pc = PE.mk(Math.max(1, Math.ceil(r.w * k)), Math.max(1, Math.ceil(r.h * k)));
    PE.cx2(pc).drawImage(L.canvas, r.x - L.x, r.y - L.y, r.w, r.h, 0, 0, pc.width, pc.height);
    P = { L: L, r: r, prev: pc, phase: "layout", quads: [] };
    ED.setTool("vpw"); ED.emit("tool"); ED.renderOvl();
    S3.toast("Drag a box over each plane, then fit its corners. Then switch to Warp.");
  };
  // ---------- mapping ----------
  function maps() {
    return P.quads.map(function (q) { return { s: WF.homog(q.src), d: WF.homog(q.dst || q.src), q: q }; });
  }
  function segDist(p, a, b) { var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0; return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); }
  function inside(poly, p) { var w = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) w = !w; } return w; }
  function mapper() {
    var M = maps(), r = P.r;
    return function (u, v) {
      var p = { x: r.x + u * r.w, y: r.y + v * r.h }, best = null, bd = Infinity;
      for (var i = 0; i < M.length; i++) {
        var s = M[i].q.src;
        if (inside(s, p)) { best = M[i]; break; }
        var d = Math.min(segDist(p, s[0], s[1]), segDist(p, s[1], s[2]), segDist(p, s[2], s[3]), segDist(p, s[3], s[0]));
        if (d < bd) { bd = d; best = M[i]; }
      }
      if (!best) return p;
      var uv = best.s.inv(p.x, p.y), q = best.d(uv.u, uv.v), D = ED.doc, lx = 2 * Math.max(D.w, D.h);
      if (!isFinite(q.x) || !isFinite(q.y)) return p;      // past the horizon of the plane: keep it in place
      return { x: Math.max(-lx, Math.min(D.w + lx, q.x)), y: Math.max(-lx, Math.min(D.h + lx, q.y)) };
    };
  }
  VX.pwMapper = function () { return mapper(); };
  function preview() {
    if (!P) return;
    if (P.phase === "warp" && P.quads.length) VX.meshPreview(P.L, P.prev, mapper(), 28);
    else { delete ED.live.over[P.L.id]; ED.render(); ED.renderOvl(); }
  }
  var pvSoon = (function () { var raf = 0; return function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; preview(); }); }; })();
  function corners(set) { var out = []; P.quads.forEach(function (q, qi) { (set === "dst" ? q.dst : q.src).forEach(function (p, ci) { out.push({ qi: qi, ci: ci, p: p }); }); }); return out; }
  function linked(qi, ci) {      // corners that share a layout position with (qi, ci)
    var s = P.quads[qi].src[ci], out = [];
    P.quads.forEach(function (q, i) { q.src.forEach(function (p, j) { if (Math.abs(p.x - s.x) < 1e-6 && Math.abs(p.y - s.y) < 1e-6) out.push([i, j]); }); });
    return out;
  }
  VX.pwStraighten = function (which) {
    if (!P || P.phase !== "warp") return;
    for (var pass = 0; pass < 12; pass++) P.quads.forEach(function (q, qi) {      // joined planes: repeat until the shared corners agree
      for (var e = 0; e < 4; e++) {
        var a = q.dst[e], b = q.dst[(e + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 180;
        var vert = Math.abs(ang - 90) < 35, hor = ang < 35 || ang > 145;
        if (vert && (which === "v" || which === "both")) { var mx = (a.x + b.x) / 2; setDst(qi, e, { x: mx, y: a.y }); setDst(qi, (e + 1) % 4, { x: mx, y: b.y }); }
        if (hor && (which === "h" || which === "both")) { var my = (a.y + b.y) / 2; setDst(qi, e, { x: a.x, y: my }); setDst(qi, (e + 1) % 4, { x: b.x, y: my }); }
      }
    });
    preview();
  };
  function setDst(qi, ci, p) { linked(qi, ci).forEach(function (z) { P.quads[z[0]].dst[z[1]] = { x: p.x, y: p.y }; }); }

  // ---------- tool ----------
  function hitCorner(p, set) { var t = 9 / ED.zoom, best = null, bd = t; corners(set).forEach(function (c) { var d = Math.hypot(c.p.x - p.x, c.p.y - p.y); if (d <= bd) { bd = d; best = c; } }); return best; }
  function hitQuad(p, set) { for (var i = P.quads.length - 1; i >= 0; i--) if (inside(set === "dst" ? P.quads[i].dst : P.quads[i].src, p)) return i; return -1; }
  function down(p, e) {
    if (!P) return;
    if (P.phase === "warp") {
      var hc = hitCorner(p, "dst");
      if (hc) ED.drag = { kind: "vpw", what: "dcorner", qi: hc.qi, ci: hc.ci, p0: p, o: { x: hc.p.x, y: hc.p.y } };
      return;
    }
    var c = hitCorner(p, "src");
    if (c) { ED.drag = { kind: "vpw", what: "corner", qi: c.qi, ci: c.ci, p0: p, o: { x: c.p.x, y: c.p.y }, link: linked(c.qi, c.ci) }; return; }
    var qi = hitQuad(p, "src");
    if (qi >= 0 && e.altKey) { P.quads.splice(qi, 1); ED.renderOvl(); ED.emit("tool"); return; }
    if (qi >= 0) { ED.drag = { kind: "vpw", what: "quad", qi: qi, p0: p, o: cl(P.quads[qi].src) }; return; }
    ED.drag = { kind: "vpw", what: "new", a: p, b: p };
  }
  function move(p) {
    var dr = ED.drag; if (!dr || dr.kind !== "vpw" || !P) return;
    var dx = dr.p0 ? p.x - dr.p0.x : 0, dy = dr.p0 ? p.y - dr.p0.y : 0;
    if (dr.what === "new") { dr.b = p; ED.renderOvl(); return; }
    if (dr.what === "quad") { P.quads[dr.qi].src = dr.o.map(function (q) { return { x: q.x + dx, y: q.y + dy }; }); ED.renderOvl(); return; }
    if (dr.what === "corner") {
      var np = { x: dr.o.x + dx, y: dr.o.y + dy }, t = 12 / ED.zoom;
      corners("src").forEach(function (c) { if (dr.link.some(function (z) { return z[0] === c.qi && z[1] === c.ci; })) return; if (Math.hypot(c.p.x - np.x, c.p.y - np.y) <= t) np = { x: c.p.x, y: c.p.y }; });      // snap to other planes
      dr.link.forEach(function (z) { P.quads[z[0]].src[z[1]] = { x: np.x, y: np.y }; });
      ED.renderOvl(); return;
    }
    if (dr.what === "dcorner") { setDst(dr.qi, dr.ci, { x: dr.o.x + dx, y: dr.o.y + dy }); pvSoon(); }
  }
  function up() {
    var dr = ED.drag; ED.drag = null; if (!dr || dr.kind !== "vpw" || !P) return;
    if (dr.what === "new") {
      var x0 = Math.min(dr.a.x, dr.b.x), y0 = Math.min(dr.a.y, dr.b.y), x1 = Math.max(dr.a.x, dr.b.x), y1 = Math.max(dr.a.y, dr.b.y);
      if ((x1 - x0) * ED.zoom < 12 || (y1 - y0) * ED.zoom < 12) return;
      P.quads.push({ src: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
      ED.renderOvl(); ED.emit("tool");
    }
    if (dr.what === "dcorner") preview();
  }
  function setPhase(ph) {
    if (!P) return;
    if (ph === "warp" && !P.quads.length) { S3.toast("Draw at least one plane first", "error"); ED.ui.buildOpts(); return; }
    P.phase = ph;
    if (ph === "warp") P.quads.forEach(function (q) { if (!q.dst) q.dst = cl(q.src); });
    preview(); ED.emit("tool");
  }
  VX.pwPhase = setPhase;
  VX.cancelPerspectiveWarp = function () { if (!P) return; delete ED.live.over[P.L.id]; P = null; ED.render(); ED.renderOvl(); if (ED.tool === "vpw") ED.setTool("move"); };
  VX.applyPerspectiveWarp = function () {
    if (!P) return;
    var s = P; if (s.phase !== "warp") { VX.cancelPerspectiveWarp(); return; }
    var f = mapper(); P = null; delete ED.live.over[s.L.id];
    if (ED.tool === "vpw") ED.setTool("move");
    return VX.meshApply(s.L, s.r, f, "Perspective warp");
  };
  ED.TOOLS.vpw = { down: down, move: move, up: up,
    cursor: function (p) { if (!P) return "default"; var set = P.phase === "warp" ? "dst" : "src"; return hitCorner(p, set) ? "crosshair" : P.phase === "layout" && hitQuad(p, "src") >= 0 ? "move" : P.phase === "layout" ? "crosshair" : "default"; },
    leave: function (next) { if (P && next !== "vpw") { if (P.phase === "warp") VX.applyPerspectiveWarp(); else VX.cancelPerspectiveWarp(); } } };
  UI.NAMES.vpw = "Perspective warp";
  ED.on("ovl", function (o) {
    if (!P || ED.tool !== "vpw") return;
    var c = o.c, set = P.phase === "warp" ? "dst" : "src", BL = "#1b8cff", dr = ED.drag;
    o.docPath(c, function (c2, px) {
      P.quads.forEach(function (q) {
        var Q = set === "dst" ? q.dst : q.src, f = WF.homog(Q);
        c2.beginPath();
        for (var t = 1; t < 3; t++) { var a = f(t / 3, 0), b = f(t / 3, 1), e = f(0, t / 3), g = f(1, t / 3); c2.moveTo(a.x, a.y); c2.lineTo(b.x, b.y); c2.moveTo(e.x, e.y); c2.lineTo(g.x, g.y); }
        c2.lineWidth = 0.8 * px; c2.strokeStyle = "rgba(27,140,255,.5)"; c2.stroke();
        c2.beginPath(); Q.forEach(function (p, i) { if (i) c2.lineTo(p.x, p.y); else c2.moveTo(p.x, p.y); }); c2.closePath();
        c2.lineWidth = 3 * px; c2.strokeStyle = "rgba(255,255,255,.7)"; c2.stroke(); c2.lineWidth = 1.5 * px; c2.strokeStyle = BL; c2.stroke();
        if (P.phase === "layout") { c2.fillStyle = "rgba(27,140,255,.08)"; c2.fill(); }
      });
      if (dr && dr.kind === "vpw" && dr.what === "new") { c2.setLineDash([4 * px, 3 * px]); c2.lineWidth = px; c2.strokeStyle = BL; c2.strokeRect(dr.a.x, dr.a.y, dr.b.x - dr.a.x, dr.b.y - dr.a.y); c2.setLineDash([]); }
    });
    c.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    corners(set).forEach(function (k) { var s = ED.toScr(k.p.x, k.p.y); c.fillStyle = "#fff"; c.strokeStyle = BL; c.lineWidth = 1.5; c.fillRect(s.x - 4.5, s.y - 4.5, 9, 9); c.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9); });
  });
  UI.opts("vpw", function () {
    var w = ED.ui.w, out = [UI.nameItem("vpw")];
    if (!P) { out.push(h("span", { "class": "pe-hint", text: "Choose Edit › Perspective warp with a pixel layer selected." })); return out; }
    out.push(w.seg("", [["layout", "Layout"], ["warp", "Warp"]], P.phase, function (v) { setPhase(v); }));
    if (P.phase === "warp") {
      out.push(w.btn("Straighten verticals", function () { VX.pwStraighten("v"); }, "ghost"));
      out.push(w.btn("Straighten horizontals", function () { VX.pwStraighten("h"); }, "ghost"));
      out.push(w.btn("Both", function () { VX.pwStraighten("both"); }, "ghost"));
      out.push(w.btn("Reset", function () { P.quads.forEach(function (q) { q.dst = cl(q.src); }); preview(); }, "ghost"));
      out.push(h("span", { "class": "pe-hint", text: "Drag the corners to change the perspective; joined corners move together. Enter applies." }));
    } else out.push(h("span", { "class": "pe-hint", text: P.quads.length + " plane" + (P.quads.length === 1 ? "" : "s") + ". Drag out a box per plane, fit its corners to the plane's edges (corners snap together), Alt+click removes one." }));
    out.push(w.btn("Cancel", VX.cancelPerspectiveWarp, "ghost"), w.btn("Apply", VX.applyPerspectiveWarp, "primary", "i-check"));
    return out;
  });
  UI.keys.push(function (e) {
    if (!P || ED.tool !== "vpw") return false;
    if (e.key === "Enter") { if (P.phase === "layout") setPhase("warp"); else VX.applyPerspectiveWarp(); return true; }
    if (e.key === "Escape") { ED.drag = null; VX.cancelPerspectiveWarp(); return true; }
    return false;
  });
  var undo0 = ED.undo, open0 = ED.openDoc;
  ED.undo = function () { if (P) { VX.cancelPerspectiveWarp(); return; } undo0(); };
  ED.openDoc = function (d, l) { if (P) VX.cancelPerspectiveWarp(); return open0(d, l); };
  UI.menu("Edit", [["Perspective warp", "", function () { if (ED.ui.w.need()) VX.startPerspectiveWarp(); }, function () { return !!ED.doc; }]], "Pin warp");
})();
