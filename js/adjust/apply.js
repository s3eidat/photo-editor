/* Adjust lane: Image › Apply image (blend a layer's channel, or the merged image, into the current layer) and
   Image › Calculations (blend two channels into a new grey layer or a selection). Twenty blend modes; preview at
   about screen size, result at full size. Runs on the main thread (one pass of per-pixel maths). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, AUI = PE.adjUI, A = PIX.A, h = S3.h;
  function K() { return ED.adjKit; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- blend modes on 0..1 values (b = target / back, s = source) ----------
  function dodge(b, s) { return b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)); }
  function burn(b, s) { return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s); }
  function softD(b) { return b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b); }
  var MODES = A.BLEND2 = {
    normal: function (b, s) { return s; }, multiply: function (b, s) { return b * s; }, screen: function (b, s) { return b + s - b * s; },
    overlay: function (b, s) { return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); }, darken: Math.min, lighten: Math.max,
    difference: function (b, s) { return Math.abs(b - s); }, exclusion: function (b, s) { return b + s - 2 * b * s; },
    colorDodge: dodge, colorBurn: burn, linearDodge: function (b, s) { return Math.min(1, b + s); }, linearBurn: function (b, s) { return Math.max(0, b + s - 1); },
    hardLight: function (b, s) { return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s); },
    softLight: function (b, s) { return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (softD(b) - b); },
    vividLight: function (b, s) { return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1); }, linearLight: function (b, s) { return clamp(b + 2 * s - 1, 0, 1); },
    pinLight: function (b, s) { return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1); }, hardMix: function (b, s) { return b + s >= 1 ? 1 : 0; },
    subtract: function (b, s) { return Math.max(0, b - s); }, divide: function (b, s) { return s <= 0 ? 1 : Math.min(1, b / s); }
  };
  var MODE_LIST = [["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["softLight", "Soft light"], ["hardLight", "Hard light"],
    ["vividLight", "Vivid light"], ["linearLight", "Linear light"], ["pinLight", "Pin light"], ["hardMix", "Hard mix"], ["darken", "Darken"], ["lighten", "Lighten"],
    ["colorDodge", "Colour dodge"], ["colorBurn", "Colour burn"], ["linearDodge", "Add (linear dodge)"], ["linearBurn", "Linear burn"], ["difference", "Difference"],
    ["exclusion", "Exclusion"], ["subtract", "Subtract"], ["divide", "Divide"]];
  var CHANNELS = [["rgb", "RGB"], ["r", "Red"], ["g", "Green"], ["b", "Blue"], ["gray", "Grey (luminance)"], ["alpha", "Transparency"]];
  // per-channel value of a source pixel (0..1): rgb returns -1 to mean "use the matching colour channel"
  function chanVal(d, i, ch) {
    if (ch === "r") return d[i] / 255; if (ch === "g") return d[i + 1] / 255; if (ch === "b") return d[i + 2] / 255;
    if (ch === "alpha") return d[i + 3] / 255; if (ch === "gray") return (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255; return -1;
  }
  A.chanVal = chanVal;
  // tgt, src: {data, width, height} the same size. o = {channel, invert, mode, opacity 0..1, scale, offset, keepAlpha}
  A.applyImage = function (tgt, src, o, sel) {
    var d = tgt.data, s = src.data, f = MODES[o.mode] || MODES.normal, op = clamp(+o.opacity, 0, 1), sc = Math.max(1, +o.scale || 1), off = (+o.offset || 0) / 255;
    var addLike = o.mode === "linearDodge" || o.mode === "subtract";
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      var k = op * (sel ? sel[p] / 255 : 1); if (!k) continue;
      var cv = chanVal(s, i, o.channel);
      for (var c = 0; c < 3; c++) {
        var sv = cv < 0 ? s[i + c] / 255 : cv; if (o.invert) sv = 1 - sv;
        var bv = d[i + c] / 255, r = addLike ? clamp((o.mode === "subtract" ? bv - sv : bv + sv) / sc + off, 0, 1) : f(bv, sv);
        d[i + c] = (bv + (r - bv) * k) * 255;
      }
      if (!o.keepAlpha) d[i + 3] = d[i + 3] + (Math.max(d[i + 3], s[i + 3]) - d[i + 3]) * k;
    }
    return tgt;
  };
  // Calculations: grey result 0..1 per pixel from two sources' channels.
  A.calculate = function (s1, s2, o) {
    var n = s1.width * s1.height, out = new Float32Array(n), f = MODES[o.mode] || MODES.multiply, op = clamp(+o.opacity, 0, 1), sc = Math.max(1, +o.scale || 1), off = (+o.offset || 0) / 255;
    for (var p = 0, i = 0; p < n; p++, i += 4) {
      var a = chanVal(s1.data, i, o.ch1 === "rgb" ? "gray" : o.ch1), b = chanVal(s2.data, i, o.ch2 === "rgb" ? "gray" : o.ch2);
      if (o.inv1) a = 1 - a; if (o.inv2) b = 1 - b;
      var r = o.mode === "linearDodge" ? clamp((b + a) / sc + off, 0, 1) : o.mode === "subtract" ? clamp((b - a) / sc + off, 0, 1) : f(b, a);
      out[p] = b + (r - b) * op;
    }
    return out;
  };

  // pixels of a source over a rect of the document (layer pixels as they are, or the merged image)
  function sourceOver(id, r, scale) {
    var d = ED.doc, w = Math.max(1, Math.round(r.w * scale)), hh = Math.max(1, Math.round(r.h * scale)), c = PE.mk(w, hh), x = c.getContext("2d");
    x.scale(scale, scale); x.translate(-r.x, -r.y);
    if (id === "__merged") x.drawImage(PE.flatten(d), 0, 0);
    else { var L = PE.findLayer(d, id); if (L) { var s = L.kind === "raster" ? { canvas: L.canvas, x: L.x, y: L.y } : PE.surface(L, d); x.drawImage(s.canvas, s.x, s.y); } }
    var im = x.getImageData(0, 0, w, hh); return { data: im.data, width: w, height: hh };
  }
  function layerOpts() { return [["__merged", "Merged (all visible)"]].concat(ED.doc.layers.slice().reverse().map(function (l) { return [l.id, l.name]; })); }

  // ---------- Apply image ----------
  function applyImageDialog() {
    var Kt = K(), t = Kt.adjTarget(); if (!t) return;
    var L = t.L, W = t.r.w, H = t.r.h, s = AUI.proxyScale(W, H), w = Math.max(1, Math.round(W * s)), hh = Math.max(1, Math.round(H * s));
    var small = s < 1 ? AUI.downImg(t.img, w, hh) : t.img, ssel = t.sel && s < 1 ? AUI.downPlane(t.sel, W, H, w, hh) : t.sel;
    var o = { src: "__merged", channel: "rgb", invert: false, mode: "multiply", opacity: 1, scale: 1, offset: 0, keepAlpha: true }, cache = {}, prev = PE.mk(w, hh), full = s < 1 ? PE.mk(W, H) : null, raf = 0;
    function src(scale) { var k = o.src + "@" + scale; return cache[k] || (cache[k] = sourceOver(o.src, t.r, scale)); }
    function show() {
      raf = 0;
      var im = { data: new Uint8ClampedArray(small.data), width: w, height: hh };
      A.applyImage(im, src(s), o, ssel);
      prev.getContext("2d").putImageData(new ImageData(im.data, w, hh), 0, 0);
      var c = prev;
      if (full) { var fx = full.getContext("2d"); fx.save(); fx.globalCompositeOperation = "copy"; fx.imageSmoothingQuality = "high"; fx.drawImage(prev, 0, 0, W, H); fx.restore(); c = full; }
      ED.live.over[L.id] = { canvas: PE.touch(c), x: t.r.x, y: t.r.y }; ED.render();
    }
    function soon() { if (!raf) raf = requestAnimationFrame(show); }
    var scBox = h("div", { "class": "stack pe-asecin" });
    function scaleVis() { scBox.style.display = o.mode === "linearDodge" || o.mode === "subtract" ? "" : "none"; }
    AUI.panel("Apply image", function (el) {
      el.appendChild(Kt.select("Source", layerOpts(), o.src, function (v) { o.src = v; soon(); }));
      el.appendChild(Kt.select("Channel", CHANNELS, o.channel, function (v) { o.channel = v; soon(); }));
      el.appendChild(Kt.check("Invert", false, function (v) { o.invert = v; soon(); }));
      el.appendChild(Kt.select("Blending", MODE_LIST, o.mode, function (v) { o.mode = v; scaleVis(); soon(); }));
      el.appendChild(Kt.range("Opacity", 100, 0, 100, 1, function (v) { o.opacity = v / 100; soon(); }, AUI.pc));
      scBox.appendChild(Kt.range("Scale", 1, 1, 2, 0.01, function (v) { o.scale = v; soon(); })); scBox.appendChild(Kt.range("Offset", 0, -255, 255, 1, function (v) { o.offset = v; soon(); }));
      el.appendChild(scBox); scaleVis();
      el.appendChild(Kt.check("Preserve transparency", true, function (v) { o.keepAlpha = v; soon(); }));
      el.appendChild(h("p", { "class": "faint pe-p", text: "Blends the source into “" + L.name + "”" + (t.sel ? " inside the selection." : ".") }));
      show();
    }, function () {
      if (raf) cancelAnimationFrame(raf); delete ED.live.over[L.id];
      var im = { data: new Uint8ClampedArray(t.img.data), width: W, height: H };
      A.applyImage(im, src(1), o, t.sel); Kt.commitAdjusted(t, im, "Apply image");
    }, function () { if (raf) cancelAnimationFrame(raf); delete ED.live.over[L.id]; });
  }

  // ---------- Calculations ----------
  function calculationsDialog() {
    var d = ED.doc; if (!K().need()) return;
    var r = { x: 0, y: 0, w: d.w, h: d.h }, s = AUI.proxyScale(d.w, d.h), Kt = K(), cache = {}, raf = 0;
    var o = { s1: "__merged", ch1: "gray", inv1: false, s2: "__merged", ch2: "gray", inv2: false, mode: "multiply", opacity: 1, scale: 1, offset: 0, result: "selection" };
    var w = Math.max(1, Math.round(d.w * s)), hh = Math.max(1, Math.round(d.h * s)), prev = PE.mk(w, hh);
    function src(id, scale) { var k = id + "@" + scale; return cache[k] || (cache[k] = sourceOver(id, r, scale)); }
    function show() {
      raf = 0;
      var g = A.calculate(src(o.s1, s), src(o.s2, s), o), x = prev.getContext("2d"), im = x.createImageData(w, hh);
      for (var p = 0; p < g.length; p++) { var v = g[p] * 255; im.data[p * 4] = im.data[p * 4 + 1] = im.data[p * 4 + 2] = v; im.data[p * 4 + 3] = 255; }
      x.putImageData(im, 0, 0);
      view.ver++;
    }
    // the preview is drawn over the document on an overlay canvas (the layers are not touched)
    var view = { p: o, t: { r: r }, ver: 0, set: function () {} };
    function soon() { if (!raf) raf = requestAnimationFrame(show); }
    function srcRow(el, n) {
      el.appendChild(h("h4", { "class": "pe-agroup", text: "Source " + n }));
      el.appendChild(Kt.select("Layer", layerOpts(), o["s" + n], function (v) { o["s" + n] = v; soon(); }));
      el.appendChild(Kt.select("Channel", CHANNELS.filter(function (c) { return c[0] !== "rgb"; }), o["ch" + n], function (v) { o["ch" + n] = v; soon(); }));
      el.appendChild(Kt.check("Invert", false, function (v) { o["inv" + n] = v; soon(); }));
    }
    function removePreview() { if (raf) cancelAnimationFrame(raf); }
    AUI.panel("Calculations", function (el) {
      srcRow(el, 1); srcRow(el, 2);
      el.appendChild(h("h4", { "class": "pe-agroup", text: "Result" }));
      el.appendChild(Kt.select("Blending", MODE_LIST, o.mode, function (v) { o.mode = v; soon(); }));
      el.appendChild(Kt.range("Opacity", 100, 0, 100, 1, function (v) { o.opacity = v / 100; soon(); }, AUI.pc));
      el.appendChild(Kt.range("Scale (add / subtract)", 1, 1, 2, 0.01, function (v) { o.scale = v; soon(); })); el.appendChild(Kt.range("Offset (add / subtract)", 0, -255, 255, 1, function (v) { o.offset = v; soon(); }));
      el.appendChild(Kt.seg("Make", [["selection", "Selection"], ["layer", "New grey layer"]], o.result, function (v) { o.result = v; }));
      el.appendChild(h("p", { "class": "faint pe-p", text: "Source 1 is blended onto source 2; white = selected." }));
      AUI.handles(view, function () { return { draw: function (ctx) { var a0 = ED.toScr(0, 0), a1 = ED.toScr(d.w, d.h); ctx.shadowBlur = 0; ctx.imageSmoothingEnabled = true; ctx.drawImage(prev, a0.x, a0.y, a1.x - a0.x, a1.y - a0.y); } }; });
      show();
    }, function () {
      removePreview();
      var g = A.calculate(src(o.s1, 1), src(o.s2, 1), o);
      if (o.result === "layer") {
        var c = PE.mk(d.w, d.h), x = c.getContext("2d"), im = x.createImageData(d.w, d.h);
        for (var p = 0; p < g.length; p++) { var v = g[p] * 255; im.data[p * 4] = im.data[p * 4 + 1] = im.data[p * 4 + 2] = v; im.data[p * 4 + 3] = 255; }
        x.putImageData(im, 0, 0); ED.addLayer(PE.rasterFromCanvas(PE.touch(c), "Calculations"), "Calculations");
      } else {
        var m = new Uint8Array(g.length); for (var q = 0; q < g.length; q++) m[q] = Math.round(g[q] * 255);
        var sel = PE.makeSel(d, m); ED.meta("Calculations", function () { d.sel = sel; });
      }
    }, removePreview);
  }
  AUI.addMenu("Image", [["Apply image…", "", applyImageDialog, AUI.has], ["Calculations…", "", calculationsDialog, AUI.has], "-"], "Image size");
  AUI.applyImageDialog = applyImageDialog; AUI.calculationsDialog = calculationsDialog;
})();
