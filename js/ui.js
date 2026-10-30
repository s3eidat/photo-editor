/* Photo Editor UI: menus, tool bar, options bar, Properties / Layers / History panels, dialogs,
   adjustments with live preview, keyboard shortcuts, files (open, drop, paste, save, export) and autosave. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, $ = S3.$, h = S3.h;
  function svg(id, cls) { var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", cls || "i"); s.setAttribute("aria-hidden", "true"); var u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.appendChild(u); return s; }
  var MOD = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl+";
  function K(s) { return s.replace(/Ctrl\+/g, MOD); }
  function doc() { return ED.doc; }
  function need() { if (!ED.doc) { S3.toast("Open a photo or make a new document first"); return false; } if (ED.busyCheck()) return false; return true; }

  // ---------- tools ----------
  var TOOLS = [
    ["move", "Move / transform", "V"], ["marquee", "Rectangular marquee", "M"], ["ellipse", "Elliptical marquee", "M"], ["lasso", "Lasso", "L"],
    ["polygon", "Polygonal lasso", "L"], ["wand", "Magic wand", "W"], ["crop", "Crop", "C"], ["eyedropper", "Eyedropper", "I"],
    ["heal", "Healing brush", "J"], ["clone", "Clone stamp", "S"], ["brush", "Brush", "B"], ["eraser", "Eraser", "E"],
    ["gradient", "Gradient", "G"], ["bucket", "Paint bucket", "G"], ["text", "Text", "T"], ["shape", "Shape", "U"], ["hand", "Hand", "H"], ["zoom", "Zoom", "Z"]
  ];
  var CYCLE = { M: ["marquee", "ellipse"], L: ["lasso", "polygon"], G: ["gradient", "bucket"] };
  function buildTools() {
    var box = $("#tools"); box.textContent = "";
    var grid = h("div", { "class": "pe-tgrid" });
    TOOLS.forEach(function (t) {
      grid.appendChild(h("button", { type: "button", "class": "pe-tool", "data-tool": t[0], title: t[1] + " (" + t[2] + ")", "aria-label": t[1], "aria-pressed": "false", onclick: function () { if (ED.doc || t[0] === "hand") ED.setTool(t[0]); else ED.setTool(t[0]); } }, [svg("t-" + t[0])]));
    });
    box.appendChild(grid);
    var fg = h("input", { type: "color", "class": "pe-cin", "aria-label": "Foreground colour", value: "#111111" }), bg = h("input", { type: "color", "class": "pe-cin", "aria-label": "Background colour", value: "#ffffff" });
    fg.addEventListener("input", function () { if (ED.doc) { ED.doc.fg = fg.value; colors(); } });
    bg.addEventListener("input", function () { if (ED.doc) { ED.doc.bg = bg.value; colors(); } });
    var sw = h("div", { "class": "pe-colors" }, [
      h("label", { "class": "pe-fg", title: "Foreground colour (click to change)" }, [fg]), h("label", { "class": "pe-bg", title: "Background colour" }, [bg]),
      h("button", { type: "button", "class": "pe-mini pe-swap", title: "Swap colours (X)", "aria-label": "Swap colours", onclick: swapColors }, [svg("t-swap")]),
      h("button", { type: "button", "class": "pe-mini pe-reset", title: "Default black and white (D)", "aria-label": "Default colours", onclick: resetColors }, [svg("t-reset")])
    ]);
    box.appendChild(sw);
    box._fg = fg; box._bg = bg;
  }
  function colors() {
    var b = $("#tools"); if (!ED.doc || !b._fg) return;
    b._fg.value = ED.doc.fg; b._bg.value = ED.doc.bg;
    $(".pe-fg").style.background = ED.doc.fg; $(".pe-bg").style.background = ED.doc.bg;
  }
  function swapColors() { if (!ED.doc) return; var t = ED.doc.fg; ED.doc.fg = ED.doc.bg; ED.doc.bg = t; colors(); }
  function resetColors() { if (!ED.doc) return; ED.doc.fg = "#000000"; ED.doc.bg = "#ffffff"; colors(); }

  // ---------- options bar ----------
  function field(label, el, cls) { return h("label", { "class": "pe-of" + (cls ? " " + cls : "") }, [h("span", { text: label }), el]); }
  function range(label, val, min, max, step, onSet, fmt) {
    var out = h("output", { text: fmt ? fmt(val) : String(val) }), r = h("input", { type: "range", min: min, max: max, step: step, value: val });
    r.addEventListener("input", function () { var v = +r.value; out.textContent = fmt ? fmt(v) : String(v); onSet(v); });
    var f = h("label", { "class": "pe-of pe-rng" }, [h("span", { text: label }), r, out]);
    f._set = function (v) { r.value = v; out.textContent = fmt ? fmt(v) : String(v); };
    return f;
  }
  function check(label, val, onSet) { var c = h("input", { type: "checkbox" }); c.checked = !!val; c.addEventListener("change", function () { onSet(c.checked); }); return h("label", { "class": "check pe-chk" }, [c, " " + label]); }
  function seg(label, opts, val, onSet) {
    var g = h("div", { "class": "seg pe-seg", role: "group", "aria-label": label });
    opts.forEach(function (o) {
      var b = h("button", { type: "button", "aria-pressed": String(o[0] === val), title: o[2] || o[1] }, [o[3] ? svg(o[3]) : null, o[3] ? null : o[1]]);
      if (o[3]) b.setAttribute("aria-label", o[1]);
      b.addEventListener("click", function () { S3.$$("button", g).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); onSet(o[0]); });
      g.appendChild(b);
    });
    return label ? h("div", { "class": "pe-of" }, [h("span", { text: label }), g]) : g;
  }
  function select(label, opts, val, onSet) {
    var s = h("select", { "class": "select" });
    opts.forEach(function (o) { var op = h("option", { value: o[0], text: o[1] }); if (String(o[0]) === String(val)) op.selected = true; s.appendChild(op); });
    s.addEventListener("change", function () { onSet(s.value); });
    return field(label, s);
  }
  function btn(label, fn, cls, iconId, title) { return h("button", { type: "button", "class": "btn small " + (cls || ""), title: title || label, onclick: fn }, [iconId ? svg(iconId) : null, label]); }
  var pct = function (v) { return Math.round(v * 100) + "%"; }, px = function (v) { return v + " px"; };
  function brushOpts(o, extra) {
    var bar = [
      range("Size", o.size, 1, 1000, 1, function (v) { o.size = v; ED.saveOpts(); ED.renderOvl(); }, px),
      range("Hardness", o.hard, 0, 1, 0.01, function (v) { o.hard = v; ED.saveOpts(); }, pct),
      range("Opacity", o.op, 0.01, 1, 0.01, function (v) { o.op = v; ED.saveOpts(); }, pct)
    ];
    return bar.concat(extra || []);
  }
  var SELMODES = [["new", "New", "New selection", "t-snew"], ["add", "Add", "Add (Shift)", "t-sadd"], ["subtract", "Subtract", "Subtract (Alt)", "t-ssub"], ["intersect", "Intersect", "Intersect (Shift+Alt)", "t-sint"]];
  var RATIOS = [["free", "Free"], ["1:1", "1:1"], ["4:5", "4:5"], ["3:2", "3:2"], ["4:3", "4:3"], ["16:9", "16:9"], ["9:16", "9:16"], ["orig", "Original"]];
  function selOpts(withRatio) {
    var o = ED.o.sel, bar = [seg("", SELMODES, o.mode, function (v) { o.mode = v; ED.saveOpts(); }),
      field("Feather", numInput(o.feather, 0, 250, function (v) { o.feather = v; ED.saveOpts(); }), "pe-num")];
    if (withRatio) bar.push(select("Ratio", RATIOS.slice(0, 7), o.ratio, function (v) { o.ratio = v; ED.saveOpts(); }));
    return bar;
  }
  function numInput(val, min, max, onSet, step) {
    var i = h("input", { type: "number", "class": "input", min: min, max: max, step: step || 1, value: val });
    i.addEventListener("change", function () { var v = PE.clamp(+i.value || 0, min, max); i.value = v; onSet(v); });
    return i;
  }
  function buildOpts() {
    var bar = $("#opts"); bar.textContent = "";
    var t = ED.tool, o = ED.o, items = [];
    var name = TOOLS.filter(function (x) { return x[0] === t; })[0];
    items.push(h("span", { "class": "pe-oname" }, [svg("t-" + t), name ? name[1] : t]));
    if (t === "move") {
      if (ED.xf) {
        var xf = ED.xf;
        items.push(field("W %", numInput(Math.round(xf.sx * 1000) / 10, -10000, 10000, function (v) { ED.setXf("sx", v / 100 || 0.01); }, 0.1), "pe-num"));
        items.push(field("H %", numInput(Math.round(xf.sy * 1000) / 10, -10000, 10000, function (v) { ED.setXf("sy", v / 100 || 0.01); }, 0.1), "pe-num"));
        items.push(field("Angle", numInput(Math.round(xf.rot * 10) / 10, -360, 360, function (v) { ED.setXf("rot", v); }, 0.1), "pe-num"));
        items.push(btn("", function () { ED.setXf("sx", -ED.xf.sx); buildOpts(); }, "ghost icon", "t-fliph", "Flip horizontal"));
        items.push(btn("", function () { ED.setXf("sy", -ED.xf.sy); buildOpts(); }, "ghost icon", "t-flipv", "Flip vertical"));
        items.push(h("span", { "class": "pe-hint", text: "Drag handles to scale (Shift = free, Alt = from centre), outside a corner to rotate." }));
        items.push(btn("Cancel", ED.cancelTransform, "ghost"), btn("Apply", ED.applyTransform, "primary", "i-check"));
      } else {
        items.push(check("Auto-select layer", o.move.auto, function (v) { o.move.auto = v; ED.saveOpts(); }));
        items.push(btn("Free transform", function () { if (need()) ED.startTransform(); }, "", "t-xf", K("Free transform (Ctrl+T)")));
        items.push(btn("", function () { if (need()) ED.flipLayer("h"); }, "ghost icon", "t-fliph", "Flip layer horizontal"));
        items.push(btn("", function () { if (need()) ED.flipLayer("v"); }, "ghost icon", "t-flipv", "Flip layer vertical"));
        items.push(h("span", { "class": "pe-hint", text: "Drag to move the layer (or the selected pixels). " + K("Ctrl+click picks a layer. Arrows nudge.") }));
      }
    } else if (t === "marquee" || t === "ellipse") items = items.concat(selOpts(true));
    else if (t === "lasso") items = items.concat(selOpts(false));
    else if (t === "polygon") {
      items = items.concat(selOpts(false));
      items.push(h("span", { "class": "pe-hint", text: ED.poly ? "Click to add points. Double-click, Enter or click the first point to close. Backspace removes a point, Esc cancels." : "Click to place the first point." }));
    } else if (t === "wand") {
      items = items.concat(selOpts(false));
      items.push(range("Tolerance", o.wand.tol, 0, 255, 1, function (v) { o.wand.tol = v; ED.saveOpts(); }));
      items.push(check("Contiguous", o.wand.contig, function (v) { o.wand.contig = v; ED.saveOpts(); }));
      items.push(check("All layers", o.wand.all, function (v) { o.wand.all = v; ED.saveOpts(); }));
    } else if (t === "crop") {
      items.push(select("Ratio", RATIOS, o.crop.ratio, function (v) { o.crop.ratio = v; ED.saveOpts(); var k = ED.ratioNum(v); if (k && ED.crop) { var r = ED.crop, w = Math.min(r.w, r.h * k); ED.crop = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - w / k) / 2, w: w, h: w / k }; ED.renderOvl(); buildOpts(); } }));
      items.push(check("Delete cropped pixels", o.crop.trim, function (v) { o.crop.trim = v; ED.saveOpts(); }));
      if (ED.crop) items.push(h("span", { "class": "pe-hint mono", text: Math.round(ED.crop.w) + " × " + Math.round(ED.crop.h) + " px" }));
      items.push(btn("Cancel", ED.cancelCrop, "ghost"), btn("Crop", function () { if (need()) ED.applyCrop(); }, "primary", "i-check", "Apply crop (Enter)"));
    } else if (t === "eyedropper") {
      items.push(seg("Sample", [["all", "All layers"], ["layer", "Current layer"]], o.eye.all ? "all" : "layer", function (v) { o.eye.all = v === "all"; ED.saveOpts(); }));
      items.push(h("span", { "class": "pe-hint", text: "Click sets the foreground colour, Alt+click the background." }));
    } else if (t === "brush" || t === "eraser") {
      items = items.concat(brushOpts(o[t]));
      items.push(h("span", { "class": "pe-hint", text: (t === "brush" ? "Alt+click picks a colour. " : "") + "[ ] size, Shift+[ ] hardness, Shift+click draws a straight line." + (ED.maskEdit ? " Painting the MASK: black hides, white reveals." : "") }));
    } else if (t === "clone" || t === "heal") {
      items = items.concat(brushOpts(o[t], [check("Aligned", o[t].aligned, function (v) { o[t].aligned = v; ED.saveOpts(); })]));
      items.push(h("span", { "class": "pe-hint", text: ED.cloneSrc ? "Paint to " + (t === "heal" ? "heal (texture from the source, colour from around the stroke)" : "copy from the source") + ". Alt+click sets a new source." : "Alt+click a clean area to set the source first." }));
    } else if (t === "gradient") {
      items.push(seg("", [["linear", "Linear"], ["radial", "Radial"]], o.gradient.type, function (v) { o.gradient.type = v; ED.saveOpts(); }));
      items.push(check("Foreground to transparent", o.gradient.trans, function (v) { o.gradient.trans = v; ED.saveOpts(); }));
      items.push(check("Reverse", o.gradient.rev, function (v) { o.gradient.rev = v; ED.saveOpts(); }));
      items.push(range("Opacity", o.gradient.op, 0.01, 1, 0.01, function (v) { o.gradient.op = v; ED.saveOpts(); }, pct));
      items.push(h("span", { "class": "pe-hint", text: "Drag across the canvas. Shift snaps to 45°." }));
    } else if (t === "bucket") {
      items.push(range("Tolerance", o.bucket.tol, 0, 255, 1, function (v) { o.bucket.tol = v; ED.saveOpts(); }));
      items.push(check("Contiguous", o.bucket.contig, function (v) { o.bucket.contig = v; ED.saveOpts(); }));
      items.push(check("All layers", o.bucket.all, function (v) { o.bucket.all = v; ED.saveOpts(); }));
      items.push(range("Opacity", o.bucket.op, 0.01, 1, 0.01, function (v) { o.bucket.op = v; ED.saveOpts(); }, pct));
    } else if (t === "text") {
      var to = o.text;
      items.push(fontSelect(to.font, function (v) { to.font = v; ED.saveOpts(); textLive(function (T) { T.font = v; }); }));
      items.push(field("Size", numInput(to.size, 1, 2000, function (v) { to.size = v; ED.saveOpts(); textLive(function (T) { T.size = v; }); }), "pe-num"));
      items.push(seg("", [["400", "Regular"], ["700", "Bold"]], String(to.weight), function (v) { to.weight = +v; ED.saveOpts(); textLive(function (T) { T.weight = +v; }); }));
      items.push(seg("", [["left", "Left", "Align left", "t-al"], ["center", "Centre", "Align centre", "t-ac"], ["right", "Right", "Align right", "t-ar"]], to.align, function (v) { to.align = v; ED.saveOpts(); textLive(function (T) { T.align = v; }); }));
      items.push(seg("", [["auto", "Auto"], ["ltr", "LTR"], ["rtl", "RTL"]], to.dir, function (v) { to.dir = v; ED.saveOpts(); textLive(function (T) { T.dir = v; }); }));
      items.push(h("span", { "class": "pe-hint", text: "Click to add text, click a text layer to edit it. " + K("Ctrl+Enter or Esc finishes.") }));
    } else if (t === "shape") {
      var so = o.shape;
      items.push(seg("", PE.SHAPES.map(function (s) { return [s, s, s.charAt(0).toUpperCase() + s.slice(1), "s-" + s]; }), so.type, function (v) { so.type = v; ED.saveOpts(); }));
      items.push(check("No fill", so.noFill, function (v) { so.noFill = v; ED.saveOpts(); }));
      items.push(field("Stroke", numInput(so.sw, 0, 500, function (v) { so.sw = v; ED.saveOpts(); }), "pe-num"));
      items.push(h("span", { "class": "pe-hint", text: "Drag to draw (Shift = square / 15° steps). Fill uses the foreground colour; edit it later in Properties." }));
    } else if (t === "zoom") {
      items.push(btn("Fit", function () { ED.fit(true); }, "ghost"), btn("100%", function () { ED.zoomAt(1); }, "ghost"));
      items.push(h("span", { "class": "pe-hint", text: "Click to zoom in, Alt+click to zoom out. " + K("Alt+wheel or Ctrl+wheel zooms anywhere.") }));
    } else if (t === "hand") items.push(h("span", { "class": "pe-hint", text: "Drag to pan. Hold Space with any tool. Double-click fits the screen." }));
    (ED.ui.optsTail || []).forEach(function (f) { f(t, items); });   // lane:selection (lanes add tool options: f(tool, items))
    items.forEach(function (x) { bar.appendChild(x); });
  }
  function textLive(fn) {
    var L = ED.textL || (ED.layer() && ED.layer().kind === "text" ? ED.layer() : null); if (!L) return;
    if (ED.textL) { fn(L.text); ED.placeText(); ED.render(); return; }
    ED.meta("Text style", function () { fn(L.text); }); buildProps();
  }
  function fontSelect(cur, onSet) {
    var list = PE.deviceFonts().slice(); if (list.indexOf(cur) < 0) list.unshift(cur);
    return select("Font", list.map(function (f) { return [f, f]; }), cur, onSet);
  }

  // ---------- Properties panel ----------
  var propBefore = null, propT = 0;
  function propEdit(label, fn) {     // live edit, one history step per pause
    if (!propBefore) propBefore = PE.snap(ED.doc);
    fn(); ED.render(); if (ED.textL) ED.placeText();
    clearTimeout(propT); propT = setTimeout(function () { var b = propBefore; propBefore = null; ED.push(PE.metaEntry(label, ED.doc, b)); }, 450);
  }
  function flushProps() { if (propBefore) { clearTimeout(propT); var b = propBefore; propBefore = null; ED.push(PE.metaEntry("Properties", ED.doc, b)); } }
  ED.flushProps = flushProps;
  function pnum(label, val, onSet, step, min, max) {
    var i = h("input", { type: "number", "class": "input", step: step || 1, value: Math.round(val * 100) / 100 });
    if (min != null) i.min = min; if (max != null) i.max = max;
    i.addEventListener("input", function () { var v = +i.value; if (isFinite(v) && i.value !== "") onSet(min != null ? PE.clamp(v, min, max == null ? Infinity : max) : v); });
    return h("label", { "class": "pe-pf" }, [h("span", { text: label }), i]);
  }
  function pcolor(label, val, onSet) {
    var c = h("input", { type: "color", value: val || "#000000" });
    c.addEventListener("input", function () { onSet(c.value); });
    return h("label", { "class": "pe-pf pe-pcol" }, [h("span", { text: label }), c]);
  }
  function buildProps() {
    var P = $("#props"); if (!P) return; P.textContent = "";
    var d = ED.doc, L = ED.layer();
    if (!d || !L) { P.appendChild(h("p", { "class": "faint pe-p", text: "Open a photo to see its layers here." })); return; }
    if (ED.ui.propsKind && ED.ui.propsKind(P, L)) return;   // lane:selection (group, adjustment, fill, smart layers)
    var head = h("div", { "class": "pe-phead" }, [svg(L.kind === "text" ? "t-text" : L.kind === "shape" ? "t-shape" : "i-image"), h("b", { text: L.name }), h("span", { "class": "faint", text: L.kind === "raster" ? "Pixel layer" : L.kind === "text" ? "Text layer" : "Shape layer" })]);
    P.appendChild(head);
    if (L.kind === "text") {
      var T = L.text, txt = h("textarea", { "class": "textarea prose", dir: "auto", rows: "3", "aria-label": "Text" }); txt.value = T.text;
      txt.addEventListener("input", function () { propEdit("Edit text", function () { T.text = txt.value.slice(0, PE.LIM.text); if (ED.textL === L) $("#textEdit").value = T.text; }); });
      P.appendChild(txt);
      var fonts = PE.deviceFonts().slice(); if (fonts.indexOf(T.font) < 0) fonts.unshift(T.font);
      var fs = h("select", { "class": "select", "aria-label": "Font" }); fonts.forEach(function (f) { var o = h("option", { value: f, text: f }); if (f === T.font) o.selected = true; fs.appendChild(o); });
      fs.addEventListener("change", function () { propEdit("Font", function () { T.font = fs.value; }); });
      P.appendChild(h("div", { "class": "pe-pgrid" }, [h("label", { "class": "pe-pf pe-span2" }, [h("span", { text: "Font" }), fs]),
        pnum("Size", T.size, function (v) { propEdit("Font size", function () { T.size = v; }); }, 1, 1, 2000), pcolor("Colour", T.color, function (v) { propEdit("Text colour", function () { T.color = v; }); }),
        pnum("Line height", T.lh, function (v) { propEdit("Line height", function () { T.lh = v; }); }, 0.05, 0.5, 4), pnum("Rotation", T.rot, function (v) { propEdit("Rotate", function () { T.rot = v; }); }, 1, -360, 360),
        pnum("X", T.ax, function (v) { propEdit("Move", function () { T.ax = v; }); }), pnum("Y", T.ay, function (v) { propEdit("Move", function () { T.ay = v; }); })]));
      P.appendChild(h("div", { "class": "pe-prow" }, [
        seg("", [["400", "Regular"], ["700", "Bold"]], String(T.weight >= 600 ? 700 : 400), function (v) { propEdit("Weight", function () { T.weight = +v; }); }),
        check("Italic", T.italic, function (v) { propEdit("Italic", function () { T.italic = v; }); })]));
      P.appendChild(h("div", { "class": "pe-prow" }, [
        seg("", [["left", "Left", "Align left", "t-al"], ["center", "Centre", "Align centre", "t-ac"], ["right", "Right", "Align right", "t-ar"]], T.align, function (v) {
          propEdit("Align", function () { var b = PE.textLayout(T).box; T.align = v; T.ax = v === "left" ? b.x : v === "center" ? b.x + b.w / 2 : b.x + b.w; }); }),
        seg("", [["auto", "Auto"], ["ltr", "LTR"], ["rtl", "RTL"]], T.dir, function (v) { propEdit("Direction", function () { T.dir = v; }); })]));
      P.appendChild(h("div", { "class": "pe-prow" }, [btn("Edit on canvas", function () { ED.setTool("text"); ED.startText(L, PE.snap(ED.doc)); }, "ghost"), btn("Rasterize", function () { ED.rasterize(L, true); }, "ghost")]));
    } else if (L.kind === "shape") {
      var S = L.shape, st = h("select", { "class": "select", "aria-label": "Shape" });
      PE.SHAPES.forEach(function (s) { var o = h("option", { value: s, text: s.charAt(0).toUpperCase() + s.slice(1) }); if (s === S.type) o.selected = true; st.appendChild(o); });
      st.addEventListener("change", function () { propEdit("Shape type", function () { S.type = st.value; }); });
      var noFill = check("No fill", !S.fill, function (v) { propEdit("Fill", function () { S.fill = v ? "" : ED.doc.fg; }); buildProps(); });
      P.appendChild(h("div", { "class": "pe-pgrid" }, [h("label", { "class": "pe-pf pe-span2" }, [h("span", { text: "Shape" }), st]),
        pnum("X", S.x, function (v) { propEdit("Move", function () { S.x = v; }); }), pnum("Y", S.y, function (v) { propEdit("Move", function () { S.y = v; }); }),
        pnum("W", S.w, function (v) { propEdit("Resize", function () { S.w = v; }); }, 1, 1, 3 * PE.LIM.side), pnum("H", S.h, function (v) { propEdit("Resize", function () { S.h = v; }); }, 1, 1, 3 * PE.LIM.side),
        pnum("Rotation", S.rot, function (v) { propEdit("Rotate", function () { S.rot = v; }); }, 1, -360, 360), pnum("Corner radius", S.radius, function (v) { propEdit("Radius", function () { S.radius = v; }); }, 1, 0, 1e4),
        S.fill ? pcolor("Fill", S.fill, function (v) { propEdit("Fill", function () { S.fill = v; }); }) : h("span"), pcolor("Stroke", S.stroke, function (v) { propEdit("Stroke", function () { S.stroke = v; }); }),
        pnum("Stroke width", S.sw, function (v) { propEdit("Stroke width", function () { S.sw = v; }); }, 1, 0, 500)]));
      P.appendChild(h("div", { "class": "pe-prow" }, [noFill, btn("Rasterize", function () { ED.rasterize(L, true); }, "ghost")]));
    } else {
      P.appendChild(h("p", { "class": "faint pe-p", text: L.canvas.width + " × " + L.canvas.height + " px at " + L.x + ", " + L.y + (L.mask ? "" : ". Add a mask to hide parts without erasing.") }));
      P.appendChild(h("div", { "class": "pe-prow" }, [btn("Free transform", function () { ED.setTool("move"); ED.startTransform(); }, "ghost", "t-xf"),
        btn("", function () { ED.flipLayer("h"); }, "ghost icon", "t-fliph", "Flip horizontal"), btn("", function () { ED.flipLayer("v"); }, "ghost icon", "t-flipv", "Flip vertical")]));
    }
    if (L.mask) {
      P.appendChild(h("h3", { text: "Layer mask" }));
      P.appendChild(h("p", { "class": "faint pe-p", text: ED.maskEdit ? "You are painting the mask: black hides, white reveals, grey is partly see-through." : "Click the mask thumbnail in Layers to paint on it." }));
      P.appendChild(h("div", { "class": "pe-prow" }, [
        check("Enabled", L.maskOn, function (v) { ED.meta(v ? "Enable mask" : "Disable mask", function () { L.maskOn = v; }); }),
        seg("", [["pix", "Pixels"], ["mask", "Mask"]], ED.maskEdit ? "mask" : "pix", function (v) { ED.setActive(L.id, v === "mask"); })]));
      P.appendChild(h("div", { "class": "pe-prow" }, [btn("Invert", function () { maskOp("invert"); }, "ghost"), btn("Apply", function () { maskOp("apply"); }, "ghost"), btn("Delete", function () { maskOp("delete"); }, "ghost")]));
    }
    if (ED.ui.propsTail) ED.ui.propsTail(P, L);   // lane:selection (vector mask, more Properties for any layer)
  }

  // ---------- Layers panel ----------
  var THUMB = new WeakMap();
  function thumbFor(L, which) {
    var d = ED.doc, c = h("canvas", { "class": "pe-thumb", width: "44", height: "34" }), x = c.getContext("2d");
    x.fillStyle = which === "mask" ? "#000" : x.createPattern(checkTile(), "repeat"); x.fillRect(0, 0, 44, 34);
    var k = Math.min(44 / d.w, 34 / d.h), ox = (44 - d.w * k) / 2, oy = (34 - d.h * k) / 2;
    x.setTransform(k, 0, 0, k, ox, oy);
    if (which === "mask") { x.fillStyle = "#000"; x.drawImage(L.mask.canvas, L.mask.x, L.mask.y); }
    else { var s = PE.surface(L, d); x.drawImage(s.canvas, s.x, s.y); }
    return c;
  }
  var ct = null;
  function checkTile() { if (!ct) { ct = PE.mk(8, 8); var x = ct.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 8, 8); x.fillStyle = "#ccc"; x.fillRect(0, 0, 4, 4); x.fillRect(4, 4, 4, 4); } return ct; }
  var dragId = null;
  function renderLayers() {
    if (ED.ui.layersExt) return ED.ui.layersExt();   // lane:selection (tree with groups, clipping, styles)
    var list = $("#layerList"); list.textContent = "";
    var d = ED.doc;
    $("#layerBlend").disabled = $("#layerOp").disabled = !d;
    if (!d) { list.appendChild(h("p", { "class": "faint pe-p", text: "No document open." })); return; }
    var L0 = ED.layer();
    if (L0) { $("#layerBlend").value = L0.blend; $("#layerOp").value = Math.round(L0.opacity * 100); $("#layerOpOut").textContent = Math.round(L0.opacity * 100) + "%"; }
    d.layers.slice().reverse().forEach(function (L) {
      var on = L === L0;
      var eye = h("button", { type: "button", "class": "pe-lbtn", title: L.visible ? "Hide layer" : "Show layer", "aria-label": (L.visible ? "Hide " : "Show ") + L.name, onclick: function (e) { e.stopPropagation(); ED.meta(L.visible ? "Hide layer" : "Show layer", function () { L.visible = !L.visible; }); } }, [svg(L.visible ? "t-eye" : "t-eyeoff")]);
      var th = h("button", { type: "button", "class": "pe-tb" + (on && !ED.maskEdit ? " on" : ""), title: K("Layer pixels (Ctrl+click: select its pixels)"), "aria-label": "Layer thumbnail", onclick: function (e) { e.stopPropagation(); if (e.ctrlKey || e.metaKey) { ED.selFromLayer(L); return; } ED.setActive(L.id, false); } }, [thumbFor(L)]);
      var mth = L.mask ? h("button", { type: "button", "class": "pe-tb pe-mtb" + (on && ED.maskEdit ? " on" : "") + (L.maskOn ? "" : " off"), title: "Layer mask: click to paint on it (Shift+click turns it on/off)", "aria-label": "Mask thumbnail",
        onclick: function (e) { e.stopPropagation(); if (e.shiftKey) { ED.meta("Toggle mask", function () { L.maskOn = !L.maskOn; }); return; } ED.setActive(L.id, true); } }, [thumbFor(L, "mask")]) : null;
      var nm = h("span", { "class": "pe-lname", text: L.name, title: "Double-click to rename" });
      nm.addEventListener("dblclick", function (e) { e.stopPropagation(); rename(L, nm); });
      var lock = h("button", { type: "button", "class": "pe-lbtn" + (L.locked ? " lk" : ""), title: L.locked ? "Unlock layer" : "Lock layer", "aria-label": (L.locked ? "Unlock " : "Lock ") + L.name, onclick: function (e) { e.stopPropagation(); ED.meta(L.locked ? "Unlock layer" : "Lock layer", function () { L.locked = !L.locked; }); } }, [svg(L.locked ? "t-lock" : "t-unlock")]);
      var meta = L.blend !== "normal" || L.opacity < 1 ? h("span", { "class": "pe-lmeta", text: (L.blend !== "normal" ? L.blend : "") + (L.opacity < 1 ? " " + Math.round(L.opacity * 100) + "%" : "") }) : null;
      var row = h("div", { "class": "pe-layer" + (on ? " on" : "") + (L.visible ? "" : " off"), draggable: "true", tabindex: "0", role: "option", "aria-selected": String(on), "data-id": L.id },
        [eye, th, mth, h("span", { "class": "pe-lmid" }, [nm, meta]), lock]);
      row.addEventListener("click", function () { ED.setActive(L.id, ED.maskEdit && L === L0); });
      row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); } });
      row.addEventListener("dragstart", function (e) { dragId = L.id; row.classList.add("drag"); try { e.dataTransfer.setData("text/plain", L.id); e.dataTransfer.effectAllowed = "move"; } catch (x) {} });
      row.addEventListener("dragend", function () { dragId = null; row.classList.remove("drag"); S3.$$(".pe-layer.over").forEach(function (x) { x.classList.remove("over"); }); });
      row.addEventListener("dragover", function (e) { if (!dragId) return; e.preventDefault(); row.classList.add("over"); });
      row.addEventListener("dragleave", function () { row.classList.remove("over"); });
      row.addEventListener("drop", function (e) {
        if (!dragId) return; e.preventDefault(); e.stopPropagation();
        var from = PE.findLayer(d, dragId); if (!from || from === L) return;
        ED.meta("Reorder layers", function () { var a = d.layers.filter(function (x) { return x !== from; }), i = a.indexOf(L); a.splice(i + 1, 0, from); d.layers = a; });
      });
      list.appendChild(row);
    });
  }
  function rename(L, el) {
    var i = h("input", { "class": "input pe-rename", value: L.name, maxlength: "100", dir: "auto", "aria-label": "Layer name" });
    el.replaceWith(i); i.focus(); i.select();
    var done = false;
    function end(save) { if (done) return; done = true; var v = i.value.trim().slice(0, 100); if (save && v && v !== L.name) ED.meta("Rename layer", function () { L.name = v; }); else renderLayers(); }
    i.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") end(true); if (e.key === "Escape") end(false); });
    i.addEventListener("blur", function () { end(true); });
  }
  var layersSoon = S3.debounce(function () { renderLayers(); }, 120);

  // ---------- History panel ----------
  function renderHistory() {
    var box = $("#hist"); box.textContent = "";
    var H = ED.hist; if (!H) return;
    var rows = [{ label: H.base || "Open", i: 0 }].concat(H.list.map(function (e, i) { return { label: e.label, i: i + 1 }; }));
    if (H.dropped) box.appendChild(h("p", { "class": "faint pe-p", text: H.dropped + " older step" + (H.dropped > 1 ? "s were" : " was") + " dropped to save memory." }));
    rows.forEach(function (r) {
      var b = h("button", { type: "button", "class": "pe-hrow" + (r.i === H.pos ? " on" : "") + (r.i > H.pos ? " fut" : ""), text: r.label, onclick: function () { ED.jump(r.i); } });
      box.appendChild(b);
    });
    var cur = box.querySelector(".on"); if (cur) { var t = cur.offsetTop; if (t < box.scrollTop || t > box.scrollTop + box.clientHeight - cur.offsetHeight) box.scrollTop = t - box.clientHeight / 2; }
    $("#btnUndo").disabled = !H.canUndo(); $("#btnRedo").disabled = !H.canRedo();
    $("#histMem").textContent = H.bytes > 4096 ? S3.fmtBytes(H.bytes) : "";
  }

  // ---------- layer operations ----------
  function L() { return ED.layer(); }
  var LOPS = {
    newLayer: function () { if (need()) ED.newRasterLayer(); },
    duplicate: function () {
      if (!need()) return; var a = L(); if (!a) return;
      if (PE.dupExt && PE.dupExt(a)) return;   // lane:selection
      var c = PE.newLayer(a.kind, { name: a.name + " copy", visible: a.visible, opacity: a.opacity, blend: a.blend, x: a.x, y: a.y, maskOn: a.maskOn, text: PE.clone(a.text), shape: PE.clone(a.shape), canvas: a.canvas ? PE.touch(PE.cloneCanvas(a.canvas)) : null });
      if (a.mask) c.mask = { canvas: PE.touch(PE.cloneCanvas(a.mask.canvas)), x: a.mask.x, y: a.mask.y };
      ED.addLayer(c, "Duplicate layer");
    },
    remove: function () {
      if (!need()) return; var d = doc(), a = L(); if (!a) return;
      if (PE.removeExt && PE.removeExt(a)) return;   // lane:selection
      if (d.layers.length === 1) { S3.toast("A document needs at least one layer", "error"); return; }
      ED.meta("Delete layer", function () { var i = d.layers.indexOf(a); d.layers.splice(i, 1); d.active = d.layers[Math.max(0, i - 1)].id; ED.maskEdit = false; });
    },
    up: function () { move(1); }, down: function () { move(-1); },
    viaCopy: function (cut) {
      if (!need()) return; var d = doc(), a = L();
      if (!d.sel) { LOPS.duplicate(); return; }
      if (!ED.editable(a, "pixels")) return;
      var s = PE.surface(a, d), b = d.sel.b, c = PE.mk(b.w, b.h), x = c.getContext("2d");
      x.drawImage(s.canvas, s.x - b.x, s.y - b.y);
      if (a.mask && a.maskOn) { x.globalCompositeOperation = "destination-in"; x.drawImage(a.mask.canvas, a.mask.x - b.x, a.mask.y - b.y); }
      x.globalCompositeOperation = "destination-in"; x.drawImage(PE.selCanvas(d.sel), -b.x, -b.y);
      var nl = PE.rasterFromCanvas(PE.touch(c), cut ? "Layer via cut" : "Layer via copy", b.x, b.y);
      ED.meta(cut ? "Layer via cut" : "Layer via copy", function () {
        if (cut && a.kind === "raster") { var n = PE.cloneCanvas(a.canvas), nx = n.getContext("2d"); nx.globalCompositeOperation = "destination-out"; nx.drawImage(PE.selCanvas(d.sel), -a.x, -a.y); a.canvas = PE.touch(n); }
        d.layers.splice(d.layers.indexOf(a) + 1, 0, nl); d.active = nl.id; ED.maskEdit = false;
      });
    },
    addMask: function (fromSel) {
      if (!need()) return; var a = L(); if (!a) return;
      if (a.mask) { S3.toast("This layer already has a mask"); ED.setActive(a.id, true); return; }
      ED.meta(fromSel ? "Add mask from selection" : "Add layer mask", function () { a.mask = fromSel && doc().sel ? PE.maskFromSel(doc()) : PE.whiteMask(doc()); a.maskOn = true; });
      ED.setActive(a.id, true); S3.toast("Mask added. Paint black to hide, white to bring back.");
    },
    mergeDown: function () {
      if (!need()) return; var d = doc(), a = L(), i = d.layers.indexOf(a), b = d.layers[i - 1];
      if (PE.mergeExt && PE.mergeExt(a)) return;   // lane:selection
      if (!b) { S3.toast("There is no layer below to merge into", "error"); return; }
      if (b.locked || a.locked) { S3.toast("Unlock both layers to merge them", "error"); return; }
      var below = PE.newLayer("raster", {}), save = { o: b.opacity, bl: b.blend };
      ED.meta("Merge down", function () {
        b.opacity = 1; b.blend = "normal";
        var c = PE.flatten(d, { only: [b.id, a.id] });
        b.opacity = save.o; b.blend = save.bl;
        b.kind = "raster"; b.text = null; b.shape = null; b.canvas = PE.touch(c); b.x = 0; b.y = 0; b.mask = null;
        d.layers.splice(i, 1); d.active = b.id; ED.maskEdit = false;
      });
      void below;
    },
    mergeVisible: function () {
      if (!need()) return; var d = doc(), vis = d.layers.filter(function (x) { return x.visible; });
      if (vis.length < 2) { S3.toast("Need at least two visible layers"); return; }
      ED.meta("Merge visible", function () {
        var c = PE.flatten(d), nl = PE.rasterFromCanvas(PE.touch(c), "Merged");
        var first = d.layers.indexOf(vis[0]);
        d.layers = d.layers.filter(function (x) { return !x.visible; }); d.layers.splice(Math.min(first, d.layers.length), 0, nl); d.active = nl.id; ED.maskEdit = false;
      });
    },
    flatten: function () {
      if (!need()) return; var d = doc();
      ED.meta("Flatten image", function () { var c = PE.flatten(d, { bg: "#ffffff" }), nl = PE.rasterFromCanvas(PE.touch(c), "Background"); d.layers = [nl]; d.active = nl.id; ED.maskEdit = false; });
    }
  };
  function move(dir) {
    if (!need()) return; var d = doc(), a = L(), i = d.layers.indexOf(a), j = i + dir;
    if (PE.moveExt && PE.moveExt(a, dir)) return;   // lane:selection
    if (j < 0 || j >= d.layers.length) return;
    ED.meta(dir > 0 ? "Bring forward" : "Send backward", function () { d.layers.splice(i, 1); d.layers.splice(j, 0, a); });
  }
  function maskOp(how) {
    var a = L(); if (!a || !a.mask) return;
    if (how === "delete") { ED.meta("Delete mask", function () { a.mask = null; }); ED.maskEdit = false; }
    else if (how === "invert") {
      ED.meta("Invert mask", function () {
        var m = a.mask, n = PE.mk(m.canvas.width, m.canvas.height), x = n.getContext("2d");
        x.fillStyle = "#fff"; x.fillRect(0, 0, n.width, n.height); x.globalCompositeOperation = "destination-out"; x.drawImage(m.canvas, 0, 0);
        a.mask = { canvas: PE.touch(n), x: m.x, y: m.y };
      });
    } else if (how === "apply") {
      if (!ED.editable(a, "pixels")) return;
      ED.meta("Apply mask", function () {
        var n = PE.cloneCanvas(a.canvas), x = n.getContext("2d");
        x.globalCompositeOperation = "destination-in"; x.drawImage(a.mask.canvas, a.mask.x - a.x, a.mask.y - a.y);
        a.canvas = PE.touch(n); a.mask = null;
      });
      ED.maskEdit = false;
    }
    ED.emit("layers"); buildProps();
  }
  ED.LOPS = LOPS; ED.maskOp = maskOp;

  // ---------- clipboard ----------
  function copySel(cut) {
    if (!need()) return; var d = doc(), a = L(); if (!a) return;
    var r = d.sel ? d.sel.b : { x: 0, y: 0, w: d.w, h: d.h }, c = PE.flatten(d, { only: [a.id], rect: r });
    if (d.sel) { var x = c.getContext("2d"); x.globalCompositeOperation = "destination-in"; x.drawImage(PE.selCanvas(d.sel), -r.x, -r.y); }
    var al = 0; a.opacity && (al = a.opacity);
    ED.clip = { canvas: c, x: r.x, y: r.y };
    if (navigator.clipboard && window.ClipboardItem) PE.toBlob(c, "image/png").then(function (b) { return navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); }).catch(function () {});
    if (cut) ED.clearSel(); else S3.toast("Copied" + (d.sel ? " the selection" : " the layer"));
    void al;
  }
  function pasteClip() {
    if (!ED.clip || !ED.doc) return;
    var c = PE.touch(PE.cloneCanvas(ED.clip.canvas));
    ED.addLayer(PE.rasterFromCanvas(c, "Pasted", ED.clip.x, ED.clip.y), "Paste");
  }

  // ---------- files ----------
  function openFiles(files, asLayers) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var proj = files.filter(function (f) { return /\.s3photo$/i.test(f.name); })[0];
    if (proj) { openProjectFile(proj); return; }
    var imgs = files.filter(function (f) { return /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif|ico|svg)$/i.test(f.name); });
    if (!imgs.length) { S3.toast("Those files are not images", "error"); return; }
    var chain = Promise.resolve(), first = !ED.doc || !asLayers;
    imgs.slice(0, 20).forEach(function (f, i) {
      chain = chain.then(function () { return PE.decodeImage(f); }).then(function (img) {
        if (first && i === 0) { ED.openImageDoc(img, f.name); saveNow(); }
        else ED.placeImage(img, f.name);
      });
    });
    ED.working(chain, "Opening…").then(function () { S3.done(); }).catch(function (e) { S3.toast(e.message, "error"); });
  }
  function openProjectFile(f) {
    if (f.size > PE.LIM.zip) { S3.toast("That file is too large to be a project", "error"); return; }
    ED.working(f.arrayBuffer().then(function (ab) { return PE.openProject(new Uint8Array(ab)); }), "Opening project…").then(function (d) {
      ED.openDoc(d, "Open project"); colors(); saveNow(); S3.toast("Opened “" + d.name + "”");
    }).catch(function (e) { S3.toast(e.message, "error"); });
  }
  function fname(ext) { return (String(ED.doc.name || "image").replace(/[\\\/:*?"<>|]+/g, "-").trim() || "image") + "." + ext; }
  function saveFile() {
    if (!need()) return;
    ED.flushProps();
    ED.working(PE.saveProject(ED.doc), "Saving…").then(function (blob) { S3.download(blob, fname("s3photo"), "application/zip"); S3.done(); S3.toast("Saved " + fname("s3photo") + " (" + S3.fmtBytes(blob.size) + ")"); })
      .catch(function (e) { S3.toast(e.message, "error"); });
  }

  // ---------- autosave (IndexedDB) ----------
  var saveT = 0, saving = false, again = false;
  function saveState(t, k) { var s = $("#saveState"); s.textContent = t; s.className = "chip pe-save" + (k ? " " + k : ""); }
  function dirty() { if (!ED.doc || ED.testing) return; saveState("Saving…"); clearTimeout(saveT); saveT = setTimeout(saveNow, 1500); }
  function saveNow() {
    if (!ED.doc) return;
    if (saving || ED.busy || ED.drag || ED.textL) { again = true; clearTimeout(saveT); saveT = setTimeout(saveNow, 1200); return; }
    saving = true; again = false;
    var d = ED.doc, t = PE.flatten(d, { scale: Math.min(1, 160 / Math.max(d.w, d.h)) }), thumb = t.toDataURL("image/png");
    PE.saveProject(d).then(function (blob) {
      return PE.store.put({ id: d.id, name: d.name, updated: Date.now(), w: d.w, h: d.h, thumb: thumb, blob: blob });
    }).then(function () {
      S3.store("pe-last", d.id); saveState("Saved on this device", "ok");
      return PE.store.list().then(function (all) { all.slice(12).forEach(function (r) { if (r.id !== d.id) PE.store.del(r.id); }); });
    }).catch(function (e) { saveState("Not saved: " + (e && e.name === "QuotaExceededError" ? "storage full" : "storage unavailable"), "warn"); })
      .then(function () { saving = false; if (again) dirty(); });
  }
  ED.saveNow = saveNow;
  function restoreLast() {
    var id = S3.store("pe-last");
    if (!id) return Promise.resolve(false);
    return PE.store.get(id).then(function (r) {
      if (!r || !r.blob) return false;
      return r.blob.arrayBuffer().then(function (ab) { return PE.openProject(new Uint8Array(ab)); }).then(function (d) { d.id = r.id; ED.openDoc(d, "Reopened"); colors(); saveState("Saved on this device", "ok"); return true; });
    }).catch(function () { return false; });
  }
  function openStored(id) {
    PE.store.get(id).then(function (r) {
      if (!r) throw new Error("That project is gone");
      return r.blob.arrayBuffer().then(function (ab) { return PE.openProject(new Uint8Array(ab)); }).then(function (d) { d.id = r.id; ED.openDoc(d, "Open"); colors(); S3.store("pe-last", d.id); saveState("Saved on this device", "ok"); });
    }).catch(function (e) { S3.toast(e.message, "error"); });
  }

  // ---------- dialogs ----------
  function modal(title, body, foot, wide) {
    var m = h("div", { "class": "s3-modal", role: "dialog", "aria-modal": "true", "aria-label": title });
    var x = h("button", { type: "button", "class": "btn ghost icon", "aria-label": "Close" }, [svg("i-x")]);
    var sheet = h("div", { "class": "s3-sheet pe-sheet" + (wide ? " wide" : "") }, [h("div", { "class": "row between" }, [h("h2", { text: title }), x]), body, foot ? h("div", { "class": "row pe-foot" }, foot) : null]);
    m.appendChild(sheet);
    function close() { m.remove(); document.removeEventListener("keydown", onKey, true); if (ED.stage) ED.stage.focus({ preventScroll: true }); }
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") { var p = sheet.querySelector(".pe-foot .btn.primary"); if (p) { e.preventDefault(); p.click(); } } }
    m.addEventListener("click", function (e) { if (e.target === m) close(); });
    x.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(m);
    var f = sheet.querySelector("input,select") || sheet.querySelector("button.primary") || x; f.focus({ preventScroll: true });
    return { el: m, close: close };
  }
  var PRESETS = [["Instagram square", 1080, 1080], ["Instagram portrait", 1080, 1350], ["Story / Reel", 1080, 1920], ["HD 1080p", 1920, 1080], ["4K UHD", 3840, 2160],
    ["YouTube thumbnail", 1280, 720], ["A4 at 300 dpi", 2480, 3508], ["US Letter at 300 dpi", 2550, 3300], ["Photo 6×4 in at 300 dpi", 1800, 1200], ["Web banner", 1500, 500], ["Small web", 800, 600], ["Icon", 512, 512]];
  function newDialog() {
    var w = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: "1080" }), hh = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: "1080" });
    var name = h("input", { "class": "input", value: "Untitled", maxlength: "100", dir: "auto" }), bg = "#ffffff";
    var grid = h("div", { "class": "pe-presets" });
    PRESETS.forEach(function (p, i) {
      var b = h("button", { type: "button", "class": "pe-preset", "aria-pressed": String(i === 0) }, [h("b", { text: p[0] }), h("span", { "class": "faint", text: p[1] + " × " + p[2] })]);
      b.addEventListener("click", function () { S3.$$(".pe-preset", grid).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); w.value = p[1]; hh.value = p[2]; });
      grid.appendChild(b);
    });
    var bgSeg = seg("Background", [["#ffffff", "White"], ["transparent", "Transparent"], ["#000000", "Black"], ["bg", "Background colour"]], bg, function (v) { bg = v; });
    var body = h("div", { "class": "stack" }, [grid, h("div", { "class": "pe-custom" }, [field("Width (px)", w), field("Height (px)", hh), field("Name", name)]), bgSeg,
      h("p", { "class": "faint pe-p", text: "Up to " + PE.LIM.side + " px a side and " + Math.round(PE.LIM.px / 1e6) + " megapixels." })]);
    var go = btn("Create", function () {
      try { PE.checkSize(+w.value, +hh.value, "A document"); } catch (e) { S3.toast(e.message, "error"); return; }
      var fill = bg === "bg" ? (ED.doc ? ED.doc.bg : "#ffffff") : bg;
      dlg.close(); ED.newBlank(+w.value, +hh.value, fill, name.value.trim() || "Untitled"); colors(); saveNow();
    }, "primary");
    var dlg = modal("New document", body, [h("span", { "class": "grow" }), go], true);
  }
  function imageSizeDialog() {
    if (!need()) return; var d = doc(), ratio = d.w / d.h, keep = true;
    var w = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: d.w }), hh = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: d.h });
    var pcts = h("input", { type: "number", "class": "input", min: "1", max: "1000", value: "100" });
    w.addEventListener("input", function () { if (keep) hh.value = Math.max(1, Math.round(+w.value / ratio)); pcts.value = Math.round(+w.value / d.w * 1000) / 10; });
    hh.addEventListener("input", function () { if (keep) w.value = Math.max(1, Math.round(+hh.value * ratio)); pcts.value = Math.round(+w.value / d.w * 1000) / 10; });
    pcts.addEventListener("input", function () { w.value = Math.max(1, Math.round(d.w * +pcts.value / 100)); hh.value = Math.max(1, Math.round(d.h * +pcts.value / 100)); });
    var body = h("div", { "class": "stack" }, [h("p", { "class": "faint pe-p", text: "Resamples every layer (smooth). Now " + d.w + " × " + d.h + " px." }),
      h("div", { "class": "pe-custom" }, [field("Width", w), field("Height", hh), field("Percent", pcts)]), check("Keep proportions", true, function (v) { keep = v; })]);
    var go = btn("Resize", function () { try { dlg.close(); ED.imageSize(Math.round(+w.value), Math.round(+hh.value)); } catch (e) { S3.toast(e.message, "error"); } }, "primary");
    var dlg = modal("Image size", body, [h("span", { "class": "grow" }), go]);
  }
  function canvasSizeDialog() {
    if (!need()) return; var d = doc(), anchor = 4, fill = "transparent";
    var w = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: d.w }), hh = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side), value: d.h });
    var grid = h("div", { "class": "pe-anchor", role: "group", "aria-label": "Anchor" });
    for (var i = 0; i < 9; i++) (function (i) { var b = h("button", { type: "button", "aria-pressed": String(i === 4), "aria-label": "Anchor " + (i + 1) }); b.addEventListener("click", function () { anchor = i; S3.$$("button", grid).forEach(function (x, j) { x.setAttribute("aria-pressed", String(j === i)); }); }); grid.appendChild(b); })(i);
    var body = h("div", { "class": "stack" }, [h("p", { "class": "faint pe-p", text: "Adds or trims space around the image without scaling it. Now " + d.w + " × " + d.h + " px." }),
      h("div", { "class": "pe-custom" }, [field("Width", w), field("Height", hh), h("div", { "class": "pe-of" }, [h("span", { text: "Anchor" }), grid])]),
      seg("New area", [["transparent", "Transparent"], ["#ffffff", "White"], ["fg", "Foreground"], ["bg", "Background"]], fill, function (v) { fill = v; })]);
    var go = btn("Apply", function () { try { var f = fill === "fg" ? d.fg : fill === "bg" ? d.bg : fill; dlg.close(); ED.canvasSize(Math.round(+w.value), Math.round(+hh.value), anchor, f); } catch (e) { S3.toast(e.message, "error"); } }, "primary");
    var dlg = modal("Canvas size", body, [h("span", { "class": "grow" }), go]);
  }
  function numberDialog(title, label, def, max, run) {
    var i = h("input", { type: "number", "class": "input", min: "1", max: String(max), value: String(def) });
    var go = btn("OK", function () { var v = PE.clamp(+i.value || 0, 1, max); dlg.close(); run(v); }, "primary");
    var dlg = modal(title, h("div", { "class": "stack" }, [field(label, i)]), [h("span", { "class": "grow" }), go]);
  }
  function fillDialog() {
    if (!need()) return; var d = doc(), use = "fg";
    var body = h("div", { "class": "stack" }, [seg("Use", [["fg", "Foreground"], ["bg", "Background"], ["#000000", "Black"], ["#ffffff", "White"], ["#808080", "50% grey"]], use, function (v) { use = v; }),
      h("p", { "class": "faint pe-p", text: d.sel ? "Fills the selection on the current layer." : "No selection: fills the whole layer." })]);
    var go = btn("Fill", function () { dlg.close(); ED.fillSel(use === "fg" ? d.fg : use === "bg" ? d.bg : use); }, "primary");
    var dlg = modal("Fill", body, [h("span", { "class": "grow" }), go]);
  }
  function exportDialog(selOnly) {
    if (!need()) return; ED.flushProps();
    var d = doc(), st = Object.assign({ fmt: "png", q: 0.9, scale: 1 }, S3.store("pe-export") || {}), only = !!(selOnly && d.sel);
    var info = h("p", { "class": "pe-p mono" }), qf = range("Quality", st.q, 0.1, 1, 0.01, function (v) { st.q = v; }, pct);
    var sc = h("input", { type: "number", "class": "input", min: "1", max: "400", value: String(Math.round(st.scale * 100)) });
    function size() { var r = only ? d.sel.b : { w: d.w, h: d.h }, k = Math.min(st.scale, PE.LIM.side / r.w, PE.LIM.side / r.h); return { w: Math.max(1, Math.round(r.w * k)), h: Math.max(1, Math.round(r.h * k)), k: k }; }
    function upd() { var s = size(); info.textContent = s.w + " × " + s.h + " px · " + st.fmt.toUpperCase() + (st.fmt === "png" ? " (lossless, keeps transparency)" : st.fmt === "jpg" ? " (no transparency: white behind)" : " (keeps transparency)"); qf.hidden = st.fmt === "png"; }
    sc.addEventListener("input", function () { st.scale = PE.clamp(+sc.value || 100, 1, 400) / 100; upd(); });
    var selChk = check("Only the selection", only, function (v) { only = v && !!d.sel; upd(); });
    if (!d.sel) selChk.querySelector("input").disabled = true;
    var body = h("div", { "class": "stack" }, [seg("Format", [["png", "PNG"], ["jpg", "JPG"], ["webp", "WebP"]], st.fmt, function (v) { st.fmt = v; upd(); }), qf,
      h("div", { "class": "pe-custom" }, [field("Scale %", sc)]), selChk, info]);
    var go = btn("Download", function () {
      S3.store("pe-export", st);
      var s = size(), r = only ? d.sel.b : null, type = st.fmt === "jpg" ? "image/jpeg" : st.fmt === "webp" ? "image/webp" : "image/png";
      var c = PE.flatten(d, { scale: s.k, rect: r, selMask: only, bg: st.fmt === "jpg" ? "#ffffff" : null });
      ED.working(PE.toBlob(c, type, st.fmt === "png" ? undefined : st.q)).then(function (b) {
        if (b.type !== type) S3.toast("This browser cannot write " + st.fmt.toUpperCase() + "; saved as " + (b.type.split("/")[1] || "PNG").toUpperCase(), "error");
        var ext = b.type === "image/jpeg" ? "jpg" : b.type === "image/webp" ? "webp" : "png";
        S3.download(b, fname(ext).replace(/(\.[a-z]+)$/, (only ? "-selection" : "") + "$1"), b.type); S3.done(); dlg.close();
      }).catch(function (e) { S3.toast(e.message, "error"); });
    }, "primary", "i-download");
    var dlg = modal(selOnly ? "Export selection" : "Export image", body, [h("span", { "class": "faint", text: "Nothing is uploaded." }), h("span", { "class": "grow" }), go]);
    upd();
  }
  function recentDialog() {
    var body = h("div", { "class": "stack" }, [h("p", { "class": "faint pe-p", text: "Projects are saved automatically in this browser only (the 12 most recent). Use File › Save project to keep a copy." })]), list = h("div", { "class": "pe-recent" });
    body.appendChild(list);
    var dlg = modal("Recent projects", body, null, true);
    PE.store.list().then(function (all) {
      if (!all.length) { list.appendChild(h("p", { "class": "empty", text: "Nothing saved yet." })); return; }
      all.forEach(function (r) {
        var del = h("button", { type: "button", "class": "btn ghost icon small", "aria-label": "Delete " + r.name, title: "Delete from this browser" }, [svg("i-trash")]);
        var open = h("button", { type: "button", "class": "pe-rcard" }, [h("img", { src: r.thumb || "", alt: "" }), h("b", { text: r.name }), h("span", { "class": "faint", text: r.w + " × " + r.h + " · " + new Date(r.updated).toLocaleString() })]);
        open.addEventListener("click", function () { dlg.close(); openStored(r.id); });
        del.addEventListener("click", function () { if (ED.doc && ED.doc.id === r.id) { S3.toast("That project is open", "error"); return; } PE.store.del(r.id).then(function () { item.remove(); }); });
        var item = h("div", { "class": "pe-ritem" }, [open, del]);
        list.appendChild(item);
      });
    }).catch(function () { list.appendChild(h("p", { "class": "empty", text: "Storage is not available in this browser." })); });
  }
  var SHORTCUTS = [["Tools", "V move · M marquee · L lasso · W wand · C crop · I eyedropper · J heal · S clone · B brush · E eraser · G gradient / bucket · T text · U shape · H hand · Z zoom (press again to cycle)"],
    ["Undo / redo", "Ctrl+Z · Ctrl+Shift+Z (or Ctrl+Y)"], ["Select all / deselect / inverse", "Ctrl+A · Ctrl+D · Ctrl+Shift+I"], ["Feather", "Shift+F6"],
    ["Add / subtract / intersect", "hold Shift / Alt / Shift+Alt when you start"], ["Free transform", "Ctrl+T (in some browsers Ctrl+Alt+T)"],
    ["Layer via copy / cut", "Ctrl+J · Ctrl+Shift+J"], ["New layer", "Ctrl+Shift+N (or Alt+Shift+N)"], ["Merge down / visible", "Ctrl+E · Ctrl+Shift+E"], ["Layer up / down", "Ctrl+] · Ctrl+["],
    ["Levels / curves / hue-sat", "Ctrl+L · Ctrl+M · Ctrl+U"], ["Colour balance / invert / desaturate", "Ctrl+B · Ctrl+I · Ctrl+Shift+U"],
    ["Copy / cut / paste", "Ctrl+C · Ctrl+X · Ctrl+V (paste makes a new layer)"], ["Fill fg / bg / dialog", "Alt+Backspace · Ctrl+Backspace · Shift+F5"], ["Clear selection", "Delete"],
    ["Brush size / hardness", "[ ] · Shift+[ ]"], ["Opacity", "1–9, 0 = 100% (brush, or layer)"], ["Colours", "X swap · D black/white"],
    ["Zoom", "Ctrl+= · Ctrl+- · Ctrl+0 fit · Ctrl+1 100% · Alt/Ctrl+wheel"], ["Pan", "Space+drag · wheel"], ["Apply / cancel", "Enter · Esc"],
    ["Save project / open / export", "Ctrl+S · Ctrl+O · Ctrl+Shift+Alt+W"], ["New document", "Ctrl+Alt+N"]];
  function shortcutsDialog() {
    var t = h("table", { "class": "tbl" }, [h("tbody", {}, SHORTCUTS.map(function (r) { return h("tr", {}, [h("td", { text: r[0] }), h("td", { "class": "mono", text: K(r[1]) })]); }))]);
    modal("Keyboard shortcuts", h("div", { "class": "tbl-wrap" }, [t]), null, true);
  }

  // ---------- adjustments & filters (floating panel with live preview) ----------
  function sl(k, label, min, max, step, def, fmt) { return { k: k, label: label, min: min, max: max, step: step, def: def, fmt: fmt }; }
  var ADJ = {
    brightness: { t: "Brightness / Contrast", c: [sl("b", "Brightness", -150, 150, 1, 0), sl("c", "Contrast", -100, 100, 1, 0)] },
    levels: { t: "Levels", custom: "levels" },
    curves: { t: "Curves", custom: "curves" },
    exposure: { t: "Exposure", c: [sl("ev", "Exposure (stops)", -5, 5, 0.01, 0), sl("offset", "Offset", -0.5, 0.5, 0.001, 0), sl("gamma", "Gamma", 0.1, 4, 0.01, 1)] },
    hueSat: { t: "Hue / Saturation", c: [sl("hue", "Hue", -180, 180, 1, 0), sl("sat", "Saturation", -100, 100, 1, 0), sl("light", "Lightness", -100, 100, 1, 0)], chk: [["colorize", "Colorize"]] },
    vibrance: { t: "Vibrance", c: [sl("vibrance", "Vibrance", -100, 100, 1, 0), sl("sat", "Saturation", -100, 100, 1, 0)] },
    colorBalance: { t: "Colour balance", custom: "balance" },
    bw: { t: "Black & white", c: [sl("reds", "Reds", -200, 300, 1, 40), sl("yellows", "Yellows", -200, 300, 1, 60), sl("greens", "Greens", -200, 300, 1, 40), sl("cyans", "Cyans", -200, 300, 1, 60), sl("blues", "Blues", -200, 300, 1, 20), sl("magentas", "Magentas", -200, 300, 1, 80)] },
    threshold: { t: "Threshold", c: [sl("level", "Level", 1, 255, 1, 128)] },
    blur: { t: "Gaussian blur", c: [sl("radius", "Radius (px)", 0, 250, 0.1, 4)] },
    unsharp: { t: "Unsharp mask", c: [sl("amount", "Amount %", 1, 500, 1, 120), sl("radius", "Radius (px)", 0.1, 100, 0.1, 2), sl("threshold", "Threshold", 0, 255, 1, 0)] },
    noise: { t: "Add noise", c: [sl("amount", "Amount %", 0, 100, 0.5, 8)], chk: [["mono", "Monochromatic"], ["gauss", "Gaussian"]] },
    pixelate: { t: "Pixelate (mosaic)", c: [sl("size", "Cell size (px)", 2, 200, 1, 12)] },
    vignette: { t: "Vignette", c: [sl("amount", "Amount (− darken, + lighten)", -100, 100, 1, -60), sl("size", "Size", 0, 100, 1, 45), sl("soft", "Softness", 1, 100, 1, 60)] }
  };
  var QUICK = { invert: "Invert", desaturate: "Desaturate", sharpen: "Sharpen" };
  ED.ADJ = ADJ;
  function adjTarget() {
    if (!need()) return null;
    var a = L(); if (!ED.editable(a, "pixels")) return null;
    if (ED.maskEdit) { S3.toast("Adjustments change layer pixels: click the layer thumbnail (not the mask) first", "error"); return null; }
    var r = { x: a.x, y: a.y, w: a.canvas.width, h: a.canvas.height }, img = PE.getData(a.canvas);
    return { L: a, r: r, img: { data: img.data, width: img.width, height: img.height }, sel: PE.selFor(doc(), r) };
  }
  function commitAdjusted(t, data, label) {
    var n = PE.mk(t.r.w, t.r.h); n.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data.data ? data.data : data), t.r.w, t.r.h), 0, 0);
    ED.meta(label, function () { t.L.canvas = PE.touch(n); });
  }
  function quick(op) {
    var t = adjTarget(); if (!t) return;
    ED.working(PE.work("adjust", [t.img, op, {}, t.sel]), QUICK[op] + "…").then(function (res) { commitAdjusted(t, res, QUICK[op]); }).catch(function (e) { S3.toast(e.message, "error"); });
  }
  var floatState = null;
  function openAdjust(op) {
    if (floatState) closeFloat(false);
    var spec = ADJ[op], t = adjTarget(); if (!spec || !t) return;
    ED.cancelModes();
    var key = PE.uid("k"), p = {}, box = $("#float"), prevC = PE.mk(t.r.w, t.r.h), pctx = prevC.getContext("2d");
    (spec.c || []).forEach(function (c) { p[c.k] = c.def; });
    (spec.chk || []).forEach(function (c) { p[c[0]] = false; });
    var st = floatState = { op: op, t: t, p: p, key: key, prev: prevC, busy: false, again: false, shown: null, previewOn: true };
    ED.modal = true;
    box.textContent = ""; box.hidden = false;
    var bodyEl = h("div", { "class": "pe-fbody" });
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: spec.t }), h("span", { "class": "faint pe-fbusy", id: "fBusy" })]));
    box.appendChild(bodyEl);
    (spec.c || []).forEach(function (c) { bodyEl.appendChild(range(c.label, c.def, c.min, c.max, c.step, function (v) { p[c.k] = v; schedule(); }, c.fmt)); });
    (spec.chk || []).forEach(function (c) { bodyEl.appendChild(check(c[1], false, function (v) { p[c[0]] = v; schedule(); })); });
    if (spec.custom === "levels") levelsUI(bodyEl, st);
    if (spec.custom === "curves") curvesUI(bodyEl, st);
    if (spec.custom === "balance") balanceUI(bodyEl, st);
    if (spec.ui) spec.ui(bodyEl, st);   // lane:adjust
    var pv = check("Preview", true, function (v) { st.previewOn = v; showPreview(); });
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [pv, h("span", { "class": "grow" }), btn("Reset", function () { closeFloat(false); openAdjust(op); }, "ghost"), btn("Cancel", function () { closeFloat(false); }, "ghost"), btn("OK", function () { closeFloat(true); }, "primary")]));
    if (t.sel) bodyEl.appendChild(h("p", { "class": "faint pe-p", text: "Applies inside the selection only." }));
    function showPreview() {
      if (st.previewOn && st.shown) ED.live.over[t.L.id] = { canvas: prevC, x: t.r.x, y: t.r.y }; else delete ED.live.over[t.L.id];
      ED.render();
    }
    st.showPreview = showPreview;
    function run() {
      if (st.busy) { st.again = true; return; }
      st.busy = true; st.again = false; $("#fBusy").textContent = "Updating…";
      var params = JSON.parse(JSON.stringify(p)), sig = JSON.stringify(params);
      PE.workAdjust(key, op, params).then(function (res) {
        if (floatState !== st) return;
        pctx.putImageData(new ImageData(new Uint8ClampedArray(res.data), t.r.w, t.r.h), 0, 0); PE.touch(prevC);
        st.shown = sig; showPreview();
      }).catch(function (e) { S3.toast(e.message, "error"); }).then(function () {
        st.busy = false; if ($("#fBusy")) $("#fBusy").textContent = "";
        if (st.again && floatState === st) run();
        if (st.waitOk && floatState === st && !st.again) st.waitOk();
      });
    }
    var schedule = S3.debounce(run, t.r.w * t.r.h > 4e6 ? 140 : 50);
    st.schedule = schedule; st.run = run;
    PE.workLoad(key, t.img, t.sel).then(run);
  }
  function closeFloat(ok) {
    var st = floatState; if (!st) return;
    var box = $("#float");
    function done() {
      floatState = null; ED.modal = false; box.hidden = true; box.textContent = "";
      delete ED.live.over[st.t.L.id]; ED.render();
    }
    if (!ok) { done(); return; }
    var sig = JSON.stringify(st.p);
    if (st.shown === sig && !st.busy) { var c = st.prev; done(); ED.meta(ADJ[st.op].t, function () { st.t.L.canvas = c; }); return; }
    st.waitOk = function () { if (JSON.stringify(st.p) === st.shown) { st.waitOk = null; closeFloat(true); } };
    if (!st.busy) st.run();
  }
  function histCanvas(img, which, w, hh) {
    var c = h("canvas", { "class": "pe-hist", width: String(w), height: String(hh) }), x = c.getContext("2d"), H = PIX.histogram(img)[which || "l"], mx = 1;
    for (var i = 0; i < 256; i++) if (H[i] > mx) mx = H[i];
    var lmx = Math.log(1 + mx);
    x.fillStyle = "rgba(127,127,127,.55)";
    for (i = 0; i < 256; i++) { var v = Math.log(1 + H[i]) / lmx * hh; x.fillRect(i * w / 256, hh - v, w / 256 + 0.6, v); }
    return c;
  }
  function levelsUI(el, st) {
    var p = st.p; p.inB = 0; p.inW = 255; p.gamma = 1; p.outB = 0; p.outW = 255;
    el.appendChild(histCanvas(st.t.img, "l", 256, 70));
    var rs = {};
    function mkR(k, label, min, max, step) { rs[k] = range(label, p[k], min, max, step, function (v) { p[k] = v; if (p.inW <= p.inB + 1) { if (k === "inB") p.inB = p.inW - 2; else p.inW = p.inB + 2; rs.inB._set(p.inB); rs.inW._set(p.inW); } st.schedule(); }); el.appendChild(rs[k]); }
    mkR("inB", "Input black", 0, 253, 1); mkR("gamma", "Midtones (gamma)", 0.1, 9.99, 0.01); mkR("inW", "Input white", 2, 255, 1); mkR("outB", "Output black", 0, 255, 1); mkR("outW", "Output white", 0, 255, 1);
    el.appendChild(btn("Auto", function () {
      var Hh = PIX.histogram(st.t.img).l, tot = 0, i, a = 0, b = 255, acc = 0;
      for (i = 0; i < 256; i++) tot += Hh[i];
      for (i = 0; i < 256; i++) { acc += Hh[i]; if (acc > tot * 0.005) { a = i; break; } }
      acc = 0; for (i = 255; i >= 0; i--) { acc += Hh[i]; if (acc > tot * 0.005) { b = i; break; } }
      p.inB = Math.min(a, 253); p.inW = Math.max(b, p.inB + 2); rs.inB._set(p.inB); rs.inW._set(p.inW); st.schedule();
    }, "ghost", null, "Stretch the darkest and brightest 0.5% to black and white"));
  }
  function balanceUI(el, st) {
    var p = st.p, tone = "mid"; p.sh = [0, 0, 0]; p.mid = [0, 0, 0]; p.hi = [0, 0, 0]; p.keepLum = true;
    var rs = [];
    el.appendChild(seg("Tone", [["sh", "Shadows"], ["mid", "Midtones"], ["hi", "Highlights"]], tone, function (v) { tone = v; rs.forEach(function (r, i) { r._set(p[tone][i]); }); }));
    [["Cyan ↔ Red"], ["Magenta ↔ Green"], ["Yellow ↔ Blue"]].forEach(function (lab, i) { var r = range(lab[0], 0, -100, 100, 1, function (v) { p[tone][i] = v; st.schedule(); }); rs.push(r); el.appendChild(r); });
    el.appendChild(check("Preserve luminosity", true, function (v) { p.keepLum = v; st.schedule(); }));
  }
  function curvesUI(el, st) {
    var p = st.p, ch = "rgb"; p.rgb = [[0, 0], [255, 255]]; p.r = [[0, 0], [255, 255]]; p.g = [[0, 0], [255, 255]]; p.b = [[0, 0], [255, 255]];
    var S = 256, c = h("canvas", { "class": "pe-curve", width: String(S), height: String(S), "aria-label": "Curve: drag points, click to add, double-click to remove" }), x = c.getContext("2d");
    var hist = PIX.histogram(st.t.img), drag = -1;
    function draw() {
      x.clearRect(0, 0, S, S);
      var H = hist[ch === "rgb" ? "l" : ch], mx = 1, i; for (i = 0; i < 256; i++) mx = Math.max(mx, H[i]);
      x.fillStyle = "rgba(127,127,127,.25)"; for (i = 0; i < 256; i++) { var v = Math.log(1 + H[i]) / Math.log(1 + mx) * S; x.fillRect(i, S - v, 1, v); }
      x.strokeStyle = "rgba(127,127,127,.35)"; x.lineWidth = 1;
      for (i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * S / 4, 0); x.lineTo(i * S / 4, S); x.moveTo(0, i * S / 4); x.lineTo(S, i * S / 4); x.stroke(); }
      x.beginPath(); x.moveTo(0, S); x.lineTo(S, 0); x.stroke();
      var lut = PIX.lutCurve(p[ch]); x.strokeStyle = ch === "r" ? "#e5484d" : ch === "g" ? "#30a46c" : ch === "b" ? "#3e63dd" : getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#eee";
      x.lineWidth = 2; x.beginPath(); for (i = 0; i < 256; i++) { if (i) x.lineTo(i, S - lut[i]); else x.moveTo(i, S - lut[i]); } x.stroke();
      p[ch].forEach(function (q) { x.beginPath(); x.arc(q[0], S - q[1], 4.5, 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill(); x.strokeStyle = "#000"; x.lineWidth = 1.2; x.stroke(); });
    }
    function at(e) { var r = c.getBoundingClientRect(); return [PE.clamp((e.clientX - r.left) / r.width * 255, 0, 255), PE.clamp(255 - (e.clientY - r.top) / r.height * 255, 0, 255)]; }
    c.addEventListener("pointerdown", function (e) {
      var q = at(e), pts = p[ch], best = -1, bd = 1e9;
      pts.forEach(function (pp, i) { var dd = Math.hypot(pp[0] - q[0], pp[1] - q[1]); if (dd < bd) { bd = dd; best = i; } });
      if (bd > 12) { if (pts.length >= 14) return; pts.push([Math.round(q[0]), Math.round(q[1])]); pts.sort(function (a, b) { return a[0] - b[0]; }); best = pts.findIndex(function (pp) { return pp[0] === Math.round(q[0]); }); }
      drag = best; c.setPointerCapture(e.pointerId); draw(); st.schedule();
    });
    c.addEventListener("pointermove", function (e) {
      if (drag < 0) return; var q = at(e), pts = p[ch], lo = drag > 0 ? pts[drag - 1][0] + 1 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 1 : 255;
      pts[drag] = [Math.round(PE.clamp(q[0], lo, hi)), Math.round(q[1])]; draw(); st.schedule();
    });
    c.addEventListener("pointerup", function () { drag = -1; });
    c.addEventListener("dblclick", function (e) { var q = at(e), pts = p[ch]; if (pts.length <= 2) return; var i = pts.findIndex(function (pp) { return Math.hypot(pp[0] - q[0], pp[1] - q[1]) < 12; }); if (i > 0 && i < pts.length - 1 || (i >= 0 && pts.length > 2)) { pts.splice(i, 1); draw(); st.schedule(); } });
    el.appendChild(seg("Channel", [["rgb", "RGB"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]], ch, function (v) { ch = v; draw(); }));
    el.appendChild(c);
    el.appendChild(h("p", { "class": "faint pe-p", text: "Drag points; click to add; double-click to remove." }));
    draw();
  }

  // ---------- menus ----------
  function has() { return !!ED.doc; }
  function hasSel() { return !!(ED.doc && ED.doc.sel); }
  var MENUS = [
    ["File", [["New…", "Ctrl+Alt+N", newDialog], ["Open image or project…", "Ctrl+O", function () { $("#fileOpen").click(); }], ["Place image as layer…", "", function () { if (need()) $("#filePlace").click(); }, has],
      ["Recent projects…", "", recentDialog], "-", ["Save project (.s3photo)", "Ctrl+S", saveFile, has], ["Export image…", "Ctrl+Shift+Alt+W", function () { exportDialog(false); }, has], ["Export selection…", "", function () { exportDialog(true); }, hasSel]]],
    ["Edit", [["Undo", "Ctrl+Z", function () { ED.undo(); }, function () { return ED.hist && ED.hist.canUndo(); }], ["Redo", "Ctrl+Shift+Z", function () { ED.redo(); }, function () { return ED.hist && ED.hist.canRedo(); }], "-",
      ["Cut", "Ctrl+X", function () { copySel(true); }, has], ["Copy", "Ctrl+C", function () { copySel(false); }, has], ["Paste as new layer", "Ctrl+V", pasteClip, function () { return has() && !!ED.clip; }], "-",
      ["Fill…", "Shift+F5", fillDialog, has], ["Clear selection pixels", "Delete", function () { if (need()) ED.clearSel(); }, hasSel], "-",
      ["Free transform", "Ctrl+T", function () { if (need()) ED.startTransform(); }, has], ["Flip layer horizontal", "", function () { if (need()) ED.flipLayer("h"); }, has], ["Flip layer vertical", "", function () { if (need()) ED.flipLayer("v"); }, has]]],
    ["Image", [["Brightness / Contrast…", "", function () { openAdjust("brightness"); }, has], ["Levels…", "Ctrl+L", function () { openAdjust("levels"); }, has], ["Curves…", "Ctrl+M", function () { openAdjust("curves"); }, has],
      ["Exposure…", "", function () { openAdjust("exposure"); }, has], "-", ["Vibrance…", "", function () { openAdjust("vibrance"); }, has], ["Hue / Saturation…", "Ctrl+U", function () { openAdjust("hueSat"); }, has],
      ["Colour balance…", "Ctrl+B", function () { openAdjust("colorBalance"); }, has], ["Black & white…", "Ctrl+Shift+Alt+B", function () { openAdjust("bw"); }, has], "-",
      ["Invert", "Ctrl+I", function () { quick("invert"); }, has], ["Desaturate", "Ctrl+Shift+U", function () { quick("desaturate"); }, has], ["Threshold…", "", function () { openAdjust("threshold"); }, has], "-",
      ["Image size…", "Ctrl+Alt+I", imageSizeDialog, has], ["Canvas size…", "Ctrl+Alt+C", canvasSizeDialog, has], ["Crop to selection", "", function () { if (need() && ED.doc.sel) { var b = ED.doc.sel.b; ED.crop = { x: b.x, y: b.y, w: b.w, h: b.h }; ED.applyCrop(); } }, hasSel],
      ["Rotate 90° clockwise", "", function () { if (need()) ED.rotateCanvas("cw"); }, has], ["Rotate 90° counter-clockwise", "", function () { if (need()) ED.rotateCanvas("ccw"); }, has], ["Rotate 180°", "", function () { if (need()) ED.rotateCanvas("180"); }, has],
      ["Flip canvas horizontal", "", function () { if (need()) ED.rotateCanvas("fh"); }, has], ["Flip canvas vertical", "", function () { if (need()) ED.rotateCanvas("fv"); }, has]]],
    ["Layer", [["New layer", "Ctrl+Shift+N", LOPS.newLayer, has], ["Duplicate layer", "", LOPS.duplicate, has], ["Delete layer", "", LOPS.remove, has], ["Layer via copy", "Ctrl+J", function () { LOPS.viaCopy(false); }, has], ["Layer via cut", "Ctrl+Shift+J", function () { LOPS.viaCopy(true); }, hasSel], "-",
      ["Add mask (reveal all)", "", function () { LOPS.addMask(false); }, has], ["Add mask from selection", "", function () { LOPS.addMask(true); }, hasSel], ["Apply mask", "", function () { maskOp("apply"); }, function () { return has() && !!(L() && L().mask); }], ["Delete mask", "", function () { maskOp("delete"); }, function () { return has() && !!(L() && L().mask); }], "-",
      ["Rasterize layer", "", function () { if (need()) ED.rasterize(L(), true); }, function () { return has() && L() && L().kind !== "raster"; }], ["Bring forward", "Ctrl+]", LOPS.up, has], ["Send backward", "Ctrl+[", LOPS.down, has], "-",
      ["Merge down", "Ctrl+E", LOPS.mergeDown, has], ["Merge visible", "Ctrl+Shift+E", LOPS.mergeVisible, has], ["Flatten image", "", LOPS.flatten, has]]],
    ["Select", [["All", "Ctrl+A", function () { if (need()) ED.selectAll(); }, has], ["Deselect", "Ctrl+D", function () { if (need()) ED.deselect(); }, hasSel], ["Inverse", "Ctrl+Shift+I", function () { if (need()) ED.invertSel(); }, has], "-",
      ["Layer pixels", "", function () { if (need()) ED.selFromLayer(L()); }, has], ["Feather…", "Shift+F6", function () { if (need()) numberDialog("Feather selection", "Radius (px)", 10, 250, function (v) { ED.modifySel("feather", v); }); }, hasSel],
      ["Expand…", "", function () { if (need()) numberDialog("Expand selection", "By (px)", 4, 100, function (v) { ED.modifySel("expand", v); }); }, hasSel], ["Contract…", "", function () { if (need()) numberDialog("Contract selection", "By (px)", 4, 100, function (v) { ED.modifySel("contract", v); }); }, hasSel]]],
    ["Filter", [["Gaussian blur…", "", function () { openAdjust("blur"); }, has], ["Sharpen", "", function () { quick("sharpen"); }, has], ["Unsharp mask…", "", function () { openAdjust("unsharp"); }, has], "-",
      ["Add noise…", "", function () { openAdjust("noise"); }, has], ["Pixelate…", "", function () { openAdjust("pixelate"); }, has], ["Vignette…", "", function () { openAdjust("vignette"); }, has]]],
    ["View", [["Zoom in", "Ctrl+=", function () { ED.zoomStep(1); }, has], ["Zoom out", "Ctrl+-", function () { ED.zoomStep(-1); }, has], ["Fit on screen", "Ctrl+0", function () { ED.fit(true); }, has], ["Actual pixels (100%)", "Ctrl+1", function () { ED.zoomAt(1); }, has], "-",
      ["Keyboard shortcuts", "?", shortcutsDialog]]]
  ];
  var openMenu = null;
  function buildMenus() {
    var bar = $("#menus"); bar.textContent = "";
    MENUS.forEach(function (m) {
      var b = h("button", { type: "button", "class": "pe-mbtn", "aria-haspopup": "true", "aria-expanded": "false", text: m[0] });
      var pop = h("div", { "class": "pe-menu", role: "menu", hidden: true });
      function fill() {
        pop.textContent = "";
        m[1].forEach(function (it) {
          if (it === "-") { pop.appendChild(h("hr")); return; }
          var en = !it[3] || it[3]();
          var item = h("button", { type: "button", role: "menuitem", "class": "pe-mi" }, [h("span", { text: it[0] }), it[1] ? h("kbd", { text: K(it[1]) }) : null]);
          if (!en) item.disabled = true;
          item.addEventListener("click", function () { closeMenus(); it[2](); });
          pop.appendChild(item);
        });
      }
      b.addEventListener("click", function (e) { e.stopPropagation(); if (openMenu === pop) { closeMenus(); return; } closeMenus(); fill(); pop.hidden = false; b.setAttribute("aria-expanded", "true"); openMenu = pop; var f = pop.querySelector(".pe-mi:not([disabled])"); if (f && e.detail === 0) f.focus(); });
      b.addEventListener("mouseenter", function () { if (openMenu && openMenu !== pop) { closeMenus(); fill(); pop.hidden = false; b.setAttribute("aria-expanded", "true"); openMenu = pop; } });
      pop.addEventListener("keydown", function (e) {
        var items = S3.$$(".pe-mi:not([disabled])", pop), i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
        if (e.key === "Escape") { closeMenus(); b.focus(); }
      });
      bar.appendChild(h("div", { "class": "pe-mwrap" }, [b, pop]));
    });
    document.addEventListener("click", function (e) { if (openMenu && !e.target.closest(".pe-mwrap")) closeMenus(); });
  }
  function closeMenus() { S3.$$(".pe-menu").forEach(function (p) { p.hidden = true; }); S3.$$(".pe-mbtn").forEach(function (b) { b.setAttribute("aria-expanded", "false"); }); openMenu = null; }

  // ---------- keyboard ----------
  function onKey(e) {
    if (document.querySelector(".s3-modal")) return;
    var c = e.ctrlKey || e.metaKey, k = e.key, lk = k.length === 1 ? k.toLowerCase() : k, typing = ED.isTyping(e);
    if (floatState) { if (k === "Escape") { e.preventDefault(); closeFloat(false); } else if (k === "Enter" && !typing) { e.preventDefault(); closeFloat(true); } return; }
    if (typing) return;
    if (openMenu && k === "Escape") { closeMenus(); return; }
    if ((ED.ui.keys || []).some(function (f) { return f(e); })) return;   // lane:selection (lanes add key handlers to ED.ui.keys)
    function go(fn) { e.preventDefault(); fn(); }
    if (c) {
      if (lk === "z") return go(function () { if (e.shiftKey) ED.redo(); else ED.undo(); });
      if (lk === "y") return go(ED.redo);
      if (lk === "s") return go(saveFile);
      if (lk === "o") return go(function () { $("#fileOpen").click(); });
      if (lk === "n" && e.altKey) return go(newDialog);
      if (lk === "n" && e.shiftKey) return go(LOPS.newLayer);
      if (lk === "w" && e.shiftKey && e.altKey) return go(function () { exportDialog(false); });
      if (!ED.doc) return;
      if (lk === "a") return go(ED.selectAll);
      if (lk === "d") return go(ED.deselect);
      if (lk === "i" && e.shiftKey) return go(ED.invertSel);
      if (lk === "i" && e.altKey) return go(imageSizeDialog);
      if (lk === "c" && e.altKey) return go(canvasSizeDialog);
      if (lk === "i") return go(function () { quick("invert"); });
      if (lk === "t") return go(function () { ED.setTool("move"); ED.startTransform(); });
      if (lk === "j") return go(function () { LOPS.viaCopy(e.shiftKey); });
      if (lk === "e") return go(e.shiftKey ? LOPS.mergeVisible : LOPS.mergeDown);
      if (k === "]") return go(LOPS.up);
      if (k === "[") return go(LOPS.down);
      if (lk === "l") return go(function () { openAdjust("levels"); });
      if (lk === "m") return go(function () { openAdjust("curves"); });
      if (lk === "u") return go(function () { if (e.shiftKey) quick("desaturate"); else openAdjust("hueSat"); });
      if (lk === "b") return go(function () { openAdjust(e.shiftKey && e.altKey ? "bw" : "colorBalance"); });
      if (lk === "c") { copySel(false); e.preventDefault(); return; }
      if (lk === "x") { copySel(true); e.preventDefault(); return; }
      if (k === "0") return go(function () { ED.fit(true); });
      if (k === "1") return go(function () { ED.zoomAt(1); });
      if (k === "=" || k === "+") return go(function () { ED.zoomStep(1); });
      if (k === "-") return go(function () { ED.zoomStep(-1); });
      if (k === "Backspace") return go(function () { ED.fillSel(ED.doc.bg, "Fill"); });
      return;
    }
    if (k === "?") return go(shortcutsDialog);
    if (!ED.doc) return;
    if (e.altKey && e.shiftKey && lk === "n") return go(LOPS.newLayer);
    if (k === "Enter") { if (ED.poly) return go(ED.closePoly); if (ED.xf) return go(ED.applyTransform); if (ED.crop) return go(ED.applyCrop); return; }
    if (k === "Escape") { if (ED.drag) return go(ED.cancelDrag); if (ED.poly) return go(function () { ED.poly = null; ED.renderOvl(); buildOpts(); }); if (ED.xf) return go(ED.cancelTransform); if (ED.crop) return go(ED.cancelCrop); return; }
    if (k === "Backspace" && ED.poly) return go(function () { ED.poly.pts.pop(); if (!ED.poly.pts.length) ED.poly = null; ED.renderOvl(); });
    if (k === "Backspace" && e.altKey) return go(function () { ED.fillSel(ED.doc.fg, "Fill"); });
    if (k === "Backspace" && e.shiftKey) return go(fillDialog);
    if (k === "F5" && e.shiftKey) return go(fillDialog);
    if (k === "F6" && e.shiftKey) return go(function () { if (hasSel()) numberDialog("Feather selection", "Radius (px)", 10, 250, function (v) { ED.modifySel("feather", v); }); });
    if (k === "Delete" || k === "Backspace") return go(ED.clearSel);
    if (k.indexOf("Arrow") === 0 && ED.tool === "move" && !ED.xf) { var n = e.shiftKey ? 10 : 1; return go(function () { ED.nudge(k === "ArrowLeft" ? -n : k === "ArrowRight" ? n : 0, k === "ArrowUp" ? -n : k === "ArrowDown" ? n : 0); }); }
    if (k === "[" || k === "]" || k === "{" || k === "}") {
      var bo = ED.o[ED.tool]; if (!bo || bo.size == null) return;
      e.preventDefault();
      if (e.shiftKey) bo.hard = PE.clamp(Math.round((bo.hard + (k === "]" || k === "}" ? 0.25 : -0.25)) * 4) / 4, 0, 1);
      else bo.size = PE.clamp(Math.round(bo.size * (k === "]" ? 1.15 : 1 / 1.15) + (k === "]" ? 1 : -1)), 1, 1000);
      ED.saveOpts(); buildOpts(); ED.renderOvl(); return;
    }
    if (/^[0-9]$/.test(k) && !e.altKey) {
      var v = k === "0" ? 1 : +k / 10, to = ED.o[ED.tool];
      e.preventDefault();
      if (to && to.op != null) { to.op = v; ED.saveOpts(); buildOpts(); S3.toast("Tool opacity " + Math.round(v * 100) + "%"); }
      else if (L()) { var a = L(); ED.meta("Layer opacity", function () { a.opacity = v; }); }
      return;
    }
    if (lk === "x") return go(swapColors);
    if (lk === "d") return go(resetColors);
    var map = { v: "move", w: "wand", c: "crop", i: "eyedropper", j: "heal", s: "clone", b: "brush", e: "eraser", t: "text", u: "shape", h: "hand", z: "zoom" };
    var up = k.toUpperCase();
    if (CYCLE[up]) { var cy = CYCLE[up], cur = cy.indexOf(ED.tool); return go(function () { ED.setTool(cur < 0 ? cy[0] : (e.shiftKey || cur >= 0) ? cy[(cur + 1) % cy.length] : cy[0]); }); }
    if (map[lk] && !e.altKey) return go(function () { ED.setTool(map[lk]); });
  }

  // ---------- status ----------
  function status(arg) {
    var d = ED.doc;
    $("#zLabel").textContent = d ? Math.round(ED.zoom * 1000) / 10 + "%" : "—";
    $("#docInfo").textContent = d ? d.w + " × " + d.h + " px · " + d.layers.length + " layer" + (d.layers.length === 1 ? "" : "s") + (d.sel ? " · selection " + d.sel.b.w + " × " + d.sel.b.h : "") : "";
    if (arg && typeof arg === "object") $("#cursor").textContent = Math.floor(arg.x) + ", " + Math.floor(arg.y);
    var busy = $("#busy"); busy.hidden = !ED.busy; if (typeof arg === "string") busy.textContent = arg;
  }

  // ---------- empty state ----------
  function renderEmpty() {
    var e = $("#empty"); e.hidden = !!ED.doc;
    $("#app").classList.toggle("no-doc", !ED.doc);
    if (ED.doc) return;
    var r = $("#emptyRecent"); r.textContent = "";
    PE.store.list().then(function (all) {
      if (!all.length) return;
      r.appendChild(h("h3", { text: "Recent on this device" }));
      var g = h("div", { "class": "pe-egrid" });
      all.slice(0, 6).forEach(function (it) { var b = h("button", { type: "button", "class": "pe-rcard" }, [h("img", { src: it.thumb || "", alt: "" }), h("b", { text: it.name }), h("span", { "class": "faint", text: it.w + " × " + it.h })]); b.addEventListener("click", function () { openStored(it.id); }); g.appendChild(b); });
      r.appendChild(g);
    }).catch(function () {});
  }

  // ---------- wire everything ----------
  function init() {
    ED.init();
    buildMenus(); buildTools();
    $("#btnUndo").addEventListener("click", function () { ED.undo(); });
    $("#btnRedo").addEventListener("click", function () { ED.redo(); });
    $("#btnExport").addEventListener("click", function () { exportDialog(false); });
    $("#btnSave").addEventListener("click", saveFile);
    $("#btnKeys").addEventListener("click", shortcutsDialog);
    $("#zIn").addEventListener("click", function () { ED.zoomStep(1); });
    $("#zOut").addEventListener("click", function () { ED.zoomStep(-1); });
    $("#zLabel").addEventListener("click", function () { ED.fit(true); });
    $("#eOpen").addEventListener("click", function () { $("#fileOpen").click(); });
    $("#eNew").addEventListener("click", newDialog);
    var docName = $("#docName");
    docName.addEventListener("change", function () { if (!ED.doc) return; var v = docName.value.trim().slice(0, 100) || "Untitled"; ED.meta("Rename document", function () { ED.doc.name = v; }); });
    $("#fileOpen").addEventListener("change", function (e) { openFiles(e.target.files, false); e.target.value = ""; });
    $("#filePlace").addEventListener("change", function (e) { openFiles(e.target.files, true); e.target.value = ""; });
    var stage = $("#stage");
    ["dragenter", "dragover"].forEach(function (ev) { stage.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { e.preventDefault(); stage.classList.add("is-over"); } }); });
    ["dragleave", "drop"].forEach(function (ev) { stage.addEventListener(ev, function () { stage.classList.remove("is-over"); }); });
    stage.addEventListener("drop", function (e) { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); openFiles(e.dataTransfer.files, true); });
    document.addEventListener("paste", function (e) {
      if (ED.isTyping(e) || document.querySelector(".s3-modal")) return;
      var files = Array.prototype.slice.call((e.clipboardData && e.clipboardData.files) || []).filter(function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); openFiles(files, true); return; }
      if (ED.clip && ED.doc) { e.preventDefault(); pasteClip(); }
    });
    var blend = $("#layerBlend"); PE.BLENDS.forEach(function (b) { blend.appendChild(h("option", { value: b, text: b.charAt(0).toUpperCase() + b.slice(1) })); });
    blend.addEventListener("change", function () { var a = L(); if (a) ED.meta("Blend mode", function () { a.blend = blend.value; }); });
    var op = $("#layerOp"), opB = null, opT = 0;
    op.addEventListener("input", function () { var a = L(); if (!a) return; if (!opB) opB = PE.snap(ED.doc); a.opacity = +op.value / 100; $("#layerOpOut").textContent = op.value + "%"; ED.render(); clearTimeout(opT); opT = setTimeout(function () { var b = opB; opB = null; ED.push(PE.metaEntry("Layer opacity", ED.doc, b)); }, 400); });
    $("#lNew").addEventListener("click", LOPS.newLayer); $("#lDup").addEventListener("click", LOPS.duplicate); $("#lDel").addEventListener("click", LOPS.remove);
    $("#lMask").addEventListener("click", function () { LOPS.addMask(hasSel()); }); $("#lUp").addEventListener("click", LOPS.up); $("#lDown").addEventListener("click", LOPS.down);
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", function () { if (ED.doc) saveNow(); });

    ED.on("changed", function (why) { renderLayers(); renderHistory(); buildProps(); status(); renderEmpty(); colors(); if (ED.doc) $("#docName").value = ED.doc.name; if (why !== "open" || true) dirty(); });
    ED.on("layers", function () { layersSoon(); buildProps(); });
    ED.on("tool", function () { S3.$$(".pe-tool").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-tool") === ED.tool)); }); buildOpts(); status(); });
    ED.on("view", status);
    ED.on("colors", colors);
    ED.on("textinput", function () { var t = $("#props textarea"); if (t && ED.textL) t.value = ED.textL.text.text; });

    renderLayers(); renderHistory(); buildProps(); buildOpts(); status(); renderEmpty();
    ED.emit("tool");
    ED.ready = restoreLast().then(function (ok) { if (!ok) renderEmpty(); return ok; });
  }
  ED.adjKit = { MENUS: MENUS, QUICK: QUICK, SHORTCUTS: SHORTCUTS, field: field, range: range, check: check, seg: seg, select: select, btn: btn, modal: modal, svg: svg, need: need, K: K, histCanvas: histCanvas, adjTarget: adjTarget, commitAdjusted: commitAdjusted };   // lane:adjust
  ED.ui = { openAdjust: openAdjust, closeFloat: closeFloat, quick: quick, exportDialog: exportDialog, newDialog: newDialog, renderLayers: renderLayers, buildOpts: buildOpts, buildProps: buildProps, colors: colors, saveFile: saveFile, openFiles: openFiles, floatState: function () { return floatState; } };
  ED.ui.MENUS = MENUS; ED.ui.TOOLS = TOOLS; ED.ui.SHORTCUTS = SHORTCUTS; ED.ui.w = { field: field, range: range, check: check, seg: seg, select: select, btn: btn, numInput: numInput, modal: modal, svg: svg, numberDialog: numberDialog, need: need, K: K, pct: pct, px: px };   // lane:selection
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
