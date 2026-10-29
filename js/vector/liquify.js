/* Vector lane: Liquify (Filter › Liquify…, Ctrl+Shift+X). A full-screen workspace on the current pixel layer:
   forward warp, reconstruct, smooth, twirl (Alt reverses), pucker, bloat, push left, freeze and thaw masks, with
   brush size, density, pressure and rate, reconstruct-all, restore-all, mesh and mask views, and its own undo.
   Brushes edit a displacement field at a working resolution (so it stays fast on big photos); OK resamples the
   full-size layer through the field in a worker. Area outside a selection starts frozen. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, UI = VX.ui, h = S3.h;
  var TOOLS = [["warp", "Forward warp", "W", "v-liquify"], ["recon", "Reconstruct", "R", "t-undo"], ["smooth", "Smooth", "E", "t-wsmooth"], ["twirl", "Twirl clockwise (Alt: counter-clockwise)", "C", "t-wtwirl"],
    ["pucker", "Pucker", "S", "t-wpucker"], ["bloat", "Bloat", "B", "t-wbloat"], ["push", "Push left (Alt: right)", "O", "t-wpush"], ["freeze", "Freeze mask", "F", "t-wfreeze"], ["thaw", "Thaw mask", "D", "t-wthaw"],
    ["hand", "Hand", "H", "t-hand"], ["zoom", "Zoom (Alt: out)", "Z", "t-zoom"]];
  var NS = "http://www.w3.org/2000/svg", ICONS = {
    "t-wsmooth": '<path d="M3 15c3-6 5 4 9-2s5-2 9-4"/><path d="M3 19h18" opacity=".5"/>',
    "t-wtwirl": '<path d="M12 12a2 2 0 1 1 2-2c0 3-3 5-6 4.5S3.5 10.5 5 7.5 11 3 15 4.5s6 6 4.5 10-6 6.5-10.5 5"/>',
    "t-wpucker": '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2"/><path d="M12 5v4M12 19v-4M5 12h4M19 12h-4M9 9l1.5 1.5M15 15l-1.5-1.5M15 9l-1.5 1.5M9 15l1.5-1.5"/>',
    "t-wbloat": '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2"/><path d="M12 9V4.5M12 15v4.5M9 12H4.5M15 12h4.5M9.5 9.5 7 7M14.5 14.5 17 17M14.5 9.5 17 7M9.5 14.5 7 17"/>',
    "t-wpush": '<path d="M14 20V8M9 12l-5-4 5-4"/><path d="M4 8h10"/>',
    "t-wfreeze": '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" opacity=".35"/><path d="M12 4v16M4 12h16"/>',
    "t-wthaw": '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="2.5 2"/><path d="m7 7 10 10"/>'
  };
  (function () { var s = document.createElementNS(NS, "svg"), t = document.createElementNS(NS, "svg"); s.setAttribute("style", "display:none"); s.setAttribute("aria-hidden", "true");
    Object.keys(ICONS).forEach(function (id) { var sym = document.createElementNS(NS, "symbol"); sym.setAttribute("id", id); sym.setAttribute("viewBox", "0 0 24 24"); t.innerHTML = ICONS[id]; while (t.firstChild) sym.appendChild(t.firstChild); s.appendChild(sym); });
    document.body.appendChild(s); })();
  var OPT = Object.assign({ size: 120, density: 50, pressure: 100, rate: 80, tool: "warp", mesh: false, mask: true }, S3.store("pe-liquify") || {});
  var S = null;      // the open session

  VX.openLiquify = function () {
    if (!ED.doc || ED.busyCheck()) return;
    var L = ED.layer(); if (!ED.editable(L, "pixels")) return;
    if (ED.maskEdit) { S3.toast("Liquify changes layer pixels: click the layer thumbnail (not the mask) first", "error"); return; }
    ED.cancelModes();
    var W = L.canvas.width, H = L.canvas.height, k = Math.min(1, 1600 / Math.max(W, H)), ww = Math.max(1, Math.round(W * k)), wh = Math.max(1, Math.round(H * k));
    k = ww / W;
    var wc = PE.mk(ww, wh), wx = PE.cx2(wc); wx.imageSmoothingQuality = "high"; wx.drawImage(L.canvas, 0, 0, ww, wh);
    var src = wx.getImageData(0, 0, ww, wh);
    S = { L: L, W: W, H: H, k: k, ww: ww, wh: wh, src: src.data, out: wx.getImageData(0, 0, ww, wh), wc: wc, D: new Float32Array(ww * wh * 2), F: new Float32Array(ww * wh), undo: [], z: 1, px: 0, py: 0 };
    if (ED.doc.sel) {      // outside the selection is frozen
      var m = ED.doc.sel.m, dw = ED.doc.w, dh = ED.doc.h;
      for (var y = 0; y < wh; y++) for (var x = 0; x < ww; x++) { var dx = Math.floor((x + 0.5) / k) + L.x, dy = Math.floor((y + 0.5) / k) + L.y; S.F[y * ww + x] = dx >= 0 && dy >= 0 && dx < dw && dy < dh ? 1 - m[dy * dw + dx] / 255 : 1; }
    }
    build();
  };

  // ---------- brush maths on the field ----------
  function weight(d, r) {
    if (d >= r) return 0;
    var inner = 1 - OPT.density / 100, t = d / r;
    if (t <= inner) return 1;
    var u = (t - inner) / (1 - inner || 1); return (1 - u * u) * (1 - u * u);
  }
  function sampleD(D, x, y, o) {
    var ww = S.ww, wh = S.wh; x = Math.max(0, Math.min(ww - 1.001, x)); y = Math.max(0, Math.min(wh - 1.001, y));
    var x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, i = (y0 * ww + x0) * 2, i1 = x0 + 1 < ww ? i + 2 : i, j = y0 + 1 < wh ? i + ww * 2 : i, j1 = x0 + 1 < ww ? j + 2 : j;
    o[0] = (D[i] * (1 - tx) + D[i1] * tx) * (1 - ty) + (D[j] * (1 - tx) + D[j1] * tx) * ty;
    o[1] = (D[i + 1] * (1 - tx) + D[i1 + 1] * tx) * (1 - ty) + (D[j + 1] * (1 - tx) + D[j1 + 1] * tx) * ty;
  }
  // a copy of the field around the brush, so a step reads the field as it was before the step
  function Snapshot(x0, y0, x1, y1) {
    var ww = S.ww, w = x1 - x0 + 1, hh = y1 - y0 + 1, a = new Float32Array(w * hh * 2);
    for (var y = 0; y < hh; y++) a.set(S.D.subarray(((y + y0) * ww + x0) * 2, ((y + y0) * ww + x1 + 1) * 2), y * w * 2);
    this.get = function (x, y, c) {      // field value at integer x, y
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return a[((y - y0) * w + x - x0) * 2 + c];
      return S.D[(y * ww + x) * 2 + c];
    };
    var self = this;
    this.sample = function (x, y, o) {
      x = Math.max(0, Math.min(S.ww - 1.001, x)); y = Math.max(0, Math.min(S.wh - 1.001, y));
      var ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy, ix1 = Math.min(S.ww - 1, ix + 1), iy1 = Math.min(S.wh - 1, iy + 1);
      for (var c = 0; c < 2; c++) o[c] = (self.get(ix, iy, c) * (1 - tx) + self.get(ix1, iy, c) * tx) * (1 - ty) + (self.get(ix, iy1, c) * (1 - tx) + self.get(ix1, iy1, c) * tx) * ty;
    };
  }
  // one brush application at work point c; fn(x, y, weight, index, snapshot, tmp) edits S.D[index]
  function apply(c, r, fn, reach) {
    var ww = S.ww, wh = S.wh, x0 = Math.max(0, Math.floor(c.x - r)), y0 = Math.max(0, Math.floor(c.y - r)), x1 = Math.min(ww - 1, Math.ceil(c.x + r)), y1 = Math.min(wh - 1, Math.ceil(c.y + r));
    if (x1 < x0 || y1 < y0) return null;
    var mg = Math.ceil((reach || 0) + 3), old = new Snapshot(Math.max(0, x0 - mg), Math.max(0, y0 - mg), Math.min(ww - 1, x1 + mg), Math.min(wh - 1, y1 + mg)), pr = OPT.pressure / 100, o = [0, 0];
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var i = y * ww + x, w = weight(Math.hypot(x - c.x, y - c.y), r) * pr * (1 - S.F[i]);
      if (w <= 0) continue;
      fn(x, y, w, i, old, o);
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  // generic: new displacement = old displacement at q, plus the move from p to q
  function moveTo(x, y, qx, qy, i, old, o) { old.sample(qx, qy, o); S.D[i * 2] = o[0] + qx - x; S.D[i * 2 + 1] = o[1] + qy - y; }
  function dab(tool, c, m, alt) {
    var r = OPT.size * S.k / 2, rate = OPT.rate / 100;
    if (tool === "warp" || tool === "push") {
      var mx = m.x, my = m.y;
      if (tool === "push") { var t = mx; mx = alt ? -my : my; my = alt ? t : -t; }
      return apply(c, r, function (x, y, w, i, old, o) { moveTo(x, y, x - mx * w, y - my * w, i, old, o); }, Math.hypot(mx, my));
    }
    if (tool === "twirl") { var th = (alt ? -1 : 1) * 0.07 * rate; return apply(c, r, function (x, y, w, i, old, o) { var a = -th * w, cs = Math.cos(a), sn = Math.sin(a), dx = x - c.x, dy = y - c.y; moveTo(x, y, c.x + dx * cs - dy * sn, c.y + dx * sn + dy * cs, i, old, o); }, r * 0.1); }
    if (tool === "pucker" || tool === "bloat") { var s = (tool === "pucker" ? 1 : -1) * 0.045 * rate; return apply(c, r, function (x, y, w, i, old, o) { var f = 1 + s * w; moveTo(x, y, c.x + (x - c.x) * f, c.y + (y - c.y) * f, i, old, o); }, r * 0.06); }
    if (tool === "recon") { var kr = 0.12 * rate; return apply(c, r, function (x, y, w, i) { S.D[i * 2] *= 1 - kr * w; S.D[i * 2 + 1] *= 1 - kr * w; }); }
    if (tool === "smooth") {
      var ks = 0.35 * rate, rr = Math.max(2, Math.round(r / 6));
      return apply(c, r, function (x, y, w, i, old) {
        var sx = 0, sy = 0, n = 0;
        for (var yy = Math.max(0, y - rr); yy <= Math.min(S.wh - 1, y + rr); yy += Math.max(1, rr >> 1)) for (var xx = Math.max(0, x - rr); xx <= Math.min(S.ww - 1, x + rr); xx += Math.max(1, rr >> 1)) { sx += old.get(xx, yy, 0); sy += old.get(xx, yy, 1); n++; }
        S.D[i * 2] += (sx / n - S.D[i * 2]) * ks * w; S.D[i * 2 + 1] += (sy / n - S.D[i * 2 + 1]) * ks * w;
      }, rr);
    }
    if (tool === "freeze" || tool === "thaw") {
      var ww = S.ww, x0 = Math.max(0, Math.floor(c.x - r)), y0 = Math.max(0, Math.floor(c.y - r)), x1 = Math.min(ww - 1, Math.ceil(c.x + r)), y1 = Math.min(S.wh - 1, Math.ceil(c.y + r)), pr = OPT.pressure / 100;
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { var w2 = weight(Math.hypot(x - c.x, y - c.y), r) * pr, q = y * ww + x; S.F[q] = tool === "freeze" ? Math.max(S.F[q], w2) : Math.min(S.F[q], 1 - w2); }
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, mask: true };
    }
    return null;
  }
  VX.liquifyDab = function (tool, c, m, alt) { return dab(tool, c, m || { x: 0, y: 0 }, alt); };
  // re-render the warped preview inside rect (work px)
  function renderRect(rc) {
    var ww = S.ww, wh = S.wh, D = S.D, src = S.src, out = S.out.data, x0 = Math.max(0, rc.x), y0 = Math.max(0, rc.y), x1 = Math.min(ww, rc.x + rc.w), y1 = Math.min(wh, rc.y + rc.h);
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
      var i = y * ww + x, sx = x + D[i * 2], sy = y + D[i * 2 + 1], o = i * 4;
      if (sx === x && sy === y) { out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; out[o + 3] = src[o + 3]; continue; }
      var ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, r = 0, g = 0, b = 0, a = 0;
      for (var j = 0; j < 2; j++) for (var k = 0; k < 2; k++) {
        var xx = Math.max(0, Math.min(ww - 1, ix + k)), yy = Math.max(0, Math.min(wh - 1, iy + j)), w = (k ? fx : 1 - fx) * (j ? fy : 1 - fy), q = (yy * ww + xx) * 4, al = src[q + 3] * w;
        r += src[q] * al; g += src[q + 1] * al; b += src[q + 2] * al; a += al;
      }
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a; } else out[o + 3] = 0;
    }
    PE.cx2(S.wc).putImageData(S.out, 0, 0, x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  }
  VX.liquifyRender = function () { renderRect({ x: 0, y: 0, w: S.ww, h: S.wh }); };

  // ---------- workspace ----------
  var root = null, view = null, vctx = null, sideEl = null, toolsEl = null, raf = 0, ptr = null, cursor = null, hold = 0;
  function build() {
    ED.modal = true;
    view = h("canvas", { "aria-label": "Liquify preview: drag to apply the brush" }); vctx = view.getContext("2d");
    var stage = h("div", { "class": "pe-vws-stage" }, [view]);
    toolsEl = h("div", { "class": "pe-vws-tools", role: "toolbar", "aria-label": "Liquify tools" });
    TOOLS.forEach(function (t) {
      var b = h("button", { type: "button", "class": "pe-tool", "aria-label": t[1], title: t[1] + " (" + t[2] + ")", "aria-pressed": String(OPT.tool === t[0]), "data-t": t[0] }, [ED.ui.w.svg(t[3])]);
      b.addEventListener("click", function () { setTool(t[0]); });
      toolsEl.appendChild(b);
    });
    sideEl = h("div", { "class": "pe-vws-side" });
    var foot = h("div", { "class": "pe-vws-foot" }, [h("span", { "class": "faint", text: "Ctrl+Z undoes the last stroke · [ ] brush size · Space or the hand tool pans · wheel zooms" }), h("span", { "class": "grow" }),
      ED.ui.w.btn("Cancel", function () { close(false); }, "ghost"), ED.ui.w.btn("OK", function () { close(true); }, "primary", "i-check")]);
    root = h("div", { "class": "pe-vws", role: "dialog", "aria-modal": "true", "aria-label": "Liquify" }, [h("div", { "class": "pe-vws-top" }, [h("h2", { text: "Liquify" }), h("span", { "class": "faint", text: S.L.name + " · " + S.W + " × " + S.H + " px" })]),
      h("div", { "class": "pe-vws-body" }, [toolsEl, stage, sideEl]), foot]);
    document.body.appendChild(root);
    buildSide();
    view.addEventListener("pointerdown", pDown); view.addEventListener("pointermove", pMove); view.addEventListener("pointerup", pUp); view.addEventListener("pointercancel", pUp);
    view.addEventListener("pointerleave", function () { cursor = null; draw(); });
    view.addEventListener("wheel", function (e) { e.preventDefault(); var r = view.getBoundingClientRect(); zoomAt(S.z * Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    document.addEventListener("keydown", onKey, true); document.addEventListener("keyup", onKeyUp, true);
    new ResizeObserver(function () { size(); }).observe(stage);
    VX.liquifyRender();
    size(); fit();
  }
  function buildSide() {
    var w = ED.ui.w; sideEl.textContent = "";
    sideEl.appendChild(h("h3", { "class": "pe-p", text: "Brush" }));
    sideEl.appendChild(w.range("Size", OPT.size, 4, 1500, 1, function (v) { OPT.size = v; save(); draw(); }, w.px));
    sideEl.appendChild(w.range("Density", OPT.density, 0, 100, 1, function (v) { OPT.density = v; save(); }));
    sideEl.appendChild(w.range("Pressure", OPT.pressure, 1, 100, 1, function (v) { OPT.pressure = v; save(); }));
    sideEl.appendChild(w.range("Rate", OPT.rate, 1, 100, 1, function (v) { OPT.rate = v; save(); }));
    sideEl.appendChild(h("h3", { "class": "pe-p", text: "Reconstruct" }));
    var base = null;
    sideEl.appendChild(w.range("Reconstruct all", 0, 0, 100, 1, function (v) { if (!base) { pushUndo(); base = new Float32Array(S.D); } for (var i = 0; i < S.D.length; i++) S.D[i] = base[i] * (1 - v / 100); VX.liquifyRender(); draw(); }, function (v) { return v + "%"; }));
    sideEl.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Restore all", function () { pushUndo(); S.D.fill(0); base = null; VX.liquifyRender(); buildSide(); draw(); }, "ghost")]));
    sideEl.appendChild(h("h3", { "class": "pe-p", text: "Mask" }));
    sideEl.appendChild(h("div", { "class": "pe-prow" }, [
      w.btn("Freeze all", function () { pushUndo(); S.F.fill(1); draw(); }, "ghost"), w.btn("Thaw all", function () { pushUndo(); S.F.fill(0); draw(); }, "ghost"),
      w.btn("Invert", function () { pushUndo(); for (var i = 0; i < S.F.length; i++) S.F[i] = 1 - S.F[i]; draw(); }, "ghost")]));
    sideEl.appendChild(h("h3", { "class": "pe-p", text: "View" }));
    sideEl.appendChild(w.check("Show mask", OPT.mask, function (v) { OPT.mask = v; save(); draw(); }));
    sideEl.appendChild(w.check("Show mesh", OPT.mesh, function (v) { OPT.mesh = v; save(); draw(); }));
    sideEl.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Fit", function () { fit(); }, "ghost"), w.btn("100%", function () { zoomAt(1 / S.k * 1, view.clientWidth / 2, view.clientHeight / 2); }, "ghost")]));
  }
  function save() { S3.store("pe-liquify", OPT); }
  function setTool(t) { OPT.tool = t; save(); S3.$$("button", toolsEl).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-t") === t)); }); draw(); }
  var dpr = 1;
  function size() { if (!view) return; dpr = Math.min(2, window.devicePixelRatio || 1); var r = view.parentNode.getBoundingClientRect(); view.width = Math.max(1, Math.round(r.width * dpr)); view.height = Math.max(1, Math.round(r.height * dpr)); draw(); }
  function fit() { var r = view.parentNode.getBoundingClientRect(); S.z = Math.min((r.width - 32) / S.ww, (r.height - 32) / S.wh); S.px = (r.width - S.ww * S.z) / 2; S.py = (r.height - S.wh * S.z) / 2; draw(); }
  function zoomAt(z, sx, sy) { z = PE.clamp(z, 0.05, 40); var wx = (sx - S.px) / S.z, wy = (sy - S.py) / S.z; S.z = z; S.px = sx - wx * z; S.py = sy - wy * z; draw(); }
  function toWork(e) { var r = view.getBoundingClientRect(); return { x: (e.clientX - r.left - S.px) / S.z, y: (e.clientY - r.top - S.py) / S.z, sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0; if (!S || !view) return;
      var c = vctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, view.width, view.height);
      c.setTransform(dpr * S.z, 0, 0, dpr * S.z, dpr * S.px, dpr * S.py);
      c.fillStyle = "#fff"; c.fillRect(0, 0, S.ww, S.wh); c.fillStyle = "#d4d7dc";
      var cs = 12 / S.z * 1; for (var y = 0; y < S.wh; y += cs) for (var x = ((y / cs) % 2) * cs; x < S.ww; x += cs * 2) c.fillRect(x, y, Math.min(cs, S.ww - x), Math.min(cs, S.wh - y));
      c.imageSmoothingEnabled = S.z < 2; c.drawImage(S.wc, 0, 0);
      if (OPT.mask) drawMask(c);
      if (OPT.mesh) drawMesh(c);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (cursor && OPT.tool !== "hand" && OPT.tool !== "zoom") { var r = OPT.size * S.k / 2 * S.z; c.beginPath(); c.arc(cursor.sx, cursor.sy, r, 0, Math.PI * 2); c.strokeStyle = "rgba(0,0,0,.8)"; c.lineWidth = 1.5; c.stroke(); c.beginPath(); c.arc(cursor.sx, cursor.sy, Math.max(0.5, r - 1.5), 0, Math.PI * 2); c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 1; c.stroke(); var ir = r * (1 - OPT.density / 100); if (ir > 2) { c.beginPath(); c.arc(cursor.sx, cursor.sy, ir, 0, Math.PI * 2); c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]); } }
    });
  }
  var maskC = null;
  function drawMask(c) {
    var any = false, F = S.F; for (var i = 0; i < F.length; i += 7) if (F[i] > 0) { any = true; break; }
    if (!any) return;
    if (!maskC || maskC.width !== S.ww) maskC = PE.mk(S.ww, S.wh);
    var mx = PE.cx2(maskC), im = mx.createImageData(S.ww, S.wh), d = im.data;
    for (i = 0; i < F.length; i++) { d[i * 4] = 229; d[i * 4 + 1] = 72; d[i * 4 + 2] = 77; d[i * 4 + 3] = F[i] * 140; }
    mx.putImageData(im, 0, 0); c.drawImage(maskC, 0, 0);
  }
  function drawMesh(c) {
    var step = Math.max(8, Math.round(24 / S.z * 1.5)), o = [0, 0];
    c.lineWidth = 1 / S.z; c.strokeStyle = "rgba(60,130,255,.65)"; c.beginPath();
    for (var y = 0; y <= S.wh; y += step) { for (var x = 0; x <= S.ww; x += step / 2) { sampleD(S.D, x, y, o); if (x) c.lineTo(x - o[0], y - o[1]); else c.moveTo(x - o[0], y - o[1]); } }
    for (x = 0; x <= S.ww; x += step) { for (y = 0; y <= S.wh; y += step / 2) { sampleD(S.D, x, y, o); if (y) c.lineTo(x - o[0], y - o[1]); else c.moveTo(x - o[0], y - o[1]); } }
    c.stroke();
  }
  function pushUndo() { S.undo.push({ D: new Float32Array(S.D), F: new Float32Array(S.F) }); if (S.undo.length > 8) S.undo.shift(); }
  var space = false;
  function pDown(e) {
    try { view.setPointerCapture(e.pointerId); } catch (x) {}
    var p = toWork(e); cursor = p;
    var t = space || e.button === 1 ? "hand" : OPT.tool;
    if (t === "hand") { ptr = { pan: true, sx: p.sx, sy: p.sy, px: S.px, py: S.py }; return; }
    if (t === "zoom") { zoomAt(S.z * (e.altKey ? 1 / 1.5 : 1.5), p.sx, p.sy); return; }
    pushUndo();
    ptr = { last: p, alt: e.altKey, t: t };
    stroke(p, { x: 0, y: 0 });
    if (["twirl", "pucker", "bloat", "recon", "smooth", "freeze", "thaw"].indexOf(t) >= 0) { clearInterval(hold); hold = setInterval(function () { if (ptr && !ptr.pan) stroke(ptr.last, { x: 0, y: 0 }); }, 33); }
  }
  function stroke(p, m) {
    var t = ptr.t, rc = null, r = OPT.size * S.k / 2;
    if (t === "warp" || t === "push") {
      var len = Math.hypot(m.x, m.y), n = Math.max(1, Math.ceil(len / Math.max(1, r * 0.15))), sx = m.x / n, sy = m.y / n, c = { x: p.x - m.x, y: p.y - m.y };
      for (var i = 0; i < n; i++) { c = { x: c.x + sx, y: c.y + sy }; var q = dab(t, c, { x: sx, y: sy }, ptr.alt); rc = q && rc ? PE.union(rc, q) : q || rc; }
    } else rc = dab(t, p, m, ptr.alt);
    if (rc && !rc.mask) renderRect({ x: rc.x - 2, y: rc.y - 2, w: rc.w + 4, h: rc.h + 4 });
    draw();
  }
  function pMove(e) {
    var p = toWork(e); cursor = p;
    if (!ptr) { draw(); return; }
    if (ptr.pan) { S.px = ptr.px + p.sx - ptr.sx; S.py = ptr.py + p.sy - ptr.sy; draw(); return; }
    var m = { x: p.x - ptr.last.x, y: p.y - ptr.last.y };
    if (ptr.t === "warp" || ptr.t === "push") { if (Math.hypot(m.x, m.y) < 0.5) return; stroke(p, m); }
    ptr.last = p; draw();
  }
  function pUp() { clearInterval(hold); ptr = null; }
  function onKey(e) {
    if (!S) return;
    e.stopPropagation();
    var k = e.key, c = e.ctrlKey || e.metaKey;
    if (k === "Escape") { e.preventDefault(); close(false); return; }
    if (k === "Enter") { e.preventDefault(); close(true); return; }
    if (c && k.toLowerCase() === "z") { e.preventDefault(); var u = S.undo.pop(); if (u) { S.D = u.D; S.F = u.F; VX.liquifyRender(); draw(); } return; }
    if (e.code === "Space") { space = true; e.preventDefault(); return; }
    if (k === "[" || k === "]") { e.preventDefault(); OPT.size = PE.clamp(Math.round(OPT.size * (k === "]" ? 1.15 : 1 / 1.15)), 4, 1500); save(); buildSide(); draw(); return; }
    if (c || e.altKey || e.target.tagName === "INPUT") return;
    var t = TOOLS.filter(function (x) { return x[2].toLowerCase() === k.toLowerCase(); })[0];
    if (t) { e.preventDefault(); setTool(t[0]); }
  }
  function onKeyUp(e) { if (e.code === "Space") space = false; }
  function close(ok) {
    if (!S) return;
    var s = S; S = null; clearInterval(hold);
    document.removeEventListener("keydown", onKey, true); document.removeEventListener("keyup", onKeyUp, true);
    root.remove(); root = view = null; ED.modal = false;
    if (ED.stage) ED.stage.focus({ preventScroll: true });
    if (!ok) return;
    var moved = false; for (var i = 0; i < s.D.length; i++) if (s.D[i] !== 0) { moved = true; break; }
    if (!moved) return;
    var img = PE.getData(s.L.canvas);
    ED.working(VX.work("liquifyApply", [{ data: img.data, width: img.width, height: img.height }, s.D, s.ww, s.wh, s.k]), "Liquify…").then(function (res) {
      var cv = VX.toCanvas(res);
      ED.meta("Liquify", function () { s.L.canvas = cv; });
    }).catch(function (e) { S3.toast(e.message, "error"); });
  }
  VX.closeLiquify = close;
  VX.liquifySession = function () { return S; };

  UI.menu("Filter", ["-", ["Liquify…", "Ctrl+Shift+X", function () { if (ED.ui.w.need()) VX.openLiquify(); }, function () { return !!ED.doc; }]]);
  UI.keys.push(function (e) { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "x") { if (ED.ui.w.need()) VX.openLiquify(); return true; } return false; });
})();
