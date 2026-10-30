/* Photo Editor: state, canvas view, tools and the editing actions. Panels, menus and dialogs are in ui.js. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, $ = S3.$;
  var ED = PE.ed = {
    doc: null, hist: null, tool: "brush", zoom: 1, panX: 0, panY: 0, maskEdit: false, modal: false,
    live: { over: {}, maskOver: {}, hide: null }, clip: null, cloneSrc: null, cloneOff: null, xf: null, crop: null, poly: null,
    hooks: { changed: [], layers: [], tool: [], history: [], view: [] }
  };
  var DEF = {
    brush: { size: 30, hard: 0.8, op: 1 }, eraser: { size: 40, hard: 0.8, op: 1 }, clone: { size: 40, hard: 0.6, op: 1, aligned: true },
    heal: { size: 30, hard: 0.5, op: 1, aligned: true }, sel: { mode: "new", feather: 0, ratio: "free" }, wand: { tol: 32, contig: true, all: false },
    bucket: { tol: 32, contig: true, all: false, op: 1 }, gradient: { type: "linear", trans: false, rev: false, op: 1 }, crop: { ratio: "free", trim: true },
    text: { font: "Inter", size: 72, weight: 700, italic: false, align: "left", dir: "auto" }, shape: { type: "rect", fill: "#3dd6d0", noFill: false, stroke: "#111111", sw: 0, radius: 0 },
    move: { auto: false }, eye: { all: true }
  };
  ED.o = (function () { var s = S3.store("pe-opts") || {}, o = {}; Object.keys(DEF).forEach(function (k) { o[k] = Object.assign({}, DEF[k], s[k] && typeof s[k] === "object" ? s[k] : {}); }); return o; })();
  ED.saveOpts = S3.debounce(function () { S3.store("pe-opts", ED.o); }, 300);
  function emit(n, a) { (ED.hooks[n] || []).forEach(function (f) { try { f(a); } catch (e) { console.error(e); } }); }
  ED.on = function (n, f) { (ED.hooks[n] = ED.hooks[n] || []).push(f); };
  ED.emit = emit;

  // ---------- stage ----------
  var stage, view, ovl, vctx, octx, comp, cctx, ta, dpr = 1, raf = 0, oraf = 0;
  function sizeCanvases() {
    var r = stage.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    [view, ovl].forEach(function (c) { c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); c.style.width = r.width + "px"; c.style.height = r.height + "px"; });
    comp.width = view.width; comp.height = view.height;
    render(); renderOvl();
  }
  function stageSize() { var r = stage.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  ED.fit = function (allowUp) {
    if (!ED.doc) return;
    var s = stageSize(), z = Math.min((s.w - 48) / ED.doc.w, (s.h - 48) / ED.doc.h);
    if (!allowUp) z = Math.min(1, z);
    ED.zoom = Math.max(0.01, z); ED.panX = (s.w - ED.doc.w * ED.zoom) / 2; ED.panY = (s.h - ED.doc.h * ED.zoom) / 2;
    ED.fitted = { up: !!allowUp };
    render(); renderOvl(); emit("view");
  };
  ED.zoomAt = function (z, sx, sy) {
    if (!ED.doc) return;
    var s = stageSize(); if (sx == null) { sx = s.w / 2; sy = s.h / 2; }
    z = PE.clamp(z, 0.02, 32);
    var px = (sx - ED.panX) / ED.zoom, py = (sy - ED.panY) / ED.zoom;
    ED.zoom = z; ED.panX = sx - px * z; ED.panY = sy - py * z; ED.fitted = null;
    render(); renderOvl(); emit("view");
  };
  ED.zoomStep = function (dir, sx, sy) {
    var steps = [0.02, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32], z = ED.zoom, i;
    if (dir > 0) { for (i = 0; i < steps.length && steps[i] <= z * 1.01; i++); z = steps[Math.min(i, steps.length - 1)]; }
    else { for (i = steps.length - 1; i >= 0 && steps[i] >= z * 0.99; i--); z = steps[Math.max(i, 0)]; }
    ED.zoomAt(z, sx, sy);
  };
  function toDoc(sx, sy) { return { x: (sx - ED.panX) / ED.zoom, y: (sy - ED.panY) / ED.zoom }; }
  function toScr(x, y) { return { x: x * ED.zoom + ED.panX, y: y * ED.zoom + ED.panY }; }
  ED.toDoc = toDoc; ED.toScr = toScr;
  var checker = null;
  function checkerPat(c) {
    if (!checker) { var k = PE.mk(16, 16), x = PE.cx2(k); x.fillStyle = "#ffffff"; x.fillRect(0, 0, 16, 16); x.fillStyle = "#d4d7dc"; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8); checker = k; }
    return c.createPattern(checker, "repeat");
  }
  function render() { if (!raf) raf = requestAnimationFrame(paint); }
  ED.render = render;
  function paint() {
    raf = 0;
    var c = vctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, view.width, view.height);
    var d = ED.doc; if (!d) return;
    var x0 = ED.panX * dpr, y0 = ED.panY * dpr, W = d.w * ED.zoom * dpr, H = d.h * ED.zoom * dpr;
    c.save(); c.fillStyle = checkerPat(c); c.translate(Math.round(x0), Math.round(y0)); c.fillRect(0, 0, Math.round(W), Math.round(H)); c.restore();
    cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, comp.width, comp.height);
    var k = ED.zoom * dpr;
    cctx.setTransform(k, 0, 0, k, x0, y0);
    cctx.imageSmoothingEnabled = ED.zoom < 2; cctx.imageSmoothingQuality = ED.zoom < 0.5 ? "medium" : "low";
    cctx.save(); cctx.beginPath(); cctx.rect(0, 0, d.w, d.h); cctx.clip();
    PE.drawLayers(cctx, d, ED.live);
    cctx.restore();
    c.drawImage(comp, 0, 0);
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 1; c.strokeRect(Math.round(x0) - 0.5, Math.round(y0) - 0.5, Math.round(W) + 1, Math.round(H) + 1);
  }

  // ---------- overlay: selection ants, transform/crop boxes, tool previews, brush cursor ----------
  var antsT = 0, antOff = 0, cursorPt = null;
  function renderOvl() { if (!oraf) oraf = requestAnimationFrame(paintOvl); }
  ED.renderOvl = renderOvl;
  function docPath(c, fn) { c.save(); c.setTransform(dpr * ED.zoom, 0, 0, dpr * ED.zoom, dpr * ED.panX, dpr * ED.panY); fn(c, 1 / ED.zoom); c.restore(); }
  function ants(c, path, px) {
    c.lineWidth = px; c.setLineDash([4 * px, 4 * px]);
    c.strokeStyle = "#000"; c.lineDashOffset = -antOff * px; c.stroke(path);
    c.strokeStyle = "#fff"; c.lineDashOffset = -antOff * px + 4 * px; c.stroke(path);
    c.setLineDash([]);
  }
  function paintOvl() {
    oraf = 0;
    var c = octx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ovl.width, ovl.height);
    var d = ED.doc; if (!d) return;
    if (d.sel && !ED.xf) docPath(c, function (c, px) { ants(c, PE.selOutline(d.sel), px); });
    var dr = ED.drag;
    if (dr && dr.kind === "marquee" && dr.rect) docPath(c, function (c, px) {
      var p = new Path2D(), r = dr.rect;
      if (dr.ellipse) p.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2); else p.rect(r.x, r.y, r.w, r.h);
      ants(c, p, px);
    });
    if (dr && dr.kind === "lasso" && dr.pts.length > 1) docPath(c, function (c, px) { var p = new Path2D(); dr.pts.forEach(function (q, i) { if (i) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y); }); ants(c, p, px); });
    if (ED.poly && ED.poly.pts.length) docPath(c, function (c, px) {
      var p = new Path2D(), P = ED.poly.pts; P.forEach(function (q, i) { if (i) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y); });
      if (ED.poly.hover) p.lineTo(ED.poly.hover.x, ED.poly.hover.y);
      ants(c, p, px);
      c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.lineWidth = px; c.beginPath(); c.arc(P[0].x, P[0].y, 4 * px, 0, Math.PI * 2); c.fill(); c.stroke();
    });
    if (dr && dr.kind === "gradient" && dr.b) docPath(c, function (c, px) {
      c.lineWidth = 2 * px; c.strokeStyle = "#fff"; c.beginPath(); c.moveTo(dr.a.x, dr.a.y); c.lineTo(dr.b.x, dr.b.y); c.stroke();
      c.lineWidth = px; c.strokeStyle = "#000"; c.stroke();
      [dr.a, dr.b].forEach(function (q) { c.beginPath(); c.arc(q.x, q.y, 4 * px, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill(); c.stroke(); });
    });
    if (ED.crop) paintCrop(c);
    if (ED.xf) paintXf(c);
    emit("overlay", { c: c, docPath: docPath, dpr: dpr });   // lane:selection (lanes draw previews on the overlay)
    if (ED.cloneSrc && (ED.tool === "clone" || ED.tool === "heal")) {
      var sp = ED.cloneSrc, cur = ED.stroke && ED.stroke.off && cursorPt ? toDoc(cursorPt.x, cursorPt.y) : null;
      if (cur) sp = { x: cur.x + ED.stroke.off.x, y: cur.y + ED.stroke.off.y };
      var s = toScr(sp.x, sp.y); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.strokeStyle = "#fff"; c.lineWidth = 3; cross(c, s.x, s.y); c.strokeStyle = "#000"; c.lineWidth = 1; cross(c, s.x, s.y);
    }
    if (cursorPt && brushTool() && !ED.modal) {
      var o = ED.o[ED.tool], r = Math.max(1, o.size * ED.zoom / 2);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.beginPath(); c.arc(cursorPt.x, cursorPt.y, r, 0, Math.PI * 2); c.strokeStyle = "rgba(0,0,0,.8)"; c.lineWidth = 1.5; c.stroke();
      c.beginPath(); c.arc(cursorPt.x, cursorPt.y, Math.max(0.5, r - 1.5), 0, Math.PI * 2); c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 1; c.stroke();
    }
    (ED.ovlHooks || []).forEach(function (f) { try { f(c, docPath, cursorPt, dpr); } catch (e) { console.error(e); } }); // lane:paint
  }
  function cross(c, x, y) { c.beginPath(); c.moveTo(x - 8, y); c.lineTo(x + 8, y); c.moveTo(x, y - 8); c.lineTo(x, y + 8); c.stroke(); }
  function brushTool() { return ["brush", "eraser", "clone", "heal"].indexOf(ED.tool) >= 0 || !!(TOOLS[ED.tool] && TOOLS[ED.tool].brush); }   // lane:selection (.brush tools)
  setInterval(function () { if (ED.doc && (ED.doc.sel || ED.drag || ED.poly) && !document.hidden) { antOff = (antOff + 1) % 8; renderOvl(); } }, 140);

  // ---------- history plumbing ----------
  ED.push = function (e) { if (!e) return; ED.hist.push(e); changed(); };
  ED.meta = function (label, fn) {     // snapshot, mutate, record
    var before = PE.snap(ED.doc), r = fn();
    ED.push(PE.metaEntry(label, ED.doc, before));
    return r;
  };
  function changed(soft) { clearLive(); render(); renderOvl(); emit("changed", soft); }
  ED.changed = changed;
  ED.undo = function () { if (busyCheck()) return; cancelModes(); if (ED.hist.undo()) changed(); };
  ED.redo = function () { if (busyCheck()) return; cancelModes(); if (ED.hist.redo()) changed(); };
  ED.jump = function (n) { if (busyCheck()) return; cancelModes(); ED.hist.jump(n); changed(); };
  function clearLive() { ED.live.over = {}; ED.live.maskOver = {}; ED.live.hide = ED.textL ? ED.textL.id : null; }
  ED.busy = 0;
  function busyCheck() { if (ED.busy) { S3.toast("Still working on the last step…"); return true; } return false; }
  ED.busyCheck = busyCheck;
  ED.working = function (p, msg) {
    ED.busy++; emit("view", msg || "Working…");
    return Promise.resolve(p).then(function (v) { ED.busy--; emit("view"); return v; }, function (e) { ED.busy--; emit("view"); throw e; });
  };

  // ---------- documents ----------
  ED.openDoc = function (doc, label) {
    cancelModes();
    ED.doc = doc; ED.maskEdit = false; ED.cloneSrc = null; ED.cloneOff = null;
    ED.hist = new PE.History(PE.historyBudget(), 60); ED.hist.base = label || "Open";
    if (!doc.active && doc.layers.length) doc.active = doc.layers[doc.layers.length - 1].id;
    clearLive(); ED.fit(); emit("layers"); emit("changed", "open");
  };
  ED.newBlank = function (w, h, bg, name) {
    var d = PE.newDoc(w, h, name || "Untitled"), c = PE.mk(d.w, d.h);
    if (bg && bg !== "transparent") { var x = PE.cx2(c); x.fillStyle = bg; x.fillRect(0, 0, d.w, d.h); }
    var L = PE.rasterFromCanvas(PE.touch(c), bg && bg !== "transparent" ? "Background" : "Layer 1");
    d.layers = [L]; d.active = L.id; ED.openDoc(d, "New document");
  };
  ED.openImageDoc = function (img, name) {
    var d = PE.newDoc(img.w, img.h, String(name || "Image").replace(/\.[^.]+$/, "").slice(0, 100) || "Image");
    var L = PE.rasterFromCanvas(img.canvas, "Background"); d.layers = [L]; d.active = L.id; ED.openDoc(d, "Open");
    if (img.scaled) S3.toast("Scaled down from " + img.ow + " × " + img.oh + " to " + img.w + " × " + img.h + " (limit " + PE.LIM.side + " px a side, " + Math.round(PE.LIM.px / 1e6) + " MP)");
  };
  ED.layer = function () { return ED.doc ? PE.activeLayer(ED.doc) : null; };
  ED.setActive = function (id, mask) { ED.doc.active = id; var L = ED.layer(); ED.maskEdit = !!(mask && L && L.mask); emit("layers"); emit("tool"); renderOvl(); };
  function docRect() { return { x: 0, y: 0, w: ED.doc.w, h: ED.doc.h }; }
  ED.docRect = docRect;
  ED.addLayer = function (L, label, above) {
    return ED.meta(label || "New layer", function () {
      var d = ED.doc, i = d.layers.indexOf(above || ED.layer());
      d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, L); d.active = L.id; ED.maskEdit = false; emit("layers"); return L;
    });
  };
  ED.newRasterLayer = function () {
    var n = ED.doc.layers.filter(function (l) { return /^Layer \d+$/.test(l.name); }).length + 1;
    return ED.addLayer(PE.rasterFromCanvas(PE.touch(PE.mk(ED.doc.w, ED.doc.h)), "Layer " + (n + 1)), "New layer");
  };
  ED.placeImage = function (img, name) {
    var d = ED.doc, k = Math.min(1, d.w / img.w, d.h / img.h), c = img.canvas;
    if (k < 1) { var n = PE.mk(img.w * k, img.h * k), x = PE.cx2(n); x.imageSmoothingQuality = "high"; x.drawImage(img.canvas, 0, 0, n.width, n.height); c = PE.touch(n); }
    var L = PE.rasterFromCanvas(c, String(name || "Image").replace(/\.[^.]+$/, "").slice(0, 100) || "Image", Math.round((d.w - c.width) / 2), Math.round((d.h - c.height) / 2));
    ED.addLayer(L, "Place image");
    if (k < 1) S3.toast("Placed and scaled to fit the canvas (" + c.width + " × " + c.height + ")");
  };
  ED.rasterize = function (L, silent) {
    if (!L || L.kind === "raster") return L;
    var s = PE.surface(L, ED.doc);
    ED.meta("Rasterize layer", function () { L.canvas = PE.touch(PE.cloneCanvas(s.canvas)); L.x = s.x; L.y = s.y; L.kind = "raster"; L.text = null; L.shape = null; });
    if (!silent) S3.toast("Layer rasterized so it can be painted (Ctrl+Z undoes)");
    emit("layers");
    return L;
  };
  function editable(L, need) {
    if (!L) { S3.toast("Add a layer first", "error"); return false; }
    if (L.locked) { S3.toast("“" + L.name + "” is locked. Unlock it in the Layers panel.", "error"); return false; }
    if (!L.visible) { S3.toast("“" + L.name + "” is hidden. Show it to edit it.", "error"); return false; }
    if (PE.editableExt && !PE.editableExt(L, need)) return false;   // lane:selection (groups, adjustment layers)
    if (need === "pixels" && L.kind !== "raster" && !ED.maskEdit) ED.rasterize(L);
    return true;
  }
  ED.editable = editable;

  // ---------- pointer input ----------
  var pointers = {}, pinch = null, space = false;
  function local(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onDown(e) {
    if (!ED.doc || ED.modal) return;
    if (ED.textL && e.target === ta) return;
    if (ED.textL) finishText();
    stage.focus({ preventScroll: true });
    pointers[e.pointerId] = local(e);
    var ids = Object.keys(pointers);
    if (ids.length === 2) {          // second finger: cancel the stroke and pinch-zoom instead
      cancelDrag();
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: ED.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, px: ED.panX, py: ED.panY };
      return;
    }
    if (ids.length > 2) return;
    try { stage.setPointerCapture(e.pointerId); } catch (x) {}
    var s = local(e), p = toDoc(s.x, s.y);
    if (e.button === 1 || space || ED.tool === "hand") { ED.drag = { kind: "pan", sx: s.x, sy: s.y, px: ED.panX, py: ED.panY }; return; }
    if (e.button === 2) return;
    var T = TOOLS[ED.tool];
    if (T && T.down) T.down(p, e, s);
  }
  function onMove(e) {
    var s = local(e);
    if (pointers[e.pointerId]) pointers[e.pointerId] = s;
    cursorPt = e.pointerType === "touch" ? null : s;
    if (pinch) {
      var ids = Object.keys(pointers); if (ids.length < 2) return;
      var a = pointers[ids[0]], b = pointers[ids[1]], dd = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var z = PE.clamp(pinch.z * dd / Math.max(1, pinch.d), 0.02, 32), px = (pinch.mx - pinch.px) / pinch.z, py = (pinch.my - pinch.py) / pinch.z;
      ED.zoom = z; ED.panX = mx - px * z; ED.panY = my - py * z; render(); renderOvl(); emit("view"); return;
    }
    var p = toDoc(s.x, s.y);
    emit("view", { x: p.x, y: p.y });
    var dr = ED.drag;
    if (dr && dr.kind === "pan") { ED.fitted = null; ED.panX = dr.px + s.x - dr.sx; ED.panY = dr.py + s.y - dr.sy; render(); renderOvl(); return; }
    var T = TOOLS[ED.tool];
    if (dr && T && T.move) { var ev = e.getCoalescedEvents ? e.getCoalescedEvents() : null; if (ev && ev.length > 1 && dr.kind === "stroke") ev.forEach(function (q) { var l = local(q); T.move(toDoc(l.x, l.y), q); }); else T.move(p, e); }
    else if (T && T.hover) T.hover(p, e);
    stage.style.cursor = cursorFor(p);
    renderOvl();
  }
  function onUp(e) {
    delete pointers[e.pointerId];
    if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; return; }
    var dr = ED.drag;
    if (!dr) return;
    if (dr.kind === "pan") { ED.drag = null; return; }
    var T = TOOLS[ED.tool], s = local(e);
    if (T && T.up) T.up(toDoc(s.x, s.y), e);
    renderOvl();
  }
  function cancelDrag() {
    var dr = ED.drag; ED.drag = null;
    if (dr && dr.kind === "stroke") { ED.stroke = null; clearLive(); render(); }
    if (dr && dr.cancel) dr.cancel();
    renderOvl();
  }
  ED.cancelDrag = cancelDrag;
  function cursorFor(p) {
    if (ED.cursorHook) { var hc = ED.cursorHook(p); if (hc) return hc; } // lane:paint
    if (space || ED.tool === "hand") return ED.drag && ED.drag.kind === "pan" ? "grabbing" : "grab";
    if (ED.xf) { var h = xfHit(p); return h ? (h === "move" ? "move" : h === "rot" ? "alias" : "nwse-resize") : "default"; }
    if (ED.crop) { var ch = cropHit(p); return ch ? (ch === "move" ? "move" : "crosshair") : "crosshair"; }
    if (TOOLS[ED.tool] && TOOLS[ED.tool].cursor) return TOOLS[ED.tool].cursor(p);   // lane:vector
    if (brushTool()) return "none";
    return { move: "move", zoom: "zoom-in", text: "text", eyedropper: "crosshair", bucket: "crosshair" }[ED.tool] || "crosshair";
  }

  // ---------- painting (brush, eraser, clone, heal) ----------
  function tipFill(c, x, y, r, hard, color) {
    var h = PE.clamp(hard, 0, 1), rgb = PE.rgbOf(color);
    if (h >= 0.99 || r < 1.2) { c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); c.fill(); return; }
    var g = c.createRadialGradient(x, y, r * h, x, y, r), col = "rgba(" + rgb.join(",") + ",";
    g.addColorStop(0, col + "1)"); g.addColorStop(0.5, col + "0.5)"); g.addColorStop(1, col + "0)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  ED.tipFill = tipFill;
  var dabC = null;
  function strokeStart(p, e) {
    var L = ED.layer(), tool = ED.tool, o = ED.o[tool];
    if (tool === "brush" && e.altKey) { pick(p, false); return; }
    if (!editable(L, "pixels")) return;
    if (ED.maskEdit && !L.mask) ED.maskEdit = false;
    if ((tool === "clone" || tool === "heal") && (e.altKey || !ED.cloneSrc)) {
      if (e.altKey) { ED.cloneSrc = { x: p.x, y: p.y }; ED.cloneOff = null; S3.toast("Source set. Now paint where you want to copy it."); renderOvl(); }
      else S3.toast("Alt+click (or long-press with Alt on) a clean area first to set the source", "error");
      return;
    }
    var mask = ED.maskEdit, before = PE.snap(ED.doc);
    var grew = mask ? PE.ensureMaskCovers(L, docRect()) : PE.ensureCovers(L, docRect());
    var holder = mask ? L.mask : L, cv = holder.canvas;
    var st = ED.stroke = { L: L, mask: mask, holder: holder, tool: tool, o: Object.assign({}, o), ox: holder.x, oy: holder.y, buf: PE.mk(cv.width, cv.height), bbox: null,
      grow: grew ? PE.metaEntry("Grow", ED.doc, before) : null, last: null, live: PE.mk(cv.width, cv.height) };
    st.bctx = PE.cx2(st.buf);
    if (tool === "clone" || tool === "heal") {
      st.snap = PE.cloneCanvas(cv);
      if (!o.aligned || !ED.cloneOff) ED.cloneOff = { x: ED.cloneSrc.x - p.x, y: ED.cloneSrc.y - p.y };
      st.off = ED.cloneOff;
    }
    var lum = PE.rgbOf(ED.doc.fg); st.reveal = mask && (lum[0] * 0.299 + lum[1] * 0.587 + lum[2] * 0.114) >= 128;
    st.color = mask ? "#ffffff" : ED.doc.fg;
    if (e.shiftKey && ED.lastPt && ED.lastPt.L === L) { st.last = ED.lastPt; dabLine(st.last, p); }
    else dabLine(null, p);
    ED.drag = { kind: "stroke" };
    preview();
  }
  function dabAt(st, x, y) {
    var lx = x - st.ox, ly = y - st.oy, r = Math.max(0.5, st.o.size / 2), c = st.bctx;
    if (st.tool === "clone" || st.tool === "heal") {
      var d = Math.ceil(r * 2) + 2;
      if (!dabC || dabC.width < d) dabC = PE.mk(d, d);
      var dc = PE.cx2(dabC), sx = lx + st.off.x - r, sy = ly + st.off.y - r;
      dc.globalCompositeOperation = "copy"; dc.drawImage(st.snap, -sx, -sy);
      dc.globalCompositeOperation = "destination-in"; tipFill(dc, r, r, r, st.o.hard, "#000000"); dc.globalCompositeOperation = "source-over";
      c.drawImage(dabC, 0, 0, d, d, lx - r, ly - r, d, d);
    } else tipFill(c, lx, ly, r, st.o.hard, st.color);
    var b = { x: lx - r - 1, y: ly - r - 1, w: 2 * r + 2, h: 2 * r + 2 };
    if (ED.doc.sel) {      // keep paint inside the selection
      c.save(); c.beginPath(); c.rect(b.x, b.y, b.w, b.h); c.clip(); c.globalCompositeOperation = "destination-in";
      c.drawImage(PE.selCanvas(ED.doc.sel), -st.ox, -st.oy); c.restore();
    }
    st.bbox = PE.union(st.bbox, b);
  }
  function dabLine(a, b) {
    var st = ED.stroke; if (!st) return;
    if (!a) { dabAt(st, b.x, b.y); st.last = b; return; }
    var dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), step = Math.max(1, st.o.size * 0.12);
    if (dist < step) return;
    var n = Math.floor(dist / step);
    for (var i = 1; i <= n; i++) dabAt(st, a.x + dx * i * step / dist, a.y + dy * i * step / dist);
    st.last = { x: a.x + dx * n * step / dist, y: a.y + dy * n * step / dist };
  }
  function applyStroke(c, st) {
    c.save(); c.globalAlpha = PE.clamp(st.o.op, 0, 1);
    c.globalCompositeOperation = st.tool === "eraser" || (st.mask && !st.reveal) ? "destination-out" : "source-over";
    if (st.L.lockA && !st.mask && st.tool !== "eraser") c.globalCompositeOperation = "source-atop";   // lane:selection (lock transparent pixels)
    c.drawImage(st.buf, 0, 0); c.restore();
  }
  var pvRaf = 0;
  function preview() {
    if (pvRaf) return;
    pvRaf = requestAnimationFrame(function () {
      pvRaf = 0; var st = ED.stroke; if (!st) return;
      var lc = PE.cx2(st.live); lc.globalCompositeOperation = "copy"; lc.drawImage(st.holder.canvas, 0, 0); lc.globalCompositeOperation = "source-over";
      applyStroke(lc, st); PE.touch(st.live);
      var o = { canvas: st.live, x: st.ox, y: st.oy };
      if (st.mask) ED.live.maskOver[st.L.id] = o; else ED.live.over[st.L.id] = o;
      render();
    });
  }
  function strokeMove(p) { var st = ED.stroke; if (!st) return; dabLine(st.last, p); preview(); }
  function strokeEnd() {
    var st = ED.stroke; ED.drag = null; if (!st) return;
    ED.lastPt = { x: st.last.x, y: st.last.y, L: st.L };
    var label = { brush: "Brush", eraser: "Eraser", clone: "Clone stamp", heal: "Healing brush" }[st.tool] + (st.mask ? " (mask)" : "");
    if (!st.bbox) { ED.stroke = null; ED.push(st.grow); changed(); return; }
    var bb = PE.inter(PE.rectI(st.bbox), { x: 0, y: 0, w: st.buf.width, h: st.buf.height });
    if (!bb) { ED.stroke = null; ED.push(st.grow); changed(); return; }
    if (st.tool !== "heal") {
      var e1 = PE.editPixels(ED.doc, label, st.holder, "canvas", bb, function (c) { applyStroke(c, st); });
      ED.stroke = null; ED.push(PE.compound(label, [st.grow, e1])); return;
    }
    // healing: texture from the source, colour/brightness matched to the surroundings (worker)
    var pad = 6, R = PE.inter({ x: bb.x - pad, y: bb.y - pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad }, { x: 0, y: 0, w: st.buf.width, h: st.buf.height });
    var cv = st.holder.canvas, dst = PE.getData(cv, R), srcC = PE.mk(R.w, R.h);
    PE.cx2(srcC).drawImage(st.snap, -(R.x + st.off.x), -(R.y + st.off.y));
    var src = PE.getData(srcC), md = PE.getData(st.buf, R).data, m = new Uint8Array(R.w * R.h), op = PE.clamp(st.o.op, 0, 1);
    for (var i = 0; i < m.length; i++) m[i] = Math.round(md[i * 4 + 3] * op);
    ED.working(PE.work("heal", [{ data: dst.data, width: R.w, height: R.h }, { data: src.data, width: R.w, height: R.h }, m]), "Healing…").then(function (res) {
      var e2 = PE.editPixels(ED.doc, label, st.holder, "canvas", R, function (c) { c.putImageData(new ImageData(new Uint8ClampedArray(res.data), R.w, R.h), R.x, R.y); });
      ED.stroke = null; ED.push(PE.compound(label, [st.grow, e2]));
    }).catch(function (err) { ED.stroke = null; changed(); S3.toast(err.message, "error"); });
  }

  // ---------- selection tools ----------
  function selMode(e) {
    if (e.shiftKey && e.altKey) return "intersect";
    if (e.shiftKey) return "add";
    if (e.altKey) return "subtract";
    return ED.o.sel.mode;
  }
  ED.setSelection = function (m, mode, label, feather) {
    var d = ED.doc;
    if (feather > 0) m = PIX.feather(m, d.w, d.h, feather);
    var next = PE.makeSel(d, PIX.combine(d.sel ? d.sel.m : null, m, d.sel ? mode : "new"));
    ED.meta(label || "Selection", function () { d.sel = next; });
  };
  ED.deselect = function () { if (ED.doc && ED.doc.sel) ED.meta("Deselect", function () { ED.doc.sel = null; }); };
  ED.selectAll = function () { var d = ED.doc; ED.meta("Select all", function () { d.sel = PE.makeSel(d, PIX.rectMask(d.w, d.h, 0, 0, d.w, d.h)); }); };
  ED.invertSel = function () { var d = ED.doc; if (!d.sel) { ED.selectAll(); return; } ED.meta("Inverse", function () { d.sel = PE.makeSel(d, PIX.invertMask(d.sel.m)); }); };
  ED.modifySel = function (how, r) {
    var d = ED.doc; if (!d.sel) { S3.toast("Make a selection first", "error"); return; }
    var job = how === "feather" ? PE.work("feather", [d.sel.m, d.w, d.h, r]) : PE.work("grow", [d.sel.m, d.w, d.h, how === "expand" ? r : -r]);
    ED.working(job).then(function (m) {
      var s = PE.makeSel(d, m);
      if (s && how === "feather") { var any = false; for (var i = 0; i < m.length; i++) if (m[i] >= 128) { any = true; break; } if (!any) S3.toast("No pixel is more than 50% selected: the edges will not show, but the selection is still there"); }
      ED.meta({ feather: "Feather", expand: "Expand selection", contract: "Contract selection" }[how], function () { d.sel = s; });
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  ED.selFromLayer = function (L) {
    var d = ED.doc, s = PE.surface(L, d), m = new Uint8Array(d.w * d.h), r = PE.inter({ x: s.x, y: s.y, w: s.canvas.width, h: s.canvas.height }, docRect());
    if (r) {
      var img = PE.flatten(d, { only: [L.id], rect: r }), px = PE.getData(img).data;
      for (var y = 0; y < r.h; y++) for (var x = 0; x < r.w; x++) m[(y + r.y) * d.w + x + r.x] = px[(y * r.w + x) * 4 + 3];
    }
    ED.setSelection(m, "new", "Select layer pixels");
  };
  function constrainRatio(a, p, ratio, e) {
    var dx = p.x - a.x, dy = p.y - a.y, k = ratio === "1:1" || e.shiftKey ? 1 : ratio && ratio !== "free" ? ratioNum(ratio) : 0;
    if (k) { var w = Math.max(Math.abs(dx), Math.abs(dy) * k), h = w / k; dx = Math.sign(dx || 1) * w; dy = Math.sign(dy || 1) * h; }
    if (e.altKey && ED.drag && ED.drag.center) return { x: a.x - dx, y: a.y - dy, w: 2 * dx, h: 2 * dy };
    return norm({ x: a.x, y: a.y, w: dx, h: dy });
  }
  function ratioNum(r) { if (r === "orig") return ED.doc.w / ED.doc.h; var m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r); return m ? +m[1] / +m[2] : 0; }
  ED.ratioNum = ratioNum;
  function norm(r) { return { x: r.w < 0 ? r.x + r.w : r.x, y: r.h < 0 ? r.y + r.h : r.y, w: Math.abs(r.w), h: Math.abs(r.h) }; }
  function marqueeMask(r, ellipse, doc) {
    var d = doc || ED.doc;
    if (!ellipse) return PIX.rectMask(d.w, d.h, r.x, r.y, r.w, r.h);
    return PE.pathMask(d, r, function (c) { c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); });
  }
  ED.marqueeMask = marqueeMask;
  function polyMask(pts) {
    var b = PE.aabbOf(pts);
    return PE.pathMask(ED.doc, b, function (c) { c.beginPath(); pts.forEach(function (q, i) { if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.closePath(); });
  }
  ED.polyMask = polyMask;
  function closePoly() {
    var P = ED.poly; ED.poly = null;
    if (P && P.pts.length >= 3) ED.setSelection(polyMask(P.pts), P.mode, "Polygonal lasso", ED.o.sel.feather);
    renderOvl(); emit("tool");
  }
  ED.closePoly = closePoly;
  function sampleImage(all, L) {
    var d = ED.doc;
    if (all || !L) return { img: PE.getData(PE.flatten(d)), ox: 0, oy: 0 };
    var s = PE.surface(L, d), id = PE.getData(s.canvas);
    return { img: id, ox: s.x, oy: s.y };
  }
  function regionAt(p, o) {     // magic-wand / bucket region in doc coords
    var d = ED.doc, L = ED.layer(), sm = sampleImage(o.all, L);
    return PE.work("wand", [{ data: sm.img.data, width: sm.img.width, height: sm.img.height }, p.x - sm.ox, p.y - sm.oy, o.tol, o.contig]).then(function (lm) {
      if (!sm.ox && !sm.oy && sm.img.width === d.w && sm.img.height === d.h) return lm;
      var m = new Uint8Array(d.w * d.h), W = sm.img.width;
      for (var y = 0; y < sm.img.height; y++) { var dy = y + sm.oy; if (dy < 0 || dy >= d.h) continue; for (var x = 0; x < W; x++) { var dx = x + sm.ox; if (dx >= 0 && dx < d.w) m[dy * d.w + dx] = lm[y * W + x]; } }
      return m;
    });
  }

  // ---------- eyedropper ----------
  function pick(p, toBg) {
    var d = ED.doc, x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    var src = ED.o.eye.all ? PE.flatten(d, { rect: { x: x, y: y, w: 1, h: 1 } }) : PE.flatten(d, { rect: { x: x, y: y, w: 1, h: 1 }, only: [ED.layer().id] });
    var px = PE.getData(src).data;
    if (!px[3]) return;
    var hx = PE.toHex(px[0], px[1], px[2]);
    if (toBg) d.bg = hx; else d.fg = hx;
    emit("tool"); emit("colors");
  }
  ED.pick = pick;

  // ---------- fill / gradient ----------
  ED.fillSel = function (color, label) { fillWith(ED.doc.sel, color, label || "Fill", 1); };
  function fillWith(sel, color, label, op) {
    var L = ED.layer(); if (!editable(L, "pixels")) return;
    if (ED.maskEdit && L.mask) { var lum = PE.rgbOf(color); color = lum[0] * 0.299 + lum[1] * 0.587 + lum[2] * 0.114 >= 128 ? "#ffffff" : "#000000"; }
    var before = PE.snap(ED.doc), mask = ED.maskEdit && L.mask, grew = mask ? PE.ensureMaskCovers(L, docRect()) : PE.ensureCovers(L, docRect()), h = mask ? L.mask : L;
    var g = grew ? PE.metaEntry("Grow", ED.doc, before) : null, r = sel ? { x: sel.b.x - h.x, y: sel.b.y - h.y, w: sel.b.w, h: sel.b.h } : { x: -h.x, y: -h.y, w: ED.doc.w, h: ED.doc.h };
    var e = PE.editPixels(ED.doc, label || "Fill", h, "canvas", r, function (c) {
      var t = PE.mk(h.canvas.width, h.canvas.height), tc = PE.cx2(t);
      tc.fillStyle = color; tc.fillRect(r.x, r.y, r.w, r.h);
      if (sel) { tc.globalCompositeOperation = "destination-in"; tc.drawImage(PE.selCanvas(sel), -h.x, -h.y); }
      c.save(); c.globalAlpha = op;
      if (mask && color === "#000000") c.globalCompositeOperation = "destination-out";
      if (!mask && L.lockA) c.globalCompositeOperation = "source-atop";   // lane:selection (lock transparent pixels)
      c.drawImage(t, 0, 0); c.restore();
    });
    ED.push(PE.compound(label, [g, e]));
  }
  ED.clearSel = function () {
    var L = ED.layer(), sel = ED.doc.sel;
    if (!sel) { S3.toast("Select an area first (Layer › Delete removes the whole layer)"); return; }
    if (!editable(L, "pixels")) return;
    var h = ED.maskEdit && L.mask ? L.mask : L;
    ED.push(PE.editPixels(ED.doc, "Clear", h, "canvas", { x: sel.b.x - h.x, y: sel.b.y - h.y, w: sel.b.w, h: sel.b.h }, function (c) {
      c.globalCompositeOperation = "destination-out"; c.drawImage(PE.selCanvas(sel), -h.x, -h.y); c.globalCompositeOperation = "source-over";
    }));
  };
  function gradientTo(c, a, b, o, w, h, ox, oy) {
    var d = ED.doc, fg = d.fg, bg = o.trans ? null : d.bg, ca = o.rev ? (bg || fg) : fg, cb = o.rev ? fg : bg;
    var g = o.type === "radial" ? c.createRadialGradient(a.x - ox, a.y - oy, 0, a.x - ox, a.y - oy, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) : c.createLinearGradient(a.x - ox, a.y - oy, b.x - ox, b.y - oy);
    function rgba(hx, al) { var q = PE.rgbOf(hx); return "rgba(" + q.join(",") + "," + al + ")"; }
    if (o.trans) { g.addColorStop(0, rgba(fg, o.rev ? 0 : 1)); g.addColorStop(1, rgba(fg, o.rev ? 1 : 0)); }
    else { g.addColorStop(0, ca); g.addColorStop(1, cb); }
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  function applyGradient(a, b) {
    var L = ED.layer(); if (!editable(L, "pixels")) return;
    var o = ED.o.gradient, mask = ED.maskEdit && L.mask, before = PE.snap(ED.doc), grew = mask ? PE.ensureMaskCovers(L, docRect()) : PE.ensureCovers(L, docRect()), hd = mask ? L.mask : L;
    var g = grew ? PE.metaEntry("Grow", ED.doc, before) : null, sel = ED.doc.sel;
    var e = PE.editPixels(ED.doc, "Gradient", hd, "canvas", sel ? { x: sel.b.x - hd.x, y: sel.b.y - hd.y, w: sel.b.w, h: sel.b.h } : null, function (c, cv) {
      var t = PE.mk(cv.width, cv.height), tc = PE.cx2(t);
      gradientTo(tc, a, b, o, cv.width, cv.height, hd.x, hd.y);
      if (mask) {      // on a mask: the gradient's brightness becomes the mask value (blended by selection x opacity)
        var gd = tc.getImageData(0, 0, t.width, t.height).data, md = c.getImageData(0, 0, t.width, t.height), mm = md.data;
        var sl = sel ? PE.selFor(ED.doc, { x: hd.x, y: hd.y, w: t.width, h: t.height }) : null;
        for (var i = 0, q = 0; i < mm.length; i += 4, q++) {
          var gv = (gd[i] * 0.299 + gd[i + 1] * 0.587 + gd[i + 2] * 0.114) * gd[i + 3] / 255, k = o.op * (sl ? sl[q] / 255 : 1), ma = mm[i + 3];
          mm[i] = mm[i + 1] = mm[i + 2] = 255; mm[i + 3] = ma + (gv - ma) * k;
        }
        c.putImageData(md, 0, 0); return;
      }
      if (sel) { tc.globalCompositeOperation = "destination-in"; tc.drawImage(PE.selCanvas(sel), -hd.x, -hd.y); }
      c.save(); c.globalAlpha = o.op; if (L.lockA) c.globalCompositeOperation = "source-atop"; c.drawImage(t, 0, 0); c.restore();   // lane:selection (lockA)
    });
    ED.push(PE.compound("Gradient", [g, e]));
  }

  // ---------- move / float selection ----------
  function layerAt(p) {
    var d = ED.doc, x = Math.floor(p.x), y = Math.floor(p.y);
    for (var i = d.layers.length - 1; i >= 0; i--) {
      var L = d.layers[i]; if (!L.visible) continue;
      var px = PE.getData(PE.flatten(d, { only: [L.id], rect: { x: x, y: y, w: 1, h: 1 } })).data;
      if (px[3] > 10) return L;
    }
    return null;
  }
  function moveStart(p, e) {
    if (e.ctrlKey || e.metaKey || ED.o.move.auto) { var hit = layerAt(p); if (hit && hit.id !== ED.doc.active) ED.setActive(hit.id); }
    var L = ED.layer(); if (!editable(L)) return;
    var before = PE.snap(ED.doc), sel = ED.doc.sel;
    if (sel && L.kind === "raster" && !ED.maskEdit) {     // move the selected pixels
      var b = sel.b, fl = PE.mk(b.w, b.h), fc = PE.cx2(fl);
      fc.drawImage(L.canvas, L.x - b.x, L.y - b.y); fc.globalCompositeOperation = "destination-in"; fc.drawImage(PE.selCanvas(sel), -b.x, -b.y);
      var cut = PE.cloneCanvas(L.canvas), cc = PE.cx2(cut);
      if (!e.altKey) { cc.globalCompositeOperation = "destination-out"; cc.drawImage(PE.selCanvas(sel), -L.x, -L.y); }
      L.canvas = PE.touch(cut);
      ED.drag = { kind: "float", p0: p, L: L, fl: fl, b: b, before: before, dx: 0, dy: 0, cancel: function () { PE.restore(ED.doc, before); changed(); } };
      floatPreview();
      return;
    }
    ED.drag = { kind: "move", cancel: function () { PE.restore(ED.doc, before); changed(); }, p0: p, L: L, before: before, x: L.x, y: L.y, mx: L.mask ? L.mask.x : 0, my: L.mask ? L.mask.y : 0, t: PE.clone(L.text), s: PE.clone(L.shape) };
  }
  function floatPreview() {
    var dr = ED.drag, L = dr.L, fr = { x: dr.b.x + dr.dx, y: dr.b.y + dr.dy, w: dr.b.w, h: dr.b.h }, u = PE.rectI(PE.union({ x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }, fr));
    var c = dr.live && dr.live.width === u.w && dr.live.height === u.h ? dr.live : (dr.live = PE.mk(u.w, u.h)), x = PE.cx2(c);
    x.clearRect(0, 0, u.w, u.h); x.drawImage(L.canvas, L.x - u.x, L.y - u.y); x.drawImage(dr.fl, fr.x - u.x, fr.y - u.y); PE.touch(c);
    ED.live.over[L.id] = { canvas: c, x: u.x, y: u.y }; render();
  }
  function moveTo(p, e) {
    var dr = ED.drag, dx = p.x - dr.p0.x, dy = p.y - dr.p0.y;
    if (e && e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    dx = Math.round(dx); dy = Math.round(dy);
    if (dr.kind === "float") { dr.dx = dx; dr.dy = dy; floatPreview(); renderOvl(); return; }
    shiftLayer(dr, dx, dy); render();
  }
  function shiftLayer(dr, dx, dy) {
    var L = dr.L;
    if (PE.shiftExt) PE.shiftExt(dr, dx, dy);   // lane:selection (groups, linked layers)
    if (L.kind === "raster") { L.x = dr.x + dx; L.y = dr.y + dy; }
    if (L.text) { L.text.ax = dr.t.ax + dx; L.text.ay = dr.t.ay + dy; }
    if (L.shape) { L.shape.x = dr.s.x + dx; L.shape.y = dr.s.y + dy; }
    if (L.mask) { L.mask.x = dr.mx + dx; L.mask.y = dr.my + dy; }
  }
  function moveEnd() {
    var dr = ED.drag; ED.drag = null; if (!dr) return;
    if (dr.kind === "float") {
      var L = dr.L, fr = { x: dr.b.x + dr.dx, y: dr.b.y + dr.dy, w: dr.b.w, h: dr.b.h };
      PE.ensureCovers(L, fr);
      var n = PE.cloneCanvas(L.canvas); PE.cx2(n).drawImage(dr.fl, fr.x - L.x, fr.y - L.y); L.canvas = PE.touch(n);
      var d = ED.doc, s = d.sel, m = new Uint8Array(d.w * d.h);
      for (var y = 0; y < d.h; y++) { var sy = y - dr.dy; if (sy < 0 || sy >= d.h) continue; for (var x = 0; x < d.w; x++) { var sx = x - dr.dx; if (sx >= 0 && sx < d.w) m[y * d.w + x] = s.m[sy * d.w + sx]; } }
      d.sel = PE.makeSel(d, m);
      ED.push(PE.metaEntry("Move selection", ED.doc, dr.before)); return;
    }
    if (dr.L.x === dr.x && dr.L.y === dr.y && JSON.stringify(dr.L.text) === JSON.stringify(dr.t) && JSON.stringify(dr.L.shape) === JSON.stringify(dr.s)) return;
    ED.push(PE.metaEntry("Move", ED.doc, dr.before));
  }
  ED.nudge = function (dx, dy) {
    var L = ED.layer(); if (!editable(L)) return;
    var before = PE.snap(ED.doc);
    shiftLayer({ L: L, x: L.x, y: L.y, mx: L.mask ? L.mask.x : 0, my: L.mask ? L.mask.y : 0, t: PE.clone(L.text), s: PE.clone(L.shape) }, dx, dy);
    ED.push(PE.metaEntry("Nudge", ED.doc, before));
  };

  // ---------- free transform ----------
  function layerBox(L) {
    if (L.kind !== "raster") { var b = PE.vbox(L); return { x: b.x, y: b.y, w: b.w, h: b.h, r0: b.rot }; }
    var ab = PIX.alphaBounds(PE.getData(L.canvas));
    if (!ab) return null;
    return { x: L.x + ab.x, y: L.y + ab.y, w: ab.w, h: ab.h, r0: 0 };
  }
  ED.startTransform = function () {
    if (ED.xf) return;
    var L = ED.layer(); if (!editable(L)) return;
    cancelModes();
    var b = layerBox(L); if (!b) { S3.toast("This layer is empty", "error"); return; }
    ED.tool = "move";
    ED.xf = { L: L, b: b, sx: 1, sy: 1, rot: 0, tx: 0, ty: 0 };
    xfPreview(); emit("tool"); renderOvl();
  };
  function xfMatrix(xf) {
    var b = xf.b, cx = b.x + b.w / 2, cy = b.y + b.h / 2, r0 = b.r0 || 0;
    var m = PE.mTRS({ cx: 0, cy: 0, rot: r0 + xf.rot });
    m = PE.mMul([1, 0, 0, 1, cx + xf.tx, cy + xf.ty], m);
    m = PE.mMul(m, [xf.sx, 0, 0, xf.sy, 0, 0]);
    m = PE.mMul(m, PE.mTRS({ cx: 0, cy: 0, rot: -r0 }));
    return PE.mMul(m, [1, 0, 0, 1, -cx, -cy]);
  }
  ED.xfMatrix = xfMatrix;
  function xfPreview() {
    var xf = ED.xf, L = xf.L, s = PE.surface(L, ED.doc), m = xfMatrix(xf);
    ED.live.over[L.id] = { canvas: s.canvas, x: s.x, y: s.y, m: m };
    if (L.mask) ED.live.maskOver[L.id] = L.mask;
    render();
  }
  function xfCorners(xf) {     // oriented box corners after transform, + centre and angle
    var b = xf.b, cx = b.x + b.w / 2 + xf.tx, cy = b.y + b.h / 2 + xf.ty, a = (b.r0 || 0) + xf.rot, hw = b.w * xf.sx / 2, hh = b.h * xf.sy / 2;
    function P(lx, ly) { return PE.rotPt(cx + lx, cy + ly, cx, cy, a); }
    return { c: { x: cx, y: cy }, a: a, pts: [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], P: P, hw: hw, hh: hh };
  }
  var HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  function xfHit(p) {
    var xf = ED.xf, k = xfCorners(xf), tol = 9 / ED.zoom;
    for (var i = 0; i < HANDLES.length; i++) { var h = HANDLES[i], q = k.P(h[0] * k.hw, h[1] * k.hh); if (Math.hypot(p.x - q.x, p.y - q.y) <= tol) return "h" + i; }
    var l = PE.rotPt(p.x, p.y, k.c.x, k.c.y, -k.a), inside = Math.abs(l.x - k.c.x) <= Math.abs(k.hw) && Math.abs(l.y - k.c.y) <= Math.abs(k.hh);
    if (inside) return "move";
    for (i = 0; i < 4; i++) { var cq = k.pts[i]; if (Math.hypot(p.x - cq.x, p.y - cq.y) <= 30 / ED.zoom) return "rot"; }
    return null;
  }
  function paintXf(c) {
    var k = xfCorners(ED.xf);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var s = k.pts.map(function (q) { return toScr(q.x, q.y); });
    c.beginPath(); s.forEach(function (q, i) { if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.closePath();
    c.strokeStyle = "#fff"; c.lineWidth = 3; c.stroke(); c.strokeStyle = "#1b8cff"; c.lineWidth = 1.5; c.stroke();
    HANDLES.forEach(function (h) { var q = k.P(h[0] * k.hw, h[1] * k.hh), sq = toScr(q.x, q.y); c.fillStyle = "#fff"; c.strokeStyle = "#1b8cff"; c.lineWidth = 1.5; c.fillRect(sq.x - 4.5, sq.y - 4.5, 9, 9); c.strokeRect(sq.x - 4.5, sq.y - 4.5, 9, 9); });
    var cc = toScr(k.c.x, k.c.y); c.beginPath(); c.arc(cc.x, cc.y, 3.5, 0, Math.PI * 2); c.stroke();
  }
  function xfDown(p, e) {
    var h = xfHit(p);
    if (!h) { h = "rot"; }
    var xf = ED.xf;
    ED.drag = { kind: "xf", h: h, p0: p, s: { sx: xf.sx, sy: xf.sy, rot: xf.rot, tx: xf.tx, ty: xf.ty }, k: xfCorners(xf) };
  }
  function xfMove(p, e) {
    var dr = ED.drag, xf = ED.xf, b = xf.b, k = dr.k;
    if (dr.h === "move") { xf.tx = dr.s.tx + p.x - dr.p0.x; xf.ty = dr.s.ty + p.y - dr.p0.y; }
    else if (dr.h === "rot") {
      var a0 = Math.atan2(dr.p0.y - k.c.y, dr.p0.x - k.c.x), a1 = Math.atan2(p.y - k.c.y, p.x - k.c.x), r = dr.s.rot + (a1 - a0) * 180 / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      xf.rot = r;
    } else {
      var hd = HANDLES[+dr.h.slice(1)], hx = hd[0], hy = hd[1], hw = b.w * dr.s.sx / 2, hh = b.h * dr.s.sy / 2;
      var A = e.altKey ? k.c : k.P(-hx * hw, -hy * hh), q = PE.rotPt(p.x, p.y, A.x, A.y, -k.a), qx = q.x - A.x, qy = q.y - A.y, f = e.altKey ? 2 : 1;
      var sx = hx ? qx * f / (hx * b.w) : dr.s.sx, sy = hy ? qy * f / (hy * b.h) : dr.s.sy;
      if (hx && hy && !e.shiftKey) {      // corners keep the aspect ratio (Shift = free)
        var kk = Math.max(Math.abs(sx / dr.s.sx), Math.abs(sy / dr.s.sy));
        sx = Math.sign(sx || 1) * Math.abs(dr.s.sx) * kk; sy = Math.sign(sy || 1) * Math.abs(dr.s.sy) * kk;
      }
      if (Math.abs(sx * b.w) < 1) sx = Math.sign(sx || 1) / b.w;
      if (Math.abs(sy * b.h) < 1) sy = Math.sign(sy || 1) / b.h;
      xf.sx = sx; xf.sy = sy;
      var nc = k.c;
      if (!e.altKey) {
        // centre = anchor + R(a) * (hx*w*sx/2, hy*h*sy/2) measured from the anchor side; for edge handles the other axis stays centred
        var lx = hx ? hx * b.w * sx / 2 : 0, ly = hy ? hy * b.h * sy / 2 : 0;
        var Al = PE.rotPt(A.x, A.y, k.c.x, k.c.y, -k.a), cl = { x: hx ? Al.x + lx : k.c.x, y: hy ? Al.y + ly : k.c.y };
        nc = PE.rotPt(cl.x, cl.y, k.c.x, k.c.y, k.a);
      }
      xf.tx = nc.x - (b.x + b.w / 2); xf.ty = nc.y - (b.y + b.h / 2);
    }
    xfPreview(); emit("tool");
  }
  ED.applyTransform = function () {
    var xf = ED.xf; if (!xf) return;
    var L = xf.L, m = xfMatrix(xf);
    ED.xf = null; clearLive();
    if (Math.abs(xf.sx - 1) < 1e-9 && Math.abs(xf.sy - 1) < 1e-9 && !xf.rot && !xf.tx && !xf.ty) { changed(); emit("tool"); return; }
    try {
      ED.meta("Free transform", function () { transformLayer(L, m, xf); });
    } catch (err) { S3.toast(err.message, "error"); changed(); }
    emit("tool");
  };
  function transformLayer(L, m, xf) {
    if (L.mask) { var mb = PE.bake(L.mask.canvas, L.mask.x, L.mask.y, m); L.mask = { canvas: mb.canvas, x: mb.x, y: mb.y }; }
    if (PE.xfAny) PE.xfAny(L, m, xf); if (PE.xfExt && PE.xfExt[L.kind]) return PE.xfExt[L.kind](L, m, xf);   // lane:selection (xfAny: vector masks etc. on any layer)
    if (L.kind === "raster") { var r = PE.bake(L.canvas, L.x, L.y, m); L.canvas = r.canvas; L.x = r.x; L.y = r.y; return; }
    // vector layers stay editable: new centre, size, rotation and flips
    var b = PE.vbox(L), c = PE.mApply(m, b.x + b.w / 2, b.y + b.h / 2), sx = xf ? xf.sx : 1, sy = xf ? xf.sy : 1, rot = xf ? (b.rot + xf.rot) : b.rot;
    if (!xf) {     // derive from the matrix (canvas rotate/flip)
      var det = m[0] * m[3] - m[1] * m[2], ang = Math.atan2(m[1], m[0]) * 180 / Math.PI;
      if (det < 0) { sx = -1; ang = Math.atan2(-m[1], -m[0]) * 180 / Math.PI; }
      rot = det < 0 ? ang - b.rot : b.rot + ang; sy = 1;
      var sc = Math.sqrt(Math.abs(det)); sx *= sc; sy *= sc;
    }
    if (sy < 0) { sy = -sy; sx = -sx; rot += 180; }
    rot = ((rot % 360) + 540) % 360 - 180;
    if (L.kind === "shape") {
      var S = L.shape; S.w = Math.max(1, S.w * Math.abs(sx)); S.h = Math.max(1, S.h * Math.abs(sy)); S.x = c.x - S.w / 2; S.y = c.y - S.h / 2; S.rot = rot;
      if (sx < 0) S.flipX = !S.flipX; S.sw = S.sw * Math.sqrt(Math.abs(sx * sy));
    } else {
      var T = L.text; T.size = PE.clamp(T.size * Math.sqrt(Math.abs(sx * sy)), 1, 2000); T.rot = rot; if (sx < 0) T.flipX = !T.flipX;
      if (PE.VX && PE.VX.xfText && PE.VX.xfText(T, c, sx, sy)) return;   // lane:vector (paragraph boxes, character scale)
      var lay = PE.textLayout(T); T.ax = c.x + (T.align === "left" ? -lay.w / 2 : T.align === "right" ? lay.w / 2 : 0); T.ay = c.y - lay.h / 2;
    }
  }
  ED.transformLayer = transformLayer;
  ED.cancelTransform = function () { if (!ED.xf) return; ED.xf = null; clearLive(); render(); renderOvl(); emit("tool"); };
  ED.flipLayer = function (axis) {
    var L = ED.layer(); if (!editable(L)) return;
    var b = layerBox(L); if (!b) return;
    var xf = { b: b, sx: axis === "h" ? -1 : 1, sy: axis === "v" ? -1 : 1, rot: 0, tx: 0, ty: 0 };
    ED.meta(axis === "h" ? "Flip horizontal" : "Flip vertical", function () { transformLayer(L, xfMatrix(xf), xf); });
  };
  ED.setXf = function (k, v) { if (!ED.xf) return; ED.xf[k] = v; xfPreview(); renderOvl(); };

  // ---------- crop ----------
  ED.startCrop = function () { cancelModes(); ED.tool = "crop"; ED.crop = { x: 0, y: 0, w: ED.doc.w, h: ED.doc.h, fresh: true }; emit("tool"); renderOvl(); };
  function cropHit(p) {
    var r = ED.crop, t = 10 / ED.zoom, hx = Math.abs(p.x - r.x) <= t ? -1 : Math.abs(p.x - r.x - r.w) <= t ? 1 : 0, hy = Math.abs(p.y - r.y) <= t ? -1 : Math.abs(p.y - r.y - r.h) <= t ? 1 : 0;
    var inX = p.x >= r.x - t && p.x <= r.x + r.w + t, inY = p.y >= r.y - t && p.y <= r.y + r.h + t;
    if ((hx || hy) && inX && inY) return { hx: hx, hy: hy };
    if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return "move";
    return null;
  }
  function paintCrop(c) {
    var r = ED.crop, a = toScr(r.x, r.y), b = toScr(r.x + r.w, r.y + r.h), W = ovl.width / dpr, H = ovl.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "rgba(0,0,0,.55)"; c.beginPath(); c.rect(0, 0, W, H); c.rect(a.x, a.y, b.x - a.x, b.y - a.y); c.fill("evenodd");
    c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 1;
    for (var i = 1; i < 3; i++) { var x = a.x + (b.x - a.x) * i / 3, y = a.y + (b.y - a.y) * i / 3; c.beginPath(); c.moveTo(x, a.y); c.lineTo(x, b.y); c.moveTo(a.x, y); c.lineTo(b.x, y); c.stroke(); }
    c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    c.fillStyle = "#fff";
    [[a.x, a.y], [b.x, a.y], [a.x, b.y], [b.x, b.y], [(a.x + b.x) / 2, a.y], [(a.x + b.x) / 2, b.y], [a.x, (a.y + b.y) / 2], [b.x, (a.y + b.y) / 2]].forEach(function (q) { c.fillRect(q[0] - 4, q[1] - 4, 8, 8); });
  }
  function cropDown(p, e) {
    var h = cropHit(p), r = ED.crop;
    if (r.fresh && h === "move") h = null;
    ED.drag = { kind: "crop", h: h || "new", p0: p, r0: Object.assign({}, r) };
  }
  function cropMove(p, e) {
    var dr = ED.drag, r0 = dr.r0, k = ratioNum(ED.o.crop.ratio), r;
    if (dr.h === "move") r = { x: r0.x + p.x - dr.p0.x, y: r0.y + p.y - dr.p0.y, w: r0.w, h: r0.h };
    else if (dr.h === "new") r = constrainRatio(dr.p0, p, ED.o.crop.ratio, e);
    else {
      var x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
      if (dr.h.hx < 0) x0 = p.x; if (dr.h.hx > 0) x1 = p.x; if (dr.h.hy < 0) y0 = p.y; if (dr.h.hy > 0) y1 = p.y;
      r = norm({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      if (k) { if (dr.h.hx) r.h = r.w / k; else r.w = r.h * k; if (dr.h.hy < 0 && dr.h.hx) r.y = y1 - r.h; if (dr.h.hx < 0 && !dr.h.hy) r.x = x1 - r.w; }
    }
    r.w = Math.max(1, r.w); r.h = Math.max(1, r.h);
    ED.crop = r; r.fresh = false; emit("tool");
  }
  ED.applyCrop = function () {
    var r = ED.crop; if (!r) return;
    ED.crop = null;
    var R = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    try { PE.checkSize(R.w, R.h, "The crop"); } catch (e) { S3.toast(e.message, "error"); emit("tool"); return; }
    ED.meta("Crop", function () { resizeCanvasTo(R, ED.o.crop.trim); });
    ED.fit(); emit("tool");
  };
  ED.cancelCrop = function () { ED.crop = null; renderOvl(); emit("tool"); };
  // Make the document cover rect R (doc coords) of the old document. trim=true deletes pixels outside.
  function resizeCanvasTo(R, trim, fill) {
    var d = ED.doc;
    d.layers.forEach(function (L, i) {
      if (L.kind === "raster") {
        L.x -= R.x; L.y -= R.y;
        if (trim) {
          var ir = PE.inter({ x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }, { x: 0, y: 0, w: R.w, h: R.h });
          var n = ir ? PE.mk(ir.w, ir.h) : PE.mk(1, 1); if (ir) PE.cx2(n).drawImage(L.canvas, L.x - ir.x, L.y - ir.y);
          L.canvas = PE.touch(n); L.x = ir ? ir.x : 0; L.y = ir ? ir.y : 0;
        }
        if (fill && i === 0) {
          PE.ensureCovers(L, { x: 0, y: 0, w: R.w, h: R.h });
          var f = PE.cloneCanvas(L.canvas), fc = PE.cx2(f); fc.globalCompositeOperation = "destination-over"; fc.fillStyle = fill; fc.fillRect(-L.x, -L.y, R.w, R.h); L.canvas = PE.touch(f);
        }
      }
      if (L.text) { L.text.ax -= R.x; L.text.ay -= R.y; }
      if (L.shape) { L.shape.x -= R.x; L.shape.y -= R.y; }
      if (L.mask) L.mask = { canvas: L.mask.canvas, x: L.mask.x - R.x, y: L.mask.y - R.y };
      if (PE.offsetExt) PE.offsetExt(L, -R.x, -R.y);   // lane:selection (crop / canvas size for new layer kinds)
    });
    d.w = R.w; d.h = R.h; d.sel = null;
  }
  ED.resizeCanvasTo = resizeCanvasTo;
  ED.canvasSize = function (w, h, anchor, fill) {
    var d = ED.doc; PE.checkSize(w, h, "The canvas");
    var ax = anchor % 3, ay = Math.floor(anchor / 3), R = { x: Math.round((d.w - w) * ax / 2), y: Math.round((d.h - h) * ay / 2), w: w, h: h };
    ED.meta("Canvas size", function () { resizeCanvasTo(R, false, fill && fill !== "transparent" ? fill : null); }); ED.fit();
  };
  ED.imageSize = function (w, h) {
    var d = ED.doc; PE.checkSize(w, h, "The image");
    var kx = w / d.w, ky = h / d.h, m = [kx, 0, 0, ky, 0, 0];
    ED.meta("Image size", function () {
      d.layers.forEach(function (L) {
        if (L.mask) { var mb = PE.bake(L.mask.canvas, L.mask.x, L.mask.y, m); L.mask = { canvas: mb.canvas, x: mb.x, y: mb.y }; }
        if (L.kind === "raster") { var r = PE.bake(L.canvas, L.x, L.y, m); L.canvas = r.canvas; L.x = r.x; L.y = r.y; }
        if (L.text) { var T = L.text, k = Math.sqrt(kx * ky); T.ax *= kx; T.ay *= ky; T.size = PE.clamp(T.size * k, 1, 2000); }
        if (L.text && PE.VX && PE.VX.scaleText) PE.VX.scaleText(L.text, kx, ky);   // lane:vector
        if (L.shape) { var S = L.shape; S.x *= kx; S.y *= ky; S.w *= kx; S.h *= ky; S.sw *= Math.sqrt(kx * ky); }
        if (PE.scaleExt) PE.scaleExt(L, kx, ky);   // lane:selection (image size for new layer kinds)
      });
      d.w = w; d.h = h; d.sel = null;
    });
    ED.fit();
  };
  ED.rotateCanvas = function (how) {
    var d = ED.doc, W = d.w, H = d.h, m = how === "cw" ? [0, 1, -1, 0, H, 0] : how === "ccw" ? [0, -1, 1, 0, 0, W] : how === "180" ? [-1, 0, 0, -1, W, H] : how === "fh" ? [-1, 0, 0, 1, W, 0] : [1, 0, 0, -1, 0, H];
    ED.meta({ cw: "Rotate 90° clockwise", ccw: "Rotate 90° counter-clockwise", "180": "Rotate 180°", fh: "Flip canvas horizontal", fv: "Flip canvas vertical" }[how], function () {
      d.layers.forEach(function (L) { transformLayer(L, m, null); });
      if (how === "cw" || how === "ccw") { d.w = H; d.h = W; }
      d.sel = null;
    });
    ED.fit();
  };

  // ---------- text ----------
  function textHit(p) {
    var d = ED.doc;
    for (var i = d.layers.length - 1; i >= 0; i--) {
      var L = d.layers[i]; if (L.kind !== "text" || !L.visible) continue;
      var b = PE.vbox(L), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, q = PE.rotPt(p.x, p.y, c.x, c.y, -b.rot);
      if (q.x >= b.x - 4 && q.x <= b.x + b.w + 4 && q.y >= b.y - 4 && q.y <= b.y + b.h + 4) return L;
    }
    return null;
  }
  function textDown(p) {
    var hit = textHit(p);
    if (hit) { if (hit.locked) { S3.toast("That text layer is locked", "error"); return; } ED.setActive(hit.id); startText(hit, PE.snap(ED.doc)); return; }
    var o = ED.o.text, before = PE.snap(ED.doc), size = o.size;
    var L = PE.newLayer("text", { name: "Text", text: { text: "", font: o.font, size: size, weight: o.weight, italic: o.italic, color: ED.doc.fg, align: o.align, dir: o.dir, ax: p.x, ay: p.y - size * 0.6 } });
    var d = ED.doc, i = d.layers.indexOf(ED.layer()); d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, L); d.active = L.id;
    emit("layers"); startText(L, before, true);
  }
  function startText(L, before, isNew) {
    ED.textL = L; ED.textBefore = before; ED.textNew = !!isNew; ED.live.hide = L.id;
    ta.hidden = false; ta.value = L.text.text; placeText(); render();
    setTimeout(function () { ta.focus(); if (!isNew) ta.select(); }, 0);
    emit("tool");
  }
  ED.startText = startText;
  function placeText() {
    var L = ED.textL; if (!L) return;
    var T = L.text, lay = PE.textLayout(Object.assign({}, T, { text: T.text || " " })), b = lay.box, z = ED.zoom, s = toScr(b.x, b.y), dir = PE.textDir(Object.assign({}, T, { text: T.text || "" }));
    ta.style.font = PE.fontCss(Object.assign({}, T, { size: T.size * z }));
    ta.style.lineHeight = (lay.lh * z) + "px"; ta.style.color = T.color; ta.style.textAlign = T.align; ta.dir = dir;
    var w = Math.max(b.w, T.size * 0.6) * z + T.size * z * 0.6 + 8;
    var left = T.align === "center" ? s.x + b.w * z / 2 - w / 2 : T.align === "right" ? s.x + b.w * z - w + 4 : s.x - 4;
    ta.style.left = left + "px"; ta.style.top = s.y + "px"; ta.style.width = w + "px"; ta.style.height = (lay.h * z + 6) + "px";
    ta.style.transform = "rotate(" + (T.rot || 0) + "deg)" + (T.flipX ? " scaleX(-1)" : "");
    if (PE.VX && PE.VX.placeText) PE.VX.placeText(ta, L);   // lane:vector
  }
  ED.placeText = placeText;
  function finishText() {
    var L = ED.textL; if (!L) return;
    ED.textL = null; ta.hidden = true; ED.live.hide = null;
    L.text.text = ta.value.slice(0, PE.LIM.text);
    var d = ED.doc;
    if (!L.text.text.trim()) {
      d.layers = d.layers.filter(function (x) { return x !== L; });
      if (d.active === L.id) d.active = d.layers.length ? d.layers[d.layers.length - 1].id : null;
      if (!ED.textNew) ED.push(PE.metaEntry("Delete text", d, ED.textBefore)); else { changed(); }
    } else {
      if (ED.textNew) L.name = L.text.text.replace(/\s+/g, " ").trim().slice(0, 40) || "Text";
      ED.push(PE.metaEntry(ED.textNew ? "Add text" : "Edit text", d, ED.textBefore));
    }
    emit("layers"); emit("tool");
  }
  ED.finishText = finishText;

  // ---------- shapes ----------
  function shapeDown(p) {
    var o = ED.o.shape, before = PE.snap(ED.doc);
    var L = PE.newLayer("shape", { name: o.type.charAt(0).toUpperCase() + o.type.slice(1), shape: { type: o.type, x: p.x, y: p.y, w: 1, h: o.type === "line" ? Math.max(1, o.sw || 4) : 1, fill: o.noFill ? "" : ED.doc.fg, stroke: o.type === "line" ? ED.doc.fg : o.stroke, sw: o.type === "line" ? Math.max(1, o.sw || 4) : o.sw, radius: o.radius } });
    var d = ED.doc, i = d.layers.indexOf(ED.layer()); d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, L); d.active = L.id;
    ED.drag = { kind: "shape", L: L, p0: p, before: before, center: true, cancel: function () { PE.restore(ED.doc, before); changed(); emit("layers"); } }; emit("layers");
  }
  function shapeMove(p, e) {
    var dr = ED.drag, S = dr.L.shape;
    if (S.type === "line") {
      var dx = p.x - dr.p0.x, dy = p.y - dr.p0.y, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (e.shiftKey) { ang = Math.round(ang / 15) * 15; }
      var cx = dr.p0.x + Math.cos(ang * Math.PI / 180) * len / 2, cy = dr.p0.y + Math.sin(ang * Math.PI / 180) * len / 2;
      S.w = Math.max(1, len); S.x = cx - S.w / 2; S.y = cy - S.h / 2; S.rot = ang;
    } else { var r = constrainRatio(dr.p0, p, e.shiftKey ? "1:1" : "free", e); S.x = r.x; S.y = r.y; S.w = Math.max(1, r.w); S.h = Math.max(1, r.h); }
    render();
  }
  function shapeUp() {
    var dr = ED.drag; ED.drag = null; var S = dr.L.shape;
    if (S.w < 3 && (S.type === "line" || S.h < 3)) { var k = Math.min(ED.doc.w, ED.doc.h) / 4; S.w = k; if (S.type !== "line") S.h = k; S.x = dr.p0.x - S.w / 2; S.y = dr.p0.y - S.h / 2; }
    ED.push(PE.metaEntry("Add shape", ED.doc, dr.before)); emit("layers");
  }

  // ---------- tool table ----------
  var TOOLS = ED.TOOLS = {
    move: { down: function (p, e) { if (ED.xf) { xfDown(p, e); return; } moveStart(p, e); }, move: function (p, e) { if (ED.drag.kind === "xf") xfMove(p, e); else moveTo(p, e); },
      up: function () { if (ED.drag && ED.drag.kind === "xf") { ED.drag = null; return; } moveEnd(); } },
    marquee: { down: function (p, e) { ED.drag = { kind: "marquee", a: p, mode: selMode(e), ellipse: false, center: false }; }, move: marqMove, up: marqUp },
    ellipse: { down: function (p, e) { ED.drag = { kind: "marquee", a: p, mode: selMode(e), ellipse: true, center: false }; }, move: marqMove, up: marqUp },
    lasso: { down: function (p, e) { ED.drag = { kind: "lasso", pts: [p], mode: selMode(e) }; }, move: function (p) { var P = ED.drag.pts, q = P[P.length - 1]; if (Math.hypot(p.x - q.x, p.y - q.y) * ED.zoom >= 2) P.push(p); },
      up: function () { var dr = ED.drag; ED.drag = null; if (dr.pts.length >= 3) ED.setSelection(polyMask(dr.pts), dr.mode, "Lasso", ED.o.sel.feather); else if (dr.mode === "new") ED.deselect(); } },
    polygon: { down: function (p, e) {
        var P = ED.poly;
        if (!P) { ED.poly = { pts: [p], mode: selMode(e) }; emit("tool"); return; }
        var f = P.pts[0];
        if (P.pts.length >= 3 && Math.hypot(p.x - f.x, p.y - f.y) * ED.zoom <= 8) { closePoly(); return; }
        if (e.detail >= 2 && P.pts.length >= 2) { closePoly(); return; }
        P.pts.push(p);
      }, hover: function (p) { if (ED.poly) ED.poly.hover = p; } },
    wand: { down: function (p, e) {
        var mode = selMode(e), o = ED.o.wand;
        ED.working(regionAt(p, o)).then(function (m) { ED.setSelection(m, mode, "Magic wand", ED.o.sel.feather); }).catch(function (err) { S3.toast(err.message, "error"); });
      } },
    crop: { down: function (p, e) { if (!ED.crop) ED.startCrop(); cropDown(p, e); }, move: cropMove, up: function () { ED.drag = null; } },
    eyedropper: { down: function (p, e) { pick(p, e.altKey); ED.drag = { kind: "eye", bg: e.altKey }; }, move: function (p) { pick(p, ED.drag.bg); }, up: function () { ED.drag = null; } },
    brush: { down: strokeStart, move: strokeMove, up: strokeEnd },
    eraser: { down: strokeStart, move: strokeMove, up: strokeEnd },
    clone: { down: strokeStart, move: strokeMove, up: strokeEnd },
    heal: { down: strokeStart, move: strokeMove, up: strokeEnd },
    gradient: { down: function (p) { var L = ED.layer(); if (!editable(L, "pixels")) return; ED.drag = { kind: "gradient", a: p, b: null }; },
      move: function (p, e) { var dr = ED.drag; if (e.shiftKey) { var ang = Math.round(Math.atan2(p.y - dr.a.y, p.x - dr.a.x) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(p.x - dr.a.x, p.y - dr.a.y); p = { x: dr.a.x + Math.cos(ang) * len, y: dr.a.y + Math.sin(ang) * len }; } dr.b = p; },
      up: function () { var dr = ED.drag; ED.drag = null; if (dr && dr.b && Math.hypot(dr.b.x - dr.a.x, dr.b.y - dr.a.y) > 1) applyGradient(dr.a, dr.b); } },
    bucket: { down: function (p) {
        var L = ED.layer(); if (!editable(L, "pixels")) return;
        var o = ED.o.bucket, d = ED.doc;
        ED.working(regionAt(p, o)).then(function (m) {
          if (d.sel) m = PIX.combine(d.sel.m, m, "intersect");
          var s = PE.makeSel(d, m); if (!s) return;
          fillWith(s, d.fg, "Paint bucket", o.op);
        }).catch(function (err) { S3.toast(err.message, "error"); });
      } },
    text: { down: textDown },
    shape: { down: shapeDown, move: shapeMove, up: shapeUp },
    hand: {},
    zoom: { down: function (p, e, s) { ED.zoomStep(e.altKey ? -1 : 1, s.x, s.y); } }
  };
  function marqMove(p, e) { var dr = ED.drag; dr.center = e.altKey && !(dr.mode === "subtract"); dr.rect = constrainRatio(dr.a, p, ED.o.sel.ratio, e); }
  function marqUp() {
    var dr = ED.drag; ED.drag = null;
    if (!dr.rect || dr.rect.w * ED.zoom < 2 || dr.rect.h * ED.zoom < 2) { if (dr.mode === "new") ED.deselect(); return; }
    ED.setSelection(marqueeMask(dr.rect, dr.ellipse), dr.mode, dr.ellipse ? "Elliptical marquee" : "Rectangular marquee", ED.o.sel.feather);
  }
  ED.setTool = function (t) {
    if (!TOOLS[t] || ED.tool === t) { emit("tool"); return; }
    if (ED.textL) finishText();
    if (ED.poly) { ED.poly = null; }
    if (ED.crop && t !== "crop") ED.cancelCrop();
    if (ED.xf && t !== "move") ED.applyTransform();
    if (TOOLS[ED.tool] && TOOLS[ED.tool].leave) TOOLS[ED.tool].leave(t);   // lane:vector
    ED.tool = t; S3.store("pe-tool", t);
    if (t === "crop" && ED.doc && !ED.crop) ED.startCrop();
    emit("tool"); renderOvl();
  };
  function cancelModes() {
    if (ED.textL) finishText();
    if (ED.drag) cancelDrag();
    if (ED.xf) ED.cancelTransform();
    if (ED.crop) ED.cancelCrop();
    if (ED.poly) { ED.poly = null; renderOvl(); }
  }
  ED.cancelModes = cancelModes;

  // ---------- init ----------
  ED.init = function () {
    stage = $("#stage"); view = $("#view"); ovl = $("#ovl"); ta = $("#textEdit");
    vctx = view.getContext("2d"); octx = ovl.getContext("2d"); comp = document.createElement("canvas"); cctx = comp.getContext("2d");
    ED.stage = stage;
    new ResizeObserver(function () { var had = view.width; sizeCanvases(); if (ED.doc && (had <= 1 || ED.fitted)) ED.fit(ED.fitted && ED.fitted.up); }).observe(stage);
    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", function (e) { if (pointers[e.pointerId] || e.target === ovl || e.target === stage || e.target === view) onMove(e); });
    window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; pinch = null; if (ED.drag && ED.drag.kind !== "pan") cancelDrag(); ED.drag = null; });
    stage.addEventListener("pointerleave", function () { cursorPt = null; renderOvl(); });
    stage.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    stage.addEventListener("dblclick", function (e) {
      if (ED.tool === "crop" && ED.crop) ED.applyCrop();
      else if (ED.tool === "move" && ED.xf) ED.applyTransform();
      else if (ED.tool === "hand") ED.fit(true);
    });
    stage.addEventListener("wheel", function (e) {
      if (!ED.doc) return; e.preventDefault();
      var s = local(e);
      if (e.ctrlKey || e.metaKey || e.altKey) ED.zoomAt(ED.zoom * Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 30 ? 0.01 : 0.0018)), s.x, s.y);
      else { ED.fitted = null; ED.panX -= e.shiftKey ? e.deltaY : e.deltaX; ED.panY -= e.shiftKey ? 0 : e.deltaY; render(); renderOvl(); }
    }, { passive: false });
    ta.addEventListener("input", function () { if (ED.textL) { ED.textL.text.text = ta.value; placeText(); emit("textinput"); } });
    ta.addEventListener("keydown", function (e) { if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); finishText(); stage.focus(); } });
    ta.addEventListener("blur", function () { setTimeout(function () { if (ED.textL && document.activeElement !== ta && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("#props"))) finishText(); }, 0); });
    document.addEventListener("keydown", function (e) { if (e.code === "Space" && !isTyping(e)) { if (!space) { space = true; stage.style.cursor = "grab"; } if (document.activeElement === stage) e.preventDefault(); } });
    document.addEventListener("keyup", function (e) { if (e.code === "Space") { space = false; stage.style.cursor = ""; } });
    var t = S3.store("pe-tool"); if (TOOLS[t] && t !== "crop") ED.tool = t;
    PE.startWorker();
    sizeCanvases();
  };
  function isTyping(e) { var t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); }
  ED.isTyping = isTyping;
  ED.on("view", function () { if (ED.textL) placeText(); });
})();
