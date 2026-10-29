/* Selection lane: vector masks. L.vmask = {paths: [{closed, pts: [[x, y, inX, inY, outX, outY], …]}], on, invert, feather}
   in document coordinates (handles absolute; equal to the anchor for corners). Drawn sharp at any size, applied
   with the layer mask, transformed / moved / cropped with the layer. Made from a selection's outline or a shape. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, h = S3.h;

  function tracePath(c, paths) {
    c.beginPath();
    (paths || []).forEach(function (sp) {
      var P = sp.pts || []; if (P.length < 2) return;
      c.moveTo(P[0][0], P[0][1]);
      for (var i = 1; i <= P.length - (sp.closed === false ? 1 : 0); i++) {
        var a = P[i - 1], b = P[i % P.length];
        if (a[4] === a[0] && a[5] === a[1] && b[2] === b[0] && b[3] === b[1]) c.lineTo(b[0], b[1]);
        else c.bezierCurveTo(a[4], a[5], b[2], b[3], b[0], b[1]);
      }
      if (sp.closed !== false) c.closePath();
    });
  }
  SX.tracePath = tracePath;
  var CACHE = new WeakMap();
  function maskCanvas(L, doc) {
    var V = L.vmask, key = JSON.stringify(V) + doc.w + "x" + doc.h, hit = CACHE.get(L);
    if (hit && hit.key === key) return hit.c;
    var pad = 64, c = PE.mk(doc.w + 2 * pad, doc.h + 2 * pad), x = PE.cx2(c);
    x.translate(pad, pad);
    if (V.invert) { x.fillStyle = "#fff"; x.fillRect(-pad, -pad, c.width, c.height); x.globalCompositeOperation = "destination-out"; }
    x.fillStyle = "#fff"; tracePath(x, V.paths); x.fill("evenodd");
    if (V.feather > 0) {
      var im = x.getImageData(0, 0, c.width, c.height), a = new Float32Array(c.width * c.height), i;
      for (i = 0; i < a.length; i++) a[i] = im.data[i * 4 + 3];
      PIX.blurPlane(a, c.width, c.height, V.feather / 2);
      for (i = 0; i < a.length; i++) im.data[i * 4 + 3] = a[i];
      x.setTransform(1, 0, 0, 1, 0, 0); x.putImageData(im, 0, 0);
    }
    var out = { canvas: PE.touch(c), x: -pad, y: -pad };
    CACHE.set(L, { key: key, c: out });
    return out;
  }
  SX.vmaskCanvas = maskCanvas;
  var VC = new WeakMap();
  // applied before layer styles, so effects follow the vector shape
  SX.prepExt.unshift(function (R, L, P) {
    if (!L.vmask || L.vmask.on === false) return P;
    var vm = maskCanvas(L, R.doc), key = PE.ver(P.img) + ":" + P.x + ":" + P.y + ":" + PE.ver(vm.canvas), hit = VC.get(L);
    if (hit && hit.key === key && hit.src === P.img) return Object.assign({}, P, { img: hit.out });
    var t = PE.mk(P.img.width, P.img.height), c = PE.cx2(t);
    c.drawImage(P.img, 0, 0); c.globalCompositeOperation = "destination-in"; c.drawImage(vm.canvas, vm.x - P.x, vm.y - P.y);
    PE.touch(t); VC.set(L, { key: key, src: P.img, out: t });
    return Object.assign({}, P, { img: t });
  });
  // groups: the vector mask clips the group's buffer
  var g0 = SX.drawExt.group;
  SX.drawExt.group = function (R, tgt, G) {
    if (!G.vmask || G.vmask.on === false) return g0(R, tgt, G);
    var o = R.opts.over && R.opts.over[G.id]; if (o || (R.container && R.container(G))) return g0(R, tgt, G);
    var b = SX.buffer(R, "vgrp", tgt.d + 1); SX.groupInto(R, b, G);
    var vm = maskCanvas(G, R.doc), c = b.c; c.save(); SX.setT(c, b, R.M); c.globalCompositeOperation = "destination-in"; c.drawImage(vm.canvas, vm.x, vm.y); c.restore();
    SX.compositeBuf(R, tgt, b, G.blend === "pass" ? "normal" : G.blend, G.opacity);
  };

  // ---------- geometry follows the layer ----------
  function mapPts(V, f) { return Object.assign({}, V, { paths: V.paths.map(function (sp) { return { closed: sp.closed, pts: sp.pts.map(function (q) { var a = f(q[0], q[1]), i = f(q[2], q[3]), o = f(q[4], q[5]); return [a.x, a.y, i.x, i.y, o.x, o.y]; }) }; }) }); }
  var xa0 = PE.xfAny;
  PE.xfAny = function (L, m, xf) { if (xa0) xa0(L, m, xf); if (L.vmask) L.vmask = mapPts(L.vmask, function (x, y) { return PE.mApply(m, x, y); }); };
  PE.offsetExt = (function (prev) { return function (L, dx, dy) { if (prev) prev(L, dx, dy); if (L.vmask) L.vmask = mapPts(L.vmask, function (x, y) { return { x: x + dx, y: y + dy }; }); }; })(PE.offsetExt);
  PE.scaleExt = (function (prev) { return function (L, kx, ky) { if (prev) prev(L, kx, ky); if (L.vmask) L.vmask = mapPts(L.vmask, function (x, y) { return { x: x * kx, y: y * ky }; }); }; })(PE.scaleExt);
  var shift0 = PE.shiftExt;
  PE.shiftExt = function (dr, dx, dy) { if (shift0) shift0(dr, dx, dy); var L = dr.L; if (!L.vmask) return; if (!dr._vm) dr._vm = L.vmask; L.vmask = mapPts(dr._vm, function (x, y) { return { x: x + dx, y: y + dy }; }); };
  var more0 = SX.shiftMore;
  SX.shiftMore = function (k, o, dx, dy) { if (more0) more0(k, o, dx, dy); if (k.vmask) { if (!o.vm) o.vm = k.vmask; k.vmask = mapPts(o.vm, function (x, y) { return { x: x + dx, y: y + dy }; }); } };
  var mm0 = SX.moveMore;
  SX.moveMore = function (L, dx, dy) { if (mm0) mm0(L, dx, dy); if (L.vmask) L.vmask = mapPts(L.vmask, function (x, y) { return { x: x + dx, y: y + dy }; }); };

  // ---------- making paths ----------
  function simplify(pts, tol) {       // Douglas-Peucker on a closed polyline
    if (pts.length < 4) return pts;
    var keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    (function rec(a, b) {
      var ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, best = -1, bd = tol;
      for (var i = a + 1; i < b; i++) { var px = pts[i][0] - ax, py = pts[i][1] - ay, dd = L2 ? Math.abs(px * dy - py * dx) / Math.sqrt(L2) : Math.hypot(px, py); if (dd > bd) { bd = dd; best = i; } }
      if (best > 0) { keep[best] = 1; rec(a, best); rec(best, b); }
    })(0, pts.length - 1);
    return pts.filter(function (p, i) { return keep[i]; });
  }
  // Selection outline -> closed polygons (anti-aliased edge at the 50% line), simplified to ~0.6 px.
  SX.selectionToPaths = function (sel) {
    var b = sel.b, w = b.w + 2, hh = b.h + 2, sub = new Uint8Array(w * hh);
    for (var y = 0; y < b.h; y++) for (var x = 0; x < b.w; x++) sub[(y + 1) * w + x + 1] = sel.m[(y + b.y) * sel.w + x + b.x];
    var seg = PIX.outline(sub, w, hh), n = seg.length / 4, used = new Uint8Array(n), ends = new Map(), W1 = w + 2, out = [], i;
    function key(x, y) { return y * W1 + x; }
    for (i = 0; i < n; i++) [key(seg[i * 4], seg[i * 4 + 1]), key(seg[i * 4 + 2], seg[i * 4 + 3])].forEach(function (k) { var l = ends.get(k); if (l) l.push(i); else ends.set(k, [i]); });
    for (i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = 1; var poly = [[seg[i * 4], seg[i * 4 + 1]]], cx = seg[i * 4 + 2], cy = seg[i * 4 + 3];
      for (;;) {
        poly.push([cx, cy]);
        var list = ends.get(key(cx, cy)), nx = -1;
        if (list) for (var j = 0; j < list.length; j++) if (!used[list[j]]) { nx = list[j]; break; }
        if (nx < 0) break;
        used[nx] = 1;
        if (seg[nx * 4] === cx && seg[nx * 4 + 1] === cy) { cx = seg[nx * 4 + 2]; cy = seg[nx * 4 + 3]; } else { cx = seg[nx * 4]; cy = seg[nx * 4 + 1]; }
      }
      // pixel corners -> doc coords, smooth the staircase by averaging neighbours, then simplify
      var pts = poly.map(function (q) { return [q[0] - 1 + b.x, q[1] - 1 + b.y]; });
      if (pts.length > 8) pts = pts.map(function (q, k) { var p0 = pts[(k - 1 + pts.length) % pts.length], p1 = pts[(k + 1) % pts.length]; return [(p0[0] + 2 * q[0] + p1[0]) / 4, (p0[1] + 2 * q[1] + p1[1]) / 4]; });
      pts = simplify(pts, 0.6);
      if (pts.length >= 3) out.push({ closed: true, pts: pts.map(function (q) { return [q[0], q[1], q[0], q[1], q[0], q[1]]; }) });
    }
    return out;
  };
  function ellipsePath(r) {
    var k = 0.5523, cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
    return { closed: true, pts: [[cx + rx, cy, cx + rx, cy - ry * k, cx + rx, cy + ry * k], [cx, cy + ry, cx + rx * k, cy + ry, cx - rx * k, cy + ry], [cx - rx, cy, cx - rx, cy + ry * k, cx - rx, cy - ry * k], [cx, cy - ry, cx - rx * k, cy - ry, cx + rx * k, cy - ry]] };
  }
  function rectPath(r) { var P = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]; return { closed: true, pts: P.map(function (q) { return [q[0], q[1], q[0], q[1], q[0], q[1]]; }) }; }
  SX.ellipsePath = ellipsePath; SX.rectPath = rectPath;

  // ---------- commands ----------
  function target() { var L = ED.layer(); if (!L || L.kind === "adjust" || L.kind === "qmask" || L.kind === "channel") { S3.toast("Pick a layer or group first", "error"); return null; } return L; }
  SX.addVectorMask = function (how) {
    if (!SX.need()) return; var L = target(); if (!L) return;
    var d = ED.doc, paths;
    if (how === "selection") { if (!d.sel) { S3.toast("Make a selection first", "error"); return; } paths = SX.selectionToPaths(d.sel); if (!paths.length) { S3.toast("The selection has no edge to trace", "error"); return; } }
    else if (how === "ellipse" || how === "rect") { var r = d.sel ? d.sel.b : { x: d.w * 0.15, y: d.h * 0.15, w: d.w * 0.7, h: d.h * 0.7 }; paths = [how === "ellipse" ? ellipsePath(r) : rectPath(r)]; }
    else if (how === "hide") paths = [];
    else paths = [rectPath({ x: -1, y: -1, w: d.w + 2, h: d.h + 2 })];
    ED.meta("Add vector mask", function () { L.vmask = { paths: paths, on: true, invert: false, feather: 0 }; if (how === "selection") d.sel = null; });
    ED.emit("layers");
  };
  SX.vmaskToPixels = function (L) {
    L = L || ED.layer(); if (!L || !L.vmask) return;
    var d = ED.doc, vm = maskCanvas(L, d), c = PE.mk(d.w, d.h), x = PE.cx2(c); x.drawImage(vm.canvas, vm.x, vm.y);
    if (L.mask && L.maskOn) { x.globalCompositeOperation = "destination-in"; x.drawImage(L.mask.canvas, L.mask.x, L.mask.y); }
    ED.meta("Rasterize vector mask", function () { L.mask = { canvas: PE.touch(c), x: 0, y: 0 }; L.maskOn = true; delete L.vmask; });
  };
  SX.deleteVmask = function (L) { L = L || ED.layer(); if (!L || !L.vmask) return; ED.meta("Delete vector mask", function () { delete L.vmask; }); };

  // ---------- Properties block (appended for every kind that has one) + panel thumbnail ----------
  var props0 = ED.ui.propsKind;
  function vmBlock(P, L) {
    var w = ED.ui.w, V = L.vmask;
    P.appendChild(h("h3", { text: "Vector mask" }));
    P.appendChild(h("p", { "class": "faint pe-p", text: V.paths.length + " path" + (V.paths.length === 1 ? "" : "s") + ". Stays sharp at any size and moves / transforms with the layer." }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.check("Enabled", V.on !== false, function (v) { ED.meta(v ? "Enable vector mask" : "Disable vector mask", function () { L.vmask = Object.assign({}, L.vmask, { on: v }); }); }),
      w.check("Invert", !!V.invert, function (v) { ED.meta("Invert vector mask", function () { L.vmask = Object.assign({}, L.vmask, { invert: v }); }); })]));
    P.appendChild(w.range("Feather", V.feather || 0, 0, 250, 0.5, function (v) { SX.liveEdit({ adj: { op: "fill" } }, function () { L.vmask = Object.assign({}, L.vmask, { feather: v }); }); }, function (v) { return v + " px"; }));
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("To pixel mask", function () { SX.vmaskToPixels(L); }, "ghost"), w.btn("Delete", function () { SX.deleteVmask(L); }, "ghost")]));
  }
  ED.ui.propsKind = function (P, L) { var r = props0 ? props0(P, L) : false; if (r && L.vmask) vmBlock(P, L); return r; };
  var tail0 = ED.ui.propsTail;
  ED.ui.propsTail = function (P, L) { if (tail0) tail0(P, L); if (L.vmask) vmBlock(P, L); };
  var meta0 = SX.metaMore;
  SX.metaMore = function (L, parts) { if (meta0) meta0(L, parts); if (L.vmask) parts.push("vector mask" + (L.vmask.on === false ? " (off)" : "")); };

  // ---------- files ----------
  SX.fields.vmask = {
    save: function (L) { return L.vmask ? PE.clone(L.vmask) : undefined; },
    parse: function (v) {
      if (!v || typeof v !== "object" || !Array.isArray(v.paths)) return undefined;
      var count = 0, paths = v.paths.slice(0, 200).map(function (sp) {
        var pts = (sp && Array.isArray(sp.pts) ? sp.pts : []).slice(0, 20000).filter(function (q) { return Array.isArray(q) && q.length === 6; })
          .map(function (q) { return q.map(function (n) { n = +n; return isFinite(n) ? Math.max(-1e5, Math.min(1e5, n)) : 0; }); });
        count += pts.length; return { closed: sp.closed !== false, pts: pts };
      }).filter(function (sp) { return sp.pts.length >= 2; });
      if (count > 100000) return undefined;
      return { paths: paths, on: v.on !== false, invert: v.invert === true, feather: SX.num(v.feather, 0, 250) || 0 };
    }
  };
  function hasV() { var L = ED.layer(); return !!(L && L.vmask); }
  SX.menu("Layer", [["Vector mask from selection", "", function () { SX.addVectorMask("selection"); }, SX.hasSel], ["Vector mask: ellipse", "", function () { SX.addVectorMask("ellipse"); }, SX.has],
    ["Vector mask: rectangle", "", function () { SX.addVectorMask("rect"); }, SX.has], ["Rasterize vector mask", "", function () { SX.vmaskToPixels(); }, hasV], ["Delete vector mask", "", function () { SX.deleteVmask(); }, hasV]], "Delete mask");

  SX.tests.push(async function (ok, near) {
    var d = SX.scratch(40, 40, [PE.rasterFromCanvas(SX.solid(40, 40, "#0000ff"), "b")]), L = d.layers[0];
    d.sel = PE.makeSel(d, PIX.rectMask(40, 40, 10, 10, 20, 20));
    var paths = SX.selectionToPaths(d.sel); ok(paths.length === 1 && paths[0].pts.length >= 4 && paths[0].pts.length <= 8, "selection outline traced and simplified");
    SX.addVectorMask("selection");
    var f = PE.flatten(d); ok(SX.px(f, 20, 20)[3] === 255 && SX.px(f, 5, 5)[3] === 0 && !d.sel, "vector mask hides outside the path");
    ED.nudge(5, 0); f = PE.flatten(d); ok(SX.px(f, 33, 20)[3] === 255 && SX.px(f, 12, 20)[3] === 0, "vector mask moves with the layer");
    ED.undo();
    var xf = { b: { x: 0, y: 0, w: 40, h: 40, r0: 0 }, sx: 0.5, sy: 0.5, rot: 0, tx: 0, ty: 0 };
    ED.meta("t", function () { ED.transformLayer(L, ED.xfMatrix(xf), xf); });
    f = PE.flatten(d); ok(SX.px(f, 20, 20)[3] === 255 && SX.px(f, 14, 20)[3] === 0 && SX.px(f, 16, 20)[3] === 255, "vector mask transforms with the layer, stays sharp");
    ED.undo(); L.vmask = Object.assign({}, L.vmask, { invert: true }); ok(SX.px(PE.flatten(d), 5, 5)[3] === 255 && SX.px(PE.flatten(d), 20, 20)[3] === 0, "invert vector mask");
    L.vmask = Object.assign({}, L.vmask, { invert: false });
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())); ok(od.layers[0].vmask && od.layers[0].vmask.paths[0].pts.length === L.vmask.paths[0].pts.length, "vector masks round-trip");
    SX.vmaskToPixels(L); ok(!L.vmask && L.mask && SX.px(PE.flatten(d), 5, 5)[3] === 0, "rasterize vector mask into the layer mask");
    var ep = SX.ellipsePath({ x: 0, y: 0, w: 40, h: 40 }); ok(ep.pts.length === 4 && ep.pts[0][0] === 40, "ellipse path");
  });
})();
