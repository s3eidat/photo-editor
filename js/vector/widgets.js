/* Vector lane: on-canvas widgets for live shapes. With the shape, path-selection or direct-selection tool, a
   rectangle / polygon shows a round handle to drag its corner radius, a star a diamond to drag its indent. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, UI = VX.ui;
  var ON = { shape: 1, psel: 1, dsel: 1 };
  function live() { var L = ED.doc && ED.layer(); return L && L.kind === "shape" && L.visible && !L.locked && (L.shape.type === "rect" || L.shape.type === "polygon" || L.shape.type === "star") ? L : null; }
  function M(L) { return VX.boxMatrix(L.shape); }
  // widget position in the shape's own box, then mapped to the document
  function spots(L) {
    var s = L.shape, out = [], m = M(L), maxR = Math.min(s.w, s.h) / 2;
    if (s.type === "rect") { var r = PE.clamp(s.radius || 0, 0, maxR), k = Math.max(r, Math.min(12 / ED.zoom, maxR)) / Math.SQRT2; out.push({ w: "radius", p: PE.mApply(m, s.x + Math.max(r * 0.29, k * 0.7), s.y + Math.max(r * 0.29, k * 0.7)) }); }
    else {
      var pts = VG().polyPts(s.x, s.y, s.w, s.h, s.sides || 5, s.type === "star" ? (s.indent == null ? 0.5 : s.indent) : 0), c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      var tip = pts[0], t = Math.min(0.45, ((s.radius || 0) + 10 / ED.zoom) / Math.max(1, Math.hypot(tip.x - c.x, tip.y - c.y)));
      out.push({ w: "radius", p: PE.mApply(m, tip.x + (c.x - tip.x) * t, tip.y + (c.y - tip.y) * t), tip: tip, c: c });
      if (s.type === "star") out.push({ w: "indent", p: PE.mApply(m, pts[1].x, pts[1].y) });
    }
    return out;
  }
  function VG() { return PE.VG; }
  VX.widgetSpots = function (L) { return spots(L); };
  function hit(L, p) { var t = 8 / ED.zoom, best = null; spots(L).forEach(function (s) { if (Math.hypot(s.p.x - p.x, s.p.y - p.y) <= t) best = s; }); return best; }
  // wrap the tools: a press on a widget drags it, anything else goes to the tool
  Object.keys(ON).forEach(function (t) {
    var T = ED.TOOLS[t]; if (!T) return;
    var d0 = T.down, m0 = T.move, u0 = T.up, c0 = T.cursor;
    T.down = function (p, e) {
      var L = live(), w = L && hit(L, p);
      if (!w) return d0 && d0(p, e);
      ED.drag = { kind: "vwidget", L: L, w: w.w, before: PE.snap(ED.doc), inv: PE.mInv(M(L)), s0: PE.clone(L.shape), cancel: function () { PE.restore(ED.doc, ED.drag.before); ED.changed(); } };
    };
    T.move = function (p, e) {
      var dr = ED.drag; if (!dr || dr.kind !== "vwidget") return m0 && m0(p, e);
      var q = PE.mApply(dr.inv, p.x, p.y), s = dr.L.shape, s0 = dr.s0;
      if (dr.w === "radius") {
        if (s.type === "rect") s.radius = PE.clamp(Math.max(q.x - s0.x, q.y - s0.y) / 0.71, 0, Math.min(s0.w, s0.h) / 2);
        else { var c = { x: s0.x + s0.w / 2, y: s0.y + s0.h / 2 }, tip = VG().polyPts(s0.x, s0.y, s0.w, s0.h, s0.sides || 5, 0)[0], L2 = Math.hypot(tip.x - c.x, tip.y - c.y) || 1, along = ((q.x - tip.x) * (c.x - tip.x) + (q.y - tip.y) * (c.y - tip.y)) / L2; s.radius = PE.clamp(along * 1.4, 0, L2); }
      } else {      // indent: distance of the inner point from the centre
        var cc = { x: s0.x + s0.w / 2, y: s0.y + s0.h / 2 }, rr = Math.hypot((q.x - cc.x) / (s0.w / 2), (q.y - cc.y) / (s0.h / 2));
        s.indent = PE.clamp(1 - rr, 0.01, 0.99);
      }
      if (e && e.shiftKey && s.radius != null) s.radius = Math.round(s.radius);
      ED.render(); ED.renderOvl();
    };
    T.up = function (p, e) {
      var dr = ED.drag; if (!dr || dr.kind !== "vwidget") return u0 && u0(p, e);
      ED.drag = null; ED.push(PE.metaEntry(dr.w === "radius" ? "Corner radius" : "Star indent", ED.doc, dr.before));
    };
    T.cursor = function (p) { var L = live(); if (L && hit(L, p)) return "pointer"; return c0 ? c0(p) : "crosshair"; };
  });
  ED.on("overlay", function (o) {
    if (!ON[ED.tool]) return;
    var L = live(); if (!L) return;
    var c = o.c; c.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    spots(L).forEach(function (s) {
      var q = ED.toScr(s.p.x, s.p.y); c.beginPath();
      if (s.w === "radius") c.arc(q.x, q.y, 4.5, 0, Math.PI * 2); else { c.moveTo(q.x, q.y - 5.5); c.lineTo(q.x + 5.5, q.y); c.lineTo(q.x, q.y + 5.5); c.lineTo(q.x - 5.5, q.y); c.closePath(); }
      c.fillStyle = "#fff"; c.fill(); c.lineWidth = 1.5; c.strokeStyle = "#1b8cff"; c.stroke();
      c.beginPath(); c.arc(q.x, q.y, 1.6, 0, Math.PI * 2); c.fillStyle = "#1b8cff"; c.fill();
    });
  });
  // shortcuts list
  if (ED.ui.SHORTCUTS) ED.ui.SHORTCUTS.push(["Pen / path tools", "P (Shift+P: pen, curvature, freeform) · A path / direct selection (Shift+A)"], ["Path tools", "Enter / Esc end a path · Delete removes anchors · arrows nudge · Ctrl+T transforms the selected parts · Ctrl+Enter path to selection"],
    ["Liquify / smart resize", "Ctrl+Shift+X · Ctrl+Shift+Alt+C"]);
  void UI;
})();
