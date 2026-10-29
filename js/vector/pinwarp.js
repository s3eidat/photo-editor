/* Vector lane: Edit › Pin warp. A triangle mesh covers the layer's visible pixels; click to drop pins, drag them and
   the rest of the shape follows as rigidly as it can (as-rigid-as-possible solver: per-vertex best rotation, then a
   relaxed global step, pins held). Modes: rigid, normal (allows local scaling), distort (stretchy). Alt-click removes
   a pin. Apply resamples the full layer in the worker through the same mesh. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, UI = VX.ui, PIX = window.PIX, h = S3.h;
  var OPT = Object.assign({ mode: "rigid", density: "normal", expand: 2, mesh: true }, S3.store("pe-pinwarp") || {});
  var Z = null;      // session
  VX.pinSession = function () { return Z; };

  function buildMesh(L, keepPins) {
    var img = PE.getData(L.canvas), ab = PIX.alphaBounds(img); if (!ab) return null;
    var e = OPT.expand, r = { x: L.x + ab.x - e, y: L.y + ab.y - e, w: ab.w + 2 * e, h: ab.h + 2 * e };
    var cell = Math.max(4, Math.max(r.w, r.h) / ({ fewer: 12, normal: 22, more: 36 }[OPT.density] || 22));
    var nx = Math.max(2, Math.ceil(r.w / cell) + 1), ny = Math.max(2, Math.ceil(r.h / cell) + 1), sx = r.w / (nx - 1), sy = r.h / (ny - 1);
    var cells = new Uint8Array((nx - 1) * (ny - 1)), W = img.width, d = img.data;
    for (var j = 0; j < ny - 1; j++) for (var i = 0; i < nx - 1; i++) {      // keep cells that touch a visible pixel (grown by the expansion)
      var x0 = Math.max(0, Math.floor(r.x - L.x + i * sx - e)), x1 = Math.min(W - 1, Math.ceil(r.x - L.x + (i + 1) * sx + e)), y0 = Math.max(0, Math.floor(r.y - L.y + j * sy - e)), y1 = Math.min(img.height - 1, Math.ceil(r.y - L.y + (j + 1) * sy + e)), hit = 0;
      for (var y = y0; y <= y1 && !hit; y += 1) for (var x = x0; x <= x1; x += 1) if (d[(y * W + x) * 4 + 3] > 8) { hit = 1; break; }
      cells[j * (nx - 1) + i] = hit;
    }
    var N = nx * ny, rest = new Float32Array(N * 2), kept = new Uint8Array(N), nb = [];
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) { var k = j * nx + i; rest[k * 2] = r.x + i * sx; rest[k * 2 + 1] = r.y + j * sy; nb.push([]); }
    function link(a, b) { if (nb[a].indexOf(b) < 0) { nb[a].push(b); nb[b].push(a); } }
    for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
      if (!cells[j * (nx - 1) + i]) continue;
      var a = j * nx + i, b = a + 1, c = a + nx, dd = c + 1;
      kept[a] = kept[b] = kept[c] = kept[dd] = 1;
      link(a, b); link(a, c); link(b, dd); link(c, dd); link(a, dd);
    }
    var m = { L: L, r: r, nx: nx, ny: ny, cells: cells, rest: rest, pos: new Float32Array(rest), kept: kept, nb: nb, pins: [] };
    if (keepPins && Z) Z.pins.forEach(function (p) { var v = nearest(m, p.rx, p.ry, Infinity); if (v >= 0) m.pins.push({ v: v, rx: p.rx, ry: p.ry, x: p.x, y: p.y }); });
    return m;
  }
  function nearest(m, x, y, tol) {
    var best = -1, bd = tol * tol;
    for (var k = 0; k < m.kept.length; k++) { if (!m.kept[k]) continue; var dx = m.pos[k * 2] - x, dy = m.pos[k * 2 + 1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } }
    return best;
  }
  function nearestRest(m, x, y) {
    var best = -1, bd = Infinity;
    for (var k = 0; k < m.kept.length; k++) { if (!m.kept[k]) continue; var dx = m.rest[k * 2] - x, dy = m.rest[k * 2 + 1] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } }
    return best;
  }
  // ---------- as-rigid-as-possible ----------
  function solve(m, iters) {
    var N = m.kept.length, P = m.pos, R0 = m.rest, nb = m.nb, fixed = new Uint8Array(N), rc = new Float32Array(N), rs = new Float32Array(N), sc = new Float32Array(N).fill(1);
    m.pins.forEach(function (p) { fixed[p.v] = 1; P[p.v * 2] = p.x; P[p.v * 2 + 1] = p.y; });
    if (!m.pins.length) return;
    for (var it = 0; it < iters; it++) {
      for (var i = 0; i < N; i++) {      // local: best rotation (and scale in "normal") per vertex
        if (!m.kept[i]) continue;
        var a = 0, b = 0, ee = 0, L = nb[i];
        for (var q = 0; q < L.length; q++) {
          var j = L[q], ex = R0[i * 2] - R0[j * 2], ey = R0[i * 2 + 1] - R0[j * 2 + 1], fx = P[i * 2] - P[j * 2], fy = P[i * 2 + 1] - P[j * 2 + 1];
          a += ex * fx + ey * fy; b += ex * fy - ey * fx; ee += ex * ex + ey * ey;
        }
        if (OPT.mode === "distort") { rc[i] = 1; rs[i] = 0; sc[i] = 1; continue; }
        var l = Math.hypot(a, b) || 1; rc[i] = a / l; rs[i] = b / l;
        sc[i] = OPT.mode === "normal" && ee > 0 ? Math.max(0.2, Math.min(5, l / ee)) : 1;
      }
      globalStep(m, fixed, rc, rs, sc);
    }
  }
  // global step: the positions that best fit the rotated rest edges, pins held (conjugate gradients on the mesh Laplacian)
  function globalStep(m, fixed, rc, rs, sc) {
    var N = m.kept.length, P = m.pos, R0 = m.rest, nb = m.nb, free = [], i, q, j;
    for (i = 0; i < N; i++) if (m.kept[i] && !fixed[i] && nb[i].length) free.push(i);
    var bx = new Float64Array(N), by = new Float64Array(N);
    free.forEach(function (i) {
      var L = nb[i];
      for (var q = 0; q < L.length; q++) {
        var j = L[q], c = (rc[i] * sc[i] + rc[j] * sc[j]) / 2, s = (rs[i] * sc[i] + rs[j] * sc[j]) / 2, ex = R0[i * 2] - R0[j * 2], ey = R0[i * 2 + 1] - R0[j * 2 + 1];
        bx[i] += c * ex - s * ey; by[i] += s * ex + c * ey;
        if (fixed[j]) { bx[i] += P[j * 2]; by[i] += P[j * 2 + 1]; }
      }
    });
    function A(x, out) { free.forEach(function (i) { var L = nb[i], v = L.length * x[i]; for (var q = 0; q < L.length; q++) { var j = L[q]; if (!fixed[j]) v -= x[j]; } out[i] = v; }); }
    [0, 1].forEach(function (ax) {
      var x = new Float64Array(N), b = ax ? by : bx, r = new Float64Array(N), p = new Float64Array(N), Ap = new Float64Array(N), rr = 0;
      for (i = 0; i < N; i++) x[i] = P[i * 2 + ax];
      A(x, Ap);
      free.forEach(function (i) { r[i] = b[i] - Ap[i]; p[i] = r[i]; rr += r[i] * r[i]; });
      for (var it = 0; it < 60 && rr > 1e-10; it++) {
        A(p, Ap);
        var pAp = 0; free.forEach(function (i) { pAp += p[i] * Ap[i]; });
        if (!pAp) break;
        var al = rr / pAp, rn = 0;
        free.forEach(function (i) { x[i] += al * p[i]; r[i] -= al * Ap[i]; rn += r[i] * r[i]; });
        var be = rn / rr; rr = rn;
        free.forEach(function (i) { p[i] = r[i] + be * p[i]; });
      }
      free.forEach(function (i) { P[i * 2 + ax] = x[i]; });
    });
  }
  VX.pinSolve = solve;
  VX.pinMesh = buildMesh;

  // ---------- session ----------
  VX.startPin = function () {
    if (!ED.doc || ED.busyCheck()) return;
    var L = ED.layer(); if (!ED.editable(L, "pixels")) return;
    if (ED.xf) ED.applyTransform();
    ED.cancelModes();
    var m = buildMesh(L); if (!m) { S3.toast("This layer is empty", "error"); return; }
    var r = m.r, k = Math.min(1, 1000 / Math.max(r.w, r.h)), pc = PE.mk(Math.max(1, Math.ceil(r.w * k)), Math.max(1, Math.ceil(r.h * k)));
    PE.cx2(pc).drawImage(L.canvas, r.x - L.x, r.y - L.y, r.w, r.h, 0, 0, pc.width, pc.height);
    Z = m; Z.prev = pc; Z.pk = k;
    ED.setTool("vpin"); preview(); ED.emit("tool");
    S3.toast("Click to add pins, drag them to bend. Alt+click removes a pin.");
  };
  function clearPreview() { if (Z) delete ED.live.over[Z.L.id]; }
  VX.cancelPin = function () { if (!Z) return; clearPreview(); Z = null; ED.render(); ED.renderOvl(); if (ED.tool === "vpin") ED.setTool("move"); };
  VX.applyPin = function () {
    if (!Z) return;
    var m = Z, L = m.L; Z = null; clearPreview();
    if (ED.tool === "vpin") ED.setTool("move");
    if (!m.pins.length) { ED.render(); return; }
    solve(m, 60);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, N = m.kept.length;
    for (var i = 0; i < N; i++) { if (!m.kept[i]) continue; x0 = Math.min(x0, m.pos[i * 2]); x1 = Math.max(x1, m.pos[i * 2]); y0 = Math.min(y0, m.pos[i * 2 + 1]); y1 = Math.max(y1, m.pos[i * 2 + 1]); }
    var ob = PE.inter(PE.rectI({ x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, h: y1 - y0 + 2 }), { x: -ED.doc.w, y: -ED.doc.h, w: ED.doc.w * 3, h: ED.doc.h * 3 });
    if (!ob || ob.w * ob.h > PE.LIM.layerPx) { S3.toast("The result would be too large", "error"); ED.changed(); return; }
    var dst = new Float32Array(N * 2); for (i = 0; i < N; i++) { dst[i * 2] = m.pos[i * 2] - ob.x; dst[i * 2 + 1] = m.pos[i * 2 + 1] - ob.y; }
    var img = PE.getData(L.canvas), r = m.r, jobs = [VX.work("meshWarp", [{ data: img.data, width: img.width, height: img.height }, r.x - L.x, r.y - L.y, r.w, r.h, m.nx, m.ny, dst, ob.w, ob.h, m.cells])];
    if (L.mask) { var mi = PE.getData(L.mask.canvas); jobs.push(VX.work("meshWarp", [{ data: mi.data, width: mi.width, height: mi.height }, r.x - L.mask.x, r.y - L.mask.y, r.w, r.h, m.nx, m.ny, new Float32Array(dst), ob.w, ob.h, m.cells])); }
    ED.working(Promise.all(jobs), "Pin warp…").then(function (res) {
      ED.meta("Pin warp", function () { L.canvas = VX.toCanvas(res[0]); L.x = ob.x; L.y = ob.y; if (res[1]) L.mask = { canvas: VX.toCanvas(res[1]), x: ob.x, y: ob.y }; });
    }).catch(function (e) { S3.toast(e.message, "error"); ED.changed(); });
  };
  var pv = null;
  function preview() {
    if (!Z) return;
    var m = Z, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i, j, N = m.kept.length;
    for (i = 0; i < N; i++) { if (!m.kept[i]) continue; x0 = Math.min(x0, m.pos[i * 2]); x1 = Math.max(x1, m.pos[i * 2]); y0 = Math.min(y0, m.pos[i * 2 + 1]); y1 = Math.max(y1, m.pos[i * 2 + 1]); }
    var ob = PE.inter(PE.rectI({ x: x0 - 2, y: y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 }), { x: -ED.doc.w, y: -ED.doc.h, w: ED.doc.w * 3, h: ED.doc.h * 3 }); if (!ob) return;
    var k = Math.min(1, 1400 / Math.max(ob.w, ob.h)), W = Math.max(1, Math.ceil(ob.w * k)), H = Math.max(1, Math.ceil(ob.h * k));
    if (!pv || pv.width !== W || pv.height !== H) pv = PE.mk(W, H);
    var c = PE.cx2(pv), src = m.prev, sk = m.pk; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
    function V(v) { return { s: { x: (m.rest[v * 2] - m.r.x) * sk, y: (m.rest[v * 2 + 1] - m.r.y) * sk }, d: { x: (m.pos[v * 2] - ob.x) * k, y: (m.pos[v * 2 + 1] - ob.y) * k } }; }
    for (j = 0; j < m.ny - 1; j++) for (i = 0; i < m.nx - 1; i++) {
      if (!m.cells[j * (m.nx - 1) + i]) continue;
      var a = j * m.nx + i, b = a + 1, cc = a + m.nx, d = cc + 1;
      VX.drawTri(c, src, V(a), V(b), V(d)); VX.drawTri(c, src, V(a), V(d), V(cc));
    }
    PE.touch(pv);
    ED.live.over[m.L.id] = { canvas: pv, x: ob.x * k, y: ob.y * k, m: [1 / k, 0, 0, 1 / k, 0, 0] };
    if (m.L.mask) ED.live.maskOver[m.L.id] = m.L.mask;
    ED.render(); ED.renderOvl();
  }
  var loop = 0;
  function relax(frames) {      // keep solving for a few frames so the shape settles
    cancelAnimationFrame(loop);
    var n = frames;
    (function step() { if (!Z) return; solve(Z, 6); preview(); if (--n > 0) loop = requestAnimationFrame(step); })();
  }

  // ---------- tool ----------
  function down(p, e) {
    if (!Z) return;
    var t = 10 / ED.zoom, pin = -1;
    Z.pins.forEach(function (q, i) { if (Math.hypot(q.x - p.x, q.y - p.y) <= t) pin = i; });
    if (pin >= 0 && e.altKey) { Z.pins.splice(pin, 1); relax(10); ED.emit("tool"); return; }
    if (pin < 0) {
      var v = nearest(Z, p.x, p.y, Math.max(t * 2, Math.max(Z.r.w, Z.r.h) / 15)); if (v < 0) return;
      if (Z.pins.some(function (q) { return q.v === v; })) return;
      Z.pins.push({ v: v, x: Z.pos[v * 2], y: Z.pos[v * 2 + 1], rx: Z.rest[v * 2], ry: Z.rest[v * 2 + 1] }); pin = Z.pins.length - 1;
      ED.emit("tool");
    }
    var q0 = Z.pins[pin];
    ED.drag = { kind: "vpin", pin: q0, p0: p, x0: q0.x, y0: q0.y, cancel: function () {} };
    ED.renderOvl();
  }
  function move(p) {
    var dr = ED.drag; if (!dr || dr.kind !== "vpin" || !Z) return;
    dr.pin.x = dr.x0 + p.x - dr.p0.x; dr.pin.y = dr.y0 + p.y - dr.p0.y;
    solve(Z, 4); preview();
  }
  function up() { var dr = ED.drag; ED.drag = null; if (dr && dr.kind === "vpin") relax(20); }
  ED.TOOLS.vpin = { down: down, move: move, up: up, cursor: function () { return "crosshair"; }, leave: function (next) { if (Z && next !== "vpin") VX.applyPin(); } };
  UI.NAMES.vpin = "Pin warp";
  ED.on("overlay", function (o) {
    if (!Z || ED.tool !== "vpin") return;
    var c = o.c, m = Z;
    if (OPT.mesh) o.docPath(c, function (c2, px) {
      c2.beginPath();
      for (var j = 0; j < m.ny - 1; j++) for (var i = 0; i < m.nx - 1; i++) {
        if (!m.cells[j * (m.nx - 1) + i]) continue;
        var a = j * m.nx + i, b = a + 1, cc = a + m.nx, d = cc + 1, P = m.pos;
        c2.moveTo(P[a * 2], P[a * 2 + 1]); c2.lineTo(P[b * 2], P[b * 2 + 1]); c2.lineTo(P[d * 2], P[d * 2 + 1]); c2.lineTo(P[cc * 2], P[cc * 2 + 1]); c2.lineTo(P[a * 2], P[a * 2 + 1]); c2.lineTo(P[d * 2], P[d * 2 + 1]);
      }
      c2.lineWidth = 0.75 * px; c2.strokeStyle = "rgba(27,140,255,.55)"; c2.stroke();
    });
    c.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    m.pins.forEach(function (q) { var s = ED.toScr(q.x, q.y); c.beginPath(); c.arc(s.x, s.y, 6, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 2; c.strokeStyle = "#1b8cff"; c.stroke(); c.beginPath(); c.arc(s.x, s.y, 2.5, 0, Math.PI * 2); c.fillStyle = "#1b8cff"; c.fill(); });
  });
  function save() { S3.store("pe-pinwarp", OPT); }
  UI.opts("vpin", function () {
    var w = ED.ui.w, out = [UI.nameItem("vpin")];
    if (!Z) { out.push(h("span", { "class": "pe-hint", text: "Choose Edit › Pin warp with a pixel layer selected." })); return out; }
    out.push(w.seg("Mode", [["rigid", "Rigid"], ["normal", "Normal"], ["distort", "Distort"]], OPT.mode, function (v) { OPT.mode = v; save(); relax(20); }));
    out.push(w.seg("Density", [["fewer", "Fewer points"], ["normal", "Normal"], ["more", "More points"]], OPT.density, function (v) { OPT.density = v; save(); var m = buildMesh(Z.L, true); if (m) { m.prev = Z.prev; m.pk = Z.pk; Z = m; relax(20); } }));
    out.push(w.field("Expansion", w.numInput(OPT.expand, 0, 100, function (v) { OPT.expand = v; save(); var m = buildMesh(Z.L, true); if (m) { var k = Math.min(1, 1000 / Math.max(m.r.w, m.r.h)), pc = PE.mk(Math.max(1, Math.ceil(m.r.w * k)), Math.max(1, Math.ceil(m.r.h * k))); PE.cx2(pc).drawImage(m.L.canvas, m.r.x - m.L.x, m.r.y - m.L.y, m.r.w, m.r.h, 0, 0, pc.width, pc.height); m.prev = pc; m.pk = k; Z = m; relax(20); } }), "pe-num"));
    out.push(w.check("Show mesh", OPT.mesh, function (v) { OPT.mesh = v; save(); ED.renderOvl(); }));
    out.push(w.btn("Remove pins", function () { Z.pins = []; Z.pos = new Float32Array(Z.rest); preview(); ED.emit("tool"); }, "ghost"));
    out.push(h("span", { "class": "pe-hint", text: Z.pins.length + " pin" + (Z.pins.length === 1 ? "" : "s") + ". Click adds a pin, drag bends, Alt+click removes. Enter applies, Esc cancels." }));
    out.push(w.btn("Cancel", VX.cancelPin, "ghost"), w.btn("Apply", VX.applyPin, "primary", "i-check"));
    return out;
  });
  UI.keys.push(function (e) {
    if (!Z || ED.tool !== "vpin") return false;
    if (e.key === "Enter") { VX.applyPin(); return true; }
    if (e.key === "Escape") { ED.drag = null; VX.cancelPin(); return true; }
    if ((e.key === "Delete" || e.key === "Backspace") && Z.pins.length) { Z.pins.pop(); relax(10); ED.emit("tool"); return true; }
    return false;
  });
  var undo0 = ED.undo, open0 = ED.openDoc;
  ED.undo = function () { if (Z) { if (Z.pins.length) { Z.pins.pop(); relax(10); ED.emit("tool"); } else VX.cancelPin(); return; } undo0(); };
  ED.openDoc = function (d, l) { if (Z) VX.cancelPin(); return open0(d, l); };
  UI.menu("Edit", [["Pin warp", "", function () { if (ED.ui.w.need()) VX.startPin(); }, function () { return !!ED.doc; }]], "Transform: warp");
  VX.nearestRest = nearestRest;
})();
