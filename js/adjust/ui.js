/* Adjust lane UI: registers the extra adjustments and filters (js/adjust/*.js maths) with the editor's
   live-preview panel (ED.ADJ + spec.ui), adds their menu entries (with drill-down submenus) and shortcuts. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, h = S3.h, $ = S3.$;
  var AUI = PE.adjUI = {};
  function kit() { return ED.adjKit; }
  var pc = function (v) { return v + "%"; }, pxf = function (v) { return v + " px"; };
  function has() { return !!ED.doc; }
  AUI.has = has; AUI.pc = pc; AUI.pxf = pxf;

  // ---------- registering adjustments (shown in the floating live-preview panel) ----------
  AUI.adj = function (op, spec) { ED.ADJ[op] = spec; return spec; };
  AUI.open = function (op) { return AUI.openLive(op); };
  // One-click ops (no dialog): run in the worker, one history step.
  var QUICK_LABELS = {};
  AUI.quick = function (op, label, p) {
    var K = kit(), t = K.adjTarget(); if (!t) return Promise.resolve();
    QUICK_LABELS[label] = 1;
    return ED.working(PE.work("adjust", [t.img, op, p || {}, t.sel]), label + "…").then(function (res) { K.commitAdjusted(t, res, label); })
      .catch(function (e) { S3.toast(e.message, "error"); });
  };
  AUI.isFilterLabel = function (label) {
    if (QUICK_LABELS[label]) return true;
    var Q = kit().QUICK; for (var k in Q) if (Q[k] === label) return true;
    for (var op in ED.ADJ) if (ED.ADJ[op].t === label) return true;
    return false;
  };

  // ---------- menus ----------
  function menu(name) { var M = kit().MENUS; for (var i = 0; i < M.length; i++) if (M[i][0] === name) return M[i][1]; return null; }
  // Insert items into a menu before the item whose label starts with `before` (or at the end).
  AUI.addMenu = function (name, items, before) {
    var m = menu(name); if (!m) return;
    var at = m.length;
    if (before) for (var i = 0; i < m.length; i++) if (m[i] !== "-" && m[i][0].indexOf(before) === 0) { at = i; break; }
    m.splice.apply(m, [at, 0].concat(items));
  };
  // A drill-down submenu: the item opens a second list in place of the menu (works the same on phones).
  AUI.sub = function (menuName, label, items) {
    return [label + " ›", "", function () { openSub(menuName, label, items); }, has];
  };
  var subEl = null;
  function closeSub() { if (subEl) { subEl.remove(); subEl = null; document.removeEventListener("pointerdown", outside, true); } }
  function outside(e) { if (subEl && !subEl.contains(e.target)) closeSub(); }
  function openSub(menuName, label, items) {
    closeSub();
    var btn = S3.$$(".pe-mbtn").filter(function (b) { return b.textContent === menuName; })[0]; if (!btn) return;
    var pop = h("div", { "class": "pe-menu pe-asub", role: "menu", "aria-label": label });
    var back = h("button", { type: "button", role: "menuitem", "class": "pe-mi pe-aback" }, [h("span", { text: "‹ " + label })]);
    back.addEventListener("click", function () { closeSub(); btn.click(); });
    pop.appendChild(back); pop.appendChild(h("hr"));
    items.forEach(function (it) {
      if (it === "-") { pop.appendChild(h("hr")); return; }
      var item = h("button", { type: "button", role: "menuitem", "class": "pe-mi" }, [h("span", { text: it[0] }), it[1] ? h("kbd", { text: kit().K(it[1]) }) : null]);
      if (it[3] && !it[3]()) item.disabled = true;
      item.addEventListener("click", function () { closeSub(); it[2](); });
      pop.appendChild(item);
    });
    pop.addEventListener("keydown", function (e) {
      var list = S3.$$(".pe-mi:not([disabled])", pop), i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
      if (e.key === "Escape" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); closeSub(); btn.focus(); }
    });
    btn.parentNode.appendChild(pop); subEl = pop;
    var f = pop.querySelector(".pe-mi:not([disabled]):not(.pe-aback)"); if (f) f.focus({ preventScroll: true });
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); }, 0);
  }
  AUI.closeSub = closeSub;

  // ---------- shortcuts ----------
  // combo "Ctrl+Shift+L" -> handler. Checked before the editor's own keys (capture phase).
  var KEYS = [];
  AUI.key = function (combo, fn) {
    var parts = combo.toLowerCase().split("+"), key = parts.pop();
    KEYS.push({ ctrl: parts.indexOf("ctrl") >= 0, shift: parts.indexOf("shift") >= 0, alt: parts.indexOf("alt") >= 0, key: key, fn: fn });
  };
  AUI.panelKeys = null;     // set while one of this lane's own panels is open: function (e) -> handled
  document.addEventListener("keydown", function (e) {
    if (AUI.panelKeys) { AUI.panelKeys(e); return; }
    if (document.querySelector(".s3-modal") || ED.ui.floatState() || ED.isTyping(e) || !ED.doc) return;
    var c = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase();
    for (var i = 0; i < KEYS.length; i++) {
      var K = KEYS[i];
      if (K.ctrl === c && K.shift === e.shiftKey && K.alt === e.altKey && (K.key === k || ("key" + K.key) === (e.code || "").toLowerCase())) {
        e.preventDefault(); e.stopPropagation(); K.fn(); return;
      }
    }
  }, true);

  // ---------- this lane's own floating panels (same look as the adjustment panel, for non-worker previews) ----------
  var panel = null;
  // opts: {preview: fn(on) adds a Preview checkbox, reset: fn adds a Reset button}
  AUI.panel = function (title, build, onOk, onCancel, opts) {
    if (ED.ui.floatState()) ED.ui.closeFloat(false);
    AUI.closePanel(false);
    opts = opts || {};
    var box = $("#float"), body = h("div", { "class": "pe-fbody" }), busy = h("span", { "class": "faint pe-fbusy" });
    box.textContent = ""; box.hidden = false; ED.modal = true; ED.cancelModes();
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: title }), busy]));
    box.appendChild(body);
    var K = kit();
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [opts.preview ? K.check("Preview", true, opts.preview) : null, h("span", { "class": "grow" }),
      opts.reset ? K.btn("Reset", opts.reset, "ghost") : null, K.btn("Cancel", function () { AUI.closePanel(false); }, "ghost"), K.btn("OK", function () { AUI.closePanel(true); }, "primary")]));
    panel = { onOk: onOk, onCancel: onCancel, busy: busy, body: body };
    AUI.panelKeys = function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); AUI.closePanel(false); return; }
      if (e.key === "Enter" && !ED.isTyping(e) && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); e.stopPropagation(); AUI.closePanel(true); return; }
      if (!ED.isTyping(e) && e.key !== "Tab") e.stopPropagation();     // no tool shortcuts while the panel is open
    };
    build(body);
    return panel;
  };
  AUI.panelOpen = function () { return !!panel; };
  AUI.closePanel = function (ok) {
    var pn = panel; if (!pn) return;
    panel = null; AUI.panelKeys = null; ED.modal = false;
    var box = $("#float"); box.hidden = true; box.textContent = "";
    try { if (ok) pn.onOk(); else if (pn.onCancel) pn.onCancel(); } finally { ED.render(); }
  };
  document.addEventListener("click", function (e) { if (panel && e.target.closest && e.target.closest("#menus")) AUI.closePanel(false); }, true);

  // ---------- reduced-size previews ----------
  // Big layers are previewed at about screen resolution (at least ~1.5 MP), so sliders stay responsive.
  function proxyScale(w, hh) {
    var n = w * hh, z = ED.zoom * Math.min(2, window.devicePixelRatio || 1);
    if (n <= 3e6 || z >= 1) return 1;
    return Math.min(1, Math.max(z * 1.25, Math.sqrt(1.5e6 / n)));
  }
  AUI.proxyScale = proxyScale;
  AUI.downImg = function (img, w, hh) {
    var a = PE.mk(img.width, img.height); a.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    var b = PE.mk(w, hh), x = b.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(a, 0, 0, w, hh);
    var d = x.getImageData(0, 0, w, hh); return { data: d.data, width: w, height: hh };
  };
  AUI.downPlane = function (m, W, H, w, hh) {      // area average of a 0..255 plane
    var o = new Uint8Array(w * hh);
    for (var y = 0; y < hh; y++) {
      var y0 = Math.floor(y * H / hh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * H / hh));
      for (var x = 0; x < w; x++) {
        var x0 = Math.floor(x * W / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * W / w)), s = 0;
        for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) s += m[yy * W + xx];
        o[y * w + x] = Math.round(s / ((y1 - y0) * (x1 - x0)));
      }
    }
    return o;
  };

  // ---------- live-preview panel for this lane's ops ----------
  // Same spec format as the editor's own panel (t, c sliders, chk checkboxes, ui(el, st)), but the preview is worked
  // out on a reduced copy for big layers and drawn scaled by the GPU; OK renders the exact full-size result in the
  // worker. Ops see p._scale (preview scale) so pixel radii look the same in the preview.
  AUI.openLive = function (op) {
    var spec = ED.ADJ[op], K = kit(); if (!spec) return;
    if (ED.ui.floatState()) ED.ui.closeFloat(false);
    AUI.closePanel(false);
    var t = K.adjTarget(); if (!t) return;
    var L = t.L, W = t.r.w, H = t.r.h, s = spec.proxy === false ? 1 : proxyScale(W, H), w = Math.max(1, Math.round(W * s)), hh = Math.max(1, Math.round(H * s));
    s = w / W;
    var src = s < 1 ? AUI.downImg(t.img, w, hh) : t.img, ssel = t.sel && s < 1 ? AUI.downPlane(t.sel, W, H, w, hh) : t.sel;
    var p = {}, key = PE.uid("k"), small = PE.mk(w, hh), sctx = small.getContext("2d"), full = s < 1 ? PE.mk(W, H) : null, selC = null;
    (spec.c || []).forEach(function (c) { p[c.k] = c.def; });
    (spec.chk || []).forEach(function (c) { p[c[0]] = !!c[2]; });
    if (s < 1 && t.sel) {          // selection as an alpha mask, to keep the outside crisp
      selC = PE.mk(W, H); var sx = selC.getContext("2d"), sd = sx.createImageData(W, H);
      for (var i = 0, q = 0; q < t.sel.length; q++, i += 4) sd.data[i + 3] = t.sel[q];
      sx.putImageData(sd, 0, 0);
    }
    var st = { op: op, t: t, p: p, key: key, busy: false, again: false, shown: null, previewOn: true, scale: s, live: true, src: src };
    function show() {
      if (!st.previewOn || !st.shown) { delete ED.live.over[L.id]; ED.render(); return; }
      var c = small;
      if (full) {
        var x = full.getContext("2d");
        x.save(); x.globalCompositeOperation = "copy"; x.imageSmoothingQuality = "high"; x.drawImage(small, 0, 0, W, H);
        if (selC) { x.globalCompositeOperation = "destination-in"; x.drawImage(selC, 0, 0); x.globalCompositeOperation = "destination-over"; x.drawImage(L.canvas, 0, 0); }
        x.restore(); c = full;
      }
      ED.live.over[L.id] = { canvas: PE.touch(c), x: t.r.x, y: t.r.y }; ED.render();
    }
    function run() {
      if (st.closed) return;
      if (st.busy) { st.again = true; return; }
      st.busy = true; st.again = false; if (st.pn) st.pn.busy.textContent = "Updating…";
      var params = JSON.parse(JSON.stringify(p)), sig = JSON.stringify(params);
      params._scale = s;
      PE.workAdjust(key, op, params).then(function (res) {
        if (st.closed) return;
        sctx.putImageData(new ImageData(new Uint8ClampedArray(res.data), w, hh), 0, 0);
        st.shown = sig; show();
      }).catch(function (e) { S3.toast(e.message, "error"); }).then(function () {
        st.busy = false; if (st.pn) st.pn.busy.textContent = "";
        if (st.again && !st.closed) run();
      });
    }
    st.schedule = S3.debounce(run, w * hh > 2e6 ? 120 : 40); st.run = run;
    st.pn = AUI.panel(spec.t, function (el) {
      (spec.c || []).forEach(function (c) { el.appendChild(K.range(c.label, c.def, c.min, c.max, c.step, function (v) { p[c.k] = v; st.schedule(); }, c.fmt)); });
      (spec.chk || []).forEach(function (c) { el.appendChild(K.check(c[1], !!c[2], function (v) { p[c[0]] = v; st.schedule(); })); });
      if (spec.ui) spec.ui(el, st);
      if (t.sel) el.appendChild(h("p", { "class": "faint pe-p", text: "Applies inside the selection only." }));
      if (s < 1) el.appendChild(h("p", { "class": "faint pe-p", text: "Preview at " + Math.round(s * 100) + "% size for speed; OK applies it at full size." }));
    }, function () {
      st.closed = true; delete ED.live.over[L.id];
      var params = JSON.parse(JSON.stringify(p));
      if (s === 1 && st.shown === JSON.stringify(params) && !st.busy) { var c = small; ED.meta(spec.t, function () { L.canvas = PE.touch(c); }); return; }
      params._scale = 1;
      ED.working(PE.work("adjust", [t.img, op, params, t.sel]), spec.t + "…").then(function (res) { K.commitAdjusted(t, res, spec.t); }).catch(function (e) { S3.toast(e.message, "error"); });
    }, function () { st.closed = true; delete ED.live.over[L.id]; }, {
      preview: function (v) { st.previewOn = v; show(); },
      reset: function () { AUI.closePanel(false); AUI.openLive(op); }
    });
    AUI.liveState = st;
    PE.workLoad(key, src, ssel).then(run);
    return st;
  };

  // ---------- fade the last adjustment or filter ----------
  // Every adjustment / filter commit is recorded (which layer, its pixels before and after, the selection then);
  // Fade mixes the two with an opacity and a blend mode as one more history step, while it is still the last step.
  var last = null, meta0 = ED.meta;
  ED.meta = function (label, fn) {
    var d = ED.doc, refs = d ? d.layers.map(function (L) { return L.canvas; }) : [], sel = d && d.sel;
    var r = meta0.apply(this, arguments);
    if (d && ED.doc === d && AUI.isFilterLabel(label)) {
      var ch = d.layers.filter(function (L, i) { return L.kind === "raster" && refs[i] && L.canvas !== refs[i] && L.canvas.width === refs[i].width && L.canvas.height === refs[i].height; });
      var L = ch.length === 1 ? ch[0] : null, i0 = L ? d.layers.indexOf(L) : -1;
      last = L ? { doc: d, L: L, before: refs[i0], after: L.canvas, label: label, entry: ED.hist.list[ED.hist.pos - 1],
        sel: sel ? PE.selFor({ sel: sel }, { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }) : null } : null;
    }
    return r;
  };
  function canFade() { return !!(last && ED.doc === last.doc && ED.hist && ED.hist.pos > 0 && ED.hist.list[ED.hist.pos - 1] === last.entry && last.L.canvas === last.after && !ED.busy); }
  AUI.canFade = canFade;
  var FADE_MODES = [["source-over", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"],
    ["color-dodge", "Colour dodge"], ["color-burn", "Colour burn"], ["hard-light", "Hard light"], ["soft-light", "Soft light"], ["difference", "Difference"],
    ["exclusion", "Exclusion"], ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Colour"], ["luminosity", "Luminosity"]];
  // Mix: before, then after drawn over it with opacity + mode; outside the old selection the result goes back to before.
  AUI.fadeMix = function (before, after, op, mode, sel, into) {
    var w = before.width, hh = before.height, c = into || PE.mk(w, hh), x = c.getContext("2d");
    op = PE.clamp(op, 0, 1);
    if (!mode || mode === "source-over") {      // exact straight-alpha mix: before + (after - before) * opacity * selection
      var B0 = PE.getData(before), A0 = PE.getData(after), bd = B0.data, ad = A0.data;
      for (var j = 0, p0 = 0; j < bd.length; j += 4, p0++) {
        var kk = sel ? op * sel[p0] / 255 : op; if (!kk) continue;
        for (var q0 = 0; q0 < 4; q0++) bd[j + q0] = bd[j + q0] + (ad[j + q0] - bd[j + q0]) * kk;
      }
      x.putImageData(B0, 0, 0);
      return PE.touch(c);
    }
    x.save(); x.globalCompositeOperation = "copy"; x.globalAlpha = 1; x.drawImage(before, 0, 0); x.restore();
    x.save(); x.globalAlpha = op; x.globalCompositeOperation = mode; x.drawImage(after, 0, 0); x.restore();
    if (sel) {
      var o = PE.getData(before), m = x.getImageData(0, 0, w, hh), a = o.data, b = m.data;
      for (var i = 0, p = 0; p < sel.length; p++, i += 4) {
        var k = sel[p]; if (k === 255) continue;
        if (!k) { b[i] = a[i]; b[i + 1] = a[i + 1]; b[i + 2] = a[i + 2]; b[i + 3] = a[i + 3]; continue; }
        k /= 255; for (var q = 0; q < 4; q++) b[i + q] = a[i + q] + (b[i + q] - a[i + q]) * k;
      }
      x.putImageData(m, 0, 0);
    }
    return PE.touch(c);
  };
  function fadeDialog() {
    if (!canFade()) { S3.toast("Nothing to fade: fade works right after an adjustment or filter", "error"); return; }
    var f = last, st = { op: 1, mode: "source-over" }, prev = PE.mk(f.before.width, f.before.height), raf = 0, K = kit();
    function show() { raf = 0; AUI.fadeMix(f.before, f.after, st.op, st.mode, f.sel, prev); ED.live.over[f.L.id] = { canvas: prev, x: f.L.x, y: f.L.y }; ED.render(); }
    function soon() { if (!raf) raf = requestAnimationFrame(show); }
    AUI.panel("Fade " + f.label, function (el) {
      el.appendChild(K.range("Opacity", 100, 0, 100, 1, function (v) { st.op = v / 100; soon(); }, pc));
      el.appendChild(K.select("Mode", FADE_MODES, st.mode, function (v) { st.mode = v; soon(); }));
      show();
    }, function () {
      if (raf) cancelAnimationFrame(raf);
      delete ED.live.over[f.L.id];
      if (!canFade()) return;
      var out = AUI.fadeMix(f.before, f.after, st.op, st.mode, f.sel);
      ED.meta("Fade " + f.label, function () { f.L.canvas = out; });
    }, function () { if (raf) cancelAnimationFrame(raf); delete ED.live.over[f.L.id]; });
  }
  AUI.fadeDialog = fadeDialog;
  AUI.addMenu("Edit", [["Fade…", "Ctrl+Shift+F", fadeDialog, canFade], "-"], "Cut");
  AUI.key("Ctrl+Shift+F", fadeDialog);

  // ---------- shadows / highlights ----------
  function sl(k, label, min, max, step, def, fmt) { return { k: k, label: label, min: min, max: max, step: step, def: def, fmt: fmt }; }
  AUI.sl = sl;
  AUI.adj("shadowsHighlights", { t: "Shadows / highlights", proxy: true, c: [sl("sAmt", "Shadows: amount", 0, 100, 1, 35, pc), sl("sTone", "Shadows: tonal width", 0, 100, 1, 50, pc), sl("sRad", "Shadows: radius", 0, 500, 1, 30, pxf),
    sl("hAmt", "Highlights: amount", 0, 100, 1, 0, pc), sl("hTone", "Highlights: tonal width", 0, 100, 1, 50, pc), sl("hRad", "Highlights: radius", 0, 500, 1, 30, pxf),
    sl("color", "Colour", -100, 100, 1, 20), sl("mid", "Midtone contrast", -100, 100, 1, 0)] });
  AUI.addMenu("Image", [["Shadows / highlights…", "", function () { AUI.open("shadowsHighlights"); }, has]], "Auto tone");

  // "More adjustments ›" (Image menu) collects the rest of the lane's adjustments.
  var MORE = AUI.MORE = [];
  AUI.addMenu("Image", [AUI.sub("Image", "More adjustments", MORE)], "Invert");
  AUI.more = function (label, op, key) {
    var fn = typeof op === "function" ? op : function () { AUI.open(op); };
    MORE.push([label, key || "", fn, has]);
    if (key) AUI.key(key, fn);
  };

  // ---------- photo filter ----------
  AUI.colorInput = function (label, val, onSet) {
    var c = h("input", { type: "color", "class": "pe-acolor", value: val });
    c.addEventListener("input", function () { onSet(c.value); });
    var f = kit().field(label, c); f._set = function (v) { c.value = v; }; return f;
  };
  var PF = [["#ec8a00", "Warm (orange)"], ["#f2b33d", "Warm (amber)"], ["#1f6fff", "Cool (blue)"], ["#4aa3ff", "Cool (sky)"], ["#e8361d", "Red"], ["#f08519", "Orange"],
    ["#f5d51b", "Yellow"], ["#2bb24c", "Green"], ["#19bfd8", "Cyan"], ["#2846e0", "Blue"], ["#8a35d8", "Violet"], ["#d62ab0", "Magenta"], ["#a8763a", "Sepia"], ["#2f8f7f", "Underwater teal"]];
  AUI.adj("photoFilter", { t: "Photo filter", c: [sl("density", "Density", 0, 100, 1, 25, pc)], ui: function (el, st) {
    var p = st.p, K = kit(); p.color = PF[0][0]; p.keepLum = true;
    var col = AUI.colorInput("Colour", p.color, function (v) { p.color = v; st.schedule(); });
    el.insertBefore(col, el.firstChild);
    el.insertBefore(K.select("Filter", PF, p.color, function (v) { p.color = v; col._set(v); st.schedule(); }), col);
    el.appendChild(K.check("Preserve luminosity", true, function (v) { p.keepLum = v; st.schedule(); }));
  } });
  AUI.more("Photo filter…", "photoFilter");

  // ---------- desaturate options ----------
  AUI.adj("desatMethod", { t: "Desaturate", c: [sl("amount", "Amount", 0, 100, 1, 100, pc)], ui: function (el, st) {
    st.p.method = "lum601";
    el.insertBefore(kit().select("Grey from", [["lum601", "Luminosity (Rec. 601)"], ["lum709", "Luminosity (Rec. 709)"], ["average", "Average of R, G, B"], ["lightness", "Lightness (max + min) / 2"],
      ["max", "Brightest channel"], ["min", "Darkest channel"], ["red", "Red channel"], ["green", "Green channel"], ["blue", "Blue channel"]], "lum601", function (v) { st.p.method = v; st.schedule(); }), el.firstChild);
  } });
  AUI.more("Desaturate…", "desatMethod");

  // ---------- posterize / equalize ----------
  AUI.adj("posterize", { t: "Posterize", c: [sl("levels", "Levels", 2, 64, 1, 4)] });
  AUI.more("Posterize…", "posterize");
  AUI.adj("equalize", { t: "Equalize", ui: function (el, st) {
    st.p.basis = "sel";
    el.appendChild(kit().seg("", [["sel", "Selected area only"], ["image", "Whole layer, from the selection"]], "sel", function (v) { st.p.basis = v; st.schedule(); }));
  } });
  AUI.more("Equalize", function () { if (ED.doc && ED.doc.sel) AUI.open("equalize"); else AUI.quick("equalize", "Equalize"); });

  // ---------- gradient map ----------
  // A small gradient editor: preset, then up to 6 colour stops with positions; drawn as a strip.
  var GM = [["fgbg", "Foreground to background"], ["bw", "Black to white", [[0, "#000000"], [1, "#ffffff"]]], ["sepia", "Warm duotone", [[0, "#1c1009"], [0.55, "#9a6b3c"], [1, "#f6e7c8"]]],
    ["teal", "Teal and amber", [[0, "#0b2433"], [0.45, "#2e7d86"], [1, "#f7b866"]]], ["ir", "Heat", [[0, "#000000"], [0.33, "#5b2a8f"], [0.66, "#e5485a"], [1, "#ffe76f"]]],
    ["cyan", "Cyanotype", [[0, "#0a1a3e"], [0.5, "#3a78bb"], [1, "#eef6ff"]]], ["gold", "Gold", [[0, "#1b1104"], [0.5, "#8d5d12"], [1, "#ffe6a3"]]],
    ["neon", "Neon night", [[0, "#0a0220"], [0.5, "#ff2d9b"], [1, "#f6f7a6"]]], ["mint", "Mint fade", [[0, "#24323a"], [1, "#d9f5e4"]]]];
  AUI.gradStrip = function (stops, reverse) {
    var c = h("canvas", { "class": "pe-agrad", width: "256", height: "18", "aria-hidden": "true" }), x = c.getContext("2d"), T = PIX.A.gradientTable(stops, reverse);
    for (var i = 0; i < 256; i++) { x.fillStyle = "rgb(" + Math.round(T[i * 3]) + "," + Math.round(T[i * 3 + 1]) + "," + Math.round(T[i * 3 + 2]) + ")"; x.fillRect(i, 0, 1, 18); }
    return c;
  };
  AUI.stopsEditor = function (el, getStops, onChange) {
    var box = h("div", { "class": "pe-astops" }), K = kit();
    function draw() {
      box.textContent = "";
      var stops = getStops();
      stops.forEach(function (s, i) {
        var c = h("input", { type: "color", "class": "pe-acolor", value: s[1], "aria-label": "Stop " + (i + 1) + " colour" });
        c.addEventListener("input", function () { s[1] = c.value; onChange(false); });
        var r = h("input", { type: "range", min: "0", max: "100", step: "1", value: String(Math.round(s[0] * 100)), "aria-label": "Stop " + (i + 1) + " position" });
        r.addEventListener("input", function () { s[0] = +r.value / 100; onChange(false); });
        var del = K.btn("", function () { if (stops.length > 2) { stops.splice(i, 1); draw(); onChange(true); } }, "ghost icon small", "i-x", "Remove stop");
        if (stops.length <= 2) del.disabled = true;
        box.appendChild(h("div", { "class": "pe-astop" }, [c, r, del]));
      });
      if (stops.length < 6) box.appendChild(K.btn("Add stop", function () {
        var st = getStops(), T = PIX.A.gradientTable(st, false), i = 128;
        st.push([0.5, PE.toHex(T[i * 3], T[i * 3 + 1], T[i * 3 + 2])]); st.sort(function (a, b) { return a[0] - b[0]; }); draw(); onChange(true);
      }, "ghost", "i-plus"));
    }
    el.appendChild(box); draw();
    return { redraw: draw };
  };
  AUI.adj("gradientMap", { t: "Gradient map", ui: function (el, st) {
    var p = st.p, K = kit(), d = ED.doc;
    function preset(id) { var g = GM.filter(function (x) { return x[0] === id; })[0]; return id === "fgbg" ? [[0, d.fg], [1, d.bg]] : JSON.parse(JSON.stringify(g[2])); }
    p.stops = preset("fgbg"); p.reverse = false; p.dither = false;
    var strip = h("div", { "class": "pe-astrip" });
    function redrawStrip() { strip.textContent = ""; strip.appendChild(AUI.gradStrip(p.stops, p.reverse)); }
    el.appendChild(K.select("Gradient", GM.map(function (g) { return [g[0], g[1]]; }), "fgbg", function (v) { p.stops = preset(v); ed.redraw(); redrawStrip(); st.schedule(); }));
    el.appendChild(strip);
    var ed = AUI.stopsEditor(el, function () { return p.stops; }, function () { redrawStrip(); st.schedule(); });
    el.appendChild(h("div", { "class": "row pe-arow" }, [K.check("Reverse", false, function (v) { p.reverse = v; redrawStrip(); st.schedule(); }), K.check("Dither", false, function (v) { p.dither = v; st.schedule(); })]));
    redrawStrip();
  } });
  AUI.more("Gradient map…", "gradientMap");

  // ---------- channel mixer ----------
  var CM = [["none", "Default (no change)", { r: [100, 0, 0, 0], g: [0, 100, 0, 0], b: [0, 0, 100, 0], mono: false }],
    ["bwRed", "Mono through a red filter", { mono: true, gray: [80, 30, -10, 0] }], ["bwGreen", "Mono through a green filter", { mono: true, gray: [20, 70, 10, 0] }],
    ["bwBlue", "Mono through a blue filter", { mono: true, gray: [0, 30, 70, 0] }], ["bwIr", "Mono, infrared look", { mono: true, gray: [-50, 190, -40, 0] }],
    ["bwFlat", "Mono, equal channels", { mono: true, gray: [34, 33, 33, 0] }], ["swapRB", "Swap red and blue", { r: [0, 0, 100, 0], g: [0, 100, 0, 0], b: [100, 0, 0, 0], mono: false }],
    ["warm", "Warmer reds", { r: [110, 10, -20, 0], g: [0, 100, 0, 0], b: [-10, 0, 100, 0], mono: false }]];
  AUI.adj("channelMixer", { t: "Channel mixer", ui: function (el, st) {
    var p = st.p, K = kit(), out = "r", rs = [], total = h("p", { "class": "faint pe-p mono" }), monoChk, outSeg;
    function set(v) { p.r = v.r ? v.r.slice() : p.r || [100, 0, 0, 0]; p.g = v.g ? v.g.slice() : p.g || [0, 100, 0, 0]; p.b = v.b ? v.b.slice() : p.b || [0, 0, 100, 0]; p.gray = v.gray ? v.gray.slice() : p.gray || [40, 40, 20, 0]; p.mono = !!v.mono; }
    set(CM[0][2]);
    function cur() { return p.mono ? p.gray : p[out]; }
    function sync() { var v = cur(); rs.forEach(function (r, i) { r._set(v[i]); }); total.textContent = "Total " + (v[0] + v[1] + v[2]) + "%" + (v[0] + v[1] + v[2] > 100 ? " (may clip highlights)" : ""); outSeg.style.display = p.mono ? "none" : ""; monoChk.querySelector("input").checked = p.mono; }
    el.appendChild(K.select("Preset", CM.map(function (c) { return [c[0], c[1]]; }), "none", function (v) { set(CM.filter(function (c) { return c[0] === v; })[0][2]); sync(); st.schedule(); }));
    outSeg = K.seg("Output", [["r", "Red"], ["g", "Green"], ["b", "Blue"]], out, function (v) { out = v; sync(); });
    el.appendChild(outSeg);
    [["Red", -200, 200], ["Green", -200, 200], ["Blue", -200, 200], ["Constant", -200, 200]].forEach(function (lab, i) {
      var r = K.range(lab[0], cur()[i], lab[1], lab[2], 1, function (v) { cur()[i] = v; sync(); st.schedule(); }, pc); rs.push(r); el.appendChild(r);
    });
    el.appendChild(total);
    monoChk = K.check("Monochrome", false, function (v) { p.mono = v; sync(); st.schedule(); });
    el.appendChild(monoChk);
    sync();
  } });
  AUI.more("Channel mixer…", "channelMixer");

  // ---------- selective colour ----------
  AUI.adj("selectiveColor", { t: "Selective colour", ui: function (el, st) {
    var p = st.p, K = kit(), range = "reds", rs = [];
    p.adj = {}; PIX.A.SC_RANGES.forEach(function (k) { p.adj[k] = [0, 0, 0, 0]; }); p.method = "relative";
    el.appendChild(K.select("Colours", PIX.A.SC_RANGES.map(function (k) { return [k, k.charAt(0).toUpperCase() + k.slice(1)]; }), range, function (v) { range = v; rs.forEach(function (r, i) { r._set(p.adj[range][i]); }); }));
    ["Cyan", "Magenta", "Yellow", "Black"].forEach(function (lab, i) { var r = K.range(lab, 0, -100, 100, 1, function (v) { p.adj[range][i] = v; st.schedule(); }, pc); rs.push(r); el.appendChild(r); });
    el.appendChild(K.seg("Method", [["relative", "Relative"], ["absolute", "Absolute"]], "relative", function (v) { p.method = v; st.schedule(); }));
  } });
  AUI.more("Selective colour…", "selectiveColor");

  // ---------- auto tone / contrast / colour ----------
  var AUTO = [["autoTone", "Auto tone", "Ctrl+Shift+L"], ["autoContrast", "Auto contrast", "Ctrl+Alt+Shift+L"], ["autoColor", "Auto colour", "Ctrl+Shift+B"]];
  AUI.addMenu("Image", AUTO.map(function (a) { return [a[1], a[2], function () { AUI.quick(a[0], a[1]); }, has]; }).concat(["-"]), "Vibrance");
  AUTO.forEach(function (a) { AUI.key(a[2], function () { AUI.quick(a[0], a[1]); }); });
})();
