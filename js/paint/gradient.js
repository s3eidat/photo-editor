/* Photo Editor paint lane: gradients. Multi-stop colour and opacity stops with midpoints, foreground /
   background stops, noise gradients; linear, radial, angle, reflected and diamond; dither, reverse, blend mode.
   The gradient tool renders in the paint worker. A gradient editor and a Gradients tab manage presets
   (built-in ones are made here; your own are kept in this browser). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, h = S3.h;

  PP.icons({
    "g-linear": [["rect", { x: "3.5", y: "3.5", width: "17", height: "17", rx: "2" }], "M8 4v16M12 4v16M16 4v16"],
    "g-radial": [["circle", { cx: "12", cy: "12", r: "8.5" }], ["circle", { cx: "12", cy: "12", r: "4.5" }]],
    "g-angle": [["circle", { cx: "12", cy: "12", r: "8.5" }], "M12 12V3.5M12 12l6 6"],
    "g-reflected": [["rect", { x: "3.5", y: "3.5", width: "17", height: "17", rx: "2" }], "M12 4v16M8 4v16M16 4v16", "M3.5 12h3M17.5 12h3"],
    "g-diamond": ["M12 3l9 9-9 9-9-9z", "M12 7.5l4.5 4.5-4.5 4.5-4.5-4.5z"]
  });

  // ---------- model ----------
  function st(p, c, m) { return { p: p, c: c, m: m == null ? 0.5 : m }; }
  function al(p, a, m) { return { p: p, a: a, m: m == null ? 0.5 : m }; }
  function solid(name, cols, alpha) { var n = cols.length; return { id: "b:" + name, name: name, kind: "solid", stops: cols.map(function (c, i) { return Array.isArray(c) ? st(c[0], c[1]) : st(n > 1 ? i / (n - 1) : 0, c); }), alpha: alpha || [al(0, 1), al(1, 1)] }; }
  var BUILTIN = [
    solid("Foreground to background", ["fg", "bg"]),
    solid("Foreground to transparent", ["fg", "fg"], [al(0, 1), al(1, 0)]),
    solid("Black to white", ["#000000", "#ffffff"]),
    solid("Spectrum", ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"]),
    solid("Dusk", ["#2b1055", "#7a2a7f", "#d53369", "#ff8a5b", "#ffe29f"]),
    solid("Deep water", ["#0f2027", "#203a43", "#2c5364", "#6dd5ed"]),
    solid("Brushed steel", [[0, "#5d6166"], [0.22, "#e8ebef"], [0.45, "#8a8f96"], [0.62, "#f4f6f8"], [0.82, "#70757c"], [1, "#c9cdd2"]]),
    solid("Copper", ["#3b1e08", "#b87333", "#f4c28d", "#8a4b24", "#d99a63"]),
    solid("Pastel", ["#fbc2eb", "#a6c1ee", "#c2e9fb"]),
    solid("Forest", ["#0b3d20", "#2e7d32", "#a5d66f"]),
    solid("Hard stripes", [[0, "#111111"], [0.25, "#111111"], [0.25, "#f2f2f2"], [0.5, "#f2f2f2"], [0.5, "#111111"], [0.75, "#111111"], [0.75, "#f2f2f2"], [1, "#f2f2f2"]]),
    solid("Fade both ends", ["fg", "fg", "fg"], [al(0, 0), al(0.5, 1), al(1, 0)]),
    { id: "b:Noise", name: "Noise", kind: "noise", rough: 60, seed: 7, restrict: false, transp: false },
    { id: "b:Soft noise", name: "Soft noise", kind: "noise", rough: 20, seed: 31, restrict: true, transp: false }
  ];
  var USER = [];
  // library records keep the gradient's own kind in gkind (the record's kind is "gradient")
  PP.lib.all("gradient").then(function (a) { USER = a.map(function (r) { return cleanG(Object.assign({}, r, { kind: r.gkind })); }).filter(Boolean); PP.refreshPanel("gradients"); }).catch(function () {});
  function cleanG(g) {
    if (!g || typeof g !== "object") return null;
    var num = function (v, d) { v = +v; return isFinite(v) ? PE.clamp(v, 0, 1) : d; }, col = function (c) { return c === "fg" || c === "bg" ? c : PE.hex(c, "#000000"); };
    var out = { id: String(g.id || PE.uid("g")).slice(0, 40), name: String(g.name || "Gradient").replace(/[\u0000-\u001f]/g, " ").slice(0, 60), kind: g.kind === "noise" ? "noise" : "solid" };
    if (out.kind === "noise") { out.rough = PE.clamp(+g.rough || 0, 0, 100); out.seed = (+g.seed >>> 0) || 1; out.restrict = !!g.restrict; out.transp = !!g.transp; return out; }
    out.stops = (Array.isArray(g.stops) ? g.stops : []).slice(0, 64).map(function (s) { return st(num(s && s.p, 0), col(s && s.c), num(s && s.m, 0.5)); });
    out.alpha = (Array.isArray(g.alpha) ? g.alpha : []).slice(0, 64).map(function (s) { return al(num(s && s.p, 0), num(s && s.a, 1), num(s && s.m, 0.5)); });
    if (!out.stops.length) out.stops = [st(0, "fg"), st(1, "bg")];
    if (!out.alpha.length) out.alpha = [al(0, 1), al(1, 1)];
    return out;
  }
  PP.cleanGradient = cleanG;
  function resolve(g, transp) {
    var fg = PE.rgbOf(ED.doc ? ED.doc.fg : "#000000"), bg = PE.rgbOf(ED.doc ? ED.doc.bg : "#ffffff");
    if (g.kind === "noise") return Object.assign({}, g, { transp: g.transp && transp !== false });
    return { kind: "solid", stops: g.stops.map(function (s) { return { p: s.p, m: s.m, c: s.c === "fg" ? fg : s.c === "bg" ? bg : PE.rgbOf(s.c) }; }),
      alpha: transp === false ? [{ p: 0, a: 1 }] : g.alpha };
  }
  PP.gradientLut = function (g, transp, n) { return PPX.gradLut(resolve(g, transp), n); };
  function thumb(g, w, hh) {
    var c = PE.mk(w, hh), x = PE.cx2(c), lut = PP.gradientLut(g, true, w), im = x.createImageData(w, hh);
    for (var yy = 0; yy < hh; yy++) for (var xx = 0; xx < w; xx++) {
      var q = (yy * w + xx) * 4, ck = ((xx >> 2) + (yy >> 2)) % 2 ? 204 : 255, a = lut[xx * 4 + 3];
      for (var k = 0; k < 3; k++) im.data[q + k] = lut[xx * 4 + k] * a + ck * (1 - a);
      im.data[q + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    return c;
  }
  PP.gradientThumb = thumb;

  // ---------- tool ----------
  var o = PP.opts("gradient", { type: "linear", rev: false, op: 1, dither: true, transp: true, mode: "normal", g: null });
  if (!o.g || !cleanG(o.g)) o.g = PE.clone(o.trans ? BUILTIN[1] : BUILTIN[0]);
  o.g = cleanG(o.g);
  PP.applyGradient = function (a, b) {
    var t = PP.target(); if (!t) return Promise.resolve(false);
    var d = ED.doc, hd = t.holder, sel = d.sel, mask = t.mask;
    var R = PE.inter(sel ? { x: sel.b.x - hd.x, y: sel.b.y - hd.y, w: sel.b.w, h: sel.b.h } : { x: -hd.x, y: -hd.y, w: d.w, h: d.h }, { x: 0, y: 0, w: hd.canvas.width, h: hd.canvas.height });
    if (!R) { ED.push(t.grow); return Promise.resolve(false); }
    var lut = PP.gradientLut(o.g, o.transp), op = PE.clamp(o.op, 0, 1);
    var job = PP.work("gradRender", [lut, R.w, R.h, R.x + hd.x, R.y + hd.y, { type: o.type, a: a, b: b, rev: o.rev, dither: o.dither }]);
    ED.push(t.grow);
    return PP.commitAsync(job, "Gradient…", function (px) {
      var tc = PE.mk(R.w, R.h), tx = PE.cx2(tc); tx.putImageData(new ImageData(new Uint8ClampedArray(px), R.w, R.h), 0, 0);
      var e = PE.editPixels(d, "Gradient", hd, "canvas", R, function (c) {
        if (mask) {      // on a mask: the gradient's brightness becomes the mask value
          var md = c.getImageData(R.x, R.y, R.w, R.h), mm = md.data, sl = sel ? PE.selFor(d, { x: R.x + hd.x, y: R.y + hd.y, w: R.w, h: R.h }) : null;
          for (var i = 0, q = 0; i < mm.length; i += 4, q++) {
            var gv = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * px[i + 3] / 255, k = op * (sl ? sl[q] / 255 : 1), ma = mm[i + 3];
            mm[i] = mm[i + 1] = mm[i + 2] = 255; mm[i + 3] = ma + (gv - ma) * k;
          }
          c.putImageData(md, R.x, R.y); return;
        }
        if (sel) { tx.globalCompositeOperation = "destination-in"; tx.drawImage(PE.selCanvas(sel), -(R.x + hd.x), -(R.y + hd.y)); }
        c.save(); c.globalAlpha = op; c.globalCompositeOperation = PE.gco(o.mode); c.drawImage(tc, R.x, R.y); c.restore();
      });
      PP.pushJoined(t.grow, e, "Gradient");
      return true;
    });
  };
  ED.TOOLS.gradient = {
    down: function (p) { var L = ED.layer(); if (!ED.editable(L, "pixels")) return; ED.drag = { kind: "gradient", a: p, b: null }; },
    move: function (p, e) {
      var dr = ED.drag;
      if (e.shiftKey) { var ang = Math.round(Math.atan2(p.y - dr.a.y, p.x - dr.a.x) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(p.x - dr.a.x, p.y - dr.a.y); p = { x: dr.a.x + Math.cos(ang) * len, y: dr.a.y + Math.sin(ang) * len }; }
      dr.b = p; schedulePreview(dr);
    },
    up: function () { var dr = ED.drag; ED.drag = null; PV = null; if (dr && dr.b && Math.hypot(dr.b.x - dr.a.x, dr.b.y - dr.a.y) > 1) PP.applyGradient(dr.a, dr.b); }
  };
  // live preview while dragging: rendered small (at most ~300k pixels) and shown on the overlay
  var PV = null, pvRaf = 0;
  function schedulePreview(dr) {
    if (pvRaf) return;
    pvRaf = requestAnimationFrame(function () {
      pvRaf = 0; if (ED.drag !== dr || !dr.b || !ED.doc) return;
      var d = ED.doc, r = d.sel ? d.sel.b : { x: 0, y: 0, w: d.w, h: d.h }, k = Math.min(1, Math.sqrt(3e5 / (r.w * r.h))), w = Math.max(1, Math.round(r.w * k)), hh = Math.max(1, Math.round(r.h * k));
      if (!dr.lut) dr.lut = PP.gradientLut(o.g, o.transp, 512);
      var a = { x: (dr.a.x - r.x) * k, y: (dr.a.y - r.y) * k }, b = { x: (dr.b.x - r.x) * k, y: (dr.b.y - r.y) * k };
      var px = PPX.gradRender(dr.lut, w, hh, 0, 0, { type: o.type, a: a, b: b, rev: o.rev, dither: false });
      if (ED.maskEdit) for (var i = 0; i < px.length; i += 4) { var g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; px[i] = px[i + 1] = px[i + 2] = g; }
      var c = PV && PV.c.width === w && PV.c.height === hh ? PV.c : PE.mk(w, hh), x = PE.cx2(c);
      x.globalCompositeOperation = "copy"; x.putImageData(new ImageData(px, w, hh), 0, 0);
      if (d.sel) { x.globalCompositeOperation = "destination-in"; x.drawImage(PE.selCanvas(d.sel), r.x, r.y, r.w, r.h, 0, 0, w, hh); }
      x.globalCompositeOperation = "source-over";
      PV = { c: c, r: r }; ED.renderOvl();
    });
  }
  PP.overlay(function (c, docPath) {
    if (!PV || !ED.drag || ED.drag.kind !== "gradient") return;
    docPath(c, function (c) { c.save(); c.globalAlpha = PE.clamp(o.op, 0, 1) * 0.9; c.imageSmoothingEnabled = true; c.drawImage(PV.c, PV.r.x, PV.r.y, PV.r.w, PV.r.h); c.restore(); });
  });
  var TYPES = [["linear", "Linear", "Linear", "g-linear"], ["radial", "Radial", "Radial", "g-radial"], ["angle", "Angle", "Angle", "g-angle"], ["reflected", "Reflected", "Reflected", "g-reflected"], ["diamond", "Diamond", "Diamond", "g-diamond"]];
  PP.optsFor.gradient = function (items) {
    var g = h("button", { type: "button", "class": "pp-gbtn", title: "Edit the gradient (click)", "aria-label": "Edit the gradient" }, [thumb(o.g, 120, 22)]);
    g.addEventListener("click", function () { editor(); });
    var modes = PE.BLENDS.map(function (m) { return [m, m.charAt(0).toUpperCase() + m.slice(1)]; });
    return [items[0], g, K.seg("", TYPES, o.type, function (v) { o.type = v; ED.saveOpts(); }),
      K.select("Mode", modes, o.mode, function (v) { o.mode = v; ED.saveOpts(); }),
      K.range("Opacity", o.op, 0.01, 1, 0.01, function (v) { o.op = v; ED.saveOpts(); }, function (v) { return Math.round(v * 100) + "%"; }),
      K.check("Reverse", o.rev, function (v) { o.rev = v; ED.saveOpts(); }), K.check("Dither", o.dither, function (v) { o.dither = v; ED.saveOpts(); }),
      K.check("Transparency", o.transp, function (v) { o.transp = v; ED.saveOpts(); }),
      h("span", { "class": "pe-hint", text: "Drag across the canvas. Shift snaps to 45°. Click the gradient to edit it." })];
  };
  function setGradient(g) { o.g = cleanG(PE.clone(g)); ED.saveOpts(); if (ED.tool === "gradient") ED.ui.buildOpts(); PP.refreshPanel("gradients"); }
  PP.setGradient = setGradient;
  PP.gradients = function () { return BUILTIN.concat(USER); };
  PP.removeGradient = function (id) { USER = USER.filter(function (g) { return g.id !== id; }); PP.lib.del(id).catch(function () {}); PP.refreshPanel("gradients"); };
  PP.addGradient = function (g) {
    var p = cleanG(g); if (!p) return null; p.id = PE.uid("g"); USER.push(p);
    PP.lib.put(Object.assign({}, p, { kind: "gradient", gkind: p.kind, order: Date.now() })).catch(function () {}); PP.refreshPanel("gradients");
    return p;
  };

  // ---------- gradient editor ----------
  function editor() {
    var g = cleanG(PE.clone(o.g)), sel = { kind: "c", i: 0 };
    var bar = h("canvas", { "class": "pp-gbar", width: "512", height: "28" });
    var crow = h("div", { "class": "pp-grow pp-gcol", title: "Click to add a colour stop. Drag to move, drag down to remove." });
    var arow = h("div", { "class": "pp-grow pp-galpha", title: "Click to add an opacity stop. Drag to move, drag up to remove." });
    var fields = h("div", { "class": "pp-gfields" }), noiseBox = h("div", { "class": "stack" }), solidBox = h("div", { "class": "pp-gsolid" }, [arow, bar, crow, fields]);
    var name = h("input", { "class": "input", value: g.name, maxlength: "60", "aria-label": "Gradient name" });
    name.addEventListener("input", function () { g.name = name.value.slice(0, 60); });
    var presets = h("div", { "class": "pp-gpresets" });
    function allPresets() { return BUILTIN.concat(USER); }
    function drawPresets() {
      presets.textContent = "";
      allPresets().forEach(function (p) {
        var b = h("button", { type: "button", "class": "pp-gpre", title: p.name, "aria-label": p.name }, [thumb(p, 60, 18)]);
        b.addEventListener("click", function () { g = cleanG(PE.clone(p)); g.id = PE.uid("g"); name.value = g.name; sel = { kind: "c", i: 0 }; kindSeg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.textContent === (g.kind === "noise" ? "Noise" : "Solid"))); }); redraw(); });
        presets.appendChild(b);
      });
    }
    var kindSeg = K.seg("Type", [["solid", "Solid"], ["noise", "Noise"]], g.kind, function (v) {
      if (v === g.kind) return;
      if (v === "noise") g = Object.assign({ id: g.id, name: g.name }, { kind: "noise", rough: 50, seed: Math.floor(Math.random() * 1e6) + 1, restrict: false, transp: false });
      else g = cleanG({ id: g.id, name: g.name, kind: "solid", stops: [st(0, "fg"), st(1, "bg")] });
      sel = { kind: "c", i: 0 }; redraw();
    });
    function list(kind) { return kind === "c" ? g.stops : g.alpha; }
    function sortKeep(kind) { var L = list(kind), cur = L[sel.i]; L.sort(function (a, b) { return a.p - b.p; }); if (sel.kind === kind) sel.i = Math.max(0, L.indexOf(cur)); }
    function drawBar() {
      var x = bar.getContext("2d"), w = bar.width, hh = bar.height, t = thumb(g, w, hh); x.clearRect(0, 0, w, hh); x.drawImage(t, 0, 0);
    }
    function marker(kind, i) {
      var s = list(kind)[i], on = sel.kind === kind && sel.i === i;
      var b = h("button", { type: "button", "class": "pp-gstop" + (on ? " on" : ""), "aria-label": (kind === "c" ? "Colour stop " : "Opacity stop ") + Math.round(s.p * 100) + "%" });
      b.style.left = (s.p * 100) + "%";
      var sw = h("span"); sw.style.background = kind === "c" ? (s.c === "fg" ? ED.doc ? ED.doc.fg : "#000" : s.c === "bg" ? ED.doc ? ED.doc.bg : "#fff" : s.c) : "rgba(0,0,0," + s.a + ")"; b.appendChild(sw);
      b.addEventListener("pointerdown", function (e) {
        e.stopPropagation(); e.preventDefault(); b.setPointerCapture(e.pointerId); sel = { kind: kind, i: i }; drawFields(); mark();
        var row = b.parentNode.getBoundingClientRect(), y0 = e.clientY, gone = false;
        function mv(ev) {
          s.p = PE.clamp((ev.clientX - row.left) / row.width, 0, 1); b.style.left = (s.p * 100) + "%";
          gone = list(kind).length > 2 && Math.abs(ev.clientY - y0) > 40; b.style.opacity = gone ? "0.3" : "1"; drawBar(); posField();
        }
        function upf() {
          b.removeEventListener("pointermove", mv); b.removeEventListener("pointerup", upf);
          if (gone) { list(kind).splice(list(kind).indexOf(s), 1); sel = { kind: kind, i: 0 }; } else { sel.i = list(kind).indexOf(s); sortKeep(kind); }
          redraw();
        }
        b.addEventListener("pointermove", mv); b.addEventListener("pointerup", upf);
      });
      return b;
    }
    function midpoint(kind, i) {
      var L = list(kind), a = L[i], c = L[i + 1]; if (!c || c.p - a.p < 0.02) return null;
      var m = h("span", { "class": "pp-gmid", title: "Midpoint (drag)" }); m.style.left = ((a.p + (c.p - a.p) * a.m) * 100) + "%";
      m.addEventListener("pointerdown", function (e) {
        e.stopPropagation(); e.preventDefault(); m.setPointerCapture(e.pointerId);
        var row = m.parentNode.getBoundingClientRect();
        function mv(ev) { var p = PE.clamp((ev.clientX - row.left) / row.width, 0, 1); a.m = PE.clamp((p - a.p) / (c.p - a.p), 0.05, 0.95); m.style.left = ((a.p + (c.p - a.p) * a.m) * 100) + "%"; drawBar(); }
        function upf() { m.removeEventListener("pointermove", mv); m.removeEventListener("pointerup", upf); }
        m.addEventListener("pointermove", mv); m.addEventListener("pointerup", upf);
      });
      return m;
    }
    function rows() {
      [["c", crow], ["a", arow]].forEach(function (kr) {
        var el = kr[1]; el.textContent = "";
        list(kr[0]).forEach(function (s, i) { el.appendChild(marker(kr[0], i)); var m = midpoint(kr[0], i); if (m) el.appendChild(m); });
      });
    }
    function mark() { S3.$$(".pp-gstop", solidBox).forEach(function (b) { b.classList.remove("on"); }); var row = sel.kind === "c" ? crow : arow, bs = S3.$$(".pp-gstop", row); if (bs[sel.i]) bs[sel.i].classList.add("on"); }
    [["c", crow], ["a", arow]].forEach(function (kr) {
      kr[1].addEventListener("pointerdown", function (e) {
        if (e.target !== kr[1]) return;
        var r = kr[1].getBoundingClientRect(), p = PE.clamp((e.clientX - r.left) / r.width, 0, 1), lut = PPX.gradLut(resolve(g, true), 256), k = Math.round(p * 255) * 4;
        if (list(kr[0]).length >= 64) return;
        if (kr[0] === "c") g.stops.push(st(p, PE.toHex(lut[k], lut[k + 1], lut[k + 2]))); else g.alpha.push(al(p, Math.round(lut[k + 3] * 100) / 100));
        sel = { kind: kr[0], i: list(kr[0]).length - 1 }; sortKeep(kr[0]); redraw();
      });
    });
    var posIn = null;
    function posField() { if (posIn) { var s = list(sel.kind)[sel.i]; if (s) posIn.value = Math.round(s.p * 100); } }
    function drawFields() {
      fields.textContent = ""; posIn = null;
      var s = list(sel.kind)[sel.i]; if (!s) return;
      posIn = h("input", { type: "number", "class": "input", min: "0", max: "100", step: "1", value: String(Math.round(s.p * 100)), "aria-label": "Location %" });
      posIn.addEventListener("change", function () { s.p = PE.clamp(+posIn.value || 0, 0, 100) / 100; sortKeep(sel.kind); redraw(); });
      var del = K.btn("Delete stop", function () { var L = list(sel.kind); if (L.length <= (sel.kind === "c" ? 1 : 1)) return; L.splice(sel.i, 1); sel.i = 0; redraw(); }, "ghost");
      if (sel.kind === "c") {
        var sw = h("button", { type: "button", "class": "pp-gcolbtn", title: "Choose the colour", "aria-label": "Stop colour" });
        sw.style.background = s.c === "fg" ? ED.doc.fg : s.c === "bg" ? ED.doc.bg : s.c;
        sw.addEventListener("click", function () { PP.pickColor(null, { color: s.c === "fg" ? ED.doc.fg : s.c === "bg" ? ED.doc.bg : s.c, title: "Stop colour", onPick: function (hx) { s.c = hx; redraw(); } }); });
        var src = K.select("Use", [["c", "Colour"], ["fg", "Foreground"], ["bg", "Background"]], s.c === "fg" || s.c === "bg" ? s.c : "c", function (v) { s.c = v === "c" ? (s.c === "fg" ? ED.doc.fg : s.c === "bg" ? ED.doc.bg : s.c) : v; redraw(); });
        fields.appendChild(h("div", { "class": "pp-gf" }, [h("span", { "class": "faint", text: "Colour stop" }), sw, src, K.field("Location %", posIn, "pe-num"), del]));
      } else {
        var opIn = h("input", { type: "number", "class": "input", min: "0", max: "100", step: "1", value: String(Math.round(s.a * 100)), "aria-label": "Opacity %" });
        opIn.addEventListener("input", function () { s.a = PE.clamp(+opIn.value || 0, 0, 100) / 100; drawBar(); rows(); });
        fields.appendChild(h("div", { "class": "pp-gf" }, [h("span", { "class": "faint", text: "Opacity stop" }), K.field("Opacity %", opIn, "pe-num"), K.field("Location %", posIn, "pe-num"), del]));
      }
    }
    function drawNoise() {
      noiseBox.textContent = "";
      noiseBox.appendChild(K.range("Roughness", g.rough, 0, 100, 1, function (v) { g.rough = v; drawBar(); }, function (v) { return v + "%"; }));
      noiseBox.appendChild(K.check("Restrict colours", g.restrict, function (v) { g.restrict = v; drawBar(); }));
      noiseBox.appendChild(K.check("Add transparency", g.transp, function (v) { g.transp = v; drawBar(); }));
      noiseBox.appendChild(K.btn("Randomize", function () { g.seed = Math.floor(Math.random() * 1e6) + 1; drawBar(); }, "ghost"));
    }
    function redraw() {
      var noise = g.kind === "noise";
      noiseBox.hidden = !noise; arow.hidden = crow.hidden = fields.hidden = noise;
      if (noise) { drawNoise(); solidBox.insertBefore(bar, arow); } else { rows(); drawFields(); }
      drawBar();
    }
    var body = h("div", { "class": "stack pp-gedit" }, [h("div", { "class": "faint pe-p", text: "Presets" }), presets, h("div", { "class": "row" }, [K.field("Name", name), kindSeg]), solidBox, noiseBox]);
    var save = K.btn("Save as preset", function () {
      var p = cleanG(PE.clone(g)); p.id = PE.uid("g");
      USER.push(p); PP.lib.put(Object.assign({}, p, { kind: "gradient", gkind: p.kind, order: Date.now() })).catch(function () {}); drawPresets(); S3.toast("Saved “" + p.name + "”");
    }, "ghost");
    var dlg = K.modal("Gradient editor", body, [save, h("span", { "class": "grow" }), K.btn("Cancel", function () { dlg.close(); }, "ghost"), K.btn("OK", function () { dlg.close(); setGradient(g); }, "primary")], true);
    drawPresets(); redraw();
    return { get: function () { return g; }, set: function (x) { g = cleanG(x); redraw(); }, close: dlg.close };
  }
  PP.gradientEditor = editor;

  // ---------- Gradients tab ----------
  PP.panelTab("gradients", "Gradients", function (el) {
    var grid = h("div", { "class": "pp-ggrid" });
    BUILTIN.concat(USER).forEach(function (g) {
      var on = o.g && o.g.name === g.name;
      var b = h("button", { type: "button", "class": "pp-gpre" + (on ? " on" : ""), title: g.name + (g.id.indexOf("b:") === 0 ? "" : " (Alt+click deletes)"), "aria-label": g.name }, [thumb(g, 60, 18)]);
      b.addEventListener("click", function (e) {
        if (e.altKey && g.id.indexOf("b:") !== 0) { USER = USER.filter(function (x) { return x !== g; }); PP.lib.del(g.id).catch(function () {}); PP.refreshPanel("gradients"); return; }
        setGradient(g); if (ED.doc) ED.setTool("gradient");
      });
      grid.appendChild(b);
    });
    el.appendChild(grid);
    el.appendChild(h("div", { "class": "pp-acts" }, [K.btn("Edit…", function () { if (ED.doc) ED.setTool("gradient"); editor(); }, "ghost")]));
  });
})();
