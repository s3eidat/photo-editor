/* Selection lane: linked layers (move together) and stamp visible / stamp selected (merge into a new layer while
   keeping the originals). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;

  // ---------- linking ----------
  SX.linkLayers = function () {
    if (!SX.need()) return;
    var list = SX.pickedList().filter(function (L) { return L.kind !== "qmask"; });
    if (list.length < 2) { S3.toast("Pick two or more layers to link (Ctrl+click or Shift+click in Layers)", "error"); return; }
    var d = ED.doc, old = {}, id = PE.uid("k");
    list.forEach(function (L) { if (L.link) old[L.link] = 1; });
    ED.meta("Link layers", function () { d.layers.forEach(function (L) { if (list.indexOf(L) >= 0 || (L.link && old[L.link])) L.link = id; }); });
  };
  SX.unlinkLayers = function () {
    if (!SX.need()) return;
    var d = ED.doc, list = SX.pickedList().filter(function (L) { return L.link; }); if (!list.length) return;
    ED.meta("Unlink layers", function () {
      list.forEach(function (L) { delete L.link; });
      var count = {}; d.layers.forEach(function (L) { if (L.link) count[L.link] = (count[L.link] || 0) + 1; });
      d.layers.forEach(function (L) { if (L.link && count[L.link] < 2) delete L.link; });     // a link of one is no link
    });
  };
  function linked(L) { var d = ED.doc; return L.link ? d.layers.filter(function (o) { return o !== L && o.link === L.link; }) : []; }
  SX.linkedOf = linked;
  // moving a layer (drag or arrow keys) moves its linked layers
  var shift0 = PE.shiftExt;
  PE.shiftExt = function (dr, dx, dy) {
    if (shift0) shift0(dr, dx, dy);
    var L = dr.L; if (!L.link) return;
    if (!dr._links) {
      var t = SX.tree(ED.doc), inGroup = function (o) { for (var p = t.parentOf(o); p; p = t.parentOf(p)) if (p === L) return true; return false; };
      dr._links = linked(L).filter(function (o) { return !inGroup(o); }).map(function (o) { return { o: o, snap: PE.snap({ w: 0, h: 0, layers: [o] }).layers[0].p, done: { x: 0, y: 0 } }; });
    }
    var t2 = SX.tree(ED.doc);
    dr._links.forEach(function (k) { SX.moveBy(k.o, dx - k.done.x, dy - k.done.y, t2); k.done = { x: dx, y: dy }; });
  };
  // free transform / flip of a linked layer transforms the others the same way (when applied)
  var busy = false, xa0 = PE.xfAny;
  PE.xfAny = function (L, m, xf) {
    if (xa0) xa0(L, m, xf);
    if (!SX.xfAll || busy || !L.link) return;
    busy = true;
    try { linked(L).forEach(function (o) { if (!o.locked) ED.transformLayer(o, m, null); }); } finally { busy = false; }
  };
  SX.fields.link = { save: function (L) { return L.link || undefined; }, parse: function (v) { return SX.idOk(v); } };

  // ---------- stamps ----------
  SX.stampVisible = function () {
    if (!SX.need()) return;
    var d = ED.doc, c = PE.flatten(d), L = PE.rasterFromCanvas(PE.touch(c), "Stamp (visible)");
    SX.insertAbove(L, "Stamp visible");
  };
  SX.stampSelected = function () {
    if (!SX.need()) return;
    var d = ED.doc, list = SX.pickedList();
    var c = PE.flatten(d, { only: list.map(function (L) { return L.id; }) }), L = PE.rasterFromCanvas(PE.touch(c), (list.length > 1 ? "Merged copy" : list[0].name + " (merged)"));
    SX.insertAbove(L, "Merge copy");
  };

  function anyLinked() { return SX.has() && SX.pickedList().some(function (L) { return L.link; }); }
  SX.menu("Layer", [["Link layers", "", SX.linkLayers, SX.has], ["Unlink layers", "", SX.unlinkLayers, anyLinked], "-",
    ["Merge copy (keep layers)", "Ctrl+Alt+E", SX.stampSelected, SX.has], ["Stamp visible", "Ctrl+Shift+Alt+E", SX.stampVisible, SX.has]], "Merge visible");
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.code !== "KeyE" || !ED.doc) return false;
    e.preventDefault(); if (e.shiftKey) SX.stampVisible(); else SX.stampSelected(); return true;
  });
  document.addEventListener("DOMContentLoaded", function () {
    var foot = S3.$(".pe-lfoot"), up = S3.$("#lUp"); if (!foot || !up) return;
    foot.insertBefore(h("button", { type: "button", "class": "btn ghost icon small", id: "lLink", title: "Link / unlink the picked layers (they move together)", "aria-label": "Link layers",
      onclick: function () { if (anyLinked() && SX.pickedList().every(function (L) { return L.link; })) SX.unlinkLayers(); else SX.linkLayers(); } }, [ED.ui.w.svg("t-link")]), up);
  });

  SX.tests.push(async function (ok) {
    var a = PE.rasterFromCanvas(SX.solid(5, 5, "#f00"), "a"), b = PE.rasterFromCanvas(SX.solid(5, 5, "#0f0"), "b"), c = PE.rasterFromCanvas(SX.solid(5, 5, "#00f"), "c");
    var d = SX.scratch(40, 40, [a, b, c]); SX.picked = {}; SX.picked[a.id] = 1; d.active = b.id;
    SX.linkLayers(); ok(a.link && a.link === b.link && !c.link, "link picked layers");
    SX.picked = {}; ED.setActive(a.id); ED.nudge(3, 2); ok(a.x === 3 && b.x === 3 && b.y === 2 && c.x === 0, "linked layers move together");
    ED.undo(); ok(a.x === 0 && b.x === 0, "undo linked move");
    ED.setActive(a.id); ED.flipLayer("h"); ok(SX.px(PE.flatten(d, { only: [b.id] }), 4, 0)[1] === 255 || SX.px(PE.flatten(d, { only: [b.id] }), 0, 0)[1] === 255, "flip carries linked layers"); ED.undo();
    SX.picked = {}; d.active = a.id; SX.unlinkLayers(); ok(!a.link && !b.link, "unlink (a link of one is dropped)");
    a.link = b.link = "kxy1";
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer()));
    ok(od.layers[0].link === "kxy1" && od.layers[1].link === "kxy1", "links round-trip");
    var n = d.layers.length; SX.stampVisible(); ok(d.layers.length === n + 1 && SX.px(PE.findLayer(d, d.active).canvas, 1, 1)[2] === 255, "stamp visible keeps the layers");
    SX.picked = {};
  });
})();

/* Selection lane: the lane's keyboard shortcuts in the shortcuts dialog. */
(function () {
  "use strict";
  var ED = window.PE.ed, S = ED.ui.SHORTCUTS; if (!S) return;
  S.push(["Quick selection / magic wand", "W (press again to switch)"], ["Quick mask", "Q"], ["Refine selection", "Ctrl+Alt+R"],
    ["Group / ungroup layers", "Ctrl+G · Ctrl+Shift+G"], ["Clipping mask", "Ctrl+Alt+G (or Alt+click a layer)"], ["Pick several layers", "Ctrl+click · Shift+click in Layers · Ctrl+Alt+A all"],
    ["Layer blend mode", "Shift+Alt+letter (M multiply, S screen, O overlay…) · Shift++ / Shift+-"], ["Merge copy / stamp visible", "Ctrl+Alt+E · Ctrl+Shift+Alt+E"]);
})();
