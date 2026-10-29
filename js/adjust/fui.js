/* Adjust lane: Filter menu entries (drill-down submenus) and panels for the filters in blur.js and friends. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, AUI = PE.adjUI, sl = AUI.sl, pc = AUI.pc, pxf = AUI.pxf, has = AUI.has, h = S3.h;
  var F = AUI.FILTERS = { blur: [], distort: [], noise: [], pixelate: [], render: [], stylize: [], other: [] };
  AUI.addMenu("Filter", ["-", AUI.sub("Filter", "Blur", F.blur), AUI.sub("Filter", "Distort", F.distort), AUI.sub("Filter", "Noise", F.noise), AUI.sub("Filter", "Pixelate", F.pixelate),
    AUI.sub("Filter", "Render", F.render), AUI.sub("Filter", "Stylize", F.stylize), AUI.sub("Filter", "Other", F.other)]);
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
  AUI.filter("blur", "Radial blur…", "radialBlur", { t: "Radial blur", c: [sl("amount", "Amount", 1, 100, 1, 10), sl("cx", "Centre X", 0, 100, 1, 50, pc), sl("cy", "Centre Y", 0, 100, 1, 50, pc)],
    sel: [["mode", "Method", [["spin", "Spin"], ["zoom", "Zoom"]], "spin"], ["quality", "Quality", [["draft", "Draft"], ["good", "Good"], ["best", "Best"]], "good"]] });
  AUI.filter("blur", "Surface blur…", "surfaceBlur", { t: "Surface blur", c: [sl("radius", "Radius", 1, 100, 1, 5, pxf), sl("threshold", "Threshold (levels)", 2, 255, 1, 15)] });
  AUI.filter("blur", "Smart blur…", "smartBlur", { t: "Smart blur", c: [sl("radius", "Radius", 0.5, 100, 0.5, 3, pxf), sl("threshold", "Threshold", 1, 100, 1, 25)],
    sel: [["mode", "Mode", [["normal", "Normal"], ["edges", "Edges only"], ["overlay", "Overlay edges"]], "normal"]] });
  // noise
  AUI.filter("noise", "Reduce noise…", "reduceNoise", { t: "Reduce noise", c: [sl("strength", "Strength", 0, 10, 1, 6), sl("details", "Preserve details", 0, 100, 1, 60, pc), sl("color", "Reduce colour noise", 0, 100, 1, 45, pc), sl("sharpen", "Sharpen details", 0, 100, 1, 25, pc)] });
  AUI.filter("noise", "Dust & scratches…", "dustScratches", { t: "Dust & scratches", c: [sl("radius", "Radius", 1, 100, 1, 2, pxf), sl("threshold", "Threshold (levels)", 0, 255, 1, 10)] });
  AUI.filter("noise", "Median…", "median", { t: "Median", c: [sl("radius", "Radius", 1, 100, 1, 2, pxf)] });
  AUI.filter("noise", "Despeckle", "despeckle", null);
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

  // stylize
  AUI.filter("stylize", "Emboss…", "emboss", { t: "Emboss", c: [sl("angle", "Angle", -180, 180, 1, 135, deg), sl("height", "Height", 1, 100, 1, 3, pxf), sl("amount", "Amount", 1, 500, 1, 100, pc)], chk: [["color", "Keep colours", false]] });
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
