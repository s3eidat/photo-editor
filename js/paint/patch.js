/* Photo Editor paint lane: patch tool. Drag a freehand outline around an area (or use any selection), then drag
   the selection: "source" replaces the selected area with the texture where you drop it, "destination" copies the
   selected texture to where you drop it. Either way the result is healed to the surrounding tone. */
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
})();
