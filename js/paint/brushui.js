/* Photo Editor paint lane: options bar for the engine's tools and the Brush settings dialog
   (tip, shape dynamics, scattering, texture, dual tip, colour dynamics, transfer, smoothing, symmetry). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, K = ED.ui.kit, h = S3.h, RAD = Math.PI / 180;
  var pct = function (v) { return Math.round(v * 100) + "%"; }, px = function (v) { return v + " px"; }, pc = function (v) { return Math.round(v) + "%"; }, deg = function (v) { return Math.round(v) + "°"; };

  PP.icons({
    "pp-press": ["M5 19c3-1 4.5-3 6-6l4.5-8.5 2.5 1.3-4.6 8.6c-1.6 3-3.4 4.6-6.4 5.6", ["circle", { cx: "17.5", cy: "18.5", r: "2.2" }]],
    "pp-pressop": ["M5 19c3-1 4.5-3 6-6l4.5-8.5 2.5 1.3-4.6 8.6c-1.6 3-3.4 4.6-6.4 5.6", ["circle", { cx: "17.5", cy: "18.5", r: "2.2", fill: "currentColor", opacity: ".45" }]],
    "pp-brushes": ["M4 20c2.5 0 4-1.4 4-3.6 0-1.4-1-2.4-2.3-2.4C4.4 14 3.5 15 3.5 16.4 3.5 18 3 19.3 2 20z", "M8 15.5 19.5 4a1.7 1.7 0 0 1 2.4 2.4L10.4 18", "M13 6.5l4.5 4.5"],
    "pp-sym": ["M12 2.5v19", "M9.5 7c-3 1-5 3-5 5s2 4 5 5", "M14.5 7c3 1 5 3 5 5s-2 4-5 5"]
  });

  // ---------- preview stroke: an S-curve with a pressure taper, drawn by the real engine ----------
  PP.previewStroke = function (o, w, hh, color) {
    var c = PE.mk(w, hh), buf = PE.mk(w, hh);
    var st = { o: Object.assign({}, o), spec: { fill: "color" }, bctx: PE.cx2(buf), buf: buf, ox: 0, oy: 0, mask: false, noSel: true, R: Math.random,
      n: 0, tip: PP.tipOf(o.tip), pencil: !!o.pencil, fg: PE.rgbOf(color || "#111111"), bgc: PE.rgbOf(ED.doc ? ED.doc.bg : "#ffffff"), w: w, h: hh, bbox: null };
    var maxD = Math.min(hh * 0.62, o.size); st.o.size = maxD; st.o.sym = "off";
    if (st.o.tex && PP.patternOf && PP.patternOf(st.o.tex)) { var P = PP.patternOf(st.o.tex), m = PP.texMask(P, st.o.texInvert); st.tex = { pat: st.bctx.createPattern(m, "repeat"), k: st.o.texScale / 100, depth: st.o.texDepth / 100 }; }
    if (!st.o.perTip) st.color = PP.dabColor(st, { pr: 1, tilt: 0, tiltA: 0, twist: 0 });
    var N = 260, last = null, pad = maxD / 2 + 4;
    for (var i = 0; i <= N; i++) {
      var t = i / N, x = pad + t * (w - 2 * pad), y = hh / 2 + Math.sin(t * Math.PI * 2) * (hh / 2 - pad) * 0.55, pr = Math.sin(t * Math.PI);
      if (!last) { last = { x: x, y: y }; st.last = last; PP.dab(st, x, y, { pr: pr, tilt: pr, tiltA: 0, twist: 0 }); continue; }
      var dx = x - st.last.x, dy = y - st.last.y, dist = Math.hypot(dx, dy), step = Math.max(0.5, Math.max(1, st.o.size * (st.lastF || 1)) * Math.max(1, st.o.spacing) / 100);
      st.dir = Math.atan2(dy, dx) / RAD; if (st.dir0 == null) st.dir0 = st.dir;
      while (dist >= step) { var q = { x: st.last.x + dx / dist * step, y: st.last.y + dy / dist * step }; PP.dab(st, q.x, q.y, { pr: pr, tilt: pr, tiltA: 0, twist: 0 }); st.last = q; dx = x - q.x; dy = y - q.y; dist = Math.hypot(dx, dy); }
    }
    if (st.tex && !st.o.texEach) PP.texStroke(st.bctx, st.tex, 0, 0, w, hh);
    var x2 = PE.cx2(c); x2.globalAlpha = PE.clamp(o.op == null ? 1 : o.op, 0.05, 1); x2.drawImage(buf, 0, 0);
    return c;
  };

  // ---------- options bar ----------
  function tipButton(tool) {
    var o = ED.o[tool], b = h("button", { type: "button", "class": "pp-tipbtn", title: "Brush presets and settings", "aria-label": "Brush presets and settings" });
    var cv = h("canvas", { width: "56", height: "26" }); b.appendChild(cv);
    var x = cv.getContext("2d"), pv = PP.previewStroke(Object.assign({}, o, { size: Math.min(22, Math.max(4, o.size)), spacing: Math.max(o.spacing, 8) }), 112, 52, getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#ddd");
    x.drawImage(pv, 0, 0, 56, 26);
    b.addEventListener("click", function () { if (PP.presetPicker) PP.presetPicker(tool, b); else settingsDialog(tool); });
    return b;
  }
  function toggle(id, title, on, onSet) {
    var b = h("button", { type: "button", "class": "btn ghost icon small pp-tog", title: title, "aria-label": title, "aria-pressed": String(!!on) }, [K.svg(id)]);
    b.addEventListener("click", function () { var v = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(v)); onSet(v); });
    return b;
  }
  var SYM = [["off", "Off"], ["v", "Vertical"], ["h", "Horizontal"], ["vh", "Dual axis"], ["diag", "Diagonal"], ["radial", "Radial"], ["mandala", "Mandala"]];
  // The standard brush controls; extra = tool-specific items placed before the hint.
  PP.brushBar = function (tool, items, extra, hint, cfg) {
    cfg = cfg || {};
    var o = ED.o[tool], save = function () { ED.saveOpts(); }, out = [items[0]];
    out.push(tipButton(tool));
    out.push(K.range("Size", o.size, 1, 1000, 1, function (v) { o.size = v; save(); ED.renderOvl(); }, px));
    if (!o.tip && !cfg.noHard) out.push(K.range("Hardness", o.hard, 0, 1, 0.01, function (v) { o.hard = v; save(); }, pct));
    if (!cfg.noOp) out.push(K.range(cfg.opLabel || "Opacity", o.op, 0.01, 1, 0.01, function (v) { o.op = v; save(); }, pct));
    if (!cfg.noFlow) out.push(K.range(cfg.flowLabel || "Flow", o.flow, 0.01, 1, 0.01, function (v) { o.flow = v; save(); }, pct));
    out.push(toggle("pp-press", "Pen pressure controls size", o.sizeC === "pressure", function (v) { o.sizeC = v ? "pressure" : "off"; save(); }));
    if (!cfg.noOp) out.push(toggle("pp-pressop", "Pen pressure controls opacity", o.opC === "pressure", function (v) { o.opC = v ? "pressure" : "off"; save(); }));
    out.push(K.range("Smoothing", o.smooth, 0, 100, 1, function (v) { o.smooth = v; save(); }, pc));
    if (PP.spec[tool].sym !== false && !cfg.noSym) out.push(K.select("Symmetry", SYM, o.sym, function (v) { o.sym = v; save(); ED.renderOvl(); ED.ui.buildOpts(); }));
    if (o.sym === "radial" || o.sym === "mandala") out.push(K.field("Segments", K.numInput(o.symN, 2, 32, function (v) { o.symN = v; save(); ED.renderOvl(); }), "pe-num"));
    out.push(K.btn("", function () { settingsDialog(tool); }, "ghost icon", "pp-brushes", "Brush settings (F5)"));
    (extra || []).forEach(function (x) { out.push(x); });
    if (hint) out.push(h("span", { "class": "pe-hint", text: hint }));
    return out;
  };
  PP.optsFor.brush = function (items) {
    return PP.brushBar("brush", items, [], "Alt+click picks a colour. [ ] size, Shift+[ ] hardness, Shift+click draws a straight line." + (ED.maskEdit ? " Painting the MASK: black hides, white reveals, grey is partial." : ""));
  };
  PP.optsFor.eraser = function (items) {
    var o = ED.o.eraser;
    return PP.brushBar("eraser", items, [K.seg("Mode", [["brush", "Brush"], ["pencil", "Pencil"]], o.mode, function (v) { o.mode = v; ED.saveOpts(); })], "Erases to transparency (on a mask: hides). Shift+click erases a straight line.", { noFlow: false });
  };
  ["clone", "heal"].forEach(function (t) {
    PP.optsFor[t] = function (items) {
      var o = ED.o[t];
      return PP.brushBar(t, items, [K.check("Aligned", o.aligned, function (v) { o.aligned = v; ED.saveOpts(); })],
        ED.cloneSrc ? "Paint to " + (t === "heal" ? "heal (texture from the source, colour from around the stroke)" : "copy from the source") + ". Alt+click sets a new source." : "Alt+click a clean area to set the source first.", { noSym: true });
    };
  });

  // ---------- Brush settings dialog ----------
  var CTL = [["off", "Off"], ["pressure", "Pen pressure"], ["tilt", "Pen tilt"], ["fade", "Fade"]];
  var ACTL = [["off", "Off"], ["direction", "Direction"], ["initial", "Initial direction"], ["tilt", "Pen tilt"], ["rotation", "Pen rotation"]];
  function settingsDialog(tool) {
    var o = ED.o[tool]; if (!o || !PP.spec[tool]) return;
    var row = ED.uiTOOLS.filter(function (r) { return r[0] === tool; })[0];
    var pv = h("canvas", { "class": "pp-pv", width: "560", height: "120", "aria-label": "Stroke preview" });
    function redraw() {
      var x = pv.getContext("2d"); x.clearRect(0, 0, pv.width, pv.height);
      x.drawImage(PP.previewStroke(Object.assign({}, o, { pencil: !!PP.spec[tool].pencil }), pv.width, pv.height, getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#ddd"), 0, 0);
    }
    var soon = S3.debounce(function () { redraw(); ED.saveOpts(); ED.ui.buildOpts(); ED.renderOvl(); }, 60);
    function R(label, k, min, max, step, fmt) { return K.range(label, o[k], min, max, step, function (v) { o[k] = v; soon(); }, fmt); }
    function S(label, k, opts) { return K.select(label, opts, o[k], function (v) { o[k] = v; soon(); }); }
    function C(label, k) { return K.check(label, o[k], function (v) { o[k] = v; soon(); }); }
    function sec(title, kids) { return h("details", { "class": "pp-sec", open: true }, [h("summary", { text: title })].concat([h("div", { "class": "pp-grid" }, kids)])); }
    var tips = [["", "Round (computed)"]].concat(Object.keys(PP.tips).map(function (id) { return [id, PP.tips[id].name]; }));
    var pats = [["", "None"]].concat(PP.patternList ? PP.patternList().map(function (p) { return [p.id, p.name]; }) : []);
    var duals = [["", "None"], ["round", "Round"]].concat(Object.keys(PP.tips).map(function (id) { return [id, PP.tips[id].name]; }));
    var body = h("div", { "class": "stack pp-bs" }, [pv,
      sec("Tip shape", [S("Tip", "tip", tips), R("Size", "size", 1, 1000, 1, px), R("Hardness", "hard", 0, 1, 0.01, pct), R("Angle", "angle", -180, 180, 1, deg),
        R("Roundness", "round", 1, 100, 1, pc), R("Spacing", "spacing", 1, 300, 1, pc), C("Flip", "flipX")]),
      sec("Shape dynamics", [R("Size jitter", "sizeJ", 0, 100, 1, pc), S("Size control", "sizeC", CTL), R("Minimum size", "sizeMin", 0, 100, 1, pc), R("Fade steps", "fade", 1, 500, 1),
        R("Angle jitter", "angleJ", 0, 100, 1, pc), S("Angle control", "angleC", ACTL), R("Roundness jitter", "roundJ", 0, 100, 1, pc), S("Roundness control", "roundC", CTL), R("Minimum roundness", "roundMin", 1, 100, 1, pc)]),
      sec("Scattering", [R("Scatter", "scatter", 0, 1000, 1, pc), C("Both axes", "scatterBoth"), R("Count", "count", 1, 16, 1), R("Count jitter", "countJ", 0, 100, 1, pc)]),
      sec("Texture", [S("Pattern", "tex", pats), R("Depth", "texDepth", 0, 100, 1, pc), R("Scale", "texScale", 1, 1000, 1, pc), C("Invert", "texInvert"), C("Texture each tip", "texEach")]),
      sec("Dual tip", [S("Second tip", "dual", duals), R("Size", "dualSize", 1, 300, 1, pc), R("Scatter", "dualScatter", 0, 300, 1, pc), R("Count", "dualCount", 1, 16, 1)]),
      sec("Colour dynamics", [R("Foreground / background jitter", "fgbgJ", 0, 100, 1, pc), S("Mix control", "fgbgC", CTL), R("Hue jitter", "hueJ", 0, 100, 1, pc), R("Saturation jitter", "satJ", 0, 100, 1, pc),
        R("Brightness jitter", "briJ", 0, 100, 1, pc), R("Purity", "purity", -100, 100, 1), C("Apply per tip", "perTip")]),
      sec("Transfer", [R("Opacity jitter", "opJ", 0, 100, 1, pc), S("Opacity control", "opC", CTL), R("Flow jitter", "flowJ", 0, 100, 1, pc), S("Flow control", "flowC", CTL)]),
      sec("Stroke", [R("Smoothing", "smooth", 0, 100, 1, pc), C("Build-up (airbrush)", "buildup"), S("Symmetry", "sym", SYM), R("Segments", "symN", 2, 32, 1), R("Centre X", "symX", 0, 100, 1, pc), R("Centre Y", "symY", 0, 100, 1, pc)])
    ]);
    var reset = K.btn("Reset dynamics", function () { PP.DYN_KEYS.forEach(function (k) { if (["spacing", "tip", "angle", "round", "flipX"].indexOf(k) < 0) o[k] = PP.BDEF[k]; }); dlg.close(); ED.saveOpts(); ED.ui.buildOpts(); settingsDialog(tool); }, "ghost");
    var save = PP.savePreset ? K.btn("Save as preset…", function () { PP.savePreset(tool); }, "ghost") : null;
    var dlg = K.modal("Brush settings — " + (row ? row[1] : tool), body, [reset, save, h("span", { "class": "grow" }), K.btn("Done", function () { dlg.close(); }, "primary")], true);
    redraw();
  }
  PP.settingsDialog = settingsDialog;
  window.addEventListener("keydown", function (e) {
    if (e.key !== "F5" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || ED.isTyping(e) || document.querySelector(".s3-modal") || !ED.doc || !PP.spec[ED.tool]) return;
    e.preventDefault(); e.stopImmediatePropagation(); settingsDialog(ED.tool);
  }, true);
  PP.shortcut("Brush settings", "F5 (with a painting tool)");
})();
