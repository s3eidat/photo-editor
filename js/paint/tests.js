/* Photo Editor paint lane: known-answer checks, run by S3_SELFTEST after the core's own checks. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX;
  function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1 : e); }
  function arrNear(a, b, e) { return a.length === b.length && a.every(function (v, i) { return near(v, b[i], e); }); }

  PP.test("colour models", function (ok) {
    ok(arrNear(PPX.rgb2hsb(255, 0, 0), [0, 100, 100], 1e-9) && arrNear(PPX.rgb2hsb(0, 0, 255), [240, 100, 100], 1e-9) && arrNear(PPX.rgb2hsb(128, 128, 128), [0, 0, 50.2], 0.01), "rgb -> hsb");
    ok(arrNear(PPX.hsb2rgb(120, 100, 100), [0, 255, 0], 1e-9) && arrNear(PPX.hsb2rgb(300, 50, 80), [204, 102, 204], 1e-9), "hsb -> rgb");
    ok(arrNear(PPX.rgb2lab(255, 255, 255), [100, 0, 0], 0.01) && arrNear(PPX.rgb2lab(255, 0, 0), [53.24, 80.09, 67.2], 0.05) && arrNear(PPX.rgb2lab(0, 0, 0), [0, 0, 0], 1e-6), "rgb -> Lab");
    var back = true; [[12, 200, 99], [255, 128, 0], [3, 4, 5], [250, 250, 10]].forEach(function (c) { var l = PPX.rgb2lab(c[0], c[1], c[2]); if (!arrNear(PPX.lab2rgb(l[0], l[1], l[2]), c, 0)) back = false; });
    ok(back, "Lab round trip");
    ok(!PPX.inGamut(PPX.lab2rgbRaw(50, 120, -120)) && PPX.inGamut(PPX.lab2rgbRaw(50, 0, 0)), "Lab gamut check");
    ok(arrNear(PPX.webSafe([20, 130, 240]), [0, 153, 255], 0), "web-safe colours");
    ok(arrNear(PPX.rgb2cmyk(255, 0, 0), [0, 100, 100, 0], 1e-9) && arrNear(PPX.cmyk2rgb(0, 100, 100, 0), [255, 0, 0], 1e-9), "cmyk");
    ok(arrNear(PPX.recolor("color", [128, 128, 128], [255, 0, 0]).map(Math.round), [255, 74, 74], 1) && arrNear(PPX.recolor("luminosity", [255, 0, 0], [255, 255, 255]), [255, 255, 255], 1), "recolour modes keep / take luminosity");
  });

  PP.test("brush engine", function (ok) {
    var px = PP.px, s = PP.scratch(120, 80), L = s.L, d = s.d, o = ED.o.brush;
    Object.assign(o, { size: 20, hard: 1, op: 1, flow: 0.5, spacing: 25 });
    d.fg = "#000000";
    PP.drive("brush", [{ x: 30, y: 40 }]);
    var a = px(L.canvas, 30, 40);
    ok(near(a[0], 128, 3), "flow 50% single dab is half strength (got " + a[0] + ")");
    ED.undo(); o.flow = 1;
    PP.drive("brush", [{ x: 60, y: 40 }], { pointerType: "pen", pressure: 0.25 });
    ok(px(L.canvas, 60, 40)[0] === 0 && px(L.canvas, 60 + 7, 40)[0] > 200, "pen pressure scales the tip (size control)");
    ED.undo();
    o.sizeC = "off";
    PP.drive("brush", [{ x: 60, y: 40 }], { pointerType: "pen", pressure: 0.25 });
    ok(px(L.canvas, 60 + 7, 40)[0] === 0, "size control off ignores pressure");
    ED.undo();
    o.round = 30; o.angle = 0;
    PP.drive("brush", [{ x: 60, y: 40 }]);
    ok(px(L.canvas, 68, 40)[0] === 0 && px(L.canvas, 60, 48)[0] > 200, "roundness flattens the tip");
    ED.undo(); o.round = 100;
    o.sym = "v";
    PP.drive("brush", [{ x: 20, y: 20 }, { x: 24, y: 22 }]);
    ok(px(L.canvas, 20, 20)[0] === 0 && px(L.canvas, 99, 20)[0] === 0 && px(L.canvas, 60, 20)[0] === 255, "vertical symmetry mirrors the stroke");
    ED.undo(); o.sym = "radial"; o.symN = 4;
    PP.drive("brush", [{ x: 60, y: 10 }]);
    ok(px(L.canvas, 60, 70)[0] === 0 && px(L.canvas, 90, 40)[0] === 0 && px(L.canvas, 30, 40)[0] === 0, "radial symmetry, 4 segments");
    ED.undo(); o.sym = "off";
    ok(px(L.canvas, 60, 70)[0] === 255 && ED.hist.pos === 0, "every stroke undoes");
    // masks take the foreground's brightness: grey paints a partial mask
    L.mask = PE.whiteMask(d); ED.maskEdit = true; d.fg = "#808080";
    PP.drive("brush", [{ x: 60, y: 40 }]);
    ok(near(px(L.mask.canvas, 60, 40)[3], 128, 3), "grey on a mask gives a partial mask (got " + px(L.mask.canvas, 60, 40)[3] + ")");
    ED.maskEdit = false; L.mask = null; d.fg = "#000000";
    // smoothing: the stroke lags behind, then catches up when released
    o.smooth = 60;
    PP.drive("brush", [{ x: 10, y: 60 }, { x: 40, y: 60 }, { x: 80, y: 60 }, { x: 110, y: 60 }]);
    ok(px(L.canvas, 108, 60)[0] === 0, "smoothing catches up at the end of the stroke");
    o.smooth = 0;
  });
})();
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint;
  PP.test("colour picker", function (ok) {
    var s = PP.scratch(10, 10); s.d.fg = "#336699";
    var pk = PP.pickColor("fg");
    pk.set("h", 0); pk.set("s", 100); pk.set("v", 100);
    ok(pk.state.hex() === "#ff0000", "HSB fields set the colour (got " + pk.state.hex() + ")");
    pk.set("s", 0); pk.set("s", 100);
    ok(pk.state.hex() === "#ff0000", "hue survives a trip through grey");
    pk.set("L", 50); ok(Math.round(pk.state.lab[0]) === 50, "Lab lightness field");
    pk.state.set("rgb", [20, 130, 240]); pk.setWeb(true);
    ok(pk.state.hex() === "#0099ff", "only web colours snaps (got " + pk.state.hex() + ")");
    pk.setWeb(false); pk.ok();
    ok(s.d.fg === "#0099ff" && !document.querySelector(".s3-modal"), "OK sets the foreground and closes");
  });
  PP.test("palette files", function (ok) {
    var list = [{ c: "#ff8000", n: "Orange" }, { c: "#123456", n: "" }, { c: "#000000", n: "Black ✓" }];
    var back = PP.readAco(PP.writeAco(list));
    ok(back.length === 3 && back[0].c === "#ff8000" && back[0].n === "Orange" && back[2].n === "Black ✓" && back[1].c === "#123456", "aco round trip (v2 names)");
    var v1 = new Uint8Array([0, 1, 0, 1, 0, 1, 0, 0, 0x80, 0, 0xff, 0xff, 0, 0]);    // one HSB colour: h=0 s=50% b=100%
    var r1 = PP.readAco(v1); ok(r1.length === 1 && /^#ff(7f7f|8080)$/.test(r1[0].c), "aco HSB colour (got " + (r1[0] && r1[0].c) + ")");
    var g = PP.readGpl(PP.writeGpl(list, "t")); ok(g.length === 3 && g[0].c === "#ff8000" && g[0].n === "Orange", "gpl round trip");
    ok(PP.readGpl("#aabbcc, #001122").length === 2, "plain hex lists");
    var threw = false; try { PP.readAco(new Uint8Array([0, 9, 0, 1])); } catch (e) { threw = true; } ok(threw, "rejects a non-palette");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX;
  function stripes(W, H) {
    var d = new Uint8ClampedArray(W * H * 4);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var i = (y * W + x) * 4, s = (x % 8) < 4 ? 210 : 50; d[i] = s; d[i + 1] = 90; d[i + 2] = 255 - s; d[i + 3] = 255; }
    return d;
  }
  PP.test("fill from surroundings", async function (ok) {
    var W = 64, H = 48, d = stripes(W, H), truth = new Uint8ClampedArray(d), hole = new Uint8Array(W * H);
    for (var y = 18; y < 30; y++) for (var x = 26; x < 38; x++) { hole[y * W + x] = 255; d[(y * W + x) * 4] = 255; d[(y * W + x) * 4 + 1] = 0; }
    var r = PPX.inpaint({ data: d, width: W, height: H }, hole, {}), err = 0, n = 0;
    for (var p = 0; p < W * H; p++) if (hole[p]) { err += Math.abs(r.data[p * 4] - truth[p * 4]) + Math.abs(r.data[p * 4 + 1] - truth[p * 4 + 1]); n += 2; }
    ok(err / n < 4, "stripes continue through the hole (mean error " + (err / n).toFixed(1) + ")");
    ok(r.data[0] === truth[0] && r.data[(5 * W + 5) * 4 + 2] === truth[(5 * W + 5) * 4 + 2], "pixels outside the hole stay");
    var r2 = await PP.work("inpaint", [{ data: d, width: W, height: H }, hole, {}]), same = true;
    for (p = 0; p < r.data.length; p++) if (r.data[p] !== r2.data[p]) { same = false; break; }
    ok(same, "worker gives the same result" + (PP.workerAlive() ? "" : " (fallback)"));
    // end to end: Edit › Fill with surroundings on a scratch document, undoable
    var s = PP.scratch(W, H), c = PE.cx2(s.L.canvas); c.putImageData(new ImageData(new Uint8ClampedArray(d), W, H), 0, 0); PE.touch(s.L.canvas);
    s.d.sel = PE.makeSel(s.d, PIX.rectMask(W, H, 25, 17, 14, 14));
    var done = await PP.fillSurroundings({ expand: 0, adapt: true, quality: 2, newLayer: false });
    var px = PP.px(s.L.canvas, 31, 23);
    ok(done && px[1] < 120 && ED.hist.pos === 1, "fills the selection (green was 0, now " + px[1] + ")");
    ED.undo(); ok(PP.px(s.L.canvas, 31, 23)[1] === 0, "undo fill");
  });
})();
