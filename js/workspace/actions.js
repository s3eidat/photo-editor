/* Workspace (files lane): Actions panel. Record a series of commands (image / canvas size, fit image, crop, trim,
   rotate, flip, selections, fills, layer commands, adjustments and filters with their settings, opacity and blend,
   free transform, exports) and play it back on any document, or on many files with File › Automate › Batch….
   Steps can be switched off, removed or moved; actions can be exported / imported as .json (validated).
   Painting, text and freehand selections are not recorded (they depend on where you click). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, h = S3.h, W = ED.ui.w;
  var A = WS.actions = { recording: null, playing: false };

  // ---------- step types: label(p), run(p) -> promise | value ----------
  function frac(v, n) { return Math.round(v * n); }
  function adjRun(op, p) {     // apply an adjustment / filter with its settings to the current layer (inside the selection)
    var L = ED.layer(); if (!ED.editable(L, "pixels")) throw new Error("No editable layer");
    var r = { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }, img = PE.getData(L.canvas), sel = PE.selFor(ED.doc, r);
    return PE.work("adjust", [{ data: img.data, width: img.width, height: img.height }, op, p, sel]).then(function (res) {
      var n = PE.mk(r.w, r.h); PE.cx2(n).putImageData(new ImageData(new Uint8ClampedArray(res.data), r.w, r.h), 0, 0);
      ED.meta((ED.ADJ[op] && ED.ADJ[op].t) || op, function () { L.canvas = PE.touch(n); });
    });
  }
  function title(op) { return (ED.ADJ[op] && ED.ADJ[op].t) || ({ invert: "Invert", desaturate: "Desaturate", sharpen: "Sharpen" })[op] || op; }
  var LAYER_OPS = { "New layer": "newLayer", "Duplicate layer": "duplicate", "Delete layer": "remove", "Bring forward": "up", "Send backward": "down", "Layer via copy": "viaCopy", "Layer via cut": "viaCut",
    "Add layer mask": "addMask", "Add mask from selection": "addMaskSel", "Merge down": "mergeDown", "Merge visible": "mergeVisible", "Flatten image": "flatten", "Rasterize layer": "rasterize" };
  var T = A.types = {
    imageSize: { label: function (p) { return "Image size " + p.w + " × " + p.h; }, run: function (p) { var d = ED.doc, w = p.w, hh = p.h; if (d.w !== p.w0 || d.h !== p.h0) { w = Math.max(1, Math.round(d.w * p.w / p.w0)); hh = Math.max(1, Math.round(d.h * p.h / p.h0)); } ED.imageSize(w, hh); } },
    fitImage: { label: function (p) { return "Fit image in " + p.w + " × " + p.h + (p.up ? "" : " (no enlarging)"); }, run: function (p) { A.fitImage(p.w, p.h, p.up); } },
    canvasSize: { label: function (p) { return "Canvas size " + p.w + " × " + p.h; }, run: function (p) { ED.canvasSize(p.w, p.h, p.anchor, p.fill); } },
    rotate: { label: function (p) { return { cw: "Rotate 90° clockwise", ccw: "Rotate 90° counter-clockwise", "180": "Rotate 180°", fh: "Flip canvas horizontal", fv: "Flip canvas vertical" }[p.how] || "Rotate"; }, run: function (p) { ED.rotateCanvas(p.how); } },
    flipLayer: { label: function (p) { return p.axis === "h" ? "Flip layer horizontal" : "Flip layer vertical"; }, run: function (p) { ED.flipLayer(p.axis); } },
    crop: { label: function (p) { return "Crop " + Math.round(p.w * 100) + "% × " + Math.round(p.h * 100) + "%"; }, run: function (p) { var d = ED.doc; ED.crop = { x: frac(p.x, d.w), y: frac(p.y, d.h), w: Math.max(1, frac(p.w, d.w)), h: Math.max(1, frac(p.h, d.h)) }; ED.applyCrop(); } },
    trim: { label: function (p) { return "Trim (" + ({ alpha: "transparent", tl: "top-left colour", br: "bottom-right colour" })[p.based] + ")"; }, run: function (p) { FX.trim.trim(p.based, p.sides); } },
    revealAll: { label: function () { return "Reveal all"; }, run: function () { FX.trim.revealAll(); } },
    select: { label: function (p) { return { all: "Select all", none: "Deselect", inverse: "Inverse" }[p.k]; }, run: function (p) { if (p.k === "all") ED.selectAll(); else if (p.k === "none") ED.deselect(); else ED.invertSel(); } },
    marquee: { label: function (p) { return (p.ellipse ? "Elliptical" : "Rectangular") + " marquee" + (p.mode !== "new" ? " (" + p.mode + ")" : ""); },
      run: function (p) { var d = ED.doc, r = { x: frac(p.x, d.w), y: frac(p.y, d.h), w: Math.max(1, frac(p.w, d.w)), h: Math.max(1, frac(p.h, d.h)) }; ED.setSelection(ED.marqueeMask(r, p.ellipse), p.mode, p.ellipse ? "Elliptical marquee" : "Rectangular marquee", p.feather || 0); } },
    modifySel: { label: function (p) { return { feather: "Feather", expand: "Expand selection", contract: "Contract selection" }[p.how] + " " + p.r + " px"; }, run: function (p) { ED.modifySel(p.how, p.r); return A.idle(); } },
    fill: { label: function (p) { return "Fill " + p.color; }, run: function (p) { ED.fillSel(p.color, "Fill"); } },
    layer: { label: function (p) { return Object.keys(LAYER_OPS).filter(function (k) { return LAYER_OPS[k] === p.op; })[0] || p.op; },
      run: function (p) { var O = ED.LOPS; if (p.op === "viaCut") O.viaCopy(true); else if (p.op === "viaCopy") O.viaCopy(false); else if (p.op === "addMaskSel") O.addMask(true); else if (p.op === "rasterize") ED.rasterize(ED.layer(), true); else if (O[p.op]) O[p.op](); } },
    opacity: { label: function (p) { return "Layer opacity " + Math.round(p.v * 100) + "%"; }, run: function (p) { var L = ED.layer(); if (L) ED.meta("Layer opacity", function () { L.opacity = p.v; }); } },
    blend: { label: function (p) { return "Blend mode " + p.v; }, run: function (p) { var L = ED.layer(); if (L && PE.BLENDS.indexOf(p.v) >= 0) ED.meta("Blend mode", function () { L.blend = p.v; }); } },
    adjust: { label: function (p) { return title(p.op) + (p.p && Object.keys(p.p).length ? "…" : ""); }, run: function (p) { return adjRun(p.op, p.p || {}); } },
    transform: { label: function (p) { return "Free transform " + Math.round(p.sx * 100) + "% × " + Math.round(p.sy * 100) + "%" + (p.rot ? ", " + Math.round(p.rot * 10) / 10 + "°" : ""); },
      run: function (p) { ED.startTransform(); if (!ED.xf) return; ED.xf.sx = p.sx; ED.xf.sy = p.sy; ED.xf.rot = p.rot; ED.xf.tx = p.tx; ED.xf.ty = p.ty; ED.applyTransform(); } },
    nudge: { label: function (p) { return "Move " + p.dx + ", " + p.dy; }, run: function (p) { ED.nudge(p.dx, p.dy); } },
    exportAs: { label: function (p) { return "Export as " + FX.exp.formats[p.st.fmt].label + (p.st.scale !== 1 ? " at " + Math.round(p.st.scale * 100) + "%" : ""); }, run: function (p, ctx) { return A.exportStep(p.st, ctx); } },
    savePsd: { label: function () { return "Save as PSD"; }, run: function (p, ctx) { return FX.psd.save(ED.doc).then(function (u8) { var b = new Blob([u8], { type: "image/vnd.adobe.photoshop" }); A.output(b, "psd", ctx); }); } },
    stop: { label: function (p) { return "Stop: " + p.msg; }, run: function (p, ctx) { if (ctx && ctx.batch) return; return new Promise(function (res, rej) { var dlg = W.modal("Action paused", h("p", { "class": "pe-p", text: p.msg }), [h("span", { "class": "grow" }), W.btn("Stop", function () { dlg.close(); rej(new Error("Stopped")); }, "ghost"), W.btn("Continue", function () { dlg.close(); res(); }, "primary")]); }); } }
  };
  A.idle = function () { return new Promise(function (res) { (function wait() { if (!ED.busy) res(); else setTimeout(wait, 30); })(); }); };
  A.fitImage = function (w, hh, up) { var d = ED.doc, k = Math.min(w / d.w, hh / d.h); if (!up) k = Math.min(1, k); if (Math.abs(k - 1) < 1e-9) return; ED.imageSize(Math.max(1, Math.round(d.w * k)), Math.max(1, Math.round(d.h * k))); };
  A.output = function (blob, ext, ctx, suffix) {
    if (ctx && ctx.collect) { ctx.collect(blob, ext); return; }
    FX.download(blob, FX.fname(ext, ED.doc, suffix || ""));
  };
  A.exportStep = function (st, ctx) { var X = FX.exp; return X.encode(X.render(ED.doc, st, false), st, ED.doc).then(function (b) { A.output(b, X.formats[st.fmt].ext, ctx); }); };

  // ---------- storage ----------
  var DEFAULTS = [
    { name: "Web 1600 px (JPG 85%)", steps: [{ t: "fitImage", p: { w: 1600, h: 1600, up: false } }, { t: "exportAs", p: { st: { fmt: "jpg", q: 0.85, scale: 1, trans: false, matte: "#ffffff", comp: "lzw", meta: "none", smooth: true } } }] },
    { name: "Square 1080 for social", steps: [{ t: "fitImage", p: { w: 1080, h: 1080, up: true } }, { t: "canvasSize", p: { w: 1080, h: 1080, anchor: 4, fill: "#ffffff" } }] },
    { name: "Black & white + vignette", steps: [{ t: "layer", p: { op: "flatten" } }, { t: "adjust", p: { op: "bw", p: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 } } }, { t: "adjust", p: { op: "vignette", p: { amount: -60, size: 45, soft: 60 } } }] }
  ];
  var DATA = S3.store("pe-actions"); if (!DATA || !Array.isArray(DATA.actions)) DATA = { actions: PE.clone(DEFAULTS) };
  A.data = function () { return DATA; };
  function save() { S3.store("pe-actions", DATA); }
  A.save = save;
  var sel = { a: Math.min(0, DATA.actions.length - 1), s: -1 };

  // ---------- recording ----------
  var depth = 0;
  A.rec = function (t, p) {
    if (!A.recording || A.playing || depth > 1 || ED.testing && !A.testRec) return;
    A.recording.steps.push({ t: t, p: PE.clone(p) }); save(); render();
  };
  function wrap(obj, name, fn) {
    var f0 = obj[name]; if (typeof f0 !== "function") return;
    obj[name] = function () { depth++; try { if (depth === 1) fn.apply(this, arguments); return f0.apply(this, arguments); } finally { depth--; } };
  }
  function recorders() {
    wrap(ED, "imageSize", function (w, hh) { A.rec("imageSize", { w: w, h: hh, w0: ED.doc.w, h0: ED.doc.h }); });
    wrap(ED, "canvasSize", function (w, hh, anchor, fill) { A.rec("canvasSize", { w: w, h: hh, anchor: anchor, fill: fill || "transparent" }); });
    wrap(ED, "rotateCanvas", function (how) { A.rec("rotate", { how: how }); });
    wrap(ED, "flipLayer", function (axis) { A.rec("flipLayer", { axis: axis }); });
    wrap(ED, "fillSel", function (color) { A.rec("fill", { color: color }); });
    wrap(ED, "selectAll", function () { A.rec("select", { k: "all" }); });
    wrap(ED, "deselect", function () { if (ED.doc && ED.doc.sel) A.rec("select", { k: "none" }); });
    wrap(ED, "invertSel", function () { A.rec("select", { k: "inverse" }); });
    wrap(ED, "modifySel", function (how, r) { if (ED.doc.sel) A.rec("modifySel", { how: how, r: r }); });
    wrap(ED, "applyCrop", function () { var r = ED.crop, d = ED.doc; if (r) A.rec("crop", { x: r.x / d.w, y: r.y / d.h, w: r.w / d.w, h: r.h / d.h }); });
    wrap(ED, "applyTransform", function () { var x = ED.xf; if (x && (x.sx !== 1 || x.sy !== 1 || x.rot || x.tx || x.ty)) A.rec("transform", { sx: x.sx, sy: x.sy, rot: x.rot, tx: x.tx, ty: x.ty }); });
    wrap(ED, "nudge", function (dx, dy) { A.rec("nudge", { dx: dx, dy: dy }); });
    wrap(ED, "setSelection", function (m, mode, label, feather) {
      if (label !== "Rectangular marquee" && label !== "Elliptical marquee") return;
      var d = ED.doc, b = window.PIX.bounds(m, d.w, d.h, 0); if (!b) return;
      A.rec("marquee", { x: b.x / d.w, y: b.y / d.h, w: b.w / d.w, h: b.h / d.h, ellipse: label === "Elliptical marquee", mode: mode || "new", feather: feather || 0 });
    });
    wrap(FX.trim, "trim", function (based, sides) { A.rec("trim", { based: based, sides: sides || null }); });
    wrap(FX.trim, "revealAll", function () { A.rec("revealAll", {}); });
    // parameterless layer commands and quick adjustments are recognised by their history label
    wrap(ED, "meta", function (label) {
      if (LAYER_OPS[label]) { A.rec("layer", { op: LAYER_OPS[label] }); return; }
      if (label === "Blend mode") { setTimeout(function () { var L = ED.layer(); if (L) A.rec("blend", { v: L.blend }); }, 0); return; }
      if (label === "Layer opacity") { setTimeout(function () { var L = ED.layer(); if (L) A.rec("opacity", { v: L.opacity }); }, 0); return; }
      var q = { "Invert": "invert", "Desaturate": "desaturate", "Sharpen": "sharpen" }[label];
      if (q) { A.rec("adjust", { op: q, p: {} }); return; }
      if (pendingAdj && title(pendingAdj.op) === label) { A.rec("adjust", pendingAdj); pendingAdj = null; }
    });
    var push0 = ED.push;
    ED.push = function (e) { var r = push0.apply(this, arguments); if (e && e.label === "Layer opacity" && depth === 0) { var L = ED.layer(); if (L) A.rec("opacity", { v: L.opacity }); } return r; };
  }
  // adjustment settings are read when OK is pressed in the floating panel
  var pendingAdj = null;
  function grabAdj() { var st = ED.ui.floatState && ED.ui.floatState(); if (st) pendingAdj = { op: st.op, p: PE.clone(st.p) }; }
  document.addEventListener("click", function (e) { if (A.recording && e.target.closest && e.target.closest("#float .pe-ffoot .btn.primary")) grabAdj(); }, true);
  document.addEventListener("keydown", function (e) { if (A.recording && e.key === "Enter") grabAdj(); }, true);

  // ---------- playback ----------
  A.play = function (act, ctx, onStep) {
    if (!ED.doc) return Promise.reject(new Error("Open a document first"));
    A.playing = true;
    var chain = Promise.resolve();
    act.steps.forEach(function (s, i) {
      if (s.on === false || !T[s.t]) return;
      chain = chain.then(function () { if (onStep) onStep(i, s); return T[s.t].run(s.p || {}, ctx); }).then(A.idle);
    });
    return chain.then(function () { A.playing = false; }, function (e) { A.playing = false; throw e; });
  };

  // ---------- validation for imported actions ----------
  A.clean = function (raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var name = typeof raw.name === "string" ? raw.name.replace(/[\u0000-\u001f]/g, " ").slice(0, 80) : "Action", steps = [];
    (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 200).forEach(function (s) {
      if (!s || !T[s.t]) return;
      var p = s.p && typeof s.p === "object" && !Array.isArray(s.p) ? JSON.parse(JSON.stringify(s.p)) : {};
      var n = function (v, a, b, d) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }, L = PE.LIM.side;
      switch (s.t) {
        case "imageSize": p = { w: n(p.w, 1, L, 100), h: n(p.h, 1, L, 100), w0: n(p.w0, 1, L, 100), h0: n(p.h0, 1, L, 100) }; break;
        case "fitImage": p = { w: n(p.w, 1, L, 1000), h: n(p.h, 1, L, 1000), up: p.up === true }; break;
        case "canvasSize": p = { w: n(p.w, 1, L, 100), h: n(p.h, 1, L, 100), anchor: Math.round(n(p.anchor, 0, 8, 4)), fill: p.fill === "transparent" ? "transparent" : PE.hex(p.fill, "transparent") }; break;
        case "rotate": if (["cw", "ccw", "180", "fh", "fv"].indexOf(p.how) < 0) return; p = { how: p.how }; break;
        case "flipLayer": p = { axis: p.axis === "v" ? "v" : "h" }; break;
        case "crop": case "marquee": var o = { x: n(p.x, -1, 2, 0), y: n(p.y, -1, 2, 0), w: n(p.w, 0.0001, 3, 1), h: n(p.h, 0.0001, 3, 1) }; if (s.t === "marquee") { o.ellipse = p.ellipse === true; o.mode = ["new", "add", "subtract", "intersect"].indexOf(p.mode) >= 0 ? p.mode : "new"; o.feather = n(p.feather, 0, 250, 0); } p = o; break;
        case "trim": p = { based: ["alpha", "tl", "br"].indexOf(p.based) >= 0 ? p.based : "alpha", sides: p.sides && typeof p.sides === "object" ? { top: p.sides.top !== false, left: p.sides.left !== false, bottom: p.sides.bottom !== false, right: p.sides.right !== false } : null }; break;
        case "select": if (["all", "none", "inverse"].indexOf(p.k) < 0) return; p = { k: p.k }; break;
        case "modifySel": if (["feather", "expand", "contract"].indexOf(p.how) < 0) return; p = { how: p.how, r: n(p.r, 1, 250, 1) }; break;
        case "fill": p = { color: PE.hex(p.color, "#000000") }; break;
        case "layer": if (Object.keys(LAYER_OPS).map(function (k) { return LAYER_OPS[k]; }).indexOf(p.op) < 0) return; p = { op: p.op }; break;
        case "opacity": p = { v: n(p.v, 0, 1, 1) }; break;
        case "blend": if (PE.BLENDS.indexOf(p.v) < 0) return; p = { v: p.v }; break;
        case "adjust": if (!(ED.ADJ[p.op] || ["invert", "desaturate", "sharpen"].indexOf(p.op) >= 0) || typeof p.op !== "string") return; p = { op: p.op, p: p.p && typeof p.p === "object" ? p.p : {} }; break;
        case "transform": p = { sx: n(p.sx, -100, 100, 1), sy: n(p.sy, -100, 100, 1), rot: n(p.rot, -360, 360, 0), tx: n(p.tx, -1e5, 1e5, 0), ty: n(p.ty, -1e5, 1e5, 0) }; break;
        case "nudge": p = { dx: Math.round(n(p.dx, -1e4, 1e4, 0)), dy: Math.round(n(p.dy, -1e4, 1e4, 0)) }; break;
        case "exportAs": var st = p.st || {}, fm = FX.exp.formats[st.fmt] ? st.fmt : "png"; p = { st: { fmt: fm, q: n(st.q, 0.05, 1, 0.9), scale: n(st.scale, 0.01, 10, 1), trans: st.trans !== false, matte: PE.hex(st.matte, "#ffffff"), comp: ["none", "lzw", "zip"].indexOf(st.comp) >= 0 ? st.comp : "lzw", meta: "none", smooth: st.smooth !== false } }; break;
        case "savePsd": case "revealAll": p = {}; break;
        case "stop": p = { msg: typeof p.msg === "string" ? p.msg.slice(0, 300) : "" }; break;
      }
      steps.push({ t: s.t, p: p, on: s.on !== false });
    });
    return { name: name || "Action", steps: steps };
  };

  // ---------- panel ----------
  var list = null, recBtn, status;
  function cur() { return DATA.actions[sel.a] || null; }
  function render() {
    if (!list) return;
    list.textContent = "";
    DATA.actions.forEach(function (act, i) {
      var open = i === sel.a, row = h("div", { "class": "ws-arow" + (open ? " on" : "") + (A.recording === act ? " rec" : ""), tabindex: "0", role: "option", "aria-selected": String(open) },
        [h("span", { "class": "ws-acaret", text: open ? "▾" : "▸" }), h("span", { "class": "ws-aname", dir: "auto", text: act.name }), h("span", { "class": "faint", text: String(act.steps.length) })]);
      row.addEventListener("click", function () { sel.a = open ? -1 : i; sel.s = -1; render(); });
      row.addEventListener("dblclick", function () { renameAction(act); });
      list.appendChild(row);
      if (!open) return;
      act.steps.forEach(function (s, k) {
        var chk = h("input", { type: "checkbox", "aria-label": "Include this step" }); chk.checked = s.on !== false;
        chk.addEventListener("click", function (e) { e.stopPropagation(); s.on = chk.checked; save(); });
        var srow = h("div", { "class": "ws-astep" + (sel.s === k ? " on" : "") }, [chk, h("span", { text: T[s.t] ? T[s.t].label(s.p || {}) : s.t })]);
        srow.addEventListener("click", function () { sel.s = sel.s === k ? -1 : k; render(); });
        list.appendChild(srow);
      });
      if (!act.steps.length) list.appendChild(h("p", { "class": "faint pe-p ws-astep", text: A.recording === act ? "Recording… run commands now." : "No steps yet: press ● to record." }));
    });
    recBtn.classList.toggle("on", !!A.recording);
    status.textContent = A.recording ? "● Recording “" + A.recording.name + "”" : "";
  }
  A.render = render;
  function renameAction(act) {
    var i = h("input", { "class": "input", value: act.name, maxlength: "80", dir: "auto" });
    var dlg = W.modal("Action name", h("div", { "class": "stack" }, [W.field("Name", i)]), [h("span", { "class": "grow" }), W.btn("OK", function () { act.name = i.value.trim().slice(0, 80) || act.name; save(); dlg.close(); render(); }, "primary")]);
  }
  A.newAction = function () { var act = { name: "Action " + (DATA.actions.length + 1), steps: [] }; DATA.actions.push(act); sel.a = DATA.actions.length - 1; save(); render(); renameAction(act); return act; };
  A.record = function () {
    if (A.recording) { A.stop(); return; }
    var act = cur() || A.newAction(); A.recording = act; render(); S3.toast("Recording: run the commands you want, then press ■");
  };
  A.stop = function () { A.recording = null; render(); };
  A.playSel = function () {
    var act = cur(); if (!act) { S3.toast("Pick an action first"); return; }
    if (A.recording) A.stop();
    if (!FX.need()) return;
    var from = sel.s >= 0 ? { name: act.name, steps: act.steps.slice(sel.s) } : act;
    ED.working(A.play(from, null, function (i, s) { status.textContent = "▶ " + (T[s.t] ? T[s.t].label(s.p || {}) : s.t); }), "Playing action…").then(function () { status.textContent = ""; S3.toast("Played “" + act.name + "”"); })
      .catch(function (e) { status.textContent = ""; if (e.message !== "Stopped") S3.toast(e.message, "error"); });
  };
  function stepOp(fn) { var act = cur(); if (!act || sel.s < 0) { S3.toast("Pick a step first"); return; } fn(act); save(); render(); }
  A.panel = WS.panel({ id: "actions", title: "Actions", open: false, shown: false,
    build: function (body) {
      function b(txt, title, fn, cls) { return h("button", { type: "button", "class": "btn ghost small ws-abtn " + (cls || ""), title: title, "aria-label": title, onclick: fn }, [txt]); }
      recBtn = b("●", "Record / stop recording", A.record, "ws-rec");
      var file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
      file.addEventListener("change", function () {
        var f = file.files[0]; file.value = ""; if (!f || f.size > 1e6) return;
        f.text().then(function (t) {
          var d = JSON.parse(t), arr = d && d.format === "s3pe-actions" && Array.isArray(d.actions) ? d.actions : null;
          if (!arr) throw new Error("That is not a Photo Editor actions file");
          var n = 0; arr.slice(0, 100).forEach(function (r) { var c = A.clean(r); if (c) { DATA.actions.push(c); n++; } });
          save(); render(); S3.toast("Imported " + n + " action" + (n === 1 ? "" : "s"));
        }).catch(function (e) { S3.toast(e.message || "Bad file", "error"); });
      });
      list = h("div", { "class": "ws-alist", role: "listbox", "aria-label": "Actions" });
      status = h("div", { "class": "ws-astatus faint" });
      body.appendChild(list); body.appendChild(status);
      body.appendChild(h("div", { "class": "ws-abar" }, [recBtn, b("■", "Stop recording", A.stop), b("▶", "Play the action (from the selected step)", A.playSel),
        b(W.svg("i-plus"), "New action", A.newAction), b(W.svg("i-copy"), "Duplicate action", function () { var a = cur(); if (!a) return; var c = PE.clone(a); c.name += " copy"; DATA.actions.splice(sel.a + 1, 0, c); sel.a++; save(); render(); }),
        b("↑", "Move step up", function () { stepOp(function (a) { if (sel.s > 0) { a.steps.splice(sel.s - 1, 0, a.steps.splice(sel.s, 1)[0]); sel.s--; } }); }),
        b("↓", "Move step down", function () { stepOp(function (a) { if (sel.s < a.steps.length - 1) { a.steps.splice(sel.s + 1, 0, a.steps.splice(sel.s, 1)[0]); sel.s++; } }); }),
        b("‖", "Insert a stop (message) after the selected step", function () { var a = cur(); if (!a) return; var i = h("input", { "class": "input", maxlength: "300", value: "Check the image, then continue" }); var dlg = W.modal("Insert stop", h("div", { "class": "stack" }, [W.field("Message", i)]), [h("span", { "class": "grow" }), W.btn("Insert", function () { a.steps.splice(sel.s >= 0 ? sel.s + 1 : a.steps.length, 0, { t: "stop", p: { msg: i.value.slice(0, 300) } }); save(); render(); dlg.close(); }, "primary")]); }),
        b(W.svg("i-trash"), "Delete the selected step (or the whole action)", function () {
          var a = cur(); if (!a) return;
          if (sel.s >= 0) { a.steps.splice(sel.s, 1); sel.s = Math.min(sel.s, a.steps.length - 1); }
          else { DATA.actions.splice(sel.a, 1); if (A.recording === a) A.recording = null; sel.a = Math.min(sel.a, DATA.actions.length - 1); }
          save(); render();
        })]));
      body.appendChild(h("div", { "class": "ws-abar" }, [W.btn("Export…", function () { FX.download(new Blob([JSON.stringify({ format: "s3pe-actions", version: 1, actions: DATA.actions }, null, 1)], { type: "application/json" }), "photo-editor-actions.json"); }, "ghost"),
        W.btn("Import…", function () { file.click(); }, "ghost"), W.btn("Batch…", function () { if (WS.batch) WS.batch.dialog(); }, "ghost"), file]));
      render();
    } });
  FX.menu("Image", ["Fit image…", "", function () {
    if (!FX.need()) return; var st = Object.assign({ w: 1600, h: 1600, up: false }, S3.store("pe-fit") || {});
    var wI = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: String(st.w) }), hI = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: String(st.h) });
    var dlg = W.modal("Fit image", h("div", { "class": "stack" }, [h("p", { "class": "faint pe-p", text: "Resizes so the image fits inside this box, keeping its proportions." }), h("div", { "class": "pe-custom" }, [W.field("Width", wI), W.field("Height", hI)]), W.check("Allow enlarging", st.up, function (v) { st.up = v; })]),
      [h("span", { "class": "grow" }), W.btn("OK", function () { st.w = PE.clamp(Math.round(+wI.value || 1), 1, PE.LIM.side); st.h = PE.clamp(Math.round(+hI.value || 1), 1, PE.LIM.side); S3.store("pe-fit", st); dlg.close(); A.rec("fitImage", st); depth++; try { A.fitImage(st.w, st.h, st.up); } finally { depth--; } }, "primary")]);
  }, FX.has], "Image size…");
  document.addEventListener("DOMContentLoaded", recorders);
  WS.key(function (e) { return e.altKey && !WS.ctrl(e) && e.key === "F9"; }, function () { WS.panels.show("actions", true); }, true);

  FX.tests.push(async function (ok, near, px, solid) {
    var keep = { doc: ED.doc, hist: ED.hist, data: DATA, rec: A.recording };
    DATA = { actions: [] }; A.testRec = true;
    var d = PE.newDoc(200, 100, "act"); d.layers = [PE.rasterFromCanvas(solid(200, 100, "#336699"), "bg")]; d.active = d.layers[0].id; ED.doc = d; ED.hist = new PE.History(1e8, 60);
    var act = { name: "t", steps: [] }; DATA.actions.push(act); A.recording = act;
    ED.imageSize(100, 50); ED.selectAll(); ED.invertSel(); ED.deselect(); ED.rotateCanvas("cw"); ED.LOPS.duplicate(); ED.fillSel("#ff0000");
    A.recording = null;
    ok(act.steps.map(function (s) { return s.t; }).join() === "imageSize,select,select,rotate,layer,fill", "recorded steps " + act.steps.map(function (s) { return s.t; }).join());
    var d2 = PE.newDoc(400, 200, "act2"); d2.layers = [PE.rasterFromCanvas(solid(400, 200, "#000000"), "bg")]; d2.active = d2.layers[0].id; ED.doc = d2; ED.hist = new PE.History(1e8, 60);
    await A.play(act);
    ok(d2.w === 100 && d2.h === 200 && d2.layers.length === 2 && px(d2.layers[1].canvas, 10, 10)[0] === 255, "played on another document (relative size, rotate, duplicate, fill) " + d2.w + "x" + d2.h);
    var c = A.clean({ name: "x\u0000y", steps: [{ t: "imageSize", p: { w: 1e9, h: -4 } }, { t: "eval", p: {} }, { t: "rotate", p: { how: "spin" } }, { t: "adjust", p: { op: "invert" } }, { t: "exportAs", p: { st: { fmt: "exe" } } }] });
    ok(c.name === "x y" && c.steps.length === 3 && c.steps[0].p.w === PE.LIM.side && c.steps[0].p.h === 1 && c.steps[2].p.st.fmt === "png", "imported actions are validated");
    // an adjustment with settings replays
    var d3 = PE.newDoc(4, 4, "a3"); d3.layers = [PE.rasterFromCanvas(solid(4, 4, "#ff0000"), "bg")]; d3.active = d3.layers[0].id; ED.doc = d3; ED.hist = new PE.History(1e8, 60);
    await A.play({ steps: [{ t: "adjust", p: { op: "hueSat", p: { hue: 120, sat: 0, light: 0, colorize: false } } }] });
    ok(px(d3.layers[0].canvas, 1, 1).slice(0, 3).join() === "0,255,0", "adjustment step with settings");
    DATA = keep.data; A.recording = keep.rec; A.testRec = false; ED.doc = keep.doc; ED.hist = keep.hist;
  });
})();
