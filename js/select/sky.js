/* Selection lane: Select › Sky. Finds the sky from the top edge (smooth, sky-coloured area) plus sky seen through
   branches, then snaps the edge to the photo. Runs in the lane worker; no AI model needed. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;
  var SMALL = 512, WORK_MAX = 1200;
  function img(c) { var g = PE.getData(c); return { data: g.data, width: c.width, height: c.height }; }
  // Sky mask of a flattened doc-size canvas at the working size (up to 1200 px): {m, W, H}.
  SX.skyWork = function (src, shift) {
    var d = ED.doc, ks = Math.min(1, SMALL / Math.max(d.w, d.h)), kw = Math.min(1, WORK_MAX / Math.max(d.w, d.h));
    function at(k) { var W = Math.max(1, Math.round(d.w * k)), H = Math.max(1, Math.round(d.h * k)), c = PE.mk(W, H), x = PE.cx2(c); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, W, H); return c; }
    var small = at(ks), guide = kw === ks ? null : at(kw), W = guide ? guide.width : small.width, H = guide ? guide.height : small.height;
    return SX.work("sky", [img(small), guide && img(guide), { shift: shift || 0 }]).then(function (m) { return { m: m, W: W, H: H }; });
  };
  // Sky mask (Uint8, doc size).
  SX.skyMask = function (src, shift) {
    var d = ED.doc;
    return SX.skyWork(src, shift).then(function (r) { return r.W === d.w && r.H === d.h ? r.m : SX.scaleMask(r.m, r.W, r.H, d.w, d.h); });
  };
  SX.selectSky = function (mode) {
    if (!SX.need()) return;
    var d = ED.doc;
    ED.working(SX.skyMask(PE.flatten(d)), "Finding the sky…").then(function (m) {
      if (!PE.makeSel(d, m)) { S3.toast("No sky found along the top of the picture. Try Colour range or the Magic wand.", "error"); return; }
      ED.setSelection(m, mode || "new", "Select sky");
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  SX.menu("Select", [["Sky", "", function () { SX.selectSky(); }, SX.has]], "Subject");

  SX.tests.push(async function (ok) {
    // blue sky gradient on top, textured green ground below, a dark crown with a sky gap at (30, 20)
    var W = 120, H = 80, im = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = (y * W + x) * 4, c;
      if (y >= 50) c = (x * 7 + y * 13) % 5 < 2 ? [40, 110, 30] : [70, 140, 50];
      else if (Math.abs(x - 30) < 14 && Math.abs(y - 22) < 12 && !(Math.abs(x - 30) < 3 && Math.abs(y - 20) < 3)) c = (x + y) % 3 ? [25, 50, 20] : [45, 75, 30];
      else c = [90 + y, 150 + y, 235];
      im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
    }
    var m = window.PIXS.sky(im, null, {});
    ok(m[5 * W + 100] === 255 && m[45 * W + 100] === 255, "sky: open sky is selected down to the horizon");
    ok(m[65 * W + 60] === 0 && m[28 * W + 22] === 0, "sky: ground and tree crown stay out");
    ok(m[20 * W + 30] > 200, "sky: sky seen through a gap in the crown is selected");
    var flat = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    for (var p = 0; p < W * H; p++) { var v = (p * 37) % 200; flat.data[p * 4] = v; flat.data[p * 4 + 1] = 255 - v; flat.data[p * 4 + 2] = v / 2; flat.data[p * 4 + 3] = 255; }
    ok(window.PIXS.sky(flat, null, {}).every(function (v) { return v === 0; }), "sky: a busy picture without sky selects nothing");
  });
})();
