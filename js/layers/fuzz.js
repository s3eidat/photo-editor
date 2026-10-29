/* Selection lane: self-test that runs a fixed random mix of layer commands (groups, clipping, adjustment and fill
   layers, styles, blend modes, masks, smart layers, merges, undo / redo) on a small document, then checks that a
   project save / open renders the same and that undoing everything brings the first picture back. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;
  function menu(label) { var M = ED.ui.MENUS.filter(function (m) { return m[0] === "Layer"; })[0]; var it = M && M[1].filter(function (i) { return i[0] === label; })[0]; if (it && (!it[3] || it[3]())) it[2](); }
  SX.tests.push(async function (ok) {
    var c = PE.mk(40, 30), x = PE.cx2(c), g = x.createLinearGradient(0, 0, 40, 30); g.addColorStop(0, "#203060"); g.addColorStop(1, "#f0a050"); x.fillStyle = g; x.fillRect(0, 0, 40, 30);
    var a = PE.rasterFromCanvas(PE.touch(c), "photo"), b = PE.rasterFromCanvas(SX.solid(16, 12, "#e04040"), "red", 6, 5), t = PE.rasterFromCanvas(SX.solid(10, 10, "#40e080"), "green", 20, 12);
    var d = SX.scratch(40, 30, [a, b, t]), seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    function pick(list) { return list[Math.floor(rnd() * list.length)]; }
    function real() { return ED.doc.layers.filter(function (L) { return !(SX.HELPER && SX.HELPER[L.kind]); }); }
    function sig(doc) { var p = PE.getData(PE.flatten(doc)).data, hsh = 0; for (var i = 0; i < p.length; i++) hsh = (hsh * 31 + p[i]) >>> 0; return hsh + ":" + doc.layers.length; }
    var start = sig(d), toast = S3.toast, err = null;
    var OPS = [
      function () { ED.setActive(pick(real()).id); }, function () { var p = pick(real()), q = pick(real()); ED.setActive(p.id); SX.picked = {}; SX.picked[q.id] = 1; },
      function () { SX.groupLayers(); }, function () { var G = real().filter(function (L) { return L.kind === "group"; })[0]; if (G) SX.ungroup(G); },
      function () { SX.toggleClip(ED.layer()); }, function () { SX.newAdjustment(pick(["curves", "levels", "invert"])); }, function () { SX.newFill(pick(["solid", "gradient", "pattern"])); },
      function () { var L = ED.layer(); if (L.kind !== "group" && L.kind !== "adjust") ED.meta("Layer style", function () { SX.applyStylePreset(L, pick(SX.stylePresets())); }); },
      function () { var L = ED.layer(); ED.meta("Blend mode", function () { L.blend = pick(PE.BLENDS.filter(function (m) { return m !== "pass"; })); }); },
      function () { var L = ED.layer(); if (L.mask) ED.meta("Mask feather", function () { L.maskFeather = 3; L.maskDensity = 0.5; }); },
      function () { var L = ED.layer(); if (L.kind !== "adjust") SX.toSmart(); }, function () { var G = real().filter(function (L) { return L.kind === "group"; })[0]; if (G) SX.mergeGroup(G); },
      function () { SX.stampVisible(); }, function () { menu("Duplicate layer"); }, function () { if (real().length > 2) menu("Delete layer"); }, function () { menu("Merge down"); },
      function () { ED.undo(); }, function () { ED.redo(); }
    ];
    S3.toast = function () {};
    try { for (var i = 0; i < 40; i++) { pick(OPS)(); PE.flatten(ED.doc); } }
    catch (e) { err = e.message; }
    S3.toast = toast;
    ok(!err && ED.hist.list.length > 10, "random layer commands run without errors" + (err ? ": " + err : ""));
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(ED.doc)).arrayBuffer()));
    ok(sig(od) === sig(ED.doc), "after random layer commands, a saved project opens to the same picture");
    for (var n = 0; n < 400 && ED.hist.canUndo(); n++) ED.undo();
    ok(sig(ED.doc) === start, "undoing every random layer command brings the first picture back");
  });
})();
