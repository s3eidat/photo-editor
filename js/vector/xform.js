/* Vector lane: Edit › Transform › Skew, Distort, Perspective and Warp.
   Skew slides edges along themselves, Distort moves corners freely, Perspective moves a corner and its partner
   symmetrically, Warp bends a 4 x 4 control mesh (drag the points, the tangents or anywhere inside) or uses a warp
   style with bend and distortion. Pixel layers are resampled in a worker; shape layers stay vector (their anchors are
   mapped); text is rasterized first (use Warp text to keep it editable). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, WF = PE.WF, UI = VX.ui, PIX = window.PIX, h = S3.h;
  var MODES = [["skew", "Skew"], ["distort", "Distort"], ["perspective", "Perspective"], ["warp", "Warp"]];
  var Q = null;      // the active transform
  VX.qx = function () { return Q; };

  function srcRect(L) {
    if (L.kind === "shape") { var b = VG.bounds(VX.docComps(L)); return b && b.w > 0 && b.h > 0 ? b : null; }
    var ab = PIX.alphaBounds(PE.getData(L.canvas));
    return ab ? { x: L.x + ab.x, y: L.y + ab.y, w: ab.w, h: ab.h } : null;
  }
  function corners(r) { return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]; }
  // the current mapping from the unit square to the document
  function mapper(q) {
    if (q.mode !== "warp") return WF.homog(q.quad);
    if (q.style && q.style !== "none") {
      var r = q.r, f = WF.style(q.style, q.bend, q.hd, q.vd, r.h / Math.max(1e-9, r.w));
      return function (u, v) { var p = f(u, v); return { x: r.x + p[0] * r.w, y: r.y + p[1] * r.h }; };
    }
    return WF.patch(q.P);
  }
  VX.qxMapper = mapper;

  VX.startQuad = function (mode, sel) {
    if (!ED.doc || ED.busyCheck()) return;
    if (sel) return startComps(mode, sel);
    var L = ED.layer(); if (!ED.editable(L)) return;
    if (ED.xf) ED.applyTransform();
    ED.cancelModes();
    if (L.kind === "text") {
      if (mode === "warp" && VX.warpTextDialog) { VX.warpTextDialog(); return; }
      ED.rasterize(L);
    }
    var r = srcRect(L); if (!r) { S3.toast("This layer is empty", "error"); return; }
    Q = { L: L, mode: mode, r: r, quad: corners(r), P: WF.gridPatch(r), style: "none", bend: 0.5, hd: 0, vd: 0, prev: null, fr: { sx: 1, sy: 1, rot: 0, tx: 0, ty: 0 } };
    if (L.kind === "raster") {
      var k = Math.min(1, 900 / Math.max(r.w, r.h)), pc = PE.mk(Math.max(1, Math.ceil(r.w * k)), Math.max(1, Math.ceil(r.h * k))), x = PE.cx2(pc);
      x.imageSmoothingQuality = "high"; x.drawImage(L.canvas, r.x - L.x, r.y - L.y, r.w, r.h, 0, 0, pc.width, pc.height);
      Q.prev = pc;
    } else { Q.comps0 = VX.docComps(L); Q.shape0 = PE.clone(L.shape); }
    ED.setTool("vxf"); preview(); ED.emit("tool");
  };
  // transform only some components of a path target (path selection tool + Ctrl+T)
  function startComps(mode, sel) {
    var tg = sel.tg, cs = tg.get(), idx = sel.idx.filter(function (i) { return cs[i]; });
    if (!idx.length) return;
    if (tg.kind === "layer" && !ED.editable(tg.L)) return;
    var r = VG.bounds(idx.map(function (i) { return cs[i]; })); if (!r || (r.w < 1e-6 && r.h < 1e-6)) return;
    r = { x: r.x, y: r.y, w: Math.max(r.w, 1e-3), h: Math.max(r.h, 1e-3) };
    Q = { L: tg.kind === "layer" ? tg.L : { id: "__path" }, tg: tg, idx: idx, mode: mode, r: r, quad: corners(r), P: WF.gridPatch(r), style: "none", bend: 0.5, hd: 0, vd: 0, comps0: cs,
      shape0: tg.kind === "layer" ? PE.clone(tg.L.shape) : null, pb: tg.kind === "path" ? VX.pathBegin() : null, fr: { sx: 1, sy: 1, rot: 0, tx: 0, ty: 0 } };
    ED.setTool("vxf"); preview(); ED.emit("tool");
  }
  function compsMapped(q, f) { var cs = VG.clone(q.comps0); q.idx.forEach(function (i) { cs[i] = mapComps([cs[i]], q.r, f)[0]; }); return cs; }
  function clearPreview() { if (Q) delete ED.live.over[Q.L.id]; }
  VX.cancelQuad = function () {
    if (!Q) return; clearPreview(); var L = Q.L;
    if (Q.pb) Q.pb.cancel(); else if (Q.shape0) L.shape = PE.clone(Q.shape0);
    Q = null; ED.render(); ED.renderOvl(); if (ED.tool === "vxf") ED.setTool(UI.lastOf ? UI.lastOf("psel") : "move");
  };
  VX.applyQuad = function () {
    if (!Q) return;
    var q = Q, L = q.L, f = mapper(q); Q = null; clearPreview();
    if (ED.tool === "vxf") ED.setTool(q.tg ? "psel" : "move");
    if (q.tg) {
      if (q.pb) { q.tg.put(compsMapped(q, f)); q.pb.commit("Transform path"); }
      else { L.shape = PE.clone(q.shape0); ED.meta("Transform path", function () { q.tg.put(compsMapped(q, f)); }); }
      ED.renderOvl(); return;
    }
    if (L.kind === "shape") {
      L.shape = PE.clone(q.shape0);      // undo goes back to before the preview
      ED.meta(label(q), function () { VX.setDocComps(L, mapComps(q.comps0, q.r, f)); });
      return;
    }
    VX.meshApply(L, q.r, f, label(q));
  };
  // full-size resample of a pixel layer (and its mask) through f, one undo step
  VX.meshApply = function (L, r, f, lab) {
    var n = Math.max(16, Math.min(256, Math.ceil(Math.max(r.w, r.h) / 10))), pts = [], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) { var p = f(i / (n - 1), j / (n - 1)); pts.push(p); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    var lim = { x: -ED.doc.w, y: -ED.doc.h, w: ED.doc.w * 3, h: ED.doc.h * 3 }, ob = PE.inter(PE.rectI({ x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, h: y1 - y0 + 2 }), lim);
    if (!ob) { S3.toast("The result would be off the canvas", "error"); ED.changed(); return; }
    if (ob.w * ob.h > PE.LIM.layerPx) { S3.toast("That would make the layer too large", "error"); ED.changed(); return; }
    var dst = new Float32Array(n * n * 2); pts.forEach(function (p, k) { dst[k * 2] = p.x - ob.x; dst[k * 2 + 1] = p.y - ob.y; });
    var img = PE.getData(L.canvas), jobs = [VX.work("meshWarp", [{ data: img.data, width: img.width, height: img.height }, r.x - L.x, r.y - L.y, r.w, r.h, n, n, dst, ob.w, ob.h])];
    if (L.mask) { var mi = PE.getData(L.mask.canvas); jobs.push(VX.work("meshWarp", [{ data: mi.data, width: mi.width, height: mi.height }, r.x - L.mask.x, r.y - L.mask.y, r.w, r.h, n, n, new Float32Array(dst), ob.w, ob.h])); }
    return ED.working(Promise.all(jobs), lab + "…").then(function (res) {
      ED.meta(lab, function () {
        L.canvas = toCanvas(res[0]); L.x = ob.x; L.y = ob.y;
        if (res[1]) L.mask = { canvas: toCanvas(res[1]), x: ob.x, y: ob.y };
      });
    }).catch(function (e) { S3.toast(e.message, "error"); ED.changed(); });
  };
  function toCanvas(res) { var c = PE.mk(res.width, res.height); PE.cx2(c).putImageData(new ImageData(new Uint8ClampedArray(res.data.buffer || res.data), res.width, res.height), 0, 0); return PE.touch(c); }
  VX.toCanvas = toCanvas;
  function label(q) { return { skew: "Skew", distort: "Distort", perspective: "Perspective", warp: "Warp", free: "Free transform" }[q.mode]; }
  // anchors and handles through the mapping (doc -> unit square of r -> f)
  function mapComps(cs, r, f) { return VG.map(cs, function (x, y) { return f((x - r.x) / r.w, (y - r.y) / r.h); }); }
  VX.mapCompsUnit = mapComps;

  // ---------- live preview: coarse mesh of affine triangles from a reduced copy ----------
  var pv = null;
  function preview() {
    if (!Q) return;
    var q = Q, L = q.L, f = mapper(q);
    if (q.tg) { q.tg.put(compsMapped(q, f)); ED.render(); ED.renderOvl(); return; }
    if (L.kind === "shape") { VX.setDocComps(L, mapComps(q.comps0, q.r, f)); ED.render(); ED.renderOvl(); return; }
    VX.meshPreview(L, q.prev, f, q.mode === "warp" ? 20 : 12);
  }
  // live preview of any mapping f (unit square of the layer's rect -> document) drawn from a reduced copy src
  VX.meshPreview = function (L, src, f, n) {
    var G = [], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i, j;
    for (j = 0; j <= n; j++) for (i = 0; i <= n; i++) { var p = f(i / n, j / n); G.push(p); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    var lim = { x: -ED.doc.w, y: -ED.doc.h, w: ED.doc.w * 3, h: ED.doc.h * 3 }, ob = PE.inter(PE.rectI({ x: x0 - 2, y: y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 }), lim);
    if (!ob) return;
    var k = Math.min(1, 1400 / Math.max(ob.w, ob.h)), W = Math.max(1, Math.ceil(ob.w * k)), H = Math.max(1, Math.ceil(ob.h * k));
    if (!pv || pv.width !== W || pv.height !== H) pv = PE.mk(W, H);
    var c = PE.cx2(pv), sw = src.width, sh = src.height;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    function T(a, b, cc, sa, sb, sc) {      // draw source triangle (sa, sb, sc) onto dest triangle (a, b, cc), dest in preview px
      var den = (sb.x - sa.x) * (sc.y - sa.y) - (sc.x - sa.x) * (sb.y - sa.y); if (Math.abs(den) < 1e-9) return;
      var m11 = ((b.x - a.x) * (sc.y - sa.y) - (cc.x - a.x) * (sb.y - sa.y)) / den, m12 = ((cc.x - a.x) * (sb.x - sa.x) - (b.x - a.x) * (sc.x - sa.x)) / den;
      var m21 = ((b.y - a.y) * (sc.y - sa.y) - (cc.y - a.y) * (sb.y - sa.y)) / den, m22 = ((cc.y - a.y) * (sb.x - sa.x) - (b.y - a.y) * (sc.x - sa.x)) / den;
      var dx = a.x - m11 * sa.x - m12 * sa.y, dy = a.y - m21 * sa.x - m22 * sa.y;
      var cx = (a.x + b.x + cc.x) / 3, cy = (a.y + b.y + cc.y) / 3;
      function g(p) { var vx = p.x - cx, vy = p.y - cy, l = Math.hypot(vx, vy) || 1; return { x: p.x + vx / l * 1.1, y: p.y + vy / l * 1.1 }; }      // grow ~1 px: no seams
      var A = g(a), B = g(b), C = g(cc);
      c.save(); c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.lineTo(C.x, C.y); c.closePath(); c.clip();
      c.setTransform(m11, m21, m12, m22, dx, dy); c.drawImage(src, 0, 0); c.restore();
    }
    function D(p) { return { x: (p.x - ob.x) * k, y: (p.y - ob.y) * k }; }
    for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
      var a = D(G[j * (n + 1) + i]), b = D(G[j * (n + 1) + i + 1]), cc = D(G[(j + 1) * (n + 1) + i]), d = D(G[(j + 1) * (n + 1) + i + 1]);
      var sa = { x: i / n * sw, y: j / n * sh }, sb = { x: (i + 1) / n * sw, y: j / n * sh }, sc = { x: i / n * sw, y: (j + 1) / n * sh }, sd = { x: (i + 1) / n * sw, y: (j + 1) / n * sh };
      T(a, b, d, sa, sb, sd); T(a, d, cc, sa, sd, sc);
    }
    PE.touch(pv);
    ED.live.over[L.id] = { canvas: pv, x: ob.x * k, y: ob.y * k, m: [1 / k, 0, 0, 1 / k, 0, 0] };
    if (L.mask) ED.live.maskOver[L.id] = L.mask;
    ED.render(); ED.renderOvl();
  };
  VX.qxPreview = preview;
  var pvSoon = (function () { var raf = 0; return function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; preview(); }); }; })();

  // ---------- handles ----------
  var H8 = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
  function quadHandles(q) { var f = WF.homog(q.quad); return H8.map(function (t) { return f(t[0], t[1]); }); }
  function hit(p) {
    var t = 9 / ED.zoom, q = Q;
    if (q.mode === "warp") {
      if (q.style !== "none") return { kind: "inside" };
      for (var k = 0; k < 16; k++) { var cp = q.P[k]; if (Math.hypot(cp.x - p.x, cp.y - p.y) <= t) return { kind: "cp", i: k }; }
      var f = mapper(q), loc = WF.locate(f, p.x, p.y);
      return loc.d <= t * 2 ? { kind: "mesh", u: loc.u, v: loc.v } : null;
    }
    var hs = quadHandles(q);
    for (var i = 0; i < 8; i++) if (Math.hypot(hs[i].x - p.x, hs[i].y - p.y) <= t) return { kind: "h", i: i };
    var inv = WF.homog(q.quad).inv(p.x, p.y);
    if (inv.u >= 0 && inv.u <= 1 && inv.v >= 0 && inv.v <= 1) return { kind: "move" };
    if (q.mode === "free") for (i = 0; i < 4; i++) if (Math.hypot(q.quad[i].x - p.x, q.quad[i].y - p.y) <= 30 / ED.zoom) return { kind: "rot" };
    return null;
  }
  var CORNER = { 0: 0, 2: 1, 4: 2, 6: 3 }, SIDE = { 1: [0, 1], 3: [1, 2], 5: [2, 3], 7: [3, 0] };
  function down(p, e) {
    if (!Q) return;
    var ht = hit(p);
    if (!ht) { if (Q.mode !== "warp") ht = { kind: "move" }; else return; }
    ED.drag = { kind: "vxf", h: ht, p0: p, fr: Object.assign({}, Q.fr), quad: Q.quad.map(function (c) { return { x: c.x, y: c.y }; }), P: Q.P.map(function (c) { return { x: c.x, y: c.y }; }), cancel: function () {} };
  }
  function move(p, e) {
    var dr = ED.drag; if (!dr || dr.kind !== "vxf" || !Q) return;
    var dx = p.x - dr.p0.x, dy = p.y - dr.p0.y, q = Q, ht = dr.h, Q0 = dr.quad, i;
    if (q.mode === "warp") {
      if (ht.kind === "inside") return;
      if (ht.kind === "cp") {
        var P = dr.P.map(function (c) { return { x: c.x, y: c.y }; }), idx = ht.i, r = Math.floor(idx / 4), cl = idx % 4;
        P[idx] = { x: dr.P[idx].x + dx, y: dr.P[idx].y + dy };
        if ((r === 0 || r === 3) && (cl === 0 || cl === 3)) {      // a corner carries its tangents and the inner point next to it
          var nr = r === 0 ? 1 : 2, nc = cl === 0 ? 1 : 2;
          [[r, nc], [nr, cl], [nr, nc]].forEach(function (z) { var k2 = z[0] * 4 + z[1]; P[k2] = { x: dr.P[k2].x + dx, y: dr.P[k2].y + dy }; });
        }
        q.P = P;
      } else if (ht.kind === "mesh") q.P = WF.dragPatch(dr.P, ht.u, ht.v, dx, dy);
      pvSoon(); return;
    }
    if (q.mode === "free") { freeMove(q, dr, p, e); pvSoon(); return; }
    var nq = Q0.map(function (c) { return { x: c.x, y: c.y }; });
    if (ht.kind === "move") nq.forEach(function (c, k) { c.x = Q0[k].x + dx; c.y = Q0[k].y + dy; });
    else if (CORNER[ht.i] != null) {
      var ci = CORNER[ht.i];
      if (q.mode === "distort") { nq[ci].x += dx; nq[ci].y += dy; }
      else {
        var horiz = Math.abs(dx) >= Math.abs(dy);
        if (q.mode === "skew") { if (horiz) nq[ci].x += dx; else nq[ci].y += dy; }
        else {      // perspective: the partner on the same edge moves the mirror way
          var partner = horiz ? [1, 0, 3, 2][ci] : [3, 2, 1, 0][ci];
          if (horiz) { nq[ci].x += dx; nq[partner].x -= dx; } else { nq[ci].y += dy; nq[partner].y -= dy; }
        }
      }
    } else {
      var sd = SIDE[ht.i];
      for (i = 0; i < 2; i++) {
        var c2 = nq[sd[i]];
        if (q.mode === "skew") { if (ht.i === 1 || ht.i === 5) c2.x += dx; else c2.y += dy; }
        else if (q.mode === "perspective") { if (ht.i === 1 || ht.i === 5) c2.x += (i ? -dx : dx); else c2.y += (i ? -dy : dy); }
        else { c2.x += dx; c2.y += dy; }
      }
    }
    q.quad = nq; pvSoon();
  }
  // free transform (paths): scale from the opposite side (corners keep proportions, Shift frees them), rotate outside a corner
  function freeQuad(q) {
    var r = q.r, f = q.fr, cx = r.x + r.w / 2 + f.tx, cy = r.y + r.h / 2 + f.ty, hw = r.w * f.sx / 2, hh = r.h * f.sy / 2, a = f.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(function (z) { return { x: cx + z[0] * c - z[1] * s, y: cy + z[0] * s + z[1] * c }; });
  }
  function freeMove(q, dr, p, e) {
    var f0 = dr.fr, r = q.r, f = q.fr, ht = dr.h, a = f0.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    var c0 = { x: r.x + r.w / 2 + f0.tx, y: r.y + r.h / 2 + f0.ty };
    if (ht.kind === "move") { f.tx = f0.tx + p.x - dr.p0.x; f.ty = f0.ty + p.y - dr.p0.y; }
    else if (ht.kind === "rot") {
      var d = Math.atan2(p.y - c0.y, p.x - c0.x) - Math.atan2(dr.p0.y - c0.y, dr.p0.x - c0.x), rot = f0.rot + d * 180 / Math.PI;
      f.rot = e && e.shiftKey ? Math.round(rot / 15) * 15 : rot;
    } else {
      var H = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]][ht.i], hx = H[0], hy = H[1], hw = r.w * f0.sx / 2, hh = r.h * f0.sy / 2;
      var ax = -hx * hw, ay = -hy * hh, A = { x: c0.x + ax * c - ay * s, y: c0.y + ax * s + ay * c };      // fixed opposite point
      var lx = (p.x - A.x) * c + (p.y - A.y) * s, ly = -(p.x - A.x) * s + (p.y - A.y) * c;
      var sx = hx ? lx / (hx * r.w) : f0.sx, sy = hy ? ly / (hy * r.h) : f0.sy;
      if (hx && hy && !(e && e.shiftKey)) { var k = Math.max(Math.abs(sx / f0.sx), Math.abs(sy / f0.sy)); sx = Math.sign(sx || 1) * Math.abs(f0.sx) * k; sy = Math.sign(sy || 1) * Math.abs(f0.sy) * k; }
      if (Math.abs(sx * r.w) < 0.5) sx = Math.sign(sx || 1) * 0.5 / r.w; if (Math.abs(sy * r.h) < 0.5) sy = Math.sign(sy || 1) * 0.5 / r.h;
      var mx = hx ? hx * r.w * sx / 2 : 0, my = hy ? hy * r.h * sy / 2 : 0, lc = { x: hx ? ax + mx : 0, y: hy ? ay + my : 0 };
      if (!hx) lc.x = 0; if (!hy) lc.y = 0;
      var nc = { x: c0.x + (hx ? (ax + hx * r.w * sx / 2) : 0) * c - (hy ? (ay + hy * r.h * sy / 2) : 0) * s, y: c0.y + (hx ? (ax + hx * r.w * sx / 2) : 0) * s + (hy ? (ay + hy * r.h * sy / 2) : 0) * c };
      f.sx = sx; f.sy = sy; f.tx = nc.x - (r.x + r.w / 2); f.ty = nc.y - (r.y + r.h / 2);
      void lc;
    }
    q.quad = freeQuad(q);
  }
  function up() { var dr = ED.drag; ED.drag = null; if (dr && dr.kind === "vxf") { preview(); ED.emit("tool"); } }

  ED.TOOLS.vxf = { down: down, move: move, up: up,
    cursor: function (p) { if (!Q) return "default"; var ht = hit(p); return !ht ? "default" : ht.kind === "move" ? "move" : ht.kind === "mesh" ? "grab" : "crosshair"; },
    leave: function (next) { if (Q && next !== "vxf") VX.applyQuad(); } };
  UI.NAMES.vxf = "Transform";

  // ---------- overlay ----------
  ED.on("ovl", function (o) {
    if (!Q || ED.tool !== "vxf") return;
    var c = o.c, q = Q, f = mapper(q), BL = "#1b8cff";
    o.docPath(c, function (c2, px) {
      c2.lineWidth = px; c2.strokeStyle = BL;
      if (q.mode === "warp") {      // the mesh at thirds
        for (var s = 0; s <= 3; s++) {
          c2.beginPath(); for (var t = 0; t <= 30; t++) { var a = f(s / 3, t / 30); if (t) c2.lineTo(a.x, a.y); else c2.moveTo(a.x, a.y); } c2.stroke();
          c2.beginPath(); for (t = 0; t <= 30; t++) { var b = f(t / 30, s / 3); if (t) c2.lineTo(b.x, b.y); else c2.moveTo(b.x, b.y); } c2.stroke();
        }
      } else { c2.beginPath(); q.quad.forEach(function (p, i) { if (i) c2.lineTo(p.x, p.y); else c2.moveTo(p.x, p.y); }); c2.closePath(); c2.stroke(); }
    });
    c.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    function box(p, r) { var s = ED.toScr(p.x, p.y); c.fillStyle = "#fff"; c.strokeStyle = BL; c.lineWidth = 1.5; c.fillRect(s.x - r, s.y - r, 2 * r, 2 * r); c.strokeRect(s.x - r, s.y - r, 2 * r, 2 * r); }
    if (q.mode === "warp") {
      if (q.style !== "none") return;
      [[0, 1], [0, 4], [3, 2], [3, 7], [12, 8], [12, 13], [15, 11], [15, 14]].forEach(function (z) { var a = ED.toScr(q.P[z[0]].x, q.P[z[0]].y), b = ED.toScr(q.P[z[1]].x, q.P[z[1]].y); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = BL; c.lineWidth = 1; c.stroke(); });
      q.P.forEach(function (p, i) { var s = ED.toScr(p.x, p.y), corner = i === 0 || i === 3 || i === 12 || i === 15; if (corner) box(p, 4.5); else { c.beginPath(); c.arc(s.x, s.y, 3.5, 0, Math.PI * 2); c.fillStyle = [5, 6, 9, 10].indexOf(i) >= 0 ? "#fff" : BL; c.fill(); c.strokeStyle = BL; c.stroke(); } });
    } else quadHandles(q).forEach(function (p) { box(p, 4.5); });
  });

  // ---------- options bar, keys, menus ----------
  UI.opts("vxf", function () {
    var w = ED.ui.w, out = [UI.nameItem("vxf")];
    if (!Q) { out.push(h("span", { "class": "pe-hint", text: "Choose Edit › Transform › Skew, Distort, Perspective or Warp." })); return out; }
    out.push(w.seg("", (Q.tg ? [["free", "Scale / rotate"]] : []).concat(MODES), Q.mode, function (v) { switchMode(v); }));
    if (Q.mode === "free") out.push(w.field("W %", w.numInput(Math.round(Q.fr.sx * 1000) / 10, -10000, 10000, function (v) { Q.fr.sx = v / 100 || 0.01; Q.quad = freeQuad(Q); preview(); }, 0.1), "pe-num"),
      w.field("H %", w.numInput(Math.round(Q.fr.sy * 1000) / 10, -10000, 10000, function (v) { Q.fr.sy = v / 100 || 0.01; Q.quad = freeQuad(Q); preview(); }, 0.1), "pe-num"),
      w.field("Angle", w.numInput(Math.round(Q.fr.rot * 10) / 10, -360, 360, function (v) { Q.fr.rot = v; Q.quad = freeQuad(Q); preview(); }, 0.1), "pe-num"));
    if (Q.mode === "warp") {
      out.push(w.select("Style", WF.STYLES.map(function (s) { return [s[0], s[0] === "none" ? "Custom" : s[1]]; }), Q.style, function (v) { Q.style = v; if (v === "none") Q.P = WF.gridPatch(Q.r); preview(); ED.ui.buildOpts(); }));
      if (Q.style !== "none") {
        out.push(w.range("Bend", Math.round(Q.bend * 100), -100, 100, 1, function (v) { Q.bend = v / 100; pvSoon(); }, function (v) { return v + "%"; }));
        out.push(w.range("H distort", Math.round(Q.hd * 100), -100, 100, 1, function (v) { Q.hd = v / 100; pvSoon(); }, function (v) { return v + "%"; }));
        out.push(w.range("V distort", Math.round(Q.vd * 100), -100, 100, 1, function (v) { Q.vd = v / 100; pvSoon(); }, function (v) { return v + "%"; }));
        out.push(w.btn("Edit points", function () { var f = mapper(Q); Q.P = WF.fitPatch(f, 9); Q.style = "none"; preview(); ED.ui.buildOpts(); }, "ghost", null, "Turn the style into a mesh you can drag"));
      } else out.push(w.btn("Reset", function () { Q.P = WF.gridPatch(Q.r); preview(); }, "ghost"));
    } else out.push(w.btn("Reset", function () { Q.quad = corners(Q.r); preview(); }, "ghost"));
    var hint = { free: "Drag handles to scale (Shift = free proportions), outside a corner to rotate, inside to move.", skew: "Drag a side handle to slant it; corners slide along an edge.", distort: "Drag corners anywhere; side handles move a whole edge.", perspective: "Drag a corner: its partner moves the mirror way.", warp: Q.style === "none" ? "Drag the mesh, its corner points or the tangent points." : "Pick a style and bend it, or Edit points to fine-tune." }[Q.mode];
    out.push(h("span", { "class": "pe-hint", text: hint + " Enter applies, Esc cancels." }));
    out.push(w.btn("Cancel", VX.cancelQuad, "ghost"), w.btn("Apply", VX.applyQuad, "primary", "i-check"));
    return out;
  });
  function switchMode(m) {
    if (!Q) return;
    if (m === "free") { Q.mode = "free"; Q.quad = freeQuad(Q); preview(); ED.ui.buildOpts(); return; }
    if (m === "warp" && Q.mode !== "warp") { var f = WF.homog(Q.quad); Q.P = WF.fitPatch(f, 7); Q.style = "none"; }
    if (m !== "warp" && Q.mode === "warp") { var g = mapper(Q); Q.quad = [g(0, 0), g(1, 0), g(1, 1), g(0, 1)]; }
    Q.mode = m; preview(); ED.ui.buildOpts();
  }
  UI.keys.push(function (e) {
    if (!Q || ED.tool !== "vxf") return false;
    if (e.key === "Enter") { VX.applyQuad(); return true; }
    if (e.key === "Escape") { if (ED.drag) { ED.drag = null; } VX.cancelQuad(); return true; }
    return false;
  });
  ED.on("vready", function () { ED.stage.addEventListener("dblclick", function () { if (Q && ED.tool === "vxf") VX.applyQuad(); }); });
  // undo / redo / opening another document while transforming: drop it
  var undo0 = ED.undo, redo0 = ED.redo, open0 = ED.openDoc;
  ED.undo = function () { if (Q) { VX.cancelQuad(); return; } undo0(); };
  ED.redo = function () { if (Q) VX.cancelQuad(); redo0(); };
  ED.openDoc = function (d, l) { if (Q) VX.cancelQuad(); return open0(d, l); };
  function has() { return !!ED.doc; }
  UI.menu("Edit", MODES.map(function (m) { return ["Transform: " + m[1].toLowerCase(), "", function () { if (ED.ui.w.need()) VX.startQuad(m[0]); }, has]; }), "Free transform");
  // from free transform, switch to these modes
  var moveOpts = ED.ui.optsFor.move;
  UI.opts("move", function (items) {
    if (moveOpts) items = moveOpts(items);
    if (!ED.xf) return items;
    var w = ED.ui.w, at = items.findIndex(function (x) { return x.classList && x.classList.contains("pe-hint"); });
    var sel = w.select("Mode", [["", "Scale / rotate"]].concat(MODES), "", function (v) { if (v) { ED.applyTransform(); VX.startQuad(v); } });
    items.splice(at < 0 ? items.length : at, 0, sel);
    return items;
  });
})();
