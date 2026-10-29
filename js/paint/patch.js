/* Photo Editor paint lane: patch tool and move with fill. Drag a freehand outline around an area (or use any selection), then drag
   the selection: "source" replaces the selected area with the texture where you drop it, "destination" copies the
   selected texture to where you drop it. Either way the result is healed to the surrounding tone.
   Move with fill: drag a selected object somewhere else; the hole it leaves is filled from the surroundings and
   the object is blended in at its new place ("extend" keeps the original and adds a blended copy). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, K = ED.ui.kit, h = S3.h;
  PP.icons({ "t-patch": ["M5.5 7.5c0-2 1.8-3 4-3h7c2 0 3 1.4 3 3v7c0 2.2-1 4-3 4h-4", "M4 12.5c2 0 3 1 5 1s3-1 5 0 1.5 3 0 4-4 1-6 1-4 .5-4-2.5", ["circle", { cx: "13.5", cy: "9", r: ".8", fill: "currentColor" }]] });
  var po = PP.opts("patch", { mode: "source", transp: false });

  function selMode(e) { return e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : "new"; }
  function inSel(p) { var s = ED.doc.sel, x = Math.floor(p.x), y = Math.floor(p.y); return !!(s && x >= 0 && y >= 0 && x < s.w && y < s.h && s.m[y * s.w + x] >= 128); }
  // A tool that draws a freehand selection, or drags the existing one; onDrop(off) when it is dragged.
  PP.selDragTool = function (id, onDrop) {
    return {
      down: function (p, e) {
        if (ED.doc.sel && inSel(p) && !e.shiftKey && !e.altKey) { ED.drag = { kind: "seldrag", p0: p, off: { x: 0, y: 0 }, tool: id }; return; }
        ED.drag = { kind: "lasso", pts: [p], mode: selMode(e) };
      },
      move: function (p, e) {
        var dr = ED.drag;
        if (dr.kind === "seldrag") { var dx = p.x - dr.p0.x, dy = p.y - dr.p0.y; if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } dr.off = { x: Math.round(dx), y: Math.round(dy) }; return; }
        var P = dr.pts, q = P[P.length - 1]; if (Math.hypot(p.x - q.x, p.y - q.y) * ED.zoom >= 2) P.push(p);
      },
      up: function () {
        var dr = ED.drag; ED.drag = null; if (!dr) return;
        if (dr.kind === "seldrag") { if (dr.off.x || dr.off.y) onDrop(dr.off); ED.renderOvl(); return; }
        if (dr.pts.length >= 3) ED.setSelection(ED.polyMask(dr.pts), dr.mode, "Lasso", ED.o.sel.feather); else if (dr.mode === "new") ED.deselect();
      }
    };
  };
  PP.overlay(function (c, docPath) {
    var dr = ED.drag; if (!dr || dr.kind !== "seldrag" || !ED.doc.sel) return;
    docPath(c, function (c, px) { c.save(); c.translate(dr.off.x, dr.off.y); c.setLineDash([5 * px, 4 * px]); c.lineWidth = 1.5 * px; c.strokeStyle = "#1b8cff"; c.stroke(PE.selOutline(ED.doc.sel)); c.restore(); });
  });
  // Shift a doc-sized mask by off.
  function shifted(m, w, hh, off) {
    var o = new Uint8Array(w * hh);
    for (var y = 0; y < hh; y++) { var sy = y - off.y; if (sy < 0 || sy >= hh) continue; for (var x = 0; x < w; x++) { var sx = x - off.x; if (sx >= 0 && sx < w) o[y * w + x] = m[sy * w + sx]; } }
    return o;
  }
  PP.shiftMask = shifted;
  // Heal into rect R (layer coords) of canvas cv: src = cv read at q + soff, mask (doc-sized) placed with the layer offset.
  PP.healFrom = function (cv, L, R, soff, mdoc, k) {
    var d = ED.doc, dst = PE.getData(cv, R), sc = PE.mk(R.w, R.h); PE.cx2(sc).drawImage(cv, -(R.x + soff.x), -(R.y + soff.y));
    var src = PE.getData(sc), m = new Uint8Array(R.w * R.h);
    for (var y = 0; y < R.h; y++) for (var x = 0; x < R.w; x++) { var dx = x + R.x + L.x, dy = y + R.y + L.y; if (dx >= 0 && dy >= 0 && dx < d.w && dy < d.h) m[y * R.w + x] = Math.round(mdoc[dy * d.w + dx] * (k || 1)); }
    return PE.work("heal", [{ data: dst.data, width: R.w, height: R.h }, { data: src.data, width: R.w, height: R.h }, m]).then(function (res) { return new ImageData(new Uint8ClampedArray(res.data), R.w, R.h); });
  };
  PP.patch = function (off, mode) {
    var d = ED.doc, sel = d.sel; if (!sel) return Promise.resolve(false);
    var t = PP.target("pixels"); if (!t) return Promise.resolve(false);
    var L = t.L, cv = L.canvas, b = sel.b, src = (mode || po.mode) === "source", pad = 6;
    var box = src ? b : { x: b.x + off.x, y: b.y + off.y, w: b.w, h: b.h };
    var R = PE.inter(PE.rectI({ x: box.x - L.x - pad, y: box.y - L.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }), { x: 0, y: 0, w: cv.width, h: cv.height });
    if (!R) { ED.push(t.grow); return Promise.resolve(false); }
    var mdoc = src ? sel.m : shifted(sel.m, d.w, d.h, off), soff = src ? off : { x: -off.x, y: -off.y };
    return ED.working(PP.healFrom(cv, L, R, soff, mdoc, po.transp ? 0.5 : 1), "Patching…").then(function (img) {
      var e = PE.editPixels(d, "Patch", L, "canvas", R, function (c) { c.putImageData(img, R.x, R.y); });
      ED.push(PE.compound("Patch", [t.grow, e]));
      return true;
    }).catch(function (err) { ED.push(t.grow); S3.toast(err.message, "error"); return false; });
  };
  PP.addTool("patch", "Patch", "J", "heal", PP.selDragTool("patch", function (off) { PP.patch(off); }));
  PP.cursors.patch = function (p) { return ED.doc && ED.doc.sel && inSel(p) ? "move" : "crosshair"; };
  PP.groups.forEach(function (g) { if (g.key === "J") g.ids.splice(2, 0, "patch"); });
  PP.optsFor.patch = function (items) {
    return [items[0], K.seg("Patch", [["source", "Source"], ["destination", "Destination"]], po.mode, function (v) { po.mode = v; ED.saveOpts(); }),
      K.check("Transparent", po.transp, function (v) { po.transp = v; ED.saveOpts(); }),
      h("span", { "class": "pe-hint", text: po.mode === "source" ? "Draw around the flaw, then drag the selection to clean texture." : "Draw around good texture, then drag it to where it should go." })];
  };
  PP.test("patch tool", async function (ok) {
    var s = PP.scratch(80, 40, "#6080a0"), c = PE.cx2(s.L.canvas); c.fillStyle = "#ff0000"; c.fillRect(15, 15, 8, 8); PE.touch(s.L.canvas);
    s.d.sel = PE.makeSel(s.d, PIX.rectMask(80, 40, 12, 12, 14, 14));
    ok(await PP.patch({ x: 40, y: 0 }, "source"), "patches");
    var q = PP.px(s.L.canvas, 19, 19); ok(Math.abs(q[0] - 96) < 12 && Math.abs(q[2] - 160) < 12, "the flaw is replaced from the source (" + q + ")");
    ED.undo(); ok(PP.px(s.L.canvas, 19, 19)[0] === 255, "undo patch");
    ok(await PP.patch({ x: 40, y: 0 }, "destination"), "destination mode");
    q = PP.px(s.L.canvas, 59, 19); ok(q[0] > 150 && q[2] < 140, "destination copies the selected texture (" + q + ")");
  });
  // ---------- move with fill ----------
  PP.icons({ "t-cmove": ["M4 4h7v7H4z", "M13 13h7v7h-7z", "M11 7.5h3.5a2 2 0 0 1 2 2V13", "M14.5 11l2 2 2-2"] });
  var mo = PP.opts("cmove", { mode: "move" });
  PP.contentMove = function (off, mode) {
    var d = ED.doc, sel = d.sel; if (!sel) return Promise.resolve(false);
    var t = PP.target("pixels"); if (!t) return Promise.resolve(false);
    var L = t.L, cv = L.canvas, W = cv.width, H = cv.height, move = (mode || mo.mode) === "move", before = null;
    var to = shifted(sel.m, d.w, d.h, off), pad = 6;
    function local(mdoc) { var m = new Uint8Array(W * H); for (var y = 0; y < H; y++) { var dy = y + L.y; if (dy < 0 || dy >= d.h) continue; for (var x = 0; x < W; x++) { var dx = x + L.x; if (dx >= 0 && dx < d.w) m[y * W + x] = mdoc[dy * d.w + dx]; } } return m; }
    var work = PE.cloneCanvas(cv), wx = PE.cx2(work), rects = [];
    var step1 = move ? PP.fillHole(cv, local(sel.m), { avoid: local(to), expand: 2, adapt: true }).then(function (res) { wx.putImageData(res.img, res.rect.x, res.rect.y); rects.push(res.rect); }) : Promise.resolve();
    var job = step1.then(function () {
      var b = sel.b, R = PE.inter(PE.rectI({ x: b.x + off.x - L.x - pad, y: b.y + off.y - L.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }), { x: 0, y: 0, w: W, h: H });
      if (!R) return;
      // the object, from the original pixels, healed into its new surroundings
      var dst = wx.getImageData(R.x, R.y, R.w, R.h), sc = PE.mk(R.w, R.h); PE.cx2(sc).drawImage(cv, -(R.x - off.x), -(R.y - off.y));
      var src = PE.getData(sc), m = new Uint8Array(R.w * R.h);
      for (var y = 0; y < R.h; y++) for (var x = 0; x < R.w; x++) { var dx = x + R.x + L.x, dy = y + R.y + L.y; if (dx >= 0 && dy >= 0 && dx < d.w && dy < d.h) m[y * R.w + x] = to[dy * d.w + dx]; }
      return PE.work("heal", [{ data: dst.data, width: R.w, height: R.h }, { data: src.data, width: R.w, height: R.h }, m]).then(function (res) {
        // keep the object's own pixels in its core, heal only towards the edge
        var o = new Uint8ClampedArray(res.data), g = PIX.grow(m, R.w, R.h, -3);
        for (var i = 0; i < m.length; i++) if (g[i]) { var k = g[i] / 255; for (var c = 0; c < 4; c++) o[i * 4 + c] = o[i * 4 + c] + (src.data[i * 4 + c] - o[i * 4 + c]) * k * 0.6; }
        wx.putImageData(new ImageData(o, R.w, R.h), R.x, R.y); rects.push(R);
      });
    });
    return ED.working(job, move ? "Moving and filling…" : "Extending…").then(function () {
      var U = rects.reduce(function (a, r) { return PE.union(a, r); }, null);
      if (!U) { ED.push(t.grow); return false; }
      U = PE.inter(PE.rectI(U), { x: 0, y: 0, w: W, h: H });
      var e = PE.editPixels(d, move ? "Move with fill" : "Extend with fill", L, "canvas", U, function (c) { c.putImageData(wx.getImageData(U.x, U.y, U.w, U.h), U.x, U.y); });
      before = PE.snap(d); d.sel = PE.makeSel(d, to);
      ED.push(PE.compound(move ? "Move with fill" : "Extend with fill", [t.grow, e, PE.metaEntry("Move selection", d, before)]));
      return true;
    }).catch(function (err) { ED.push(t.grow); S3.toast(err.message, "error"); return false; });
  };
  PP.addTool("cmove", "Move with fill", "J", "patch", PP.selDragTool("cmove", function (off) { PP.contentMove(off); }));
  PP.cursors.cmove = function (p) { return ED.doc && ED.doc.sel && inSel(p) ? "move" : "crosshair"; };
  PP.groups.forEach(function (g) { if (g.key === "J") g.ids.splice(g.ids.indexOf("patch") + 1, 0, "cmove"); });
  PP.optsFor.cmove = function (items) {
    return [items[0], K.seg("Mode", [["move", "Move"], ["extend", "Extend"]], mo.mode, function (v) { mo.mode = v; ED.saveOpts(); }),
      h("span", { "class": "pe-hint", text: "Draw around an object (a little loose), then drag it. The space it leaves is filled from around it." })];
  };
  PP.test("move with fill", async function (ok) {
    var W = 96, H = 48, s = PP.scratch(W, H, "#ffffff"), c = PE.cx2(s.L.canvas);
    for (var x = 0; x < W; x += 6) { c.fillStyle = (x / 6) % 2 ? "#3a6ea5" : "#5b8fc7"; c.fillRect(x, 0, 6, H); }
    c.fillStyle = "#ffcc00"; c.fillRect(14, 18, 10, 10); PE.touch(s.L.canvas);
    s.d.sel = PE.makeSel(s.d, PIX.rectMask(W, H, 12, 16, 14, 14));
    ok(await PP.contentMove({ x: 50, y: 0 }, "move"), "moves");
    var old = PP.px(s.L.canvas, 19, 23), moved = PP.px(s.L.canvas, 69, 23);
    ok(old[2] > 120 && old[0] < 140, "the hole is filled from the stripes (" + old + ")");
    ok(moved[0] > 200 && moved[1] > 160 && moved[2] < 90, "the object is at its new place (" + moved + ")");
    ok(s.d.sel && s.d.sel.b.x === 62, "the selection follows the object");
    ED.undo(); ok(PP.px(s.L.canvas, 19, 23)[0] === 255 && s.d.sel.b.x === 12, "one undo puts it all back");
  });
})();
