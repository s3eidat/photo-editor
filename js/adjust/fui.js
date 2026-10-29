/* Adjust lane: Filter menu entries (drill-down submenus) and panels for the filters in blur.js and friends. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, AUI = PE.adjUI, sl = AUI.sl, pc = AUI.pc, pxf = AUI.pxf, has = AUI.has, h = S3.h;
  var F = AUI.FILTERS = { blur: [], distort: [], noise: [], pixelate: [], render: [], sharpen: [], stylize: [], video: [], other: [] };
  AUI.addMenu("Filter", ["-", AUI.sub("Filter", "Blur", F.blur), AUI.sub("Filter", "Distort", F.distort), AUI.sub("Filter", "Noise", F.noise), AUI.sub("Filter", "Pixelate", F.pixelate),
    AUI.sub("Filter", "Render", F.render), AUI.sub("Filter", "Sharpen", F.sharpen), AUI.sub("Filter", "Stylize", F.stylize), AUI.sub("Filter", "Video", F.video), AUI.sub("Filter", "Other", F.other)]);
  // Add a filter: spec registered under op; quick filters (no settings) pass spec = null.
  AUI.filter = function (group, label, op, spec, key) {
    if (spec) AUI.adj(op, spec);
    var fn = spec ? function () { AUI.open(op); } : function () { AUI.quick(op, label.replace(/…$/, "")); };
    F[group].push([label, key || "", fn, has]);
    if (key) AUI.key(key, fn);
  };
  var deg = function (v) { return v + "°"; };
  AUI.deg = deg;

  // blur
  AUI.filter("blur", "Motion blur…", "motionBlur", { t: "Motion blur", c: [sl("angle", "Angle", -180, 180, 1, 0, deg), sl("distance", "Distance", 1, 2000, 1, 20, pxf)] });
  AUI.filter("blur", "Radial blur…", "radialBlur", { t: "Radial blur", handles: AUI.H.point("cx", "cy"), c: [sl("amount", "Amount", 1, 100, 1, 10), sl("cx", "Centre X", 0, 100, 1, 50, pc), sl("cy", "Centre Y", 0, 100, 1, 50, pc)],
    sel: [["mode", "Method", [["spin", "Spin"], ["zoom", "Zoom"]], "spin"], ["quality", "Quality", [["draft", "Draft"], ["good", "Good"], ["best", "Best"]], "good"]] });
  AUI.filter("blur", "Surface blur…", "surfaceBlur", { t: "Surface blur", c: [sl("radius", "Radius", 1, 100, 1, 5, pxf), sl("threshold", "Threshold (levels)", 2, 255, 1, 15)] });
  AUI.filter("blur", "Smart blur…", "smartBlur", { t: "Smart blur", c: [sl("radius", "Radius", 0.5, 100, 0.5, 3, pxf), sl("threshold", "Threshold", 1, 100, 1, 25)],
    sel: [["mode", "Mode", [["normal", "Normal"], ["edges", "Edges only"], ["overlay", "Overlay edges"]], "normal"]] });
  // filter gallery: thumbnails of every effect on a small copy, then the chosen effect's settings
  AUI.adj("gallery", { t: "Filter gallery", ui: function (el, st) {
    var p = st.p, K = ED.adjKit, G = PIX.A.GALLERY, ids = Object.keys(G), grid = h("div", { "class": "pe-agal", role: "listbox", "aria-label": "Effects" }), box = h("div", { "class": "stack pe-asecin" });
    p.fg = ED.doc.fg; p.bg = ED.doc.bg; p.color = "#50dcff";
    var KEEP = ["effect", "fg", "bg", "color", "stack", "cur"], layersBox = h("div", { "class": "stack pe-asecin pe-alayers" });
    function settingsOf() { var o = {}; Object.keys(p).forEach(function (k) { if (["fg", "bg", "stack", "cur"].indexOf(k) < 0 && k.charAt(0) !== "_") o[k] = p[k]; }); o.on = p.stack && p.stack[p.cur] ? p.stack[p.cur].on !== false : true; return o; }
    function load(e) { Object.keys(p).forEach(function (k) { if (KEEP.indexOf(k) < 0) delete p[k]; }); Object.keys(e).forEach(function (k) { if (k !== "on") p[k] = e[k]; }); }
    function drawLayers() {         // effect layers, top of the list = applied last (like a layer stack)
      layersBox.textContent = "";
      if (!p.stack) { layersBox.appendChild(K.btn("New effect layer", function () { p.stack = [settingsOf()]; p.cur = 0; p.stack.push(settingsOf()); p.cur = 1; drawLayers(); st.schedule(); }, "ghost", "i-plus", "Stack another effect on top of this one")); return; }
      p.stack[p.cur] = settingsOf();
      p.stack.slice().reverse().forEach(function (e, ri) {
        var i = p.stack.length - 1 - ri, row = h("div", { "class": "row pe-arow pe-alayer" + (i === p.cur ? " on" : "") });
        var vis = h("input", { type: "checkbox", "aria-label": "Show " + G[e.effect].name }); vis.checked = e.on !== false;
        vis.addEventListener("change", function () { p.stack[i].on = vis.checked; st.schedule(); });
        var name = h("button", { type: "button", "class": "btn ghost small pe-alayername", text: (p.stack.length - ri) + ". " + G[e.effect].name, "aria-pressed": String(i === p.cur) });
        name.addEventListener("click", function () { p.stack[p.cur] = settingsOf(); p.cur = i; load(p.stack[i]); choose(p.effect, true); drawLayers(); });
        var del = K.btn("", function () { p.stack[p.cur] = settingsOf(); p.stack.splice(i, 1); if (p.stack.length < 2) { load(p.stack[0]); p.stack = null; p.cur = 0; } else { p.cur = Math.min(p.cur, p.stack.length - 1); load(p.stack[p.cur]); } choose(p.effect, true); drawLayers(); st.schedule(); }, "ghost icon small", "i-trash", "Delete this effect layer");
        row.appendChild(vis); row.appendChild(name); row.appendChild(del); layersBox.appendChild(row);
      });
      layersBox.appendChild(K.btn("New effect layer", function () { p.stack[p.cur] = settingsOf(); if (p.stack.length >= 12) return; p.stack.push(settingsOf()); p.cur = p.stack.length - 1; drawLayers(); st.schedule(); }, "ghost", "i-plus", "Stack another effect on top"));
    }
    function choose(id, keep) {
      if (!keep) { p.effect = id; Object.keys(p).forEach(function (k) { if (KEEP.indexOf(k) < 0) delete p[k]; }); Object.assign(p, PIX.A.galleryDefaults(id)); }
      S3.$$("button", grid).forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-id") === p.effect)); });
      if (p.stack && !keep) drawLayers();
      box.textContent = "";
      id = p.effect;
      G[id].params.forEach(function (q) { box.appendChild(K.range(q[1], p[q[0]], q[2], q[3], q[4], function (v) { p[q[0]] = v; st.schedule(); })); });
      if (id === "neon") box.appendChild(AUI.colorInput("Glow colour", p.color, function (v) { p.color = v; st.schedule(); }));
      if (G[id].cat === "sketch" || id === "diffuseGlow") box.appendChild(h("p", { "class": "faint pe-p", text: "Uses the foreground and background colours." }));
      st.schedule();
    }
    var CATS = [["all", "All effects"], ["artistic", "Artistic"], ["brush", "Brush strokes"], ["distort", "Distort"], ["sketch", "Sketch"], ["texture", "Texture"]];
    var catSel = K.select("Show", CATS, "all", function (v) { S3.$$("button", grid).forEach(function (b) { b.hidden = v !== "all" && G[b.getAttribute("data-id")].cat !== v; }); });
    var src = st.t.img, tw = 84, th = Math.max(24, Math.min(84, Math.round(tw * src.height / src.width))), small = AUI.downImg(src, tw, th), k = tw / src.width;
    ids.forEach(function (id, n) {
      var c = h("canvas", { "class": "pe-acv", width: String(tw), height: String(th), "aria-hidden": "true" }), b = h("button", { type: "button", "class": "pe-agalbtn", role: "option", "data-id": id, "aria-selected": "false", title: G[id].name }, [c, h("span", { text: G[id].name })]);
      b.addEventListener("click", function () { choose(id); });
      grid.appendChild(b);
      setTimeout(function () {        // thumbnails one by one, so the panel shows at once
        if (!AUI.panelOpen()) return;
        var im = { data: new Uint8ClampedArray(small.data), width: tw, height: th };
        try { PIX.adjust(im, "gallery", Object.assign(PIX.A.galleryDefaults(id), { effect: id, fg: p.fg, bg: p.bg, color: p.color, _scale: Math.max(0.05, k) }), null); c.getContext("2d").putImageData(new ImageData(im.data, tw, th), 0, 0); } catch (e) { /* thumbnail only */ }
      }, 30 + n * 15);
    });
    AUI.wide();
    el.insertBefore(box, el.firstChild); el.insertBefore(grid, box); el.insertBefore(catSel, grid); el.insertBefore(layersBox, box.nextSibling);
    choose("watercolor"); drawLayers();
  } });
  AUI.addMenu("Filter", [["Filter gallery…", "", function () { AUI.open("gallery"); }, has]], "Gaussian blur");
  AUI.adj("lensCorrection", { t: "Lens correction", c: [sl("distort", "Remove distortion (− pincushion, + barrel)", -100, 100, 1, 0), sl("caRed", "Fix red / cyan fringe", -100, 100, 1, 0), sl("caBlue", "Fix blue / yellow fringe", -100, 100, 1, 0),
    sl("vignette", "Vignette amount", -100, 100, 1, 0), sl("vigMid", "Vignette midpoint", 0, 100, 1, 50, pc), sl("vertical", "Vertical perspective", -100, 100, 1, 0), sl("horizontal", "Horizontal perspective", -100, 100, 1, 0),
    sl("angle", "Angle", -180, 180, 0.1, 0, deg), sl("scale", "Scale", 25, 400, 1, 100, pc)],
    sel: [["edge", "Edge", [["transparent", "Transparency"], ["extend", "Edge extension"], ["color", "Background colour"]], "transparent"]], ui: function (el, st) { st.p.fillColor = ED.doc.bg; } });
  AUI.addMenu("Filter", [["Lens correction…", "Ctrl+Shift+R", function () { AUI.open("lensCorrection"); }, has]], "Gaussian blur");
  AUI.adj("wideAngle", { t: "Wide-angle correction", c: [sl("fovIn", "Lens field of view (fisheye)", 60, 360, 1, 180, deg), sl("fovOut", "View field of view", 20, 170, 1, 100, deg), sl("scale", "Scale", 25, 400, 1, 100, pc),
    sl("pannini", "Edge squeeze (Pannini)", 0, 200, 1, 100, pc), sl("yaw", "Look left / right (360°)", -180, 180, 1, 0, deg), sl("pitch", "Look up / down (360°)", -90, 90, 1, 0, deg), sl("roll", "Roll (360°)", -180, 180, 1, 0, deg)],
    sel: [["type", "Correction", [["fisheye", "Fisheye to flat"], ["pannini", "Wide shot: keep verticals, squeeze edges"], ["spherical", "360° panorama to a flat view"]], "fisheye"], ["edge", "Edges", [["clamp", "Repeat edge pixels"], ["transparent", "Transparent"]], "clamp"]] });
  AUI.addMenu("Filter", [["Wide-angle correction…", "Ctrl+Alt+Shift+A", function () { AUI.open("wideAngle"); }, has]], "Gaussian blur");
  AUI.key("Ctrl+Alt+Shift+A", function () { AUI.open("wideAngle"); });
  AUI.key("Ctrl+Shift+R", function () { AUI.open("lensCorrection"); });

  // depth of field
  var IRIS = [["sides", "Iris shape", [["0", "Circle"], ["3", "Triangle"], ["4", "Square"], ["5", "Pentagon"], ["6", "Hexagon"], ["7", "Heptagon"], ["8", "Octagon"]], "6"],
    ["quality", "Quality", [["draft", "Draft"], ["good", "Good"], ["best", "Best"]], "good"]];
  AUI.filter("blur", "Lens blur…", "lensBlur", { t: "Lens blur", mp: 8e5, c: [sl("radius", "Radius", 0, 100, 1, 15, pxf), sl("focal", "Focal distance", 0, 255, 1, 0), sl("rotation", "Iris rotation", 0, 360, 1, 0, deg),
    sl("curve", "Blade curvature", 0, 100, 1, 0, pc), sl("hlBright", "Highlights: brightness", 0, 100, 1, 0), sl("hlThreshold", "Highlights: threshold", 0, 255, 1, 255), sl("noise", "Noise", 0, 100, 1, 0)],
    chk: [["invert", "Invert depth", false]], sel: IRIS, ui: function (el, st) {
      var p = st.p, K = ED.adjKit, L = st.t.L, opts = [["none", "None (even blur)"], ["luminance", "Brightness"]];
      if (L.mask) opts.push(["mask", "Layer mask"]);
      if (ED.doc.sel) opts.push(["selection", "Selection"]);
      p.depthSrc = L.mask ? "mask" : ED.doc.sel ? "selection" : "none";
      if (L.mask) {      // the mask over the layer, as a plane (reduced to at most 1500 px)
        var k = Math.min(1, 1500 / Math.max(st.t.r.w, st.t.r.h)), mw = Math.max(1, Math.round(st.t.r.w * k)), mh = Math.max(1, Math.round(st.t.r.h * k)), c = PE.mk(mw, mh), x = c.getContext("2d");
        x.scale(k, k); x.drawImage(L.mask.canvas, L.mask.x - st.t.r.x, L.mask.y - st.t.r.y);
        var px = x.getImageData(0, 0, mw, mh).data, b = "";
        for (var q = 0; q < mw * mh; q++) b += String.fromCharCode(px[q * 4 + 3]);
        p.depth = { w: mw, h: mh, b64: btoa(b) };
      }
      el.insertBefore(K.select("Depth map", opts, p.depthSrc, function (v) { p.depthSrc = v; st.schedule(); }), el.firstChild);
      el.appendChild(h("p", { "class": "faint pe-p", text: "Depth: black is near, white is far; the focal distance stays sharp." }));
    } });
  function placeCentre(el, st, label) {
    var b = ED.adjKit.btn(label || "Place the centre", function () { AUI.pick(function (pt) { st.p.cx = Math.round((pt.x - st.t.r.x) / st.t.r.w * 100); st.p.cy = Math.round((pt.y - st.t.r.y) / st.t.r.h * 100); st.schedule(); }, b); }, "ghost", null, "Click the image");
    b.setAttribute("aria-pressed", "false"); b.classList.add("pe-apick"); el.appendChild(b);
  }
  F.blur.push("-");
  AUI.filter("blur", "Tilt-shift…", "tiltShift", { t: "Tilt-shift", mp: 8e5, handles: AUI.H.tilt, c: [sl("blur", "Blur", 0, 200, 1, 15, pxf), sl("cy", "Focus line position", 0, 100, 1, 50, pc), sl("angle", "Angle", -90, 90, 1, 0, deg),
    sl("focus", "Sharp band", 0, 100, 1, 12, pc), sl("transition", "Fade", 1, 100, 1, 18, pc), sl("bokeh", "Light bokeh", 0, 100, 1, 0, pc)], chk: [["symmetric", "Blur both sides", true]], sel: [IRIS[1]],
    ui: function (el, st) { st.p.cx = 50; placeCentre(el, st, "Place the focus line"); } });
  AUI.filter("blur", "Iris blur…", "irisBlur", { t: "Iris blur", mp: 8e5, handles: AUI.H.iris, c: [sl("blur", "Blur", 0, 200, 1, 15, pxf), sl("cx", "Centre X", 0, 100, 1, 50, pc), sl("cy", "Centre Y", 0, 100, 1, 50, pc),
    sl("rx", "Width", 1, 150, 1, 30, pc), sl("ry", "Height", 1, 150, 1, 30, pc), sl("rotation", "Rotation", -180, 180, 1, 0, deg), sl("sharp", "Sharp area", 0, 99, 1, 50, pc), sl("bokeh", "Light bokeh", 0, 100, 1, 0, pc)], sel: [IRIS[1]],
    ui: function (el, st) { placeCentre(el, st); } });
  AUI.filter("blur", "Field blur…", "fieldBlur", { t: "Field blur", mp: 8e5, handles: AUI.H.field, c: [sl("bokeh", "Light bokeh", 0, 100, 1, 0, pc)], sel: [IRIS[1]], ui: function (el, st) {
    var p = st.p, K = ED.adjKit, box = h("div", { "class": "stack pe-asecin" });
    p.pins = [[50, 50, 15]];
    function draw() {
      box.textContent = "";
      p.pins.forEach(function (pin, i) {
        var r = K.range("Pin " + (i + 1) + " (" + pin[0] + "%, " + pin[1] + "%) blur", pin[2], 0, 200, 1, function (v) { pin[2] = v; st.schedule(); }, pxf);
        var del = K.btn("", function () { if (p.pins.length > 1) { p.pins.splice(i, 1); draw(); st.schedule(); } }, "ghost icon small", "i-x", "Remove pin");
        if (p.pins.length < 2) del.disabled = true;
        box.appendChild(h("div", { "class": "pe-astop" }, [h("span"), r, del]));
      });
    }
    var add = K.btn("Add pin", function () {
      AUI.pick(function (pt) { if (p.pins.length >= 32) return; p.pins.push([Math.round((pt.x - st.t.r.x) / st.t.r.w * 100), Math.round((pt.y - st.t.r.y) / st.t.r.h * 100), 0]); draw(); st.schedule(); }, add);
    }, "ghost", "i-plus", "Click the image to add a pin (Shift-click adds several); set each pin's blur");
    add.setAttribute("aria-pressed", "false"); add.classList.add("pe-apick");
    st.redrawPins = draw;
    el.insertBefore(box, el.firstChild); el.insertBefore(add, box.nextSibling); draw();
    el.appendChild(h("p", { "class": "faint pe-p", text: "On the image: drag pins, click to add one, double-click a pin to remove it." }));
  } });

  // more blurs
  F.blur.push("-");
  AUI.filter("blur", "Average", "average", null);
  AUI.filter("blur", "Blur", "blurLight", null);
  AUI.filter("blur", "Blur more", "blurMore", null);
  AUI.filter("blur", "Box blur…", "boxBlur", { t: "Box blur", c: [sl("radius", "Radius", 1, 999, 1, 10, pxf)] });
  AUI.filter("blur", "Shape blur…", "shapeBlur", { t: "Shape blur", mp: 8e5, c: [sl("radius", "Radius", 1, 500, 1, 10, pxf)],
    sel: [["shape", "Shape", [["heart", "Heart"], ["star", "Star"], ["ring", "Ring"], ["disc", "Disc"], ["diamond", "Diamond"], ["square", "Square"], ["cross", "Cross"], ["line", "Line"]], "heart"]] });
  AUI.filter("blur", "Spin blur…", "spinBlur", { t: "Spin blur", handles: AUI.H.ring("cx", "cy", "size", true), c: [sl("angle", "Blur angle", 1, 90, 1, 15, deg), sl("cx", "Centre X", 0, 100, 1, 50, pc), sl("cy", "Centre Y", 0, 100, 1, 50, pc),
    sl("size", "Size", 1, 150, 1, 30, pc), sl("aspect", "Height : width", 10, 300, 1, 100, pc)], ui: function (el, st) { placeCentre(el, st); } });

  // sharpen
  AUI.filter("sharpen", "Smart sharpen…", "smartSharpen", { t: "Smart sharpen", c: [sl("amount", "Amount", 0, 500, 1, 150, pc), sl("radius", "Radius", 0.1, 64, 0.1, 1, pxf), sl("noise", "Reduce noise", 0, 100, 1, 10, pc),
    sl("angle", "Angle (motion blur)", -180, 180, 1, 0, deg), sl("shFade", "Shadows: fade", 0, 100, 1, 0, pc), sl("shTone", "Shadows: tonal width", 0, 100, 1, 50, pc), sl("hiFade", "Highlights: fade", 0, 100, 1, 0, pc), sl("hiTone", "Highlights: tonal width", 0, 100, 1, 50, pc)],
    sel: [["remove", "Remove", [["gaussian", "Gaussian blur"], ["lens", "Lens blur"], ["motion", "Motion blur"]], "lens"]] });
  AUI.filter("sharpen", "Sharpen more", "sharpenMore", null);
  AUI.filter("sharpen", "Sharpen edges", "sharpenEdges", null);
  AUI.filter("sharpen", "Shake reduction…", "shakeReduction", { t: "Shake reduction", mp: 1e6, c: [sl("length", "Blur trace length", 1, 199, 1, 9, pxf), sl("angle", "Blur trace angle", -90, 90, 1, 0, deg), sl("iterations", "Iterations", 1, 40, 1, 12), sl("smooth", "Smoothing", 0, 100, 1, 30, pc)] });
  F.sharpen.push("-");
  F.sharpen.push(["Sharpen", "", function () { ED.adjKit.QUICK && ED.ui.quick("sharpen"); }, has]);
  F.sharpen.push(["Unsharp mask…", "", function () { ED.ui.openAdjust("unsharp"); }, has]);

  // noise
  AUI.filter("noise", "Reduce noise…", "reduceNoise", { t: "Reduce noise", c: [sl("strength", "Strength", 0, 10, 1, 6), sl("details", "Preserve details", 0, 100, 1, 60, pc), sl("color", "Reduce colour noise", 0, 100, 1, 45, pc), sl("sharpen", "Sharpen details", 0, 100, 1, 25, pc)] });
  AUI.filter("noise", "Dust & scratches…", "dustScratches", { t: "Dust & scratches", c: [sl("radius", "Radius", 1, 100, 1, 2, pxf), sl("threshold", "Threshold (levels)", 0, 255, 1, 10)] });
  AUI.filter("noise", "Median…", "median", { t: "Median", c: [sl("radius", "Radius", 1, 100, 1, 2, pxf)] });
  AUI.filter("noise", "Despeckle", "despeckle", null);
  // video
  AUI.filter("video", "De-interlace…", "deinterlace", { t: "De-interlace", sel: [["field", "Eliminate", [["odd", "Odd lines"], ["even", "Even lines"]], "odd"], ["mode", "Create new lines by", [["duplicate", "Duplication"], ["interp", "Interpolation"]], "interp"]] });
  AUI.filter("video", "Broadcast-safe colours…", "broadcastSafe", { t: "Broadcast-safe colours", c: [sl("limit", "Signal limit", 50, 130, 1, 110, pc)] });

  // other
  AUI.filter("other", "High pass…", "highPass", { t: "High pass", c: [sl("radius", "Radius", 0.1, 250, 0.1, 10, pxf)] });
  var shape = [["shape", "Preserve", [["square", "Squareness"], ["round", "Roundness"]], "square"]];
  AUI.filter("other", "Minimum…", "minimum", { t: "Minimum", c: [sl("radius", "Radius", 1, 200, 1, 1, pxf)], sel: shape });
  AUI.filter("other", "Maximum…", "maximum", { t: "Maximum", c: [sl("radius", "Radius", 1, 200, 1, 1, pxf)], sel: shape });
  // distort
  var EDGE3 = [["edge", "Undefined areas", [["wrap", "Wrap around"], ["repeat", "Repeat edge pixels"], ["transparent", "Transparent"]], "wrap"]];
  AUI.filter("distort", "Displace…", "displace", { t: "Displace", c: [sl("hScale", "Horizontal scale", -999, 999, 1, 10, pxf), sl("vScale", "Vertical scale", -999, 999, 1, 10, pxf)],
    sel: [["fit", "Map", [["stretch", "Stretch to fit"], ["tile", "Tile"]], "stretch"], ["edge", "Undefined areas", [["wrap", "Wrap around"], ["repeat", "Repeat edge pixels"]], "repeat"]], ui: function (el, st) {
      var d = ED.doc, K = ED.adjKit, me = st.t.L, list = d.layers.filter(function (l) { return l.visible !== false; }).reverse();
      function pack(id) {
        var L = PE.findLayer(d, id) || me, s = L.kind === "raster" ? { canvas: L.canvas } : PE.surface(L, d), c = s.canvas, k = Math.min(1, 1024 / Math.max(c.width, c.height));
        var mw = Math.max(1, Math.round(c.width * k)), mh = Math.max(1, Math.round(c.height * k)), t = PE.mk(mw, mh), x = t.getContext("2d");
        x.fillStyle = "#808080"; x.fillRect(0, 0, mw, mh); x.drawImage(c, 0, 0, mw, mh);
        var px = x.getImageData(0, 0, mw, mh).data, b = new Uint8Array(mw * mh * 2), str = "";
        for (var q = 0; q < mw * mh; q++) { b[q * 2] = px[q * 4]; b[q * 2 + 1] = px[q * 4 + 1]; }
        for (q = 0; q < b.length; q += 0x8000) str += String.fromCharCode.apply(null, b.subarray(q, q + 0x8000));
        st.p.map = { w: mw, h: mh, b64: btoa(str), tileScale: 1 / k };
      }
      var def = (list.filter(function (l) { return l !== me; })[0] || me).id;
      el.insertBefore(K.select("Displacement map", list.map(function (l) { return [l.id, l.name]; }), def, function (v) { pack(v); st.schedule(); }), el.firstChild);
      el.appendChild(h("p", { "class": "faint pe-p", text: "Red moves pixels sideways, green up and down; mid grey (128) does not move them." }));
      pack(def);
    } });
  AUI.filter("distort", "Pinch…", "pinch", { t: "Pinch", c: [sl("amount", "Amount", -100, 100, 1, 50, pc)] });
  AUI.filter("distort", "Polar coordinates…", "polar", { t: "Polar coordinates", sel: [["mode", "", [["toPolar", "Rectangular to polar"], ["toRect", "Polar to rectangular"]], "toPolar"]] });
  AUI.filter("distort", "Ripple…", "ripple", { t: "Ripple", c: [sl("amount", "Amount", -999, 999, 1, 100, pc)], sel: [["size", "Size", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]], "medium"]] });
  AUI.filter("distort", "Shear…", "shear", { t: "Shear", c: [sl("top", "Top offset", -100, 100, 1, 20, pc), sl("middle", "Middle offset", -100, 100, 1, 0, pc), sl("bottom", "Bottom offset", -100, 100, 1, -20, pc)],
    sel: [["edge", "Undefined areas", [["wrap", "Wrap around"], ["repeat", "Repeat edge pixels"]], "wrap"]] });
  AUI.filter("distort", "Spherize…", "spherize", { t: "Spherize", c: [sl("amount", "Amount", -100, 100, 1, 100, pc)], sel: [["mode", "Mode", [["normal", "Normal"], ["horizontal", "Horizontal only"], ["vertical", "Vertical only"]], "normal"]] });
  AUI.filter("distort", "Twirl…", "twirl", { t: "Twirl", c: [sl("angle", "Angle", -999, 999, 1, 50, deg)] });
  AUI.filter("distort", "Wave…", "wave", { t: "Wave", c: [sl("generators", "Number of generators", 1, 99, 1, 5), sl("wlMin", "Wavelength min", 1, 998, 1, 10, pxf), sl("wlMax", "Wavelength max", 2, 999, 1, 120, pxf),
    sl("ampMin", "Amplitude min", 1, 998, 1, 5, pxf), sl("ampMax", "Amplitude max", 1, 999, 1, 35, pxf), sl("scaleX", "Scale horizontal", 0, 100, 1, 100, pc), sl("scaleY", "Scale vertical", 0, 100, 1, 100, pc)],
    sel: [["type", "Type", [["sine", "Sine"], ["triangle", "Triangle"], ["square", "Square"]], "sine"], ["edge", "Undefined areas", [["wrap", "Wrap around"], ["repeat", "Repeat edge pixels"]], "repeat"]],
    ui: function (el, st) { st.p.seed = 1; el.appendChild(ED.adjKit.btn("Randomise", function () { st.p.seed = (st.p.seed || 1) + 1; st.schedule(); }, "ghost")); } });
  AUI.filter("distort", "Zigzag…", "zigzag", { t: "Zigzag", c: [sl("amount", "Amount", -100, 100, 1, 10), sl("ridges", "Ridges", 1, 20, 1, 5)],
    sel: [["style", "Style", [["pond", "Pond ripples"], ["out", "Out from centre"], ["around", "Around centre"]], "pond"]] });
  AUI.filter("distort", "Offset…", "offset", { t: "Offset", c: [sl("dx", "Horizontal", -4000, 4000, 1, 50, pxf), sl("dy", "Vertical", -4000, 4000, 1, 0, pxf)], sel: EDGE3 });

  // render
  function colorsSeed(el, st) { st.p.fg = ED.doc.fg; st.p.bg = ED.doc.bg; st.p.seed = 1; el.appendChild(ED.adjKit.btn("Randomise", function () { st.p.seed = (st.p.seed || 1) + 1; st.schedule(); }, "ghost")); el.appendChild(h("p", { "class": "faint pe-p", text: "Uses the foreground and background colours." })); }
  function placeBtn(el, st, kx, ky, label) {
    var b = ED.adjKit.btn(label, function () {
      AUI.pick(function (pt) { st.p[kx] = Math.round((pt.x - st.t.r.x) / st.t.r.w * 100); st.p[ky] = Math.round((pt.y - st.t.r.y) / st.t.r.h * 100); S3.$$("#float input[type=range]").forEach(function () {}); st.schedule(); }, b);
    }, "ghost", null, "Click the image to place it");
    b.setAttribute("aria-pressed", "false"); b.classList.add("pe-apick"); el.appendChild(b);
  }
  AUI.filter("render", "Clouds", "clouds", { t: "Clouds", proxy: true, c: [sl("size", "Cloud size", 8, 2048, 1, 256, pxf)], ui: colorsSeed });
  AUI.filter("render", "Difference clouds", "differenceClouds", { t: "Difference clouds", c: [sl("size", "Cloud size", 8, 2048, 1, 256, pxf)], ui: colorsSeed });
  AUI.filter("render", "Fibers…", "fibers", { t: "Fibers", c: [sl("variance", "Variance", 1, 64, 1, 16), sl("strength", "Strength", 1, 64, 1, 4)], ui: colorsSeed });
  AUI.filter("render", "Lens flare…", "lensFlare", { t: "Lens flare", handles: AUI.H.point("x", "y"), c: [sl("brightness", "Brightness", 10, 300, 1, 100, pc), sl("x", "Centre X", 0, 100, 1, 30, pc), sl("y", "Centre Y", 0, 100, 1, 30, pc)],
    sel: [["lens", "Lens", [["zoom", "Zoom lens"], ["prime", "Prime lens"], ["movie", "Wide movie lens"]], "zoom"]], ui: function (el, st) { placeBtn(el, st, "x", "y", "Place on the image"); } });
  AUI.filter("render", "Lighting effects…", "lighting", { t: "Lighting effects", handles: AUI.H.ring("x", "y", "size"), c: [sl("intensity", "Intensity", -100, 100, 1, 35), sl("x", "Light X", -50, 150, 1, 50, pc), sl("y", "Light Y", -50, 150, 1, 35, pc),
    sl("height", "Light height", 1, 100, 1, 50, pc), sl("size", "Spread", 1, 200, 1, 60, pc), sl("focus", "Focus", 1, 100, 1, 50, pc), sl("angle", "Direction (infinite light)", -180, 180, 1, -45, deg),
    sl("ambient", "Ambience", -100, 100, 1, 15), sl("gloss", "Gloss", -100, 100, 1, 0), sl("metallic", "Metallic", -100, 100, 1, 0), sl("bump", "Texture height (from brightness)", 0, 100, 1, 30)],
    sel: [["light", "Light", [["spot", "Spot"], ["point", "Point"], ["infinite", "Infinite"]], "spot"]],
    ui: function (el, st) {
      var p = st.p, K = ED.adjKit, LK = PIX.A.LIGHT_KEYS, box = h("div", { "class": "stack pe-asecin" }), col;
      p.color = "#ffffff"; p.lights = null; p.lightIdx = 0;
      function snap() { var o = {}; LK.forEach(function (k) { o[k] = p[k]; }); return o; }
      function load(o) { LK.forEach(function (k) { if (o[k] == null) return; if (k === "color") { p.color = o.color; col._set(o.color); } else st.set(k, o[k]); }); }
      var PRESETS = [["", "Presets…"], ["spot", "Spotlight", [{ light: "spot", x: 50, y: 35, intensity: 35, size: 60, focus: 50, height: 50 }], 15],
        ["torch", "Torch beam", [{ light: "spot", x: 50, y: 45, intensity: 55, size: 35, focus: 85, height: 30 }], -10],
        ["blue", "Blue all round", [{ light: "point", x: 50, y: 50, intensity: 40, size: 90, height: 60, color: "#7fa8ff" }], 5],
        ["cross", "Crossing beams", [{ light: "spot", x: 10, y: 10, intensity: 40, size: 90, focus: 60, height: 40 }, { light: "spot", x: 90, y: 10, intensity: 40, size: 90, focus: 60, height: 40 }], 5],
        ["three", "Three spots", [{ light: "spot", x: 20, y: 30, intensity: 35, size: 35, focus: 70, height: 40 }, { light: "spot", x: 50, y: 30, intensity: 35, size: 35, focus: 70, height: 40 }, { light: "spot", x: 80, y: 30, intensity: 35, size: 35, focus: 70, height: 40 }], 0],
        ["warmcool", "Warm and cool", [{ light: "point", x: 15, y: 40, intensity: 35, size: 70, height: 40, color: "#ffb36b" }, { light: "point", x: 85, y: 40, intensity: 35, size: 70, height: 40, color: "#6bb8ff" }], 5],
        ["sun", "Low sun", [{ light: "infinite", angle: 160, intensity: 45 }], 25], ["soft", "Soft overhead", [{ light: "point", x: 50, y: 20, intensity: 25, size: 160, height: 90 }], 35]];
      function list() { if (!p.lights) p.lights = [snap()]; p.lights[p.lightIdx] = snap(); return p.lights; }
      function draw() {
        box.textContent = "";
        var L = list();
        box.appendChild(h("div", { "class": "row pe-arow" }, [K.select("Light", L.map(function (o, i) { return [String(i), "Light " + (i + 1) + " (" + (o.light || "spot") + ")"]; }), String(p.lightIdx), function (v) { list(); p.lightIdx = +v; load(p.lights[p.lightIdx]); st.schedule(); }),
          K.btn("Add", function () { var L2 = list(); if (L2.length >= 8) return; var o = snap(); o.x = Math.min(150, (o.x || 50) + 15); L2.push(o); p.lightIdx = L2.length - 1; load(o); draw(); st.schedule(); }, "ghost", "i-plus", "Add a light"),
          K.btn("", function () { var L2 = list(); if (L2.length < 2) return; L2.splice(p.lightIdx, 1); p.lightIdx = Math.max(0, p.lightIdx - 1); load(L2[p.lightIdx]); draw(); st.schedule(); }, "ghost icon", "i-trash", "Delete this light")]));
      }
      col = AUI.colorInput("Light colour", "#ffffff", function (v) { p.color = v; st.schedule(); });
      el.insertBefore(col, el.firstChild); el.insertBefore(box, col);
      el.insertBefore(K.select("", PRESETS.map(function (x) { return [x[0], x[1]]; }), "", function (v) {
        var pr = PRESETS.filter(function (x) { return x[0] === v; })[0]; if (!pr || !pr[2]) return;
        p.lights = pr[2].map(function (o) { return Object.assign({ light: "spot", intensity: 35, color: "#ffffff", x: 50, y: 35, height: 50, focus: 50, size: 60, angle: -45 }, o); });
        p.lightIdx = 0; load(p.lights[0]); st.set("ambient", pr[3]); draw(); st.schedule();
      }), box);
      draw(); placeBtn(el, st, "x", "y", "Place the light");
    } });

  // pixelate
  AUI.filter("pixelate", "Colour halftone…", "colorHalftone", { t: "Colour halftone", c: [sl("radius", "Max. radius", 4, 127, 1, 8, pxf), sl("a1", "Screen angle: cyan", -360, 360, 1, 108, deg), sl("a2", "Screen angle: magenta", -360, 360, 1, 162, deg),
    sl("a3", "Screen angle: yellow", -360, 360, 1, 90, deg), sl("a4", "Screen angle: black", -360, 360, 1, 45, deg)], chk: [["black", "Black screen (grey component)", true]] });
  AUI.filter("pixelate", "Crystallize…", "crystallize", { t: "Crystallize", c: [sl("size", "Cell size", 3, 300, 1, 10, pxf)] });
  AUI.filter("pixelate", "Facet", "facet", null);
  AUI.filter("pixelate", "Fragment", "fragment", null);
  AUI.filter("pixelate", "Halftone pattern…", "halftonePattern", { t: "Halftone pattern", c: [sl("size", "Size", 1, 12, 1, 4), sl("contrast", "Contrast", 0, 50, 1, 5)],
    sel: [["pattern", "Pattern", [["dot", "Dots"], ["circle", "Circles"], ["line", "Lines"]], "dot"]], ui: function (el, st) { st.p.fg = ED.doc.fg; st.p.bg = ED.doc.bg; el.appendChild(h("p", { "class": "faint pe-p", text: "Uses the foreground and background colours." })); } });
  AUI.filter("pixelate", "Mezzotint…", "mezzotint", { t: "Mezzotint", sel: [["type", "Type", [["fineDots", "Fine dots"], ["medDots", "Medium dots"], ["grainyDots", "Grainy dots"], ["coarseDots", "Coarse dots"],
    ["shortLines", "Short lines"], ["medLines", "Medium lines"], ["longLines", "Long lines"], ["shortStrokes", "Short strokes"], ["medStrokes", "Medium strokes"], ["longStrokes", "Long strokes"]], "medDots"]] });
  F.pixelate.push(["Mosaic…", "", function () { ED.ui.openAdjust("pixelate"); }, has]);
  AUI.filter("pixelate", "Pointillize…", "pointillize", { t: "Pointillize", c: [sl("size", "Cell size", 3, 300, 1, 6, pxf)], ui: function (el, st) { st.p.bg = ED.doc.bg; el.appendChild(h("p", { "class": "faint pe-p", text: "Gaps show the background colour." })); } });

  // video
  AUI.filter("video", "De-interlace…", "deinterlace", { t: "De-interlace", sel: [["field", "Eliminate", [["odd", "Odd lines"], ["even", "Even lines"]], "odd"], ["mode", "Create new lines by", [["duplicate", "Duplication"], ["interp", "Interpolation"]], "interp"]] });
  AUI.filter("video", "Broadcast-safe colours…", "broadcastSafe", { t: "Broadcast-safe colours", c: [sl("limit", "Signal limit", 50, 130, 1, 110, pc)] });

  // other
  AUI.adj("customKernel", { t: "Custom", ui: function (el, st) {
    var p = st.p, K = ED.adjKit, grid = h("div", { "class": "pe-akernel", role: "group", "aria-label": "5 by 5 kernel" }), sc0, off;
    p.kernel = [0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, 5, -1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0]; p.scale = 1; p.offset = 0; p.keepAlpha = true;
    p.kernel.forEach(function (v, i) {
      var inp = h("input", { type: "number", "class": "input", value: String(v), min: "-999", max: "999", step: "1", "aria-label": "Row " + (Math.floor(i / 5) + 1) + " column " + (i % 5 + 1) });
      inp.addEventListener("input", function () { var x = +inp.value; p.kernel[i] = isFinite(x) ? Math.max(-999, Math.min(999, x)) : 0; st.schedule(); });
      grid.appendChild(inp);
    });
    sc0 = h("input", { type: "number", "class": "input", value: "1", min: "-9999", max: "9999", step: "1" }); sc0.addEventListener("input", function () { p.scale = +sc0.value || 1; st.schedule(); });
    off = h("input", { type: "number", "class": "input", value: "0", min: "-9999", max: "9999", step: "1" }); off.addEventListener("input", function () { p.offset = +off.value || 0; st.schedule(); });
    el.appendChild(grid);
    el.appendChild(h("div", { "class": "row pe-arow" }, [K.field("Scale", sc0), K.field("Offset", off)]));
    el.appendChild(K.check("Keep transparency", true, function (v) { p.keepAlpha = v; st.schedule(); }));
  } });
  F.other.push(["Custom…", "", function () { AUI.open("customKernel"); }, has]);
  AUI.filter("other", "HSB / HSL…", "hsbhsl", { t: "HSB / HSL", sel: [["direction", "", [["toHsx", "RGB to H, S, B/L"], ["fromHsx", "H, S, B/L to RGB"]], "toHsx"], ["model", "Model", [["hsb", "HSB"], ["hsl", "HSL"]], "hsb"]] });

  // path blur, flame: paths drawn on the canvas
  function pathUI(el, st, start) {
    st.p.paths = [start.slice()]; st.pathCur = 0;
    var info = h("p", { "class": "faint pe-p" });
    st.onPaths = function () { var n = st.p.paths.filter(function (P) { return P.length >= 4; }).length; info.textContent = "Click the image to add points to the path; drag a point to move it, double-click to remove it. Paths: " + n + "."; };
    el.appendChild(h("div", { "class": "row pe-arow" }, [ED.adjKit.btn("New path", function () { st.p.paths.push([]); st.pathCur = st.p.paths.length - 1; st.onPaths(); }, "ghost", "i-plus"),
      ED.adjKit.btn("Clear", function () { st.p.paths = [[]]; st.pathCur = 0; st.onPaths(); st.schedule(); }, "ghost")]));
    el.appendChild(info); st.onPaths();
  }
  AUI.filter("blur", "Path blur…", "pathBlur", { t: "Path blur", mp: 8e5, handles: AUI.H.paths(true), c: [sl("speed", "Speed", 0, 500, 1, 50, pxf), sl("taper", "Taper", 0, 100, 1, 0, pc)], chk: [["centred", "Centred blur", true]],
    ui: function (el, st) { pathUI(el, st, [20, 60, 50, 45, 80, 60]); } });
  AUI.filter("render", "Flame…", "flame", { t: "Flame", mp: 1.2e6, handles: AUI.H.paths(false), c: [sl("length", "Flame length", 1, 60, 1, 12, pc), sl("width", "Width", 5, 100, 1, 30, pc), sl("turbulence", "Turbulence", 0, 100, 1, 40, pc), sl("density", "Density", 5, 100, 1, 50, pc)],
    sel: [["colors", "Colours", [["fire", "Fire"], ["blue", "Blue gas"], ["green", "Green"], ["violet", "Violet"]], "fire"]],
    ui: function (el, st) { st.p.seed = 1; pathUI(el, st, [15, 85, 50, 80, 85, 85]); el.appendChild(ED.adjKit.btn("Randomise", function () { st.p.seed++; st.schedule(); }, "ghost")); el.appendChild(h("p", { "class": "faint pe-p", text: "Tip: draw it on a new empty layer to move it later." })); } });

  // picture frame, tree
  function seedBtn(el, st) { st.p.seed = 1; el.appendChild(ED.adjKit.btn("Randomise", function () { st.p.seed = (st.p.seed || 1) + 1; st.schedule(); }, "ghost")); }
  AUI.filter("render", "Picture frame…", "pictureFrame", { t: "Picture frame", c: [sl("margin", "Width", 1, 40, 1, 8, pc)],
    sel: [["style", "Style", [["mat", "Frame and mat"], ["wood", "Wood"], ["plain", "Plain border"], ["film", "Film strip"], ["instant", "Instant photo"], ["vine", "Vine"], ["scallop", "Scalloped edge"], ["rounded", "Rounded corners"]], "mat"]],
    ui: function (el, st) {
      st.p.color = "#3a2a1c"; st.p.color2 = "#f4efe4";
      el.appendChild(h("div", { "class": "row pe-arow" }, [AUI.colorInput("Frame", st.p.color, function (v) { st.p.color = v; st.schedule(); }), AUI.colorInput("Mat / paper", st.p.color2, function (v) { st.p.color2 = v; st.schedule(); })]));
      seedBtn(el, st);
    } });
  AUI.filter("render", "Tree…", "tree", { t: "Tree", handles: AUI.H.point("x", "y"), c: [sl("x", "Base X", 0, 100, 1, 50, pc), sl("y", "Base Y", 0, 100, 1, 96, pc), sl("size", "Size", 5, 100, 1, 45, pc),
    sl("spread", "Branch angle", 5, 70, 1, 28, deg), sl("depth", "Branching", 3, 11, 1, 8), sl("bend", "Bend", 0, 60, 1, 15), sl("leaves", "Leaf amount", 0, 100, 1, 60, pc), sl("leafSize", "Leaf size", 5, 100, 1, 50, pc)],
    ui: function (el, st) {
      st.p.trunk = "#4a3424"; st.p.leaf = "#4c8c3c";
      el.appendChild(h("div", { "class": "row pe-arow" }, [AUI.colorInput("Trunk", st.p.trunk, function (v) { st.p.trunk = v; st.schedule(); }), AUI.colorInput("Leaves", st.p.leaf, function (v) { st.p.leaf = v; st.schedule(); })]));
      seedBtn(el, st);
      el.appendChild(h("p", { "class": "faint pe-p", text: "Tip: draw it on a new empty layer, then move or transform it." }));
    } });

  // stylize
  AUI.filter("stylize", "Emboss…", "emboss", { t: "Emboss", c: [sl("angle", "Angle", -180, 180, 1, 135, deg), sl("height", "Height", 1, 100, 1, 3, pxf), sl("amount", "Amount", 1, 500, 1, 100, pc)], chk: [["color", "Keep colours", false]] });
  AUI.filter("stylize", "Extrude…", "extrude", { t: "Extrude", c: [sl("size", "Size", 2, 255, 1, 30, pxf), sl("depth", "Depth", 1, 255, 1, 30)],
    sel: [["type", "Type", [["blocks", "Blocks"], ["pyramids", "Pyramids"]], "blocks"], ["depthBy", "Depth by", [["level", "Brightness"], ["random", "Random"]], "level"]], chk: [["solid", "Solid front faces", false]] });
  AUI.filter("stylize", "Find edges", "findEdges", null);
  AUI.filter("stylize", "Glowing edges…", "glowingEdges", { t: "Glowing edges", c: [sl("width", "Edge width", 1, 14, 1, 2), sl("brightness", "Edge brightness", 0, 20, 1, 6), sl("smooth", "Smoothness", 1, 15, 1, 5)] });
  AUI.filter("stylize", "Solarize", "solarize", null);
  AUI.filter("stylize", "Trace contour…", "traceContour", { t: "Trace contour", c: [sl("level", "Level", 0, 255, 1, 128)], sel: [["edge", "Edge", [["lower", "Lower"], ["upper", "Upper"]], "upper"]] });
  AUI.filter("stylize", "Oil paint…", "oilPaint", { t: "Oil paint", c: [sl("stylization", "Stylisation", 0.1, 10, 0.1, 4), sl("cleanliness", "Cleanliness", 0, 10, 0.1, 5), sl("scale", "Brush scale", 0.1, 10, 0.1, 2),
    sl("bristle", "Bristle detail", 0, 10, 0.1, 3), sl("angle", "Light angle", -180, 180, 1, -60, deg), sl("shine", "Shine", 0, 10, 0.1, 1.3)] });
  AUI.filter("stylize", "Wind…", "wind", { t: "Wind", sel: [["method", "Method", [["wind", "Wind"], ["blast", "Blast"], ["stagger", "Stagger"]], "wind"], ["direction", "From the", [["right", "Left"], ["left", "Right"]], "right"]] });
  AUI.filter("stylize", "Diffuse…", "diffuse", { t: "Diffuse", c: [sl("radius", "Radius", 1, 10, 1, 2, pxf)], sel: [["mode", "Mode", [["normal", "Normal"], ["darken", "Darken only"], ["lighten", "Lighten only"], ["aniso", "Along edges"]], "normal"]] });
  AUI.filter("stylize", "Tiles…", "tiles", { t: "Tiles", c: [sl("count", "Tiles across the short side", 1, 99, 1, 10), sl("offset", "Maximum offset", 1, 99, 1, 10, pc)],
    sel: [["fill", "Fill empty area with", [["inverse", "Inverse image"], ["original", "Unaltered image"], ["color", "Background colour"], ["transparent", "Transparency"]], "inverse"]],
    ui: function (el, st) { st.p.fillColor = ED.doc.bg; } });
})();
