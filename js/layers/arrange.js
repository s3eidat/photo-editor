/* Selection lane: align and distribute layers. With several layers picked (Ctrl/Shift+click in Layers) they align
   to their common box; with one layer and a selection, the layer aligns to the selection. Icons on the Move tool's
   options bar and items in the Layer menu. One undo step each. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, h = S3.h;
  SX.addIcons({
    "t-alL": '<path d="M4 3v18"/><rect x="7" y="6.5" width="11" height="4" rx="1"/><rect x="7" y="13.5" width="6" height="4" rx="1"/>',
    "t-alCH": '<path d="M12 3v18"/><rect x="5.5" y="6.5" width="13" height="4" rx="1"/><rect x="8.5" y="13.5" width="7" height="4" rx="1"/>',
    "t-alR": '<path d="M20 3v18"/><rect x="6" y="6.5" width="11" height="4" rx="1"/><rect x="11" y="13.5" width="6" height="4" rx="1"/>',
    "t-alT": '<path d="M3 4h18"/><rect x="6.5" y="7" width="4" height="11" rx="1"/><rect x="13.5" y="7" width="4" height="6" rx="1"/>',
    "t-alCV": '<path d="M3 12h18"/><rect x="6.5" y="5.5" width="4" height="13" rx="1"/><rect x="13.5" y="8.5" width="4" height="7" rx="1"/>',
    "t-alB": '<path d="M3 20h18"/><rect x="6.5" y="6" width="4" height="11" rx="1"/><rect x="13.5" y="11" width="4" height="6" rx="1"/>',
    "t-diH": '<rect x="3.5" y="7" width="3.5" height="10" rx="1"/><rect x="10.25" y="9" width="3.5" height="6" rx="1"/><rect x="17" y="5.5" width="3.5" height="13" rx="1"/>',
    "t-diV": '<rect x="7" y="3.5" width="10" height="3.5" rx="1"/><rect x="9" y="10.25" width="6" height="3.5" rx="1"/><rect x="5.5" y="17" width="13" height="3.5" rx="1"/>'
  });

  // ---------- bounds and moving ----------
  var BC = new WeakMap();
  function bounds(L) {
    var d = ED.doc, s = PE.surface(L, d); if (!s || !s.canvas) return null;
    var v = PE.ver(s.canvas), hit = BC.get(s.canvas), b;
    if (hit && hit.v === v) b = hit.b; else { b = PIX.alphaBounds(PE.getData(s.canvas)); BC.set(s.canvas, { v: v, b: b }); }
    return b ? { x: s.x + b.x, y: s.y + b.y, w: b.w, h: b.h } : null;
  }
  SX.layerBounds = bounds;
  // Move a layer (and a group's members) by dx, dy. Masks travel with their layer.
  function moveBy(L, dx, dy, t) {
    if (!dx && !dy) return;
    if (L.kind === "raster") { L.x += dx; L.y += dy; }
    else if (L.text) { L.text.ax += dx; L.text.ay += dy; }
    else if (L.shape) { L.shape.x += dx; L.shape.y += dy; }
    else { L.x = (L.x || 0) + dx; L.y = (L.y || 0) + dy; }
    if (L.mask) L.mask = { canvas: L.mask.canvas, x: L.mask.x + dx, y: L.mask.y + dy };
    if (SX.moveMore) SX.moveMore(L, dx, dy);
    if (L.kind === "group") (t.kids[L.id] || []).forEach(function (k) { moveBy(k, dx, dy, t); });
  }
  SX.moveBy = moveBy;
  function targets() {
    var list = SX.pickedList().filter(function (L) { return L.kind !== "adjust" && L.kind !== "qmask" && !L.locked; });
    return list.map(function (L) { return { L: L, b: bounds(L) }; }).filter(function (o) { return o.b; });
  }
  SX.align = function (how) {
    if (!SX.need()) return;
    var d = ED.doc, T = targets();
    if (!T.length) { S3.toast("Pick the layers to align (Ctrl+click or Shift+click them in Layers)", "error"); return; }
    var ref = T.length === 1 ? (d.sel ? d.sel.b : { x: 0, y: 0, w: d.w, h: d.h }) : T.reduce(function (u, o) { return PE.union(u, o.b); }, null);
    if (T.length === 1 && !d.sel) S3.toast("One layer: aligned to the canvas (make a selection to align to it)");
    var t = SX.tree(d);
    ED.meta("Align layers", function () {
      T.forEach(function (o) {
        var b = o.b, dx = 0, dy = 0;
        if (how === "left") dx = ref.x - b.x; else if (how === "hcenter") dx = ref.x + ref.w / 2 - (b.x + b.w / 2); else if (how === "right") dx = ref.x + ref.w - (b.x + b.w);
        else if (how === "top") dy = ref.y - b.y; else if (how === "vcenter") dy = ref.y + ref.h / 2 - (b.y + b.h / 2); else if (how === "bottom") dy = ref.y + ref.h - (b.y + b.h);
        moveBy(o.L, Math.round(dx), Math.round(dy), t);
      });
    });
  };
  // Distribute: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" edges evenly, or "hspace" / "vspace" equal gaps.
  SX.distribute = function (how) {
    if (!SX.need()) return;
    var T = targets(); if (T.length < 3) { S3.toast("Pick at least three layers to distribute", "error"); return; }
    var horiz = /left|hcenter|right|hspace/.test(how), key = function (b) { return how === "left" ? b.x : how === "right" ? b.x + b.w : how === "hcenter" || how === "hspace" ? b.x + b.w / 2 : how === "top" ? b.y : how === "bottom" ? b.y + b.h : b.y + b.h / 2; };
    T.sort(function (a, b) { return key(a.b) - key(b.b); });
    var t = SX.tree(ED.doc), first = T[0].b, last = T[T.length - 1].b;
    ED.meta("Distribute layers", function () {
      if (how === "hspace" || how === "vspace") {
        var total = 0; T.forEach(function (o) { total += horiz ? o.b.w : o.b.h; });
        var span = horiz ? last.x + last.w - first.x : last.y + last.h - first.y, gap = (span - total) / (T.length - 1), pos = horiz ? first.x : first.y;
        T.forEach(function (o) { var cur = horiz ? o.b.x : o.b.y, dd = Math.round(pos - cur); moveBy(o.L, horiz ? dd : 0, horiz ? 0 : dd, t); pos += (horiz ? o.b.w : o.b.h) + gap; });
        return;
      }
      var k0 = key(first), k1 = key(last);
      T.forEach(function (o, i) { var dd = Math.round(k0 + (k1 - k0) * i / (T.length - 1) - key(o.b)); moveBy(o.L, horiz ? dd : 0, horiz ? 0 : dd, t); });
    });
  };

  // ---------- UI ----------
  var A = [["left", "Align left edges", "t-alL"], ["hcenter", "Align horizontal centres", "t-alCH"], ["right", "Align right edges", "t-alR"],
    ["top", "Align top edges", "t-alT"], ["vcenter", "Align vertical centres", "t-alCV"], ["bottom", "Align bottom edges", "t-alB"]];
  (ED.ui.optsTail = ED.ui.optsTail || []).push(function (t, items) {
    if (t !== "move" || ED.xf || !ED.doc) return;
    var w = ED.ui.w, g = h("span", { "class": "pe-algroup", role: "group", "aria-label": "Align and distribute" });
    A.forEach(function (a) { g.appendChild(w.btn("", function () { SX.align(a[0]); }, "ghost icon", a[2], a[1] + " (several picked layers, or one layer to the selection)")); });
    g.appendChild(w.btn("", function () { SX.distribute("hspace"); }, "ghost icon", "t-diH", "Distribute horizontally: equal gaps (3+ layers)"));
    g.appendChild(w.btn("", function () { SX.distribute("vspace"); }, "ghost icon", "t-diV", "Distribute vertically: equal gaps (3+ layers)"));
    items.splice(Math.min(items.length, 5), 0, g);
  });
  SX.menu("Layer", A.map(function (a) { return [a[1], "", function () { SX.align(a[0]); }, SX.has]; }).concat([
    ["Distribute left edges", "", function () { SX.distribute("left"); }, SX.has], ["Distribute horizontal centres", "", function () { SX.distribute("hcenter"); }, SX.has],
    ["Distribute horizontally (equal gaps)", "", function () { SX.distribute("hspace"); }, SX.has], ["Distribute vertically (equal gaps)", "", function () { SX.distribute("vspace"); }, SX.has]]), "Send backward");
  // the menu is long: separate the arrange block
  (function () { var M = ED.ui.MENUS.filter(function (m) { return m[0] === "Layer"; })[0][1], i = -1; M.forEach(function (it, k) { if (it[0] === "Align left edges") i = k; }); if (i > 0) M.splice(i, 0, "-"); })();

  SX.tests.push(async function (ok) {
    function sq(x, y, w, hh) { var c = PE.mk(100, 60); PE.cx2(c).fillStyle = "#000"; PE.cx2(c).fillRect(x, y, w, hh); return PE.rasterFromCanvas(PE.touch(c), "s"); }
    var a = sq(5, 5, 10, 10), b = sq(40, 20, 20, 10), c = sq(80, 40, 10, 10), d = SX.scratch(100, 60, [a, b, c]);
    SX.picked = {}; SX.picked[a.id] = SX.picked[b.id] = 1; d.active = c.id;
    SX.align("left"); ok(SX.layerBounds(b).x === 5 && SX.layerBounds(c).x === 5 && SX.layerBounds(a).x === 5, "align left edges");
    ED.undo(); SX.align("vcenter"); var bb = SX.layerBounds(b); ok(Math.abs(bb.y + bb.h / 2 - 27.5) <= 1 && Math.abs(SX.layerBounds(a).y - 22.5) <= 1, "align vertical centres");
    ED.undo(); SX.distribute("hspace");
    var A1 = SX.layerBounds(a), B1 = SX.layerBounds(b), C1 = SX.layerBounds(c); ok(Math.abs((B1.x - (A1.x + A1.w)) - (C1.x - (B1.x + B1.w))) <= 1, "distribute equal gaps");
    ED.undo(); SX.distribute("left"); ok(SX.layerBounds(b).x === 42 || SX.layerBounds(b).x === 43, "distribute left edges");
    ED.undo(); SX.picked = {}; d.active = a.id; d.sel = PE.makeSel(d, window.PIX.rectMask(100, 60, 50, 0, 50, 60)); SX.align("right");
    ok(SX.layerBounds(a).x + 10 === 100, "one layer aligns to the selection");
    SX.picked = {};
  });
})();
