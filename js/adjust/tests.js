/* Adjust lane: known-answer checks, run by S3_SELFTEST (app.js) through PE.adjustTests(ok, near). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX;
  function im(px, w, h) { var d = new Uint8ClampedArray(px.length * 4); px.forEach(function (c, i) { d.set([c[0], c[1], c[2], c.length > 3 ? c[3] : 255], i * 4); }); return { data: d, width: w || px.length, height: h || 1 }; }
  function get(img, i) { return Array.prototype.slice.call(img.data, i * 4, i * 4 + 3); }
  function run(px, op, p, sel, w, h) { var a = im(px, w, h); PIX.adjust(a, op, p || {}, sel); return a; }
  PE.adjustTests = async function (ok, near) {
    // auto tone / contrast / colour
    var a1 = run([[50, 100, 20], [200, 150, 220]], "autoTone", { clip: 0 });
    ok(get(a1, 0).join() === "0,0,0" && get(a1, 1).join() === "255,255,255", "auto tone stretches each channel");
    var a2 = run([[50, 100, 20], [200, 150, 220]], "autoContrast", { clip: 0 });
    ok(near(get(a2, 0)[0], 38) && near(get(a2, 0)[1], 102) && get(a2, 0)[2] === 0 && get(a2, 1)[2] === 255 && near(get(a2, 1)[0], 230), "auto contrast stretches all channels together");
    var cast = []; for (var i = 0; i < 64; i++) { var v = 40 + i * 2.5; cast.push([v * 0.8, v * 0.9, Math.min(255, v * 1.25)]); }
    cast.push([0, 0, 0]); cast.push([255, 255, 255]);
    var a3 = run(cast, "autoColor", { clip: 0 }), s = [0, 0, 0];
    for (i = 0; i < 64; i++) { var q = get(a3, i); s[0] += q[0]; s[1] += q[1]; s[2] += q[2]; }
    ok(Math.abs(s[0] - s[2]) / 64 < 6 && Math.abs(s[1] - s[2]) / 64 < 6, "auto colour neutralises a cast (" + s.map(function (x) { return Math.round(x / 64); }) + ")");
    var a4 = run([[50, 50, 50], [200, 200, 200]], "autoContrast", { clip: 0 }, new Uint8Array([255, 0]));
    ok(get(a4, 1).join() === "200,200,200", "auto ops respect the selection");

    // shadows / highlights on flat greys: L' = B^(1/(1+3a*w)) with w the tonal weight
    var g64 = run([[64, 64, 64], [64, 64, 64], [64, 64, 64], [64, 64, 64]], "shadowsHighlights", { sAmt: 50, sTone: 100, sRad: 4, hAmt: 0, color: 0 }, null, 2, 2);
    var B = 64 / 255, ws = 1 - B * B * (3 - 2 * B), want = 255 * Math.pow(B, 1 / (1 + 1.5 * ws));
    ok(near(get(g64, 0)[0], want, 1.5) && get(g64, 3)[1] === get(g64, 3)[0], "shadows lift a dark grey (" + get(g64, 0)[0] + " want " + Math.round(want) + ")");
    var bw = run([[0, 0, 0], [255, 255, 255]], "shadowsHighlights", { sAmt: 100, sTone: 100, sRad: 0, hAmt: 100, hTone: 100, hRad: 0 });
    ok(get(bw, 0).join() === "0,0,0" && get(bw, 1)[0] > 250, "black stays black");
    var hi = run([[230, 230, 230]], "shadowsHighlights", { sAmt: 0, hAmt: 60, hTone: 60, hRad: 0 });
    ok(get(hi, 0)[0] < 222, "highlights recover a bright grey (" + get(hi, 0)[0] + ")");

    // fade: half of an inverted grey, multiply mode, and the old selection limits it
    function cv(px, w) { var c = PE.mk(w, 1), x = c.getContext("2d"), d = x.createImageData(w, 1); px.forEach(function (q, i) { d.data.set([q[0], q[1], q[2], 255], i * 4); }); x.putImageData(d, 0, 0); return c; }
    function cpx(c, i) { return Array.prototype.slice.call(c.getContext("2d").getImageData(i, 0, 1, 1).data, 0, 3); }
    var fb = cv([[200, 100, 0], [200, 100, 0]], 2), fa = cv([[55, 155, 255], [55, 155, 255]], 2);
    var f1 = PE.adjUI.fadeMix(fb, fa, 0.5, "source-over", null), f2 = PE.adjUI.fadeMix(fb, fa, 1, "multiply", new Uint8Array([255, 0]));
    ok(near(cpx(f1, 0)[0], 128, 1) && near(cpx(f1, 0)[2], 128, 1), "fade 50% normal");
    ok(near(cpx(f2, 0)[0], 43, 1) && near(cpx(f2, 0)[1], 61, 1) && cpx(f2, 1).join() === "200,100,0", "fade multiply inside the old selection only");

    // photo filter: grey through an orange gel keeps its luminance but turns warm
    var pf = get(run([[128, 128, 128]], "photoFilter", { color: "#ff8000", density: 50, keepLum: true }), 0);
    ok(pf[0] > pf[1] && pf[1] > pf[2] && near(0.299 * pf[0] + 0.587 * pf[1] + 0.114 * pf[2], 128, 1.5), "photo filter warms, keeps luminance (" + pf + ")");
    var pf2 = get(run([[200, 200, 200]], "photoFilter", { color: "#ff0000", density: 100, keepLum: false }), 0);
    ok(pf2.join() === "200,0,0", "photo filter without luminosity = multiply");

    // desaturate methods
    function ds(m, k) { return get(run([[200, 100, 40]], "desatMethod", { method: m, amount: k == null ? 100 : k }), 0); }
    ok(ds("average")[0] === 113 && ds("lightness")[1] === 120 && ds("max")[2] === 200 && ds("min")[0] === 40 && ds("green")[0] === 100 && near(ds("lum709")[0], 117) && ds("average", 50).join() === "157,107,77", "desaturate methods");

    // posterize / equalize
    var ps = run([[0, 60, 100], [180, 200, 255]], "posterize", { levels: 3 });
    ok(get(ps, 0).join() === "0,0,128" && get(ps, 1).join() === "128,255,255", "posterize to 3 levels");
    var eqi = []; for (i = 0; i < 4; i++) eqi.push([100 + i, 100 + i, 100 + i]);
    var eq = run(eqi, "equalize", {});
    ok(get(eq, 0)[0] === 0 && near(get(eq, 1)[0], 85) && near(get(eq, 2)[0], 170) && get(eq, 3)[0] === 255, "equalize spreads a narrow range");
    var eq2 = run([[10, 10, 10], [20, 20, 20], [200, 200, 200]], "equalize", { basis: "image" }, new Uint8Array([255, 255, 0]));
    ok(get(eq2, 0)[0] === 0 && get(eq2, 1)[0] === 255 && get(eq2, 2)[0] === 255, "equalize whole layer from the selection");

    // gradient map and channel mixer
    var gm = run([[0, 0, 0], [255, 255, 255], [128, 128, 128]], "gradientMap", { stops: [[0, "#ff0000"], [1, "#0000ff"]] });
    ok(get(gm, 0).join() === "255,0,0" && get(gm, 1).join() === "0,0,255" && near(get(gm, 2)[0], 127) && near(get(gm, 2)[2], 128), "gradient map by luminance");
    var gm2 = get(run([[255, 255, 255]], "gradientMap", { stops: [[0, "#000000"], [0.5, "#00ff00"], [1, "#ffffff"]], reverse: true }), 0);
    ok(gm2.join() === "0,0,0", "gradient map reverse");
    var cm = get(run([[100, 50, 200]], "channelMixer", { r: [0, 0, 100, 0], g: [50, 50, 0, 10], b: [100, 0, 0, 0] }), 0);
    ok(cm[0] === 200 && near(cm[1], 100.5, 0.6) && cm[2] === 100, "channel mixer rows + constant (" + cm + ")");
    var cm2 = get(run([[100, 50, 200]], "channelMixer", { mono: true, gray: [50, 50, 0, 0] }), 0);
    ok(cm2.join() === "75,75,75", "channel mixer monochrome");

    // selective colour
    function sc(px, adj, m) { return get(run([px], "selectiveColor", { adj: adj, method: m }), 0); }
    ok(sc([255, 0, 0], { reds: [100, 0, 0, 0] }, "absolute").join() === "0,0,0" && sc([255, 0, 0], { reds: [100, 0, 0, 0] }, "relative").join() === "255,0,0", "selective colour: cyan in reds, absolute vs relative");
    ok(sc([255, 0, 0], { reds: [0, 0, -100, 0] }, "absolute").join() === "255,0,255" && sc([0, 0, 255], { reds: [100, 100, 100, 100] }, "absolute").join() === "0,0,255", "selective colour only touches its range");
    var scw = sc([255, 255, 255], { whites: [0, 0, 0, 50] }, "absolute"); ok(scw.join() === "128,128,128" || scw.join() === "127,127,127", "selective colour: black in whites");

    // develop: defaults are a no-op; exposure +1 stop doubles linear light; saturation -100 is grey; WB warms
    var dvp = []; for (i = 0; i < 64; i++) dvp.push([i * 4, 255 - i * 3, (i * 37) % 256]);
    var dv0 = run(dvp, "develop", PIX.A.devDefaults(), null, 8, 8), dmax = 0;
    for (i = 0; i < 64; i++) { var g0 = get(dv0, i); for (var c = 0; c < 3; c++) dmax = Math.max(dmax, Math.abs(g0[c] - dvp[i][c])); }
    ok(dmax <= 1, "develop at defaults changes nothing (max diff " + dmax + ")");
    var de = get(run([[128, 128, 128]], "develop", Object.assign(PIX.A.devDefaults(), { exposure: 1 })), 0);
    ok(near(de[0], 175, 1.5) && de[0] === de[2], "develop exposure +1 stop (" + de + ")");
    var dsat = get(run([[200, 80, 40]], "develop", Object.assign(PIX.A.devDefaults(), { saturation: -100 })), 0);
    ok(dsat[0] === dsat[1] && dsat[1] === dsat[2], "develop saturation -100 is grey");
    var dwb = get(run([[128, 128, 128]], "develop", Object.assign(PIX.A.devDefaults(), { temp: 50 })), 0);
    ok(dwb[0] > 128 && dwb[2] < 128, "develop temperature warms");
    var dmix = get(run([[40, 88, 232]], "develop", Object.assign(PIX.A.devDefaults(), { hslS: [0, 0, 0, 0, 0, -100, 0, 0] })), 0), dmix2 = get(run([[220, 40, 40]], "develop", Object.assign(PIX.A.devDefaults(), { hslS: [0, 0, 0, 0, 0, -100, 0, 0] })), 0);
    ok(Math.max.apply(null, dmix) - Math.min.apply(null, dmix) < 8 && dmix2[0] > 200, "develop colour mixer: blue band only");
    ok(PIX.A.bandWeights(15, new Float32Array(8))[0] === 0.5 && PIX.A.bandWeights(225, new Float32Array(8))[5] === 1, "colour mixer hue bands");

    // blur / noise / other filters
    function gray(w, hh, f) { var a = []; for (var y = 0; y < hh; y++) for (var x = 0; x < w; x++) { var v = f(x, y); a.push([v, v, v]); } return a; }
    var mb = run(gray(21, 1, function (x) { return x === 10 ? 210 : 0; }), "motionBlur", { angle: 0, distance: 7 }, null, 21, 1), mbs = 0;
    for (i = 0; i < 21; i++) mbs += get(mb, i)[0];
    ok(near(get(mb, 10)[0], 30, 6) && get(mb, 8)[0] > 15 && get(mb, 12)[0] > 15 && get(mb, 4)[0] === 0 && get(mb, 16)[0] === 0 && near(mbs, 210, 8), "motion blur spreads evenly along the line");
    var mbv = run(gray(1, 21, function (x, y) { return y === 10 ? 210 : 0; }), "motionBlur", { angle: 0, distance: 7 }, null, 1, 21);
    ok(get(mbv, 10)[0] === 210, "motion blur at 0° leaves a vertical line alone");
    var md = run(gray(5, 5, function (x, y) { return x === 2 && y === 2 ? 255 : 20; }), "median", { radius: 1 }, null, 5, 5);
    ok(get(md, 12)[0] === 20, "median removes a hot pixel");
    var md2 = run(gray(9, 1, function (x) { return [5, 1, 9, 3, 7, 2, 8, 4, 6][x]; }), "median", { radius: 1 }, null, 9, 1);
    ok(get(md2, 4)[0] === 3, "median of a 3x3 window (" + get(md2, 4)[0] + ")");
    var ds = run(gray(5, 5, function (x, y) { return x === 2 && y === 2 ? 200 : 100; }), "dustScratches", { radius: 1, threshold: 150 }, null, 5, 5);
    ok(get(ds, 12)[0] === 200, "dust & scratches keeps differences under the threshold");
    var hp = run(gray(8, 8, function () { return 90; }), "highPass", { radius: 3 }, null, 8, 8);
    ok(get(hp, 20)[0] === 128, "high pass of a flat image is mid grey");
    var mx = run(gray(7, 1, function (x) { return x === 3 ? 200 : 10; }), "maximum", { radius: 1 }, null, 7, 1), mn = run(gray(7, 1, function (x) { return x === 3 ? 10 : 200; }), "minimum", { radius: 2 }, null, 7, 1);
    ok(get(mx, 2)[0] === 200 && get(mx, 4)[0] === 200 && get(mx, 5)[0] === 10 && get(mn, 1)[0] === 10 && get(mn, 0)[0] === 200, "maximum / minimum grow and shrink");
    var sb = run(gray(16, 1, function (x) { return x < 8 ? 40 : 220; }), "surfaceBlur", { radius: 3, threshold: 15 }, null, 16, 1);
    ok(near(get(sb, 6)[0], 40, 6) && near(get(sb, 9)[0], 220, 6), "surface blur keeps a strong edge");
    var rb = run(gray(9, 9, function () { return 77; }), "radialBlur", { amount: 40, mode: "spin" }, null, 9, 9);
    ok(get(rb, 40)[0] === 77 && get(rb, 0)[0] === 77, "radial blur of a flat image is unchanged");
    var rn = run(gray(6, 6, function () { return 120; }), "reduceNoise", {}, null, 6, 6);
    ok(near(get(rn, 14)[0], 120, 1), "reduce noise keeps flat areas");

    // colour lookup: .cube parsing, identity, channel swap, 1D invert, packing round trip
    var idc = "TITLE \"id\"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
    var swp = "LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n";
    var L1 = PIX.A.parseCube(idc), L2 = PIX.A.parseCube(swp), L3 = PIX.A.parseCube("# inv\nLUT_1D_SIZE 2\n1 1 1\n0 0 0\n");
    ok(L1.title === "id" && L1.n === 2 && L1.kind === "3d" && L3.kind === "1d", "parse .cube");
    function lk(L, px) { return get(run([px], "colorLookup", { lut: PIX.A.packLut(L), amount: 100 }), 0); }
    ok(lk(L1, [10, 128, 250]).join() === "10,128,250" && lk(L2, [10, 128, 250]).join() === "250,128,10" && lk(L3, [10, 128, 250]).join() === "245,127,5", "apply 3D / 1D LUTs");
    var bad = 0; ["LUT_3D_SIZE 2\n0 0 0\n", "hello", "LUT_3D_SIZE 999\n", "LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n" + "0 0 0\n".repeat(8)].forEach(function (t) { try { PIX.A.parseCube(t); } catch (e) { bad++; } });
    ok(bad === 4, "bad .cube files are rejected");
    var lkb = get(run([[60, 120, 200]], "colorLookup", { look: "tealOrange", amount: 0 }), 0); ok(lkb.join() === "60,120,200", "look amount 0 is a no-op");

    // replace / match colour, HDR toning
    var rc = run([[255, 0, 0], [0, 0, 255], [250, 10, 5]], "replaceColor", { colors: ["#ff0000"], fuzz: 40, hue: 120 });
    ok(get(rc, 0).join() === "0,255,0" && get(rc, 1).join() === "0,0,255" && get(rc, 2)[1] > 200, "replace colour shifts only the sampled colour");
    var rcm = run([[255, 0, 0], [0, 0, 255]], "replaceColor", { colors: ["#ff0000"], fuzz: 40, showMask: true });
    ok(get(rcm, 0)[0] === 255 && get(rcm, 1)[0] === 0, "replace colour selection preview");
    var srcI = im([[200, 100, 100], [230, 130, 120], [180, 90, 80]]), sst = PIX.A.labStats(srcI), tgt = run([[100, 100, 100], [160, 160, 160], [130, 130, 130]], "matchColor", { src: sst }), tst = PIX.A.labStats(tgt);
    ok(near(tst.m[0], sst.m[0], 1.5) && near(tst.m[1], sst.m[1], 1.5) && near(tst.m[2], sst.m[2], 1.5), "match colour moves mean L, a, b to the source");
    var neu = PIX.A.labStats(run([[150, 120, 100], [170, 140, 120]], "matchColor", { neutralize: true }));
    ok(Math.abs(neu.m[1]) < 1.5 && Math.abs(neu.m[2]) < 1.5, "match colour neutralise removes a cast");
    var hd = run(gray(32, 32, function (x) { return x < 16 ? 30 : 230; }), "hdrToning", { strength: 2, detail: 0, saturation: 0 }, null, 32, 32);
    ok(get(hd, 32 * 16 + 2)[0] > 30 && get(hd, 32 * 16 + 29)[0] < 230, "HDR toning compresses the range");

    // stylize
    var emb = run(gray(9, 9, function () { return 100; }), "emboss", {}, null, 9, 9);
    ok(get(emb, 40)[0] === 128, "emboss of a flat image is mid grey");
    var fe = run(gray(8, 8, function (x) { return x < 4 ? 0 : 255; }), "findEdges", {}, null, 8, 8);
    ok(get(fe, 8 * 3 + 1)[0] === 255 && get(fe, 8 * 3 + 3)[0] < 100, "find edges: white flats, dark edges");
    ok(get(run([[100, 200, 128]], "solarize", {}), 0).join() === "100,55,127", "solarize inverts above the threshold");
    var tc = run(gray(6, 1, function (x) { return x < 3 ? 50 : 200; }), "traceContour", { level: 128, edge: "upper" }, null, 6, 1);
    ok(get(tc, 3)[0] === 0 && get(tc, 2)[0] === 255 && get(tc, 5)[0] === 255, "trace contour draws a line at the level");
    var ge = run(gray(10, 10, function () { return 140; }), "glowingEdges", {}, null, 10, 10);
    ok(get(ge, 55)[0] === 0, "glowing edges: flat areas go black");
    var op = run(gray(12, 12, function () { return 90; }), "oilPaint", { shine: 0, bristle: 0 }, null, 12, 12);
    ok(near(get(op, 70)[0], 90, 1), "oil paint keeps a flat area");

    // distort
    var grid = gray(8, 8, function (x, y) { return x * 30 + y; });
    var of = run(grid, "offset", { dx: 2, dy: 1, edge: "wrap" }, null, 8, 8);
    ok(get(of, 1 * 8 + 2)[0] === 0 && get(of, 0)[0] === 6 * 30 + 7, "offset wraps around");
    var of2 = run(grid, "offset", { dx: 3, dy: 0, edge: "transparent" }, null, 8, 8);
    ok(of2.data[3] === 0 && of2.data[3 * 4 + 3] === 255, "offset leaves transparency behind");
    var tw = run(grid, "twirl", { angle: 0 }, null, 8, 8), same = true; for (i = 0; i < 64; i++) if (get(tw, i)[0] !== grid[i][0]) same = false;
    ok(same, "twirl 0° is identity");
    var sp0 = run(grid, "spherize", { amount: 0 }, null, 8, 8), same2 = true; for (i = 0; i < 64; i++) if (get(sp0, i)[0] !== grid[i][0]) same2 = false;
    ok(same2, "spherize 0% is identity");
    var shr = run(grid, "shear", { top: 0, middle: 0, bottom: 0 }, null, 8, 8); ok(get(shr, 13)[0] === grid[13][0], "shear 0 is identity");
    var flat = new Uint8Array(8 * 8 * 2).fill(128), bs = ""; for (i = 0; i < flat.length; i++) bs += String.fromCharCode(flat[i]);
    var dsp = run(grid, "displace", { map: { w: 8, h: 8, b64: btoa(bs) }, hScale: 50, vScale: 50 }, null, 8, 8); ok(get(dsp, 20)[0] === grid[20][0], "displace with a grey map does nothing");
    var pol = run(gray(16, 16, function (x, y) { return y < 8 ? 0 : 250; }), "polar", { mode: "toPolar" }, null, 16, 16);
    ok(get(pol, 8 * 16 + 8)[0] < 20 && pol.data[35] === 255 && get(pol, 8 * 16 + 1)[0] > 200, "polar: top row becomes the centre");

    // render
    var cl = run(gray(16, 16, function () { return 0; }), "clouds", { fg: "#000000", bg: "#ffffff", size: 8 }, null, 16, 16), cmin = 255, cmax = 0;
    for (i = 0; i < 256; i++) { var cv = get(cl, i)[0]; cmin = Math.min(cmin, cv); cmax = Math.max(cmax, cv); if (get(cl, i)[0] !== get(cl, i)[1]) cmin = -1; }
    ok(cmin >= 0 && cmax - cmin > 60, "clouds: a grey fractal between the two colours");
    var cl2 = run(gray(16, 16, function () { return 0; }), "clouds", { fg: "#000000", bg: "#ffffff", size: 8, _scale: 0.5 }, null, 8, 8);
    ok(near(get(cl2, 3 * 8 + 3)[0], get(cl, 6 * 16 + 6)[0], 3), "clouds look the same in a half-size preview");
    var dcl = run(gray(4, 4, function () { return 255; }), "differenceClouds", { fg: "#000000", bg: "#000000" }, null, 4, 4); ok(get(dcl, 5)[0] === 255, "difference clouds with black is a no-op");
    var lf = run(gray(20, 20, function () { return 40; }), "lensFlare", { x: 50, y: 50 }, null, 20, 20); ok(get(lf, 210)[0] > 200 && get(lf, 0)[0] >= 40, "lens flare brightens the centre, never darkens");
    var li = run(gray(10, 10, function () { return 200; }), "lighting", { light: "infinite", intensity: 0, ambient: 50, bump: 0 }, null, 10, 10); ok(near(get(li, 55)[0], 100, 1), "lighting: ambient only scales the colour");
    var wk = await PE.work("adjust", [im([[50, 100, 20], [200, 150, 220]]), "autoTone", { clip: 0 }, null]);
    ok(wk.data[0] === 0 && wk.data[4] === 255, "extra ops run in the worker");
  };
})();
