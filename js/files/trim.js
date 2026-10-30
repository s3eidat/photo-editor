/* Files lane: Image › Trim… (cut away transparent pixels, or a border of the top-left / bottom-right corner colour, on
   any of the four sides) and Image › Reveal all (grow the canvas so every layer's pixels fit). Both are one undo step. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, FX = PE.files, h = S3.h, W = ED.ui.w;
  var TR = FX.trim = {};

  // Bounds of what is NOT the trim colour in rgba data. based: "alpha" | "tl" | "br". Returns {x,y,w,h} or null (all trimmed).
  TR.bounds = function (img, based, tol) {
    var d = img.data, w = img.width, hh = img.height, t = tol || 0, ref = null, x, y, i;
    if (based === "tl") ref = [d[0], d[1], d[2], d[3]];
    if (based === "br") { i = (w * hh - 1) * 4; ref = [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
    function keep(i) {
      if (!ref) return d[i + 3] > t;
      if (!ref[3] && !d[i + 3]) return false;
      return Math.abs(d[i] - ref[0]) > t || Math.abs(d[i + 1] - ref[1]) > t || Math.abs(d[i + 2] - ref[2]) > t || Math.abs(d[i + 3] - ref[3]) > t;
    }
    var x0 = w, y0 = hh, x1 = -1, y1 = -1;
    for (y = 0; y < hh; y++) { var row = y * w * 4, any = false; for (x = 0; x < w; x++) if (keep(row + x * 4)) { any = true; if (x < x0) x0 = x; break; } if (!any) continue; if (y < y0) y0 = y; y1 = y; for (x = w - 1; x >= x1 + 1; x--) if (keep(row + x * 4)) { if (x > x1) x1 = x; break; } }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  TR.trim = function (based, sides, tol) {
    if (!FX.need()) return;
    var d = ED.doc, b = TR.bounds(PE.getData(PE.flatten(d)), based, tol);
    if (!b) { S3.toast("Nothing would be left: every pixel matches", "error"); return; }
    var s = sides || { top: true, left: true, bottom: true, right: true };
    var R = { x: s.left ? b.x : 0, y: s.top ? b.y : 0 }; R.w = (s.right ? b.x + b.w : d.w) - R.x; R.h = (s.bottom ? b.y + b.h : d.h) - R.y;
    if (R.x === 0 && R.y === 0 && R.w === d.w && R.h === d.h) { S3.toast("Nothing to trim"); return; }
    ED.cancelModes();
    ED.meta("Trim", function () { ED.resizeCanvasTo(R, true); }); ED.fit();
  };
  // every layer's extent (raster canvases, text / shape boxes, masks are ignored)
  TR.contentRect = function (d) {
    var u = null;
    d.layers.forEach(function (L) {
      var r = null;
      if (L.kind === "raster" && L.canvas) { var a = window.PIX.alphaBounds(PE.getData(L.canvas)); if (a) r = { x: L.x + a.x, y: L.y + a.y, w: a.w, h: a.h }; }
      else if (L.kind === "text" || L.kind === "shape") { var pad = L.kind === "shape" ? (L.shape.sw || 0) / 2 + 1 : 2; r = PE.aabbOf(PE.boxCorners(PE.vbox(L))); r = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }; }
      if (r) u = PE.union(u, r);
    });
    return u;
  };
  TR.revealAll = function () {
    if (!FX.need()) return;
    var d = ED.doc, c = TR.contentRect(d), R = PE.rectI(PE.union({ x: 0, y: 0, w: d.w, h: d.h }, c));
    if (R.x === 0 && R.y === 0 && R.w === d.w && R.h === d.h) { S3.toast("Everything is already inside the canvas"); return; }
    try { PE.checkSize(R.w, R.h, "The revealed canvas"); } catch (e) { S3.toast(e.message, "error"); return; }
    ED.cancelModes();
    ED.meta("Reveal all", function () { ED.resizeCanvasTo(R, false); }); ED.fit();
    S3.toast("Canvas is now " + R.w + " × " + R.h + " px");
  };
  TR.dialog = function () {
    if (!FX.need()) return;
    var st = Object.assign({ based: "alpha", top: true, left: true, bottom: true, right: true }, S3.store("pe-trim") || {});
    var body = h("div", { "class": "stack" }, [
      W.seg("Based on", [["alpha", "Transparent pixels"], ["tl", "Top-left colour"], ["br", "Bottom-right colour"]], st.based, function (v) { st.based = v; }),
      h("div", { "class": "pe-prow" }, [h("span", { "class": "faint", text: "Trim away:" }), W.check("Top", st.top, function (v) { st.top = v; }), W.check("Bottom", st.bottom, function (v) { st.bottom = v; }), W.check("Left", st.left, function (v) { st.left = v; }), W.check("Right", st.right, function (v) { st.right = v; })])]);
    var go = W.btn("Trim", function () { S3.store("pe-trim", st); dlg.close(); TR.trim(st.based, st); }, "primary");
    var dlg = W.modal("Trim", body, [h("span", { "class": "grow" }), go]);
  };
  FX.menu("Image", ["Trim…", "", TR.dialog, FX.has], "Crop to selection");
  FX.menu("Image", ["Reveal all", "", TR.revealAll, FX.has], "Trim…");

  FX.tests.push(async function (ok, near, px, solid) {
    var img = { data: new Uint8ClampedArray(10 * 6 * 4), width: 10, height: 6 };
    for (var i = 0; i < 60; i++) img.data.set([255, 255, 255, 255], i * 4);
    img.data.set([0, 0, 0, 255], (2 * 10 + 3) * 4); img.data.set([0, 0, 0, 255], (4 * 10 + 6) * 4);
    var b = TR.bounds(img, "tl"); ok(b && b.x === 3 && b.y === 2 && b.w === 4 && b.h === 3, "trim by corner colour");
    var a = { data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 }; a.data[(5 * 8 + 1) * 4 + 3] = 255;
    var b2 = TR.bounds(a, "alpha"); ok(b2 && b2.x === 1 && b2.y === 5 && b2.w === 1 && b2.h === 1 && TR.bounds({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, "alpha") === null, "trim transparent");
    var keep = { doc: ED.doc, hist: ED.hist }, d = PE.newDoc(100, 60, "t");
    d.layers = [PE.rasterFromCanvas(solid(40, 30, "#0f0"), "a", 80, -10)]; d.active = d.layers[0].id; ED.doc = d; ED.hist = new PE.History(1e8, 60);
    TR.revealAll(); ok(d.w === 120 && d.h === 70 && d.layers[0].x === 80 && d.layers[0].y === 0, "reveal all grows the canvas to fit (" + d.w + "x" + d.h + ")");
    ED.undo(); ok(d.w === 100 && d.h === 60, "undo reveal all");
    TR.trim("alpha"); ok(d.w === 20 && d.h === 20, "trim transparent canvas (" + d.w + "x" + d.h + ")");
    ED.doc = keep.doc; ED.hist = keep.hist;
  });
})();
