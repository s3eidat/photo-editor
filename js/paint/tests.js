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
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX;
  function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1 : e); }
  PP.test("dodge / burn / sponge", function (ok) {
    ok(near(PPX.tone("dodge", "mid", 0.5), 0.75, 1e-9) && near(PPX.tone("burn", "mid", 0.5), 0.25, 1e-9), "midtone maths");
    ok(PPX.tone("dodge", "highlights", 0.1) - 0.1 < PPX.tone("dodge", "shadows", 0.1) - 0.1 && PPX.tone("burn", "highlights", 0.9) < PPX.tone("burn", "shadows", 0.9), "ranges weight the right tones");
    var pr = PPX.toneRGB("dodge", "mid", true, 200, 60, 60), hsb0 = PPX.rgb2hsb(200, 60, 60), hsb1 = PPX.rgb2hsb(pr[0], pr[1], pr[2]);
    ok(near(hsb0[0], hsb1[0], 0.5) && PPX.lumF([pr[0] / 255, pr[1] / 255, pr[2] / 255]) > PPX.lumF([200 / 255, 60 / 255, 60 / 255]), "protect tones keeps the hue");
    ok(PPX.sponge("desat", false, 255, 0, 0).every(function (v) { return near(v, 76.5, 0.5); }), "sponge desaturates to grey of equal luminosity");
    var sp = PPX.sponge("sat", false, 150, 110, 110); ok(PPX.satF(sp.map(function (v) { return v / 255; })) > PPX.satF([150 / 255, 110 / 255, 110 / 255]), "sponge saturates");
    var s = PP.scratch(80, 40, "#808080"), px = PP.px;
    Object.assign(ED.o.dodge, { size: 16, hard: 1, op: 0.5, flow: 1, range: "mid", protect: true });
    PP.drive("dodge", [{ x: 20, y: 20 }, { x: 22, y: 20 }, { x: 20, y: 20 }]);
    ok(near(px(s.L.canvas, 20, 20)[0], 160, 3), "dodge 50% on mid grey (got " + px(s.L.canvas, 20, 20)[0] + "), scrubbing does not compound");
    PP.drive("burn", [{ x: 60, y: 20 }]);
    Object.assign(ED.o.burn, { size: 16, hard: 1, op: 0.5 }); ED.undo(); PP.drive("burn", [{ x: 60, y: 20 }]);
    ok(near(px(s.L.canvas, 60, 20)[0], 96, 3) && px(s.L.canvas, 40, 20)[0] === 128, "burn 50% (got " + px(s.L.canvas, 60, 20)[0] + ")");
    ED.undo(); ED.undo(); ok(px(s.L.canvas, 20, 20)[0] === 128, "undo dodge");
    ED.tool = "burn"; ED.TOOLS.burn.down({ x: 40, y: 20 }, PP.ev()); ED.TOOLS.burn.move({ x: 50, y: 20 }, PP.ev()); ED.stroke.spec.preview(ED.stroke);
    var mid = px(s.L.canvas, 45, 20)[0]; ED.cancelDrag();
    ok(mid < 128 && px(s.L.canvas, 45, 20)[0] === 128 && ED.hist.pos === 0, "Esc mid-stroke puts the pixels back");
  });
  PP.test("blur / sharpen / smudge", function (ok) {
    var s = PP.scratch(80, 40, "#ffffff"), c = PE.cx2(s.L.canvas), px = PP.px;
    c.fillStyle = "#000"; c.fillRect(39, 0, 2, 40); PE.touch(s.L.canvas);
    Object.assign(ED.o.blurtool, { size: 20, hard: 1, op: 1 });
    PP.drive("blurtool", [{ x: 40, y: 10 }, { x: 40, y: 14 }]);
    var b = px(s.L.canvas, 39, 12)[0], b2 = px(s.L.canvas, 37, 12)[0];
    ok(b > 40 && b2 < 250 && px(s.L.canvas, 39, 35)[0] === 0, "blur spreads the line where painted only (" + b + ", " + b2 + ")");
    ED.undo();
    Object.assign(ED.o.sharpentool, { size: 20, hard: 1, op: 1 });
    c.fillStyle = "#808080"; c.fillRect(0, 0, 80, 40); c.fillStyle = "#a0a0a0"; c.fillRect(40, 0, 40, 40); PE.touch(s.L.canvas);
    PP.drive("sharpentool", [{ x: 40, y: 20 }]);
    ok(px(s.L.canvas, 38, 20)[0] < 128 && px(s.L.canvas, 41, 20)[0] > 160, "sharpen increases edge contrast");
    ED.undo();
    c.fillStyle = "#fff"; c.fillRect(0, 0, 80, 40); c.fillStyle = "#000"; c.fillRect(0, 0, 20, 40); PE.touch(s.L.canvas);
    Object.assign(ED.o.smudge, { size: 12, hard: 1, op: 0.9, spacing: 6, finger: false });
    PP.drive("smudge", [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 30, y: 20 }, { x: 40, y: 20 }]);
    ok(px(s.L.canvas, 30, 20)[0] < 140 && px(s.L.canvas, 30, 5)[0] === 255, "smudge drags black into the white (" + px(s.L.canvas, 30, 20)[0] + ")");
    // transparent pixels do not darken the colour that is smudged into them
    var s2 = PP.scratch(60, 20, "#ff0000"), c2 = PE.cx2(s2.L.canvas); c2.clearRect(30, 0, 30, 20); PE.touch(s2.L.canvas);
    PP.drive("smudge", [{ x: 22, y: 10 }, { x: 30, y: 10 }, { x: 38, y: 10 }]);
    var q = px(s2.L.canvas, 34, 10); ok(q[3] > 0 && q[0] > 240 && q[1] < 15, "smudge into transparency keeps the colour (" + q + ")");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX;
  function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1 : e); }
  PP.test("gradients", async function (ok) {
    var bw = { kind: "solid", stops: [{ p: 0, c: [0, 0, 0], m: 0.5 }, { p: 1, c: [255, 255, 255] }], alpha: [{ p: 0, a: 1 }, { p: 1, a: 0 }] };
    var lut = PPX.gradLut(bw, 101); ok(near(lut[50 * 4], 127.5, 0.01) && near(lut[50 * 4 + 3], 0.5, 1e-6) && lut[0] === 0 && lut[100 * 4] === 255, "two stops, linear ramp, opacity stops");
    bw.stops[0].m = 0.25; lut = PPX.gradLut(bw, 101); ok(near(lut[25 * 4], 127.5, 0.01), "midpoint moves the halfway colour");
    var three = { kind: "solid", stops: [{ p: 0, c: [255, 0, 0] }, { p: 0.5, c: [0, 255, 0] }, { p: 1, c: [0, 0, 255] }], alpha: [{ p: 0, a: 1 }] };
    lut = PPX.gradLut(three, 101); ok(lut[50 * 4 + 1] === 255 && near(lut[75 * 4 + 2], 127.5, 0.01), "multi-stop");
    var T = PPX.gradT;
    ok(near(T("linear", 5, 3, 0, 0, 10, 0), 0.5, 1e-9) && near(T("reflected", -5, 0, 0, 0, 10, 0), 0.5, 1e-9) && near(T("radial", 0, 5, 0, 0, 10, 0), 0.5, 1e-9) &&
      near(T("diamond", 5, 5, 0, 0, 10, 0), 1, 1e-9) && near(T("angle", 0, -5, 0, 0, 10, 0), 0.25, 1e-9), "linear / reflected / radial / diamond / angle positions");
    var n1 = PPX.gradLut({ kind: "noise", rough: 50, seed: 3 }, 64), n2 = PPX.gradLut({ kind: "noise", rough: 50, seed: 3 }, 64), same = true;
    for (var i = 0; i < n1.length; i++) if (n1[i] !== n2[i]) same = false;
    ok(same && n1[3] === 1, "noise gradients are repeatable from their seed");
    var s = PP.scratch(100, 20, "#ff0000"), o = ED.o.gradient, keep = PE.clone(o);
    Object.assign(o, { type: "linear", rev: false, op: 1, dither: false, transp: true, mode: "normal" }); PP.setGradient({ name: "t", kind: "solid", stops: [{ p: 0, c: "#000000" }, { p: 1, c: "#ffffff" }], alpha: [{ p: 0, a: 1 }, { p: 1, a: 1 }] });
    await PP.applyGradient({ x: 0, y: 10 }, { x: 100, y: 10 });
    var l = PP.px(s.L.canvas, 5, 10), r = PP.px(s.L.canvas, 95, 10), m = PP.px(s.L.canvas, 50, 10);
    ok(l[0] < 20 && r[0] > 235 && near(m[0], 128, 3) && m[0] === m[1], "gradient tool renders across the layer (" + l[0] + ", " + m[0] + ", " + r[0] + ")");
    ED.undo(); ok(PP.px(s.L.canvas, 50, 10)[1] === 0, "undo gradient");
    s.d.sel = PE.makeSel(s.d, PIX.rectMask(100, 20, 0, 0, 50, 20)); o.type = "reflected";
    await PP.applyGradient({ x: 25, y: 10 }, { x: 50, y: 10 });
    ok(near(PP.px(s.L.canvas, 0, 10)[0], PP.px(s.L.canvas, 49, 10)[0], 8) && PP.px(s.L.canvas, 70, 10)[1] === 0, "reflected, inside the selection only");
    Object.keys(o).forEach(function (k) { delete o[k]; }); Object.assign(o, keep);
  });
})();
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX;
  // a tiny .abr (version 2) with a raw 3x2 tip and a PackBits 4x1 tip
  function abrV2() {
    var b = [];
    function u16(v) { b.push(v >> 8 & 255, v & 255); } function u32(v) { b.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); } function u8(v) { b.push(v & 255); }
    function name(s) { u32(s.length + 1); for (var i = 0; i < s.length; i++) u16(s.charCodeAt(i)); u16(0); }
    function brush(nm, w, hh, comp, data) {
      var start = b.length; u16(2); u32(0); var at = b.length; u32(0); u16(30); name(nm); u8(1); for (var i = 0; i < 4; i++) u16(0); u32(0); u32(0); u32(hh); u32(w); u16(8); u8(comp);
      data.forEach(u8); var size = b.length - at; b[at - 4] = size >>> 24 & 255; b[at - 3] = size >>> 16 & 255; b[at - 2] = size >>> 8 & 255; b[at - 1] = size & 255; void start;
    }
    u16(2); u16(2);
    brush("Dots", 3, 2, 0, [0, 128, 255, 255, 128, 0]);
    brush("Run", 4, 1, 1, [0, 2, 0xFD, 200]);     // row of 2 bytes: repeat 200 four times
    return new Uint8Array(b);
  }
  PP.test("brush presets and .abr", async function (ok) {
    var list = PPX.readAbr(abrV2());
    ok(list.length === 2 && list[0].name === "Dots" && list[0].w === 3 && list[0].h === 2 && list[0].data.join() === "0,128,255,255,128,0" && list[0].spacing === 30, "abr v2 raw tip");
    ok(list[1].w === 4 && list[1].data.join() === "200,200,200,200", "abr PackBits tip");
    var bad = abrV2().slice(0, 40), threw = false; try { PPX.readAbr(bad); } catch (e) { threw = true; } ok(threw, "rejects a truncated file");
    threw = false; try { PPX.readAbr(new Uint8Array([0, 3, 0, 0])); } catch (e) { threw = true; } ok(threw, "rejects unknown versions");
    // a sampled tip paints its shape
    var s = PP.scratch(60, 30), o = ED.o.brush; s.d.fg = "#000000";
    var g = new Uint8Array(20 * 20); for (var y = 0; y < 20; y++) for (var x = 0; x < 20; x++) g[y * 20 + x] = x < 10 ? 255 : 0;
    PP.tipFromGray("t:test", "Half", 20, 20, g);
    Object.assign(o, { tip: "t:test", size: 20, op: 1, flow: 1, angle: 0, round: 100 });
    PP.drive("brush", [{ x: 30, y: 15 }]);
    ok(PP.px(s.L.canvas, 24, 15)[0] < 30 && PP.px(s.L.canvas, 36, 15)[0] > 225, "sampled tip keeps its shape");
    ED.undo(); o.angle = 180; PP.drive("brush", [{ x: 30, y: 15 }]);
    ok(PP.px(s.L.canvas, 36, 15)[0] < 30 && PP.px(s.L.canvas, 24, 15)[0] > 225, "tip angle rotates it");
    o.tip = ""; o.angle = 0; delete PE.paint.tips["t:test"];
    var pr = PP.presets().filter(function (p) { return p.id === "p:spatter"; })[0]; PP.applyPreset("brush", pr);
    ok(o.tip === "t:spatter" && o.scatter === 60 && o.preset === "p:spatter", "applying a preset sets tip and dynamics");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX;
  // a small layer in a bigger document: strokes grow it, and that must undo / cancel cleanly
  function small() {
    var d = PE.newDoc(120, 80, "t"), c = PE.mk(40, 40), x = PE.cx2(c); x.fillStyle = "#ffffff"; x.fillRect(0, 0, 40, 40);
    var L = PE.rasterFromCanvas(PE.touch(c), "Small", 10, 10); d.layers = [L]; d.active = L.id;
    ED.doc = d; ED.hist = new PE.History(200e6, 60); ED.maskEdit = false; ED.live = { over: {}, maskOver: {}, hide: null };
    return { d: d, L: L };
  }
  PP.test("review fixes", async function (ok) {
    var s = small(), o = ED.o.brush; Object.assign(o, PP.BDEF, { size: 10, hard: 1, op: 1, flow: 1, sizeC: "off" }); s.d.fg = "#ff0000";
    ED.tool = "brush"; ED.TOOLS.brush.down({ x: 80, y: 60 }, PP.ev()); ED.TOOLS.brush.move({ x: 90, y: 60 }, PP.ev()); ED.cancelDrag();
    ok(s.L.canvas.width === 40 && s.L.x === 10 && ED.hist.pos === 0, "a cancelled stroke leaves the layer as it was");
    PP.drive("brush", [{ x: 20, y: 20 }, { x: 30, y: 20 }]);
    var f0 = PP.px(PE.flatten(s.d), 25, 20); ED.undo(); var f1 = PP.px(PE.flatten(s.d), 25, 20); ED.redo(); var f2 = PP.px(PE.flatten(s.d), 25, 20);
    ok(f0[1] === 0 && f1[1] === 255 && f2[1] === 0, "undo / redo after a cancelled stroke keeps the next stroke (" + [f0, f1, f2].join(" | ") + ")");
    // switching tools mid-stroke puts the pixels back instead of leaving them unrecorded
    s = small(); ED.tool = "brush"; ED.TOOLS.brush.down({ x: 20, y: 20 }, PP.ev()); ED.TOOLS.brush.move({ x: 40, y: 20 }, PP.ev()); ED.stroke && PP.preview();
    ED.setTool("move"); ED.tool = "brush";
    ok(!ED.drag && !ED.stroke && PP.px(s.L.canvas, 20, 10)[1] === 255 && ED.hist.pos === 0, "changing tool mid-stroke cancels it cleanly");
    // a job that finishes after the document changed is dropped
    s = small(); s.d.sel = PE.makeSel(s.d, PIX.rectMask(120, 80, 20, 20, 10, 10));
    var job = PP.fillSurroundings({ expand: 0, quality: 1 }), other = PP.scratch(30, 30); void other;
    ok((await job) === false && ED.hist.list.length === 0, "a fill that finishes on another document is not applied there");
    s = small(); s.d.sel = PE.makeSel(s.d, PIX.rectMask(120, 80, 20, 20, 10, 10));
    ok((await PP.fillSurroundings({ expand: 0, quality: 1 })) && ED.hist.list.length === 1 && s.L.canvas.width === 120, "growing the layer and the fill are one history step");
    ED.undo(); ok(s.L.canvas.width === 40, "and undo together");
    // history brush keeps the active layer
    s = PP.scratch(40, 20); var L2 = PE.rasterFromCanvas(PE.touch(PE.mk(40, 20)), "Top"); s.d.layers.push(L2);
    ED.meta("add", function () {}); ED.setActive(s.L.id); Object.assign(ED.o.hbrush, { size: 6, hard: 1, op: 1, flow: 1 }); PP.historySource(0);
    PP.drive("hbrush", [{ x: 10, y: 10 }]);
    ok(ED.doc.active === s.L.id, "the history brush leaves the active layer alone");
    // clone stamp on a mask copies mask values
    s = PP.scratch(60, 20); s.L.mask = PE.whiteMask(s.d); PE.cx2(s.L.mask.canvas).clearRect(0, 0, 20, 20); PE.touch(s.L.mask.canvas); ED.maskEdit = true;
    ED.cloneSrc = { x: 10, y: 10 }; ED.cloneOff = null; Object.assign(ED.o.clone, { size: 8, hard: 1, op: 1, flow: 1, aligned: true });
    PP.drive("clone", [{ x: 45, y: 10 }]);
    ok(PP.px(s.L.mask.canvas, 45, 10)[3] === 0 && PP.px(s.L.mask.canvas, 30, 10)[3] === 255, "clone stamp copies the hidden mask area");
    ED.maskEdit = false;
    // untrusted brush files cannot ask for huge memory
    var b = [0, 2, 0, 1, 0, 2], hdr = function (arr) { return arr; };
    void hdr; var big = [0, 2, 0, 1]; function u32(v) { big.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); }
    big.push(0, 2); var at = big.length; u32(0); u32(0); big.push(0, 25); u32(1); big.push(0, 0); big.push(1); for (var i = 0; i < 8; i++) big.push(0); u32(0); u32(0); u32(2500); u32(2500); big.push(0, 8, 1);
    for (i = 0; i < 2500; i++) big.push(0, 0);
    var size = big.length - at - 4; big[at] = size >>> 24 & 255; big[at + 1] = size >>> 16 & 255; big[at + 2] = size >>> 8 & 255; big[at + 3] = size & 255;
    var threw = false; try { PPX.readAbr(new Uint8Array(big)); } catch (e) { threw = true; } ok(threw, "rejects zero-length PackBits rows (memory bomb)");
    void b;
    var o2 = PP.clampBrush({ count: 1e8, size: 1e6, sizeC: "evil", spacing: -5 }); ok(o2.count === 16 && o2.size === 1000 && o2.sizeC === "pressure" && o2.spacing === 1, "brush options are clamped");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint;
  PP.test("sample all layers", async function (ok) {
    var s = PP.scratch(80, 40, "#3366cc"), c = PE.cx2(s.L.canvas); c.fillStyle = "#ff0000"; c.fillRect(50, 15, 8, 8); PE.touch(s.L.canvas);
    var top = PE.rasterFromCanvas(PE.touch(PE.mk(80, 40)), "Retouch"); s.d.layers.push(top); s.d.active = top.id;
    ED.cloneSrc = { x: 20, y: 20 }; ED.cloneOff = null; Object.assign(ED.o.clone, PP.BDEF, { size: 10, hard: 1, op: 1, flow: 1, aligned: true, sample: "all", sizeC: "off" });
    PP.drive("clone", [{ x: 54, y: 19 }]);
    var q = PP.px(top.canvas, 54, 19); ok(q[3] === 255 && q[2] > 190 && q[0] < 70, "clone on an empty layer copies the photo below (" + q + ")");
    ok(PP.px(s.L.canvas, 54, 19)[0] === 255, "the photo itself is untouched");
    ED.undo(); ED.o.spot.sample = "all"; Object.assign(ED.o.spot, { size: 14, hard: 1 });
    PP.drive("spot", [{ x: 54, y: 19 }]);
    for (var k = 0; k < 100 && ED.busy; k++) await new Promise(function (r) { setTimeout(r, 30); });
    q = PP.px(top.canvas, 54, 19); ok(q[3] === 255 && q[2] > 150, "spot healing on an empty layer covers the spot (" + q + ")");
    ok(PP.px(top.canvas, 10, 10)[3] === 0, "and leaves the rest of the layer empty");
    ED.o.spot.sample = "current"; ED.o.clone.sample = "current";
  });
})();
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint;
  PP.test("clone source transform", function (ok) {
    var s = PP.scratch(80, 40, "#ffffff"), c = PE.cx2(s.L.canvas); c.fillStyle = "#000000"; c.fillRect(10, 10, 4, 20); PE.touch(s.L.canvas);     // a vertical bar
    ED.cloneSrc = { x: 12, y: 20 }; ED.cloneOff = null;
    Object.assign(ED.o.clone, PP.BDEF, { size: 24, hard: 1, op: 1, flow: 1, aligned: false, sample: "current", cAngle: 90, cScale: 100, cFlipX: false, cFlipY: false, sizeC: "off" });
    PP.drive("clone", [{ x: 55, y: 20 }]);
    ok(PP.px(s.L.canvas, 47, 20)[0] < 30 && PP.px(s.L.canvas, 63, 20)[0] < 30 && PP.px(s.L.canvas, 55, 14)[0] > 220, "a 90° source turns the bar horizontal");
    ED.undo(); Object.assign(ED.o.clone, { cAngle: 0, cScale: 50 });
    PP.drive("clone", [{ x: 55, y: 20 }]);
    ok(PP.px(s.L.canvas, 55, 24)[0] < 30 && PP.px(s.L.canvas, 55, 28)[0] > 220, "a 50% source halves it");
    Object.assign(ED.o.clone, { cAngle: 0, cScale: 100, aligned: true });
  });
})();
