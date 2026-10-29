/* Vector lane self-test: known answers for the path maths and the vector layer round trips. Extends window.S3_SELFTEST. */
(function () {
  "use strict";
  var PE = window.PE, VG = PE.VG, VX = PE.VX, ED = PE.ed;
  var tests = VX.tests = [];
  VX.test = function (name, fn) { tests.push([name, fn]); };
  var base = window.S3_SELFTEST;
  window.S3_SELFTEST = async function () {
    var r = base ? await base() : true, fails = r === true ? [] : r.slice();
    var keepDoc = ED.doc, keepHist = ED.hist;
    for (var i = 0; i < tests.length; i++) {
      var out = [];
      try { await tests[i][1](function (c, m) { if (!c) out.push(m); }); } catch (e) { out.push("threw: " + (e && e.message)); }
      out.forEach(function (m) { fails.push("vector/" + tests[i][0] + ": " + m); });
    }
    ED.testing = false;
    ED.doc = keepDoc; ED.hist = keepHist; ED.live = { over: {}, maskOver: {}, hide: null }; ED.changed();
    return fails.length ? fails : true;
  };
  function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1e-6 : e); }
  VX.near = near;
  function sq(x, y, w, h) { return [{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }]; }

  VX.test("booleans", function (ok) {
    var A = [sq(0, 0, 10, 10)], B = [sq(5, 0, 10, 10)];
    ok(near(VG.areaRings(VG.bool(A, B, "add")), 150), "unite area");
    ok(near(VG.areaRings(VG.bool(A, B, "int")), 50), "intersect area");
    ok(near(VG.areaRings(VG.bool(A, B, "sub")), 50), "subtract area");
    ok(near(Math.abs(VG.areaRings(VG.bool(A, B, "xor"))), 100), "exclude area");
    var hole = VG.bool([sq(0, 0, 10, 10)], [sq(3, 3, 4, 4)], "sub");
    ok(hole.length === 2 && near(VG.areaRings(hole), 84) && VG.winding(hole, 5, 5) === 0 && VG.winding(hole, 1, 1) !== 0, "subtract makes a hole");
    var touch = VG.bool([sq(0, 0, 10, 10)], [sq(10, 0, 10, 10)], "add");
    ok(near(VG.areaRings(touch), 200) && touch.length === 1 && touch[0].length === 4, "edge-sharing squares merge to one rectangle");
    ok(VG.bool([sq(0, 0, 4, 4)], [sq(10, 10, 4, 4)], "int").length === 0, "disjoint intersect is empty");
    var same = VG.bool([sq(0, 0, 10, 10)], [sq(0, 0, 10, 10)], "add");
    ok(same.length === 1 && near(VG.areaRings(same), 100), "identical squares unite to one");
    // a self-overlapping operand is normalised by its non-zero winding
    var c = VG.combine([VG.ellipse(0, 0, 100, 100), VG.comp(VG.ellipse(50, 0, 100, 100).pts, true, "add")], 0.05);
    ok(near(VG.areaRings(c), 2 * 2500 * Math.PI - (2 * 2500 * Math.acos(0.5) - 25 * Math.sqrt(7500)), 8), "two circles unite area " + VG.areaRings(c));
  });
  VX.test("curves", function (ok) {
    var e = VG.ellipse(0, 0, 200, 100), b = VG.bounds([e]);
    ok(near(b.x, 0, 1e-9) && near(b.w, 200, 1e-9) && near(b.h, 100, 1e-9), "ellipse bounds");
    var ring = VG.flatComp(e, 0.01);
    ok(near(Math.abs(VG.area(ring)), Math.PI * 100 * 50, 20), "ellipse area from flattening");
    var s = VG.comp([VG.Pc(0, 0, 0, 0, 0, 50, 0), VG.Pc(100, 0, 100, 50, 100, 0, 0)], false), cb = VG.bounds([s]);
    ok(near(cb.h, 37.5, 1e-9) && near(cb.y, 0), "cubic extreme (3/4 of handle height)");
    var sp = VG.splitAt(s, 0, 0.5);
    ok(sp.pts.length === 3 && near(sp.pts[1][0], 50) && near(sp.pts[1][1], 37.5), "split at t=0.5 lands on the curve");
    var nb = VG.nearestSeg([s], 50, 60);
    ok(nb && near(nb.x, 50, 0.05) && near(nb.y, 37.5, 0.05) && near(nb.t, 0.5, 0.01), "nearest point on segment");
    var pts = []; for (var k = 0; k <= 60; k++) { var a = k / 60 * Math.PI; pts.push({ x: 100 + 80 * Math.cos(a), y: 100 - 80 * Math.sin(a) }); }
    var fit = VG.fit(pts, 0.5, false), fl = VG.flatComp(VG.comp(fit, false), 0.05), worst = 0;
    fl.forEach(function (p) { worst = Math.max(worst, Math.abs(Math.hypot(p.x - 100, p.y - 100) - 80)); });
    ok(fit.length >= 2 && fit.length <= 4 && worst < 1.2, "curve fit of a half circle (" + fit.length + " anchors, err " + worst.toFixed(2) + ")");
    var pp = VG.polyPts(0, 0, 100, 100, 6, 0); ok(pp.length === 6 && near(Math.min.apply(null, pp.map(function (p) { return p.y; })), 0) && near(Math.max.apply(null, pp.map(function (p) { return p.x; })), 100), "polygon fills its box");
    ok(VG.polyPts(0, 0, 10, 10, 5, 0.5).length === 10, "star has 2n points");
    var lib = VG.libComps("frame"); ok(lib && lib.length === 2 && near(VG.bounds(lib).w, 1), "custom shape normalised");
  });
  VX.test("shape layers", async function (ok) {
    var d = PE.newDoc(120, 80, "v"), sh = PE.newLayer("shape", { shape: { type: "polygon", sides: 4, x: 20, y: 20, w: 80, h: 40, fill: "#ff0000", sw: 0 } });
    d.layers = [sh];
    var px = PE.cx2(PE.flatten(d)).getImageData(60, 40, 1, 1).data, c0 = PE.cx2(PE.flatten(d)).getImageData(22, 22, 1, 1).data;
    ok(px[0] === 255 && px[3] === 255 && c0[3] === 0, "polygon (diamond) renders: centre filled, corner empty");
    sh.shape = { type: "rect", x: 10, y: 10, w: 100, h: 60, fill: "", stroke: "#0000ff", sw: 4, dash: [2, 2], cap: "butt", rot: 0 };
    var f = PE.flatten(d), cx = PE.cx2(f), on = 0, off = 0;
    for (var x = 12; x < 108; x++) { if (cx.getImageData(x, 10, 1, 1).data[3] > 128) on++; else off++; }
    ok(on > 30 && off > 30, "dashed stroke has gaps (" + on + " on / " + off + " off)");
    sh.shape.dash = null; sh.shape.align = "inside";
    var fi = PE.cx2(PE.flatten(d)); ok(fi.getImageData(11, 40, 1, 1).data[3] > 200 && fi.getImageData(8, 40, 1, 1).data[3] === 0, "inside stroke stays inside");
    sh.shape.align = "outside"; fi = PE.cx2(PE.flatten(d));
    ok(fi.getImageData(8, 40, 1, 1).data[3] > 200 && fi.getImageData(12, 40, 1, 1).data[3] === 0, "outside stroke stays outside");
    // free path with a subtracted component: hole is empty
    var L = PE.newLayer("shape", { shape: { type: "rect", x: 0, y: 0, w: 10, h: 10, fill: "#00ff00", sw: 0 } });
    VX.setDocComps(L, [VG.comp([VG.P(20, 10), VG.P(100, 10), VG.P(100, 70), VG.P(20, 70)]), VG.comp([VG.P(40, 30), VG.P(80, 30), VG.P(80, 50), VG.P(40, 50)], true, "sub")]);
    d.layers = [L];
    var g = PE.cx2(PE.flatten(d));
    ok(near(L.shape.x, 20) && near(L.shape.w, 80) && g.getImageData(25, 40, 1, 1).data[1] === 255 && g.getImageData(60, 40, 1, 1).data[3] === 0, "path with subtracted hole");
    var dc = VX.docComps(L); ok(near(dc[1].pts[0][0], 40) && near(dc[1].pts[0][1], 30), "doc <-> layer path round trip");
    L.shape.rot = 30; var before = VX.docComps(L); VX.setDocComps(L, before); var after = VX.docComps(L);
    ok(near(after[0].pts[2][0], before[0].pts[2][0], 1e-4) && near(after[0].pts[2][1], before[0].pts[2][1], 1e-4) && near(L.shape.rot, 30), "rotated path re-fit keeps its anchors");
    // project round trip keeps the extra fields
    var r = PE.newDoc(50, 50, "rt"), a = PE.newLayer("shape", { shape: { type: "star", sides: 7, indent: 0.3, x: 1, y: 2, w: 30, h: 30, fill: "#123456", stroke: "#654321", sw: 3, dash: [3, 1], cap: "square", join: "bevel", align: "outside" } });
    r.layers = [a, L]; r.vpaths = [{ id: "p1", name: "Outline", comps: [VG.comp([VG.P(1, 2), VG.Pc(30, 4, 20, 0, 40, 8, 1)], false)] }];
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(r)).arrayBuffer()));
    var s2 = od.layers[0].shape;
    ok(s2.type === "star" && s2.sides === 7 && near(s2.indent, 0.3) && JSON.stringify(s2.dash) === "[3,1]" && s2.cap === "square" && s2.join === "bevel" && s2.align === "outside", "styled shape round-trips");
    ok(od.layers[1].shape.type === "path" && od.layers[1].shape.comps.length === 2 && od.layers[1].shape.comps[1].op === "sub", "path shape round-trips");
    ok(od.vpaths && od.vpaths.length === 1 && od.vpaths[0].name === "Outline" && od.vpaths[0].comps[0].pts[1][6] === 1 && near(od.vpaths[0].comps[0].pts[1][4], 40), "saved paths round-trip");
    var evil = '{"format":"s3photo","version":1,"name":"x","w":10,"h":10,"vpaths":[{"name":"<b>","comps":[{"op":"eval","pts":[[1e99,"x",null],[2,3]]}]}],"layers":[{"kind":"shape","shape":{"type":"path","comps":"no","dash":["a",5e9],"cap":"javascript:"}}]}';
    var pj = PE.parseProjectJson(evil), dd = PE.newDoc(10, 10, "e"); VX.openDoc(dd, evil);
    ok(pj.layers[0].shape.type === "rect" && pj.layers[0].shape.cap === undefined && pj.layers[0].shape.dash[1] === 1000 && dd.vpaths[0].comps[0].op === "add" && dd.vpaths[0].comps[0].pts[0][0] === 3 * PE.LIM.side, "path fields are whitelisted and clamped");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, VX = PE.VX, VG = PE.VG, VPIX = window.VPIX;
  VX.test("paths", async function (ok) {
    // a 20x20 square with a 6x6 hole traces to an outer ring and a reversed inner ring
    var w = 30, h = 30, m = new Uint8Array(w * h);
    for (var y = 5; y < 25; y++) for (var x = 5; x < 25; x++) m[y * w + x] = (x >= 12 && x < 18 && y >= 12 && y < 18) ? 0 : 255;
    var rings = VPIX.traceMask(m, w, h, 128).map(function (r) { var o = []; for (var i = 0; i < r.length; i += 2) o.push({ x: r[i], y: r[i + 1] }); return o; });
    ok(rings.length === 2 && VX.near(Math.abs(VG.areaRings(rings)), 400 - 36), "trace keeps the hole (" + rings.length + " rings, area " + VG.areaRings(rings) + ")");
    ok(Math.sign(VG.area(rings[0])) !== Math.sign(VG.area(rings[1])), "hole ring runs the other way");
    var cs = await VX.work("maskToComps", [m, w, h, 1]);
    ok(cs.length === 2 && VG.winding(VG.flatten(cs, 0.1), 15, 15) === 0 && VG.winding(VG.flatten(cs, 0.1), 7, 7) !== 0, "selection to path: hole stays a hole");
    // curvature anchors flow through their neighbours
    var c = VG.comp([VG.Pc(0, 0, 0, 0, 0, 0, 2), VG.Pc(50, 50, 50, 50, 50, 50, 2), VG.Pc(100, 0, 100, 0, 100, 0, 2)], false);
    VX.autoSmooth(c);
    ok(VX.near(c.pts[1][3], 50) && VX.near(c.pts[1][5], 50) && c.pts[1][2] < 50 && c.pts[1][4] > 50, "curvature anchor gets a horizontal tangent at the turning point");
    // path -> selection is filled with the non-zero rule after the component operations
    var d = PE.newDoc(40, 40, "p"), msk;
    PE.ed.doc = d; PE.ed.testing = true;
    msk = VX.maskOf([VG.comp([VG.P(5, 5), VG.P(35, 5), VG.P(35, 35), VG.P(5, 35)]), VG.comp([VG.P(15, 15), VG.P(25, 15), VG.P(25, 25), VG.P(15, 25)], true, "sub")]);
    ok(msk[20 * 40 + 20] === 0 && msk[10 * 40 + 10] === 255 && msk[2 * 40 + 2] === 0, "make selection respects subtract");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, VX = PE.VX, ED = PE.ed;
  VX.test("type", async function (ok) {
    var T = { text: "one two three four five six seven eight nine ten eleven twelve", font: "Inter", size: 20, weight: 400, italic: false, color: "#000000", align: "justify-left", dir: "ltr", lh: 1.2, ax: 10, ay: 10, rot: 0, box: { w: 150, h: 400 } };
    var lay = PE.textLayout(T);
    ok(lay.lines.length >= 3 && lay.items.every(function (it) { return it.w <= 150 + 0.5; }), "paragraph wraps inside its box (" + lay.lines.length + " lines)");
    ok(lay.items.slice(0, -1).every(function (it) { return it.gap > 0 || !/\s/.test(it.s); }) && lay.items[lay.items.length - 1].gap == null, "justified lines spread, last line does not");
    ok(lay.box.x === 10 && lay.box.w === 150 && lay.box.h === 400, "paragraph box is the layout box");
    var w0 = PE.textLayout(Object.assign({}, T, { box: null, align: "left", track: 1 })).w, w1 = PE.textLayout(Object.assign({}, T, { box: null, align: "left", track: 101 })).w;
    ok(VX.near(w1 - w0, 100 / 1000 * 20 * Array.from(T.text).length, 0.5), "tracking adds track/1000 em per character");
    var small = PE.textLayout(Object.assign({}, T, { box: { w: 150, h: 30 } }));
    ok(small.overflow && small.items.filter(function (i) { return !i.hidden; }).length === 1, "lines past the box are hidden and flagged");
    // non-uniform scaling becomes character scale; boxes scale with it
    var T2 = Object.assign({}, T, { box: { w: 100, h: 50 }, size: 20 }), c = { x: 50, y: 50 };
    T2.size = 20 * Math.sqrt(2); VX.xfText(T2, c, 2, 1);
    ok(VX.near(T2.box.w, 200) && VX.near(T2.box.h, 50) && VX.near(T2.hs, 100 * 2 / Math.sqrt(2)) && VX.near(T2.ax, -50), "transform scales the box and character width");
    // drawn: underline adds ink below the text
    var d = PE.newDoc(200, 80, "t"), L = PE.newLayer("text", { text: { text: "Hi", size: 40, color: "#000000", ax: 10, ay: 10 } }); d.layers = [L];
    function ink() { var px = PE.cx2(PE.flatten(d)).getImageData(0, 0, 200, 80).data, n = 0; for (var i = 3; i < px.length; i += 4) n += px[i]; return n; }
    var a = ink(); L.text.under = true; var b = ink();
    ok(b > a * 1.05, "underline draws");
    // save / open keeps the settings
    L.text = Object.assign({}, T, { weight: 300, track: 50, caps: "small", sup: "sup", fbold: true, indF: 12, spA: 4, kern: "none", hs: 90 });
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())), t2 = od.layers[0].text;
    ok(t2.weight === 300 && t2.align === "justify-left" && t2.box.w === 150 && t2.track === 50 && t2.caps === "small" && t2.sup === "sup" && t2.fbold === true && t2.indF === 12 && t2.spA === 4 && t2.kern === "none" && t2.hs === 90, "type settings round-trip");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, VX = PE.VX, WF = PE.WF, VPIX = window.VPIX;
  VX.test("transforms", function (ok) {
    var q = [{ x: 10, y: 20 }, { x: 110, y: 30 }, { x: 90, y: 140 }, { x: 0, y: 100 }], f = WF.homog(q), near = VX.near;
    ok([[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 1, 3]].every(function (z) { var p = f(z[0], z[1]); return near(p.x, q[z[2]].x, 1e-9) && near(p.y, q[z[2]].y, 1e-9); }), "square corners land on the quad");
    var m = f(0.3, 0.7), back = f.inv(m.x, m.y); ok(near(back.u, 0.3, 1e-9) && near(back.v, 0.7, 1e-9), "projective inverse");
    var r = { x: 5, y: 7, w: 40, h: 30 }, P = WF.gridPatch(r), g = WF.patch(P), gp = g(0.25, 0.5);
    ok(near(gp.x, 15, 1e-9) && near(gp.y, 22, 1e-9), "identity patch is linear");
    var P2 = WF.fitPatch(function (u, v) { return { x: r.x + u * r.w, y: r.y + v * r.h }; }, 7);
    ok(P2.every(function (p, i) { return near(p.x, P[i].x, 1e-6) && near(p.y, P[i].y, 1e-6); }), "fitting a flat surface gives the flat patch");
    var P3 = WF.dragPatch(P, 0.5, 0.5, 10, 0), h3 = WF.patch(P3)(0.5, 0.5); ok(near(h3.x, 25 + 10, 1e-9) && near(h3.y, 22, 1e-9), "mesh drag moves the grabbed point exactly");
    ok(WF.STYLES.every(function (s) { var fn = WF.style(s[0], 0, 0, 0), a = fn(0.2, 0.6); return near(a[0], 0.2, 1e-9) && near(a[1], 0.6, 1e-9); }), "every warp style is the identity at zero bend");
    var arc = WF.style("arc", 0.5, 0, 0)(0.5, 0.5); ok(near(arc[0], 0.5, 1e-9) && near(arc[1], 0.5, 1e-9), "arc keeps the centre");
    // mesh warp: identity grid copies pixels; a 2x scale doubles the size
    var W = 8, H = 6, d = new Uint8ClampedArray(W * H * 4); for (var i = 0; i < W * H; i++) { d[i * 4] = i * 5; d[i * 4 + 1] = 255 - i * 3; d[i * 4 + 2] = 77; d[i * 4 + 3] = 255; }
    var n = 3, dst = new Float32Array(n * n * 2); for (var j = 0; j < n; j++) for (i = 0; i < n; i++) { dst[(j * n + i) * 2] = i / (n - 1) * W; dst[(j * n + i) * 2 + 1] = j / (n - 1) * H; }
    var out = VPIX.meshWarp({ data: d, width: W, height: H }, 0, 0, W, H, n, n, dst, W, H), same = true;
    for (i = 0; i < d.length; i++) if (Math.abs(out.data[i] - d[i]) > 1) { same = false; break; }
    ok(same, "identity mesh warp keeps the pixels");
    var dst2 = new Float32Array(dst.length); for (i = 0; i < dst.length; i++) dst2[i] = dst[i] * 2;
    var big = VPIX.meshWarp({ data: d, width: W, height: H }, 0, 0, W, H, n, n, dst2, W * 2, H * 2);
    ok(big.data[((3 * 16) + 5) * 4 + 3] === 255 && big.data[3] === 255 && big.data[(11 * 16 + 15) * 4 + 3] === 255 && Math.abs(big.data[0] - d[0]) <= 2, "scaled mesh warp fills the larger area, edges stay solid");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, VX = PE.VX, VPIX = window.VPIX;
  VX.test("liquify", function (ok) {
    var W = 6, H = 4, d = new Uint8ClampedArray(W * H * 4); for (var i = 0; i < W * H; i++) { d[i * 4] = i * 10; d[i * 4 + 3] = 255; }
    var zero = VPIX.liquifyApply({ data: d, width: W, height: H }, new Float32Array(W * H * 2), W, H, 1), same = true;
    for (i = 0; i < d.length; i++) if (zero.data[i] !== d[i]) same = false;
    ok(same, "an empty field changes nothing");
    var F = new Float32Array(W * H * 2); for (i = 0; i < W * H; i++) F[i * 2] = 1;      // every pixel shows its right neighbour
    var sh = VPIX.liquifyApply({ data: d, width: W, height: H }, F, W, H, 1);
    ok(sh.data[0] === d[4] && sh.data[(W + 2) * 4] === d[(W + 3) * 4], "a constant field shifts the image");
    var half = VPIX.liquifyApply({ data: d, width: W, height: H }, new Float32Array([0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0]), 3, 2, 0.5);
    ok(half.data[0] === d[4], "a half-size field is scaled up to the image");
  });
})();
(function () {
  "use strict";
  var PE = window.PE, VX = PE.VX, WF = PE.WF;
  VX.test("warp text", async function (ok) {
    var d = PE.newDoc(400, 200, "w"), L = PE.newLayer("text", { text: { text: "WARPED", size: 60, color: "#000000", ax: 40, ay: 60 } }); d.layers = [L];
    function rows() { var px = PE.cx2(PE.flatten(d)).getImageData(0, 0, 400, 200).data, top = 200, bot = 0, n = 0; for (var y = 0; y < 200; y++) for (var x = 0; x < 400; x++) if (px[(y * 400 + x) * 4 + 3] > 128) { n++; top = Math.min(top, y); bot = Math.max(bot, y); } return { top: top, bot: bot, n: n }; }
    var a = rows(); L.text.warp = { style: "arc", bend: 0.6, hd: 0, vd: 0, vert: false }; var b = rows();
    ok(b.n > a.n * 0.6 && b.bot - b.top > (a.bot - a.top) * 1.3, "arc warp bends the text (height " + (a.bot - a.top) + " -> " + (b.bot - b.top) + ")");
    var arc = WF.style("arc", 0.5, 0, 0, 0.25), mid = arc(0.5, 0.5), end = arc(0, 0.5);
    ok(VX.near(mid[0], 0.5, 1e-9) && VX.near(mid[1], 0.5, 1e-9) && end[1] > 0.5 + 0.5, "aspect-aware arc: the ends drop by more than the band height");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer()));
    ok(JSON.stringify(od.layers[0].text.warp) === JSON.stringify(L.text.warp), "warp round-trips");
  });
})();
