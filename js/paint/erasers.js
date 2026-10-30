/* Photo Editor paint lane: the eraser family's extra tools. Magic eraser: click to erase every similar pixel
   (contiguous or not, from this layer or all layers, anti-aliased edge, opacity). Background eraser: a brush that
   erases only colours close to a sampled colour (continuous / once / background swatch), contiguous or not,
   optionally protecting the foreground colour. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, PP = PE.paint, K = ED.ui.kit, h = S3.h;
  PP.icons({ "t-magicerase": ["m7.5 20.5-4-4a2 2 0 0 1 0-2.8L11 6.2a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8l-8.3 8.5z", "M21 20.5H7.5", "M18 2.5v4M16 4.5h4M21.5 8v2.5M20.2 9.3h2.6"] });
  var mo = PP.opts("magicerase", { tol: 32, contig: true, all: false, aa: true, op: 1 });
  // Erase the region of pixels similar to p. Resolves true when something changed.
  PP.magicErase = function (p) {
    var L = ED.layer(); if (!ED.editable(L, "pixels")) return Promise.resolve(false);
    if (ED.maskEdit) { S3.toast("The magic eraser works on layer pixels: click the layer thumbnail first", "error"); return Promise.resolve(false); }
    var t = PP.target("pixels"); if (!t) return Promise.resolve(false);
    ED.push(t.grow);       // the layer covers the document now; recorded before the job runs
    var d = ED.doc, sm = PP.sample(mo.all, L);
    return PP.commitAsync(PE.work("wand", [{ data: sm.img.data, width: sm.img.width, height: sm.img.height }, p.x - sm.ox, p.y - sm.oy, mo.tol, mo.contig]), "Erasing…", function (lm) {
      var W = sm.img.width, Hh = sm.img.height, m = lm;
      if (mo.aa) m = PIX.feather(lm, W, Hh, 0.8);
      // into doc space, inside the selection
      var c = PE.mk(W, Hh), x = PE.cx2(c), im = x.createImageData(W, Hh), any = false;
      for (var i = 0; i < m.length; i++) { var v = m[i]; if (d.sel) { var dx = (i % W) + sm.ox, dy = Math.floor(i / W) + sm.oy; v = dx >= 0 && dy >= 0 && dx < d.w && dy < d.h ? v * d.sel.m[dy * d.w + dx] / 255 : 0; } im.data[i * 4 + 3] = v; if (v) any = true; }
      if (!any) return false;
      x.putImageData(im, 0, 0);
      var r = PE.inter({ x: sm.ox - L.x, y: sm.oy - L.y, w: W, h: Hh }, { x: 0, y: 0, w: L.canvas.width, h: L.canvas.height });
      var e = PE.editPixels(d, "Magic eraser", L, "canvas", r, function (cc) { cc.save(); cc.globalAlpha = PE.clamp(mo.op, 0, 1); cc.globalCompositeOperation = "destination-out"; cc.drawImage(c, sm.ox - L.x, sm.oy - L.y); cc.restore(); });
      PP.pushJoined(t.grow, e, "Magic eraser");
      return true;
    });
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
  // ---------- background eraser ----------
  PP.icons({ "t-bgerase": ["m7.5 20.5-4-4a2 2 0 0 1 0-2.8L11 6.2a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8l-8.3 8.5z", "M21 20.5H7.5", ["circle", { cx: "18.5", cy: "5.5", r: "2.5", "stroke-dasharray": "1.6 1.4" }]] });
  function dist(D, q, c) { return Math.max(Math.abs(D[q] - c[0]), Math.abs(D[q + 1] - c[1]), Math.abs(D[q + 2] - c[2])) / 2.55; }
  // Sampling and tolerance limits shared with colour replacement: perDab picks the colour, weight judges a pixel.
  var LIMIT = PP.colorLimit = {
    perDab: function (st, x, y, d) {
      var o = st.o, ix = Math.floor(x), iy = Math.floor(y), r = Math.max(1, Math.ceil(d / 2));
      PP.ensureTiles(st, { x: ix - r - 1, y: iy - r - 1, w: 2 * r + 3, h: 2 * r + 3 });
      var D = st.img.data;
      if (o.sample === "swatch") st.cur = st.bgc;
      else if (o.sample === "once" && st.smp) st.cur = st.smp;
      else if (ix >= 0 && iy >= 0 && ix < st.w && iy < st.h) { var q = (iy * st.w + ix) * 4; if (D[q + 3]) { st.cur = [D[q], D[q + 1], D[q + 2]]; if (o.sample === "once") st.smp = st.cur; } }
      st.cm = null;
      if (o.limits !== "contig" || !st.cur) return;
      // pixels connected to the centre through colours within tolerance, inside the tip
      var x0 = ix - r, y0 = iy - r, S = 2 * r + 1, m = new Uint8Array(S * S), stack = [], tol = o.tol + 8;
      if (ix < 0 || iy < 0 || ix >= st.w || iy >= st.h) { st.cm = { x0: x0, y0: y0, S: S, m: m }; return; }
      stack.push(r, r); m[r * S + r] = 1;
      while (stack.length) {
        var yy = stack.pop(), xx = stack.pop();
        for (var k = 0; k < 4; k++) {
          var nx = xx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = yy + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= S || ny >= S || m[ny * S + nx]) continue;
          var gx = nx + x0, gy = ny + y0; if (gx < 0 || gy < 0 || gx >= st.w || gy >= st.h) continue;
          if ((nx - r) * (nx - r) + (ny - r) * (ny - r) > r * r) continue;
          var q2 = (gy * st.w + gx) * 4; if (!D[q2 + 3] || dist(D, q2, st.cur) > tol) continue;
          m[ny * S + nx] = 1; stack.push(nx, ny);
        }
      }
      st.cm = { x0: x0, y0: y0, S: S, m: m };
    },
    weight: function (st, i) {
      var o = st.o, D = st.img.data, q = i * 4; if (!st.cur || !D[q + 3]) return 0;
      if (o.protect && dist(D, q, st.fg) <= o.tol) return 0;
      if (st.cm) { var px = i % st.w - st.cm.x0, py = Math.floor(i / st.w) - st.cm.y0; if (px < 0 || py < 0 || px >= st.cm.S || py >= st.cm.S || !st.cm.m[py * st.cm.S + px]) return 0; }
      var dd = dist(D, q, st.cur);
      return dd <= o.tol ? 1 : dd <= o.tol + 8 ? (o.tol + 8 - dd) / 8 : 0;
    }
  };
  PP.covTool("bgerase", {
    label: "Background eraser", fill: "color", mask: false,
    begin: function (st) { st.smp = null; st.o.op = 1; st.strength = 1; return true; },
    perDab: LIMIT.perDab, weight: LIMIT.weight, keepSample: true,
    effect: function (st, px) { return [px[0], px[1], px[2], 0]; },
    // half-erased edge pixels lose the erased colour too (clean edges): C = c B + (1 - c) F, so F = (C - c B) / (1 - c)
    mix: function (st, px, c, i, o, oq) {
      var a = px[3] * (1 - c);
      o[oq + 3] = a;
      // mix fraction from the colour itself: pixels inside the tolerance count as background (left as they are, only
      // made see-through); in the tolerance's soft band, the background share e is taken out of the colour
      var B = st.o.clean ? PP.sampleOf(st, i) : null, e = 0;
      if (B) { var dd = Math.max(Math.abs(px[0] - B[0]), Math.abs(px[1] - B[1]), Math.abs(px[2] - B[2])) / 2.55; e = dd <= st.o.tol ? 0 : dd <= st.o.tol + 8 ? (st.o.tol + 8 - dd) / 8 : 0; }
      for (var k = 0; k < 3; k++) o[oq + k] = e > 0 && e < 0.98 ? PE.clamp((px[k] - e * B[k]) / (1 - e), 0, 255) : px[k];
    }
  }, { size: 60, hard: 0.9, spacing: 15, sample: "cont", limits: "contig", tol: 50, protect: false, clean: true });
  PP.addTool("bgerase", "Background eraser", "E", "eraser", ED.TOOLS.bgerase);
  PP.groups.forEach(function (g) { if (g.key === "E") g.ids.splice(1, 0, "bgerase"); });
  PP.optsFor.bgerase = function (items) {
    var o = ED.o.bgerase, sv = function () { ED.saveOpts(); };
    return PP.brushBar("bgerase", items, [
      K.select("Sampling", [["cont", "Continuous"], ["once", "Once"], ["swatch", "Background colour"]], o.sample, function (v) { o.sample = v; sv(); }),
      K.select("Limits", [["contig", "Contiguous"], ["dis", "Discontiguous"]], o.limits, function (v) { o.limits = v; sv(); }),
      K.range("Tolerance", o.tol, 0, 100, 1, function (v) { o.tol = v; sv(); }, function (v) { return v + "%"; }),
      K.check("Protect foreground colour", o.protect, function (v) { o.protect = v; sv(); }), K.check("Clean edges", o.clean, function (v) { o.clean = v; sv(); })],
      "Keep the centre of the tip on the background: only colours like the one under it are erased.", { noOp: true, noFlow: true, noSym: true });
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
  PP.test("background eraser", function (ok) {
    var s = PP.scratch(60, 30, "#20a040"), c = PE.cx2(s.L.canvas); c.fillStyle = "#e03020"; c.fillRect(30, 0, 30, 30); c.fillStyle = "#20a040"; c.fillRect(50, 10, 6, 6); PE.touch(s.L.canvas);
    Object.assign(ED.o.bgerase, { size: 40, hard: 1, sample: "cont", limits: "contig", tol: 20, protect: false });
    PP.drive("bgerase", [{ x: 26, y: 15 }]);
    ok(PP.px(s.L.canvas, 20, 15)[3] === 0 && PP.px(s.L.canvas, 34, 15)[3] === 255, "erases the sampled green, keeps the red");
    ED.undo(); ED.o.bgerase.size = 70;
    PP.drive("bgerase", [{ x: 26, y: 15 }]);
    ok(PP.px(s.L.canvas, 52, 12)[3] === 255, "contiguous: the green island behind the red stays");
    ED.undo(); ED.o.bgerase.limits = "dis";
    PP.drive("bgerase", [{ x: 26, y: 15 }]);
    ok(PP.px(s.L.canvas, 52, 12)[3] === 0, "discontiguous: it goes too");
    ED.undo(); ED.o.bgerase.protect = true; s.d.fg = "#20a040";
    PP.drive("bgerase", [{ x: 26, y: 15 }]);
    ok(PP.px(s.L.canvas, 20, 15)[3] === 255, "protect foreground colour");
  });
})();
