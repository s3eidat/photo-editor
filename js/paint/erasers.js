/* Photo Editor paint lane: the eraser family's extra tools. Magic eraser: click to erase every similar pixel
   (contiguous or not, from this layer or all layers, anti-aliased edge, opacity). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, PP = PE.paint, K = ED.ui.kit, h = S3.h;
  PP.icons({ "t-magicerase": ["m7.5 20.5-4-4a2 2 0 0 1 0-2.8L11 6.2a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8l-8.3 8.5z", "M21 20.5H7.5", "M18 2.5v4M16 4.5h4M21.5 8v2.5M20.2 9.3h2.6"] });
  var mo = PP.opts("magicerase", { tol: 32, contig: true, all: false, aa: true, op: 1 });
  // Erase the region of pixels similar to p. Resolves true when something changed.
  PP.magicErase = function (p) {
    var L = ED.layer(); if (!ED.editable(L, "pixels")) return Promise.resolve(false);
    if (ED.maskEdit) { S3.toast("The magic eraser works on layer pixels: click the layer thumbnail first", "error"); return Promise.resolve(false); }
    var d = ED.doc, sm = PP.sample(mo.all, L);
    return ED.working(PE.work("wand", [{ data: sm.img.data, width: sm.img.width, height: sm.img.height }, p.x - sm.ox, p.y - sm.oy, mo.tol, mo.contig]), "Erasing…").then(function (lm) {
      var W = sm.img.width, Hh = sm.img.height, m = lm;
      if (mo.aa) m = PIX.feather(lm, W, Hh, 0.8);
      // into doc space, inside the selection
      var c = PE.mk(W, Hh), x = PE.cx2(c), im = x.createImageData(W, Hh), any = false;
      for (var i = 0; i < m.length; i++) { var v = m[i]; if (d.sel) { var dx = (i % W) + sm.ox, dy = Math.floor(i / W) + sm.oy; v = dx >= 0 && dy >= 0 && dx < d.w && dy < d.h ? v * d.sel.m[dy * d.w + dx] / 255 : 0; } im.data[i * 4 + 3] = v; if (v) any = true; }
      if (!any) return false;
      x.putImageData(im, 0, 0);
      var t = PP.target("pixels"); if (!t) return false;
      var r = PE.inter({ x: sm.ox - L.x, y: sm.oy - L.y, w: W, h: Hh }, { x: 0, y: 0, w: L.canvas.width, h: L.canvas.height });
      var e = PE.editPixels(d, "Magic eraser", L, "canvas", r, function (cc) { cc.save(); cc.globalAlpha = PE.clamp(mo.op, 0, 1); cc.globalCompositeOperation = "destination-out"; cc.drawImage(c, sm.ox - L.x, sm.oy - L.y); cc.restore(); });
      ED.push(PE.compound("Magic eraser", [t.grow, e]));
      return true;
    }).catch(function (err) { S3.toast(err.message, "error"); return false; });
  };
  PP.addTool("magicerase", "Magic eraser", "E", "eraser", { down: function (p) { PP.magicErase(p); } });
  PP.cursors.magicerase = "crosshair";
  PP.group("E", ["eraser", "magicerase"]);
  PP.optsFor.magicerase = function (items) {
    var o = mo, s = function () { ED.saveOpts(); };
    return [items[0], K.range("Tolerance", o.tol, 0, 255, 1, function (v) { o.tol = v; s(); }), K.check("Contiguous", o.contig, function (v) { o.contig = v; s(); }),
      K.check("Anti-alias", o.aa, function (v) { o.aa = v; s(); }), K.check("Sample all layers", o.all, function (v) { o.all = v; s(); }),
      K.range("Opacity", o.op, 0.01, 1, 0.01, function (v) { o.op = v; s(); }, function (v) { return Math.round(v * 100) + "%"; }),
      h("span", { "class": "pe-hint", text: "Click a colour to erase it and everything like it." })];
  };
  PP.test("magic eraser", async function (ok) {
    var s = PP.scratch(40, 20, "#ffffff"), c = PE.cx2(s.L.canvas); c.fillStyle = "#0000ff"; c.fillRect(20, 0, 20, 20); c.fillStyle = "#fefefe"; c.fillRect(30, 5, 4, 4); PE.touch(s.L.canvas);
    Object.assign(mo, { tol: 10, contig: true, all: false, aa: false, op: 1 });
    ok(await PP.magicErase({ x: 3, y: 3 }), "erases");
    ok(PP.px(s.L.canvas, 5, 5)[3] === 0 && PP.px(s.L.canvas, 25, 5)[3] === 255 && PP.px(s.L.canvas, 31, 6)[3] === 255, "contiguous: only the touching white");
    ED.undo(); mo.contig = false; await PP.magicErase({ x: 3, y: 3 });
    ok(PP.px(s.L.canvas, 31, 6)[3] === 0 && PP.px(s.L.canvas, 25, 5)[3] === 255, "non-contiguous: every similar pixel");
    ED.undo(); mo.op = 0.5; await PP.magicErase({ x: 3, y: 3 });
    ok(Math.abs(PP.px(s.L.canvas, 5, 5)[3] - 128) <= 2, "opacity erases partly");
  });
})();
