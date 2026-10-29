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
  AUI.open = function (op) { ED.ui.openAdjust(op); };
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
  AUI.panel = function (title, build, onOk, onCancel) {
    if (ED.ui.floatState()) ED.ui.closeFloat(false);
    AUI.closePanel(false);
    var box = $("#float"), body = h("div", { "class": "pe-fbody" });
    box.textContent = ""; box.hidden = false; ED.modal = true; ED.cancelModes();
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: title }), h("span", { "class": "faint pe-fbusy" })]));
    box.appendChild(body);
    var K = kit();
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [h("span", { "class": "grow" }), K.btn("Cancel", function () { AUI.closePanel(false); }, "ghost"), K.btn("OK", function () { AUI.closePanel(true); }, "primary")]));
    panel = { onOk: onOk, onCancel: onCancel };
    AUI.panelKeys = function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); AUI.closePanel(false); return; }
      if (e.key === "Enter" && !(e.target && (e.target.tagName === "BUTTON" || e.target.tagName === "SELECT"))) { e.preventDefault(); e.stopPropagation(); AUI.closePanel(true); return; }
      if (!ED.isTyping(e) && e.key !== "Tab") e.stopPropagation();     // no tool shortcuts while the panel is open
    };
    build(body);
  };
  AUI.closePanel = function (ok) {
    var pn = panel; if (!pn) return;
    panel = null; AUI.panelKeys = null; ED.modal = false;
    var box = $("#float"); box.hidden = true; box.textContent = "";
    try { if (ok) pn.onOk(); else if (pn.onCancel) pn.onCancel(); } finally { ED.render(); }
  };
  document.addEventListener("click", function (e) { if (panel && e.target.closest && e.target.closest("#menus")) AUI.closePanel(false); }, true);

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
  AUI.adj("shadowsHighlights", { t: "Shadows / highlights", c: [sl("sAmt", "Shadows: amount", 0, 100, 1, 35, pc), sl("sTone", "Shadows: tonal width", 0, 100, 1, 50, pc), sl("sRad", "Shadows: radius", 0, 500, 1, 30, pxf),
    sl("hAmt", "Highlights: amount", 0, 100, 1, 0, pc), sl("hTone", "Highlights: tonal width", 0, 100, 1, 50, pc), sl("hRad", "Highlights: radius", 0, 500, 1, 30, pxf),
    sl("color", "Colour", -100, 100, 1, 20), sl("mid", "Midtone contrast", -100, 100, 1, 0)] });
  AUI.addMenu("Image", [["Shadows / highlights…", "", function () { AUI.open("shadowsHighlights"); }, has]], "Auto tone");

  // ---------- auto tone / contrast / colour ----------
  var AUTO = [["autoTone", "Auto tone", "Ctrl+Shift+L"], ["autoContrast", "Auto contrast", "Ctrl+Alt+Shift+L"], ["autoColor", "Auto colour", "Ctrl+Shift+B"]];
  AUI.addMenu("Image", AUTO.map(function (a) { return [a[1], a[2], function () { AUI.quick(a[0], a[1]); }, has]; }).concat(["-"]), "Vibrance");
  AUTO.forEach(function (a) { AUI.key(a[2], function () { AUI.quick(a[0], a[1]); }); });
})();
