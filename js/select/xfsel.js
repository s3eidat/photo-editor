/* Selection lane: Select › Transform selection. Scale, rotate and flip the selection outline itself (not the
   pixels) with the free-transform handles and number fields; Enter applies, Esc cancels, Ctrl+Z undoes. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;
  var FAKE = { id: "seltx", kind: "seltx", name: "Selection" };     // never in the layer list: only the transform box uses it
  PE.surfaceExt.seltx = function (L, doc) { return doc.sel ? { canvas: PE.selCanvas(doc.sel), x: 0, y: 0 } : { canvas: PE.mk(1, 1), x: 0, y: 0 }; };
  PE.xfExt.seltx = function (L, m) {
    var d = ED.doc, s = d.sel; if (!s) return;
    var b = PE.bake(PE.selCanvas(s), 0, 0, m), c = PE.mk(d.w, d.h), x = PE.cx2(c);
    x.drawImage(b.canvas, b.x, b.y);
    var px = x.getImageData(0, 0, d.w, d.h).data, mm = new Uint8Array(d.w * d.h);
    for (var i = 0; i < mm.length; i++) mm[i] = px[i * 4 + 3];
    d.sel = PE.makeSel(d, mm);
  };
  SX.transformSelection = function () {
    if (!SX.needSel()) return;
    ED.cancelModes();
    var b = ED.doc.sel.b;
    ED.setTool("move");
    ED.xf = { L: FAKE, b: { x: b.x, y: b.y, w: b.w, h: b.h, r0: 0 }, sx: 1, sy: 1, rot: 0, tx: 0, ty: 0 };
    ED.emit("tool"); ED.renderOvl();
  };
  ED.on("overlay", function (o) {
    var xf = ED.xf, d = ED.doc; if (!xf || xf.L !== FAKE || !d || !d.sel) return;
    var m = ED.xfMatrix(xf), path = PE.selOutline(d.sel);
    o.docPath(o.c, function (c, px) {
      c.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      var k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1, w = px / k;
      c.lineWidth = w; c.setLineDash([4 * w, 4 * w]); c.strokeStyle = "#000"; c.stroke(path); c.strokeStyle = "#fff"; c.lineDashOffset = 4 * w; c.stroke(path); c.setLineDash([]);
    });
  });
  SX.menu("Select", [["Transform selection", "", function () { SX.transformSelection(); }, SX.hasSel]], "Similar");

  SX.tests.push(async function (ok) {
    var d = SX.scratch(40, 40, [PE.rasterFromCanvas(SX.solid(40, 40, "#808080"), "bg")]);
    d.sel = PE.makeSel(d, window.PIX.rectMask(40, 40, 10, 10, 10, 10));
    SX.transformSelection(); ok(ED.xf && ED.xf.L.kind === "seltx", "transform box on the selection");
    ED.setXf("sx", 2); ED.setXf("sy", 2); ED.applyTransform();
    ok(d.sel && Math.abs(d.sel.b.w - 20) <= 2 && Math.abs(d.sel.b.x - 5) <= 1 && d.sel.m[6 * 40 + 6] === 255 && d.sel.m[3 * 40 + 3] === 0 && SX.px(d.layers[0].canvas, 5, 5)[0] === 128, "selection scaled about its centre, pixels untouched");
    ED.undo(); ok(d.sel && d.sel.b.w === 10, "undo transform selection");
  });
})();
