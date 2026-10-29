/* Selection lane: Refine selection workspace (Select › Refine selection…, Ctrl+Alt+R). Edge detection radius
   (+ smart radius), smooth, feather, contrast, shift edge, a refine-edge brush for hair and fur, an add/remove
   brush, previews (overlay, on black, on white, black & white, on layers, marching ants), decontaminate colours,
   and output to a selection, a layer mask, a new layer or a new layer with a mask. Preview runs at up to
   1600 px in the lane worker; OK computes the full-size result. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, h = S3.h;
  var PREVIEW_MAX = 1600, RM = null;
  var DEF = { radius: 0, smart: false, smooth: 0, feather: 0, contrast: 0, shift: 0, decon: false, deconAmt: 100, view: "overlay", opacity: 50, output: "selection" };
  SX.addIcons({ "t-refine": '<path d="M4 20c3-1 4.5-3.5 5.5-6.5"/><path d="M7.5 20c2.5-1.5 3.5-4 4-7"/><path d="M11 20c1.8-2 2.3-4.5 2.5-7.2"/><path d="M13.5 12.8 19 4.5l1.8 1.2-5.2 8.5"/>' });
  var saved = (S3.store("pe-opts") || {}).refine;
  ED.o.refine = Object.assign({ size: 40, brush: "edge" }, saved && typeof saved === "object" ? saved : {});

  function params() { var s = S3.store("pe-refine") || {}, o = {}; Object.keys(DEF).forEach(function (k) { o[k] = s[k] != null && typeof s[k] === typeof DEF[k] ? s[k] : DEF[k]; }); return o; }
  function saveParams() { if (RM) S3.store("pe-refine", RM.p); }
  function maskOf(c) { var d = PE.getData(c).data, m = new Uint8Array(c.width * c.height); for (var i = 0; i < m.length; i++) m[i] = d[i * 4 + 3]; return m; }
  function canvasOf(m, w, hh) { var c = PE.mk(w, hh), x = PE.cx2(c), im = x.createImageData(w, hh); for (var i = 0; i < m.length; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = m[i]; } x.putImageData(im, 0, 0); return c; }

  SX.openRefine = function () {
    if (!SX.need()) return;
    var d = ED.doc;
    if (!d.sel) { S3.toast("Make a selection first (Quick selection or Select › Subject are good starts)", "error"); return; }
    if (RM) return;
    ED.cancelModes();
    var k = Math.min(1, PREVIEW_MAX / Math.max(d.w, d.h)), comp = PE.flatten(d, { scale: k }), W = comp.width, H = comp.height, img = PE.getData(comp);
    var sc = PE.mk(W, H), sx = PE.cx2(sc); sx.imageSmoothingQuality = "high"; sx.drawImage(PE.selCanvas(d.sel), 0, 0, W, H);
    RM = { before: PE.snap(d), orig: d.sel, prevTool: ED.tool, k: k, W: W, H: H, img: { data: img.data, width: W, height: H }, base: sc, band: PE.mk(W, H), add: PE.mk(W, H), sub: PE.mk(W, H),
      p: params(), result: null, prev: null, busy: false, again: false, undo: [] };
    d.sel = null;           // the workspace shows its own preview instead of marching ants
    buildPanel();
    ED.setTool("refine");
    recompute();
  };
  function baseMask() {
    var c = PE.mk(RM.W, RM.H), x = PE.cx2(c);
    x.drawImage(RM.base, 0, 0); x.drawImage(RM.add, 0, 0); x.globalCompositeOperation = "destination-out"; x.drawImage(RM.sub, 0, 0);
    return maskOf(c);
  }
  function scaled(p, k) { return { radius: p.radius * k, smart: p.smart, smooth: p.smooth, feather: p.feather * k, contrast: p.contrast, shift: p.shift }; }
  function recompute() {
    if (!RM) return;
    if (RM.busy) { RM.again = true; return; }
    RM.busy = true; RM.again = false;
    var job = RM;
    SX.work("refine", [job.img, baseMask(), maskOf(job.band), scaled(job.p, job.k)]).then(function (a) {
      if (RM !== job) return;
      job.result = a; buildPreview();
    }).catch(function (e) { S3.toast(e.message, "error"); }).then(function () { job.busy = false; if (RM === job && job.again) recompute(); });
  }
  var soon = S3.debounce(recompute, 60);
  function buildPreview() {
    var r = RM, a = r.result, W = r.W, H = r.H, v = r.p.view, op = r.p.opacity / 100, d = ED.doc;
    if (v === "ants") { r.prev = null; d.sel = PE.makeSel(d, SX.scaleMask(a, W, H, d.w, d.h)); ED.renderOvl(); return; }
    d.sel = null;
    var c = r.prev && r.prev.width === W && r.prev.height === H ? r.prev : PE.mk(W, H), x = PE.cx2(c), im = x.createImageData(W, H), o = im.data, s = r.img.data;
    for (var i = 0, j = 0; i < a.length; i++, j += 4) {
      var t = a[i] / 255;
      if (v === "overlay") { o[j] = 255; o[j + 1] = 40; o[j + 2] = 60; o[j + 3] = (1 - t) * op * 255; }
      else if (v === "bw") { o[j] = o[j + 1] = o[j + 2] = a[i]; o[j + 3] = 255; }
      else if (v === "black" || v === "white") { var bgv = v === "white" ? 255 : 0, sa = s[j + 3] / 255 * t; o[j] = s[j] * sa + bgv * (1 - sa); o[j + 1] = s[j + 1] * sa + bgv * (1 - sa); o[j + 2] = s[j + 2] * sa + bgv * (1 - sa); o[j + 3] = 255; }
      else { var cb = ((Math.floor(i % W / 8) + Math.floor(i / W / 8)) & 1) ? 204 : 255, la = s[j + 3] / 255 * t; o[j] = s[j] * la + cb * (1 - la); o[j + 1] = s[j + 1] * la + cb * (1 - la); o[j + 2] = s[j + 2] * la + cb * (1 - la); o[j + 3] = 255; }
    }
    x.putImageData(im, 0, 0); r.prev = c; ED.renderOvl();
  }
  ED.on("overlay", function (o) {
    if (!RM || !RM.prev || !ED.doc) return;
    var d = ED.doc;
    o.docPath(o.c, function (c) { c.imageSmoothingEnabled = true; c.drawImage(RM.prev, 0, 0, d.w, d.h); });
  });

  // ---------- brushes ----------
  var stroke = null;
  ED.TOOLS.refine = {
    brush: true,
    down: function (p, e) {
      if (!RM) { ED.setTool("hand"); return; }
      var o = ED.o.refine, which = o.brush === "edge" ? RM.band : e.altKey ? RM.sub : RM.add, other = o.brush === "edge" ? null : e.altKey ? RM.add : RM.sub;
      RM.undo.push([RM.band, RM.add, RM.sub].map(function (c) { return PE.cloneCanvas(c); })); if (RM.undo.length > 30) RM.undo.shift();
      stroke = { c: PE.cx2(which), other: other ? PE.cx2(other) : null, last: null };
      ED.drag = { kind: "refine" }; dab(p);
    },
    move: function (p) { if (stroke) dab(p); },
    up: function () { ED.drag = null; stroke = null; recompute(); }
  };
  function dab(p) {
    var k = RM.k, r = Math.max(0.6, ED.o.refine.size / 2 * k), x = p.x * k, y = p.y * k, pts = [];
    if (stroke.last) { var dx = x - stroke.last.x, dy = y - stroke.last.y, n = Math.ceil(Math.hypot(dx, dy) / Math.max(0.5, r * 0.4)); for (var i = 1; i <= n; i++) pts.push([stroke.last.x + dx * i / n, stroke.last.y + dy * i / n]); }
    else pts.push([x, y]);
    pts.forEach(function (q) {
      stroke.c.fillStyle = "#fff"; stroke.c.beginPath(); stroke.c.arc(q[0], q[1], r, 0, Math.PI * 2); stroke.c.fill();
      if (stroke.other) { stroke.other.save(); stroke.other.globalCompositeOperation = "destination-out"; stroke.other.beginPath(); stroke.other.arc(q[0], q[1], r, 0, Math.PI * 2); stroke.other.fill(); stroke.other.restore(); }
    });
    stroke.last = { x: x, y: y };
    if (ED.o.refine.brush !== "edge") soon();
  }

  // ---------- panel ----------
  function buildPanel() {
    var w = ED.ui.w, p = RM.p, box = h("div", { "class": "pe-float pe-fxpanel pe-rmpanel", role: "dialog", "aria-label": "Refine selection" }), body = h("div", { "class": "pe-fbody" });
    function R(key, label, min, max, step, fmt) { return w.range(label, p[key], min, max, step, function (v) { p[key] = v; saveParams(); soon(); }, fmt); }
    var o = ED.o.refine;
    body.appendChild(w.seg("Brush", [["edge", "Refine edge", "Paint over hair, fur or soft edges to let the edge detection work there"], ["paint", "Add / remove", "Paint to add; Alt+paint to remove"]], o.brush, function (v) { o.brush = v; ED.saveOpts(); }));
    body.appendChild(w.range("Brush size", o.size, 1, 500, 1, function (v) { o.size = v; ED.saveOpts(); ED.renderOvl(); }, w.px));
    body.appendChild(w.select("View", [["overlay", "Overlay"], ["black", "On black"], ["white", "On white"], ["bw", "Black & white"], ["layers", "On transparency"], ["ants", "Marching ants"]], p.view, function (v) { p.view = v; saveParams(); if (RM.result) buildPreview(); }));
    body.appendChild(w.range("Overlay opacity", p.opacity, 0, 100, 1, function (v) { p.opacity = v; saveParams(); if (RM.result) buildPreview(); }, function (v) { return v + "%"; }));
    body.appendChild(h("h3", { "class": "pe-rmh", text: "Edge detection" }));
    body.appendChild(R("radius", "Radius", 0, 250, 1, w.px));
    body.appendChild(w.check("Smart radius", p.smart, function (v) { p.smart = v; saveParams(); soon(); }));
    body.appendChild(h("h3", { "class": "pe-rmh", text: "Edge" }));
    body.appendChild(R("smooth", "Smooth", 0, 100, 1));
    body.appendChild(R("feather", "Feather", 0, 250, 0.5, function (v) { return v + " px"; }));
    body.appendChild(R("contrast", "Contrast", 0, 100, 1, function (v) { return v + "%"; }));
    body.appendChild(R("shift", "Shift edge", -100, 100, 1, function (v) { return (v > 0 ? "+" : "") + v + "%"; }));
    body.appendChild(h("h3", { "class": "pe-rmh", text: "Output" }));
    body.appendChild(w.check("Decontaminate colours", p.decon, function (v) { p.decon = v; saveParams(); if (v && (p.output === "selection" || p.output === "mask")) { p.output = "layer"; outSel.querySelector("select").value = "layer"; } }));
    body.appendChild(w.range("Amount", p.deconAmt, 0, 100, 1, function (v) { p.deconAmt = v; saveParams(); }, function (v) { return v + "%"; }));
    var outSel = w.select("Output to", [["selection", "Selection"], ["mask", "Layer mask"], ["layer", "New layer"], ["layermask", "New layer with mask"]], p.output, function (v) { p.output = v; saveParams(); });
    body.appendChild(outSel);
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: "Refine selection" }), h("span", { "class": "faint", text: "Ctrl+Z undoes a stroke" })]));
    box.appendChild(body);
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [w.btn("Reset", function () { RM.p = Object.assign({}, DEF, { view: p.view, output: p.output }); saveParams(); RM.band = PE.mk(RM.W, RM.H); RM.add = PE.mk(RM.W, RM.H); RM.sub = PE.mk(RM.W, RM.H); RM.box.remove(); buildPanel(); recompute(); }, "ghost"),
      h("span", { "class": "grow" }), w.btn("Cancel", function () { close(false); }, "ghost"), w.btn("OK", function () { close(true); }, "primary")]));
    S3.$("#stage").appendChild(box);
    RM.box = box;
  }
  function close(ok) {
    var r = RM; if (!r) return;
    var d = ED.doc;
    function end() { RM = null; if (r.box) r.box.remove(); d.sel = r.orig; ED.setTool(r.prevTool === "refine" ? "marquee" : r.prevTool); ED.renderOvl(); }
    if (!ok) { end(); ED.changed(); return; }
    var p = r.p, full = PE.getData(PE.flatten(d)), up = function (c) { var u = PE.mk(d.w, d.h), x = PE.cx2(u); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, d.w, d.h); return maskOf(u); };
    var bm = PE.mk(d.w, d.h), bx = PE.cx2(bm); bx.drawImage(PE.selCanvas(r.orig), 0, 0); bx.drawImage(r.add, 0, 0, d.w, d.h); bx.globalCompositeOperation = "destination-out"; bx.drawImage(r.sub, 0, 0, d.w, d.h);
    var job = SX.work("refine", [{ data: full.data, width: d.w, height: d.h }, maskOf(bm), up(r.band), scaled(p, 1)]);
    end();
    ED.working(job, "Refining…").then(function (a) { output(r, a); }).catch(function (e) { S3.toast(e.message, "error"); ED.changed(); });
  }
  SX.closeRefine = close;
  function output(r, a) {
    var d = ED.doc, p = r.p, L = ED.layer(), out = p.output;
    if (out === "selection") { var s = PE.makeSel(d, a); d.sel = s; ED.push(PE.metaEntry("Refine selection", d, r.before)); return; }
    if (!L || L.kind === "group" || L.kind === "adjust") { S3.toast("Pick a pixel layer for this output; the result was kept as a selection", "error"); d.sel = PE.makeSel(d, a); ED.push(PE.metaEntry("Refine selection", d, r.before)); return; }
    var maskC = canvasOf(a, d.w, d.h);
    if (out === "mask") {
      if (L.mask) { var mx = PE.cx2(maskC); mx.globalCompositeOperation = "destination-in"; mx.drawImage(L.mask.canvas, L.mask.x, L.mask.y); }
      d.sel = null; L.mask = { canvas: PE.touch(maskC), x: 0, y: 0 }; L.maskOn = true;
      ED.push(PE.metaEntry("Refine selection: layer mask", d, r.before)); return;
    }
    var src = PE.flatten(d, { only: [L.id] }), finish = function (pix) {
      var nc = PE.mk(d.w, d.h), nx = PE.cx2(nc);
      nx.putImageData(new ImageData(pix, d.w, d.h), 0, 0);
      var NL = PE.rasterFromCanvas(PE.touch(nc), L.name + " (refined)");
      if (out === "layer") { var x2 = PE.cx2(nc); x2.globalCompositeOperation = "destination-in"; x2.drawImage(maskC, 0, 0); PE.touch(nc); }
      else { NL.mask = { canvas: PE.touch(maskC), x: 0, y: 0 }; NL.maskOn = true; }
      if (L.parent) NL.parent = L.parent;
      d.sel = null;
      d.layers.splice(d.layers.indexOf(L) + 1, 0, NL); L.visible = false; d.active = NL.id; ED.maskEdit = false;
      ED.push(PE.metaEntry("Refine selection: new layer", d, r.before)); ED.emit("layers");
    };
    var px = PE.getData(src).data;
    if (!p.decon) { finish(new Uint8ClampedArray(px)); return; }
    ED.working(SX.work("decontaminate", [{ data: px, width: d.w, height: d.h }, a, p.deconAmt / 100, Math.max(6, p.radius || 0)]), "Decontaminating colours…").then(finish).catch(function (e) { S3.toast(e.message, "error"); });
  }

  // ---------- guards while the workspace is open ----------
  ["undo", "redo"].forEach(function (fn) {
    var orig = ED[fn];
    ED[fn] = function () {
      if (!RM) return orig.apply(this, arguments);
      if (fn === "undo" && RM.undo.length) { var u = RM.undo.pop(); RM.band = u[0]; RM.add = u[1]; RM.sub = u[2]; recompute(); }
    };
  });
  ED.on("tool", function () { if (RM && ["refine", "hand", "zoom"].indexOf(ED.tool) < 0) { ED.setTool("refine"); S3.toast("Finish Refine selection first: OK or Cancel"); } });
  ED.on("changed", function (why) { if (RM && why === "open") { var r = RM; RM = null; if (r.box) r.box.remove(); } });
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (RM) {
      if (e.key === "Escape") { e.preventDefault(); close(false); return true; }
      if (e.key === "Enter" && !ED.isTyping(e)) { e.preventDefault(); close(true); return true; }
      var c = e.ctrlKey || e.metaKey;
      if (c && (e.key === "z" || e.key === "Z")) { e.preventDefault(); ED.undo(); return true; }
      if (!c && /^[a-zA-Z]$/.test(e.key) && "hz".indexOf(e.key.toLowerCase()) < 0) { e.preventDefault(); return true; }    // other tool keys stay off
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyR" && ED.doc) { e.preventDefault(); SX.openRefine(); return true; }
    return false;
  });
  (ED.ui.optsTail = ED.ui.optsTail || []).push(function (t, items) {
    if (["marquee", "ellipse", "lasso", "polygon", "wand", "qsel", "objsel"].indexOf(t) >= 0) items.push(ED.ui.w.btn("Refine…", function () { SX.openRefine(); }, "ghost", null, "Refine the selection's edge (Ctrl+Alt+R)"));
    if (t === "refine") items.push(h("span", { "class": "pe-hint", text: "Refine edge brush: paint over hair or soft edges. Add / remove brush: paint to add, Alt to remove. Space pans." }));
  });
  SX.menu("Select", [["Refine selection…", "Ctrl+Alt+R", function () { SX.openRefine(); }, SX.hasSel]], "Smooth…");
  ED.ui.TOOLS.push(["refine", "Refine edge brush (Refine selection)", ""]);
  document.addEventListener("DOMContentLoaded", function () { var b = S3.$('.pe-tool[data-tool="refine"]'); if (b) b.hidden = true; });

  SX.tests.push(async function (ok, near) {
    // a hard-edged mask over a soft (blurred) image edge: radius lets the guided filter follow the image
    var W = 40, H = 4, img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H }, m = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var i = (y * W + x) * 4, t = Math.min(1, Math.max(0, (x - 16) / 8)); img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * (1 - t); img.data[i + 3] = 255; m[y * W + x] = x < 20 ? 255 : 0; }
    var r0 = window.PIXS.refine(img, m, null, { radius: 0 }); ok(r0[2 * W + 19] === 255 && r0[2 * W + 20] === 0, "radius 0 keeps the mask");
    var r1 = window.PIXS.refine(img, m, null, { radius: 10 }); ok(r1[2 * W + 18] > r1[2 * W + 21] && r1[2 * W + 21] > 0 && r1[2 * W + 21] < 255 && r1[2 * W + 5] > 250 && r1[2 * W + 35] < 5, "edge detection softens along the image edge");
    var f = window.PIXS.refine(img, m, null, { feather: 6 }); ok(f[2 * W + 20] > 40 && f[2 * W + 20] < 215, "feather");
    var c = window.PIXS.refine(img, m, null, { feather: 6, contrast: 90 }); ok(c[2 * W + 17] === 255 || c[2 * W + 17] > f[2 * W + 17], "contrast sharpens");
    var sh = window.PIXS.refine(img, m, null, { feather: 6, shift: 60 }); ok(sh[2 * W + 21] > f[2 * W + 21], "shift edge expands");
    var di = new Uint8ClampedArray(12 * 4), da = new Uint8Array(12); for (var q = 0; q < 12; q++) { di.set(q < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255], q * 4); da[q] = q < 6 ? 255 : 128; }
    var dc = window.PIXS.decontaminate({ data: di, width: 12, height: 1 }, da, 1, 4); ok(dc[6 * 4] > 100 && dc[6 * 4 + 2] < 255 && dc[0] === 255, "decontaminate pulls edge colours inward");
    // workspace end to end: open, change radius, OK to a selection
    var bg = PE.rasterFromCanvas(SX.solid(60, 40, "#808080"), "bg"), d = SX.scratch(60, 40, [bg]); d.sel = PE.makeSel(d, PIX.rectMask(60, 40, 10, 10, 30, 20));
    var keep = S3.store("pe-refine"); S3.store("pe-refine", { output: "selection", feather: 4 });
    SX.openRefine(); ok(!d.sel && ED.tool === "refine", "workspace opens with its own preview");
    for (var t = 0; t < 100 && (!RM || !RM.result); t++) await new Promise(function (r) { setTimeout(r, 20); });
    SX.closeRefine(true);
    for (t = 0; t < 150 && ED.hist.pos === 0; t++) await new Promise(function (r) { setTimeout(r, 20); });
    ok(d.sel && d.sel.m[25 * 60 + 25] === 255 && d.sel.m[25 * 60 + 10] > 40 && d.sel.m[25 * 60 + 10] < 215, "refine outputs a feathered selection");
    ED.undo(); ok(d.sel && d.sel.m[25 * 60 + 10] === 255, "undo restores the original selection");
    S3.store("pe-refine", keep || {});
  });
})();
