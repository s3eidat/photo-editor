/* Adjust lane: the Develop panel (raw-style controls in sections, colour wheels, presets). Maths in develop.js. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, AUI = PE.adjUI, h = S3.h, $ = S3.$;
  function kit() { return ED.adjKit; }
  var DEF = PIX.A.devDefaults();
  var BAND_NAMES = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];
  var LOCAL_KEYS = [["Exposure", "exposure", -4, 4, 0.05], ["Contrast", "contrast", -100, 100, 1], ["Highlights", "highlights", -100, 100, 1], ["Shadows", "shadows", -100, 100, 1],
    ["Temperature", "temp", -100, 100, 1], ["Tint", "tint", -100, 100, 1], ["Saturation", "saturation", -100, 100, 1], ["Clarity", "clarity", -100, 100, 1], ["Sharpness", "sharpness", -100, 100, 1]];

  // Built-in looks (made for this app). Only the keys given change; everything else is default.
  var LOOKS = [
    ["clean", "Clean and bright", { exposure: 0.25, contrast: 12, highlights: -30, shadows: 25, whites: 10, blacks: -6, clarity: 8, vibrance: 18 }],
    ["punchy", "Punchy landscape", { contrast: 25, highlights: -45, shadows: 30, clarity: 25, dehaze: 15, vibrance: 35, saturation: 5, sharpen: 40 }],
    ["warmfilm", "Warm film", { temp: 18, tint: 4, contrast: -10, blacks: 18, tcShadow: 12, tcHigh: -10, saturation: -12, cgShadow: [200, 14, 0], cgHigh: [40, 20, 0], grain: 22, grainSize: 30 }],
    ["coolmatte", "Cool matte", { temp: -14, contrast: -18, blacks: 25, whites: -10, saturation: -18, cgShadow: [210, 22, 0], cgMid: [190, 8, 0], vignette: -12 }],
    ["moody", "Moody", { exposure: -0.3, contrast: 22, highlights: -40, shadows: -10, clarity: 18, vibrance: -10, saturation: -15, cgShadow: [215, 25, -5], cgHigh: [35, 12, 0], vignette: -30 }],
    ["portrait", "Soft portrait", { exposure: 0.15, contrast: -6, highlights: -20, shadows: 15, texture: -20, clarity: -10, vibrance: 10, hslL: [0, 12, 0, 0, 0, 0, 0, 0], hslS: [0, -8, 0, 0, 0, 0, 0, 0] }],
    ["faded", "Faded", { contrast: -25, blacks: 35, tcHigh: -18, saturation: -25, grain: 12 }],
    ["mono", "Black and white, high contrast", { saturation: -100, contrast: 35, clarity: 20, whites: 15, blacks: -15, grain: 15 }],
    ["monosoft", "Black and white, soft", { saturation: -100, contrast: -10, blacks: 20, highlights: -20, cgGlobal: [35, 8, 0] }]
  ];
  function userPresets() { var u = S3.store("pe-dev-presets"); return Array.isArray(u) ? u.filter(function (x) { return x && typeof x.name === "string" && x.p && typeof x.p === "object"; }) : []; }
  function cleanParams(src) {        // only known keys, numbers clamped by the maths anyway
    var out = PIX.A.devDefaults();
    Object.keys(out).forEach(function (k) {
      var v = src[k];
      if (k === "locals") {
        if (Array.isArray(v)) out.locals = v.slice(0, 12).filter(function (L) { return L && typeof L === "object"; }).map(function (L) {
          var o = { type: ["linear", "brush"].indexOf(L.type) >= 0 ? L.type : "radial", invert: !!L.invert };
          if (o.type === "brush") o.strokes = (Array.isArray(L.strokes) ? L.strokes : []).slice(0, 400).map(function (k) { return { r: +k.r || 5, hard: +k.hard || 0, flow: +k.flow || 1, erase: !!k.erase, pts: (Array.isArray(k.pts) ? k.pts : []).slice(0, 16000).map(Number).filter(isFinite) }; });
          ["x0", "y0", "x1", "y1", "cx", "cy", "rx", "ry", "rotation", "feather"].concat(LOCAL_KEYS.map(function (q) { return q[1]; })).forEach(function (q) { if (isFinite(+L[q]) && L[q] !== null && L[q] !== "") o[q] = +L[q]; });
          return o;
        });
      }
      else if (k === "localShow") out.localShow = null;
      else if (k === "curve") { if (v && typeof v === "object") ["rgb", "r", "g", "b"].forEach(function (c) { var a = v[c]; if (Array.isArray(a) && a.length >= 2 && a.length <= 16) out.curve[c] = a.map(function (q) { return [Math.max(0, Math.min(255, Math.round(+q[0] || 0))), Math.max(0, Math.min(255, Math.round(+q[1] || 0)))]; }); }); }
      else if (Array.isArray(out[k])) { if (Array.isArray(v)) out[k] = out[k].map(function (d0, i) { var x = +v[i]; return isFinite(x) ? x : d0; }); }
      else if (isFinite(+v) && v !== null && v !== "") out[k] = +v;
    });
    return out;
  }
  AUI.devClean = cleanParams;

  // ---------- colour wheel (hue around, saturation outwards) ----------
  var wheelImg = null;
  function wheelBitmap(S) {
    if (wheelImg && wheelImg.width === S) return wheelImg;
    var c = PE.mk(S, S), x = c.getContext("2d"), id = x.createImageData(S, S), r0 = S / 2;
    for (var y = 0; y < S; y++) for (var xx = 0; xx < S; xx++) {
      var dx = xx + 0.5 - r0, dy = y + 0.5 - r0, r = Math.sqrt(dx * dx + dy * dy) / (r0 - 1), i = (y * S + xx) * 4;
      if (r > 1) continue;
      var hue = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360, c3 = PIX.hsl2rgb(hue, r, 0.5);
      id.data[i] = c3[0]; id.data[i + 1] = c3[1]; id.data[i + 2] = c3[2]; id.data[i + 3] = 255 * Math.min(1, (1 - r) * r0);
    }
    x.putImageData(id, 0, 0); wheelImg = c; return c;
  }
  AUI.wheel = function (get, set, label) {
    var S = 150, c = h("canvas", { "class": "pe-acv pe-awheel", width: String(S), height: String(S), role: "slider", tabindex: "0", "aria-label": label + " (drag to pick hue and amount, double-click to reset)" }), x = c.getContext("2d");
    function draw() {
      x.clearRect(0, 0, S, S); x.drawImage(wheelBitmap(S), 0, 0);
      var v = get(), a = v[0] * Math.PI / 180, r = v[1] / 100 * (S / 2 - 1), px = S / 2 + Math.cos(a) * r, py = S / 2 - Math.sin(a) * r;
      x.beginPath(); x.arc(px, py, 6, 0, Math.PI * 2); x.lineWidth = 2.5; x.strokeStyle = "#fff"; x.stroke(); x.lineWidth = 1; x.strokeStyle = "#000"; x.stroke();
      c.setAttribute("aria-valuetext", "hue " + Math.round(v[0]) + "°, amount " + Math.round(v[1]) + "%");
    }
    function at(e) {
      var b = c.getBoundingClientRect(), dx = (e.clientX - b.left) / b.width * S - S / 2, dy = (e.clientY - b.top) / b.height * S - S / 2;
      var hue = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360, s = Math.min(100, Math.sqrt(dx * dx + dy * dy) / (S / 2 - 1) * 100);
      set(Math.round(hue), Math.round(s)); draw();
    }
    var drag = false;
    c.addEventListener("pointerdown", function (e) { drag = true; c.setPointerCapture(e.pointerId); at(e); });
    c.addEventListener("pointermove", function (e) { if (drag) at(e); });
    c.addEventListener("pointerup", function () { drag = false; });
    c.addEventListener("dblclick", function () { set(0, 0); draw(); });
    c.addEventListener("keydown", function (e) {
      var v = get(), st = e.shiftKey ? 10 : 2;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); set((v[0] + (e.key === "ArrowLeft" ? st : -st) + 360) % 360, v[1]); draw(); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); set(v[0], Math.max(0, Math.min(100, v[1] + (e.key === "ArrowUp" ? st : -st)))); draw(); }
    });
    draw(); c._draw = draw;
    return c;
  };

  // ---------- the panel ----------
  AUI.adj("develop", { t: "Develop", proxy: true, previewOnly: ["localShow"], ui: function (el, st) {
    var p = st.p, K = kit(), open = { basic: true };
    Object.assign(p, PIX.A.devDefaults());
    AUI.wide();
    function build() {
      el.textContent = "";
      el.appendChild(presetRow());
      sec("basic", "Basic", function (b) {
        var wbB = K.btn("Pick neutral", function () {
          AUI.pick(function (pt) {
            var im = st.t.img, x0 = Math.floor(pt.x - st.t.r.x), y0 = Math.floor(pt.y - st.t.r.y), s3 = [0, 0, 0], c = 0;
            for (var yy = y0 - 2; yy <= y0 + 2; yy++) for (var xx = x0 - 2; xx <= x0 + 2; xx++) { if (xx < 0 || yy < 0 || xx >= im.width || yy >= im.height) continue; var j = (yy * im.width + xx) * 4; s3[0] += im.data[j]; s3[1] += im.data[j + 1]; s3[2] += im.data[j + 2]; c++; }
            if (!c) return;
            var wb = PIX.A.devNeutral(s3[0] / c, s3[1] / c, s3[2] / c); p.temp = wb.temp; p.tint = wb.tint; build(); st.schedule();
          }, wbB);
        }, "ghost", null, "Click something that should be neutral grey or white");
        wbB.setAttribute("aria-pressed", "false"); wbB.classList.add("pe-apick");
        var autoB = K.btn("Auto", function () { Object.assign(p, PIX.A.devAuto((st.src || st.t.img), null)); build(); st.schedule(); }, "ghost", null, "Suggested exposure, contrast, highlights, shadows, whites and blacks");
        b.appendChild(h("div", { "class": "row pe-arow" }, [wbB, autoB]));
        b.appendChild(group("White balance")); rng(b, "Temperature", "temp", -100, 100, 1); rng(b, "Tint", "tint", -100, 100, 1);
        b.appendChild(group("Tone")); rng(b, "Exposure", "exposure", -5, 5, 0.05, function (v) { return (v > 0 ? "+" : "") + v.toFixed(2) + " EV"; });
        ["Contrast:contrast", "Highlights:highlights", "Shadows:shadows", "Whites:whites", "Blacks:blacks"].forEach(function (s) { var a = s.split(":"); rng(b, a[0], a[1], -100, 100, 1); });
        b.appendChild(group("Presence"));
        ["Texture:texture", "Clarity:clarity", "Dehaze:dehaze", "Vibrance:vibrance", "Saturation:saturation"].forEach(function (s) { var a = s.split(":"); rng(b, a[0], a[1], -100, 100, 1); });
      });
      sec("curve", "Tone curve", function (b) {
        b.appendChild(group("Regions"));
        [["Highlights", "tcHigh"], ["Lights", "tcLight"], ["Darks", "tcDark"], ["Shadows", "tcShadow"]].forEach(function (a) { rng(b, a[0], a[1], -100, 100, 1); });
        b.appendChild(group("Point curve"));
        AUI.curveEditor(b, p.curve, function () { st.schedule(); }, (st.src || st.t.img));
      });
      sec("mixer", "Colour mixer", function (b) {
        var which = st.devMix || "hslH", box = h("div", { "class": "stack pe-asecin" });
        b.appendChild(K.seg("", [["hslH", "Hue"], ["hslS", "Saturation"], ["hslL", "Luminance"]], which, function (v) { st.devMix = v; which = v; fill(); }));
        b.appendChild(box);
        function fill() { box.textContent = ""; BAND_NAMES.forEach(function (nm, i) { rngA(box, nm, which, i, -100, 100); }); }
        fill();
      });
      sec("grade", "Colour grading", function (b) {
        var zone = st.devZone || "cgShadow", wrap = h("div", { "class": "stack pe-asecin" });
        b.appendChild(K.seg("", [["cgShadow", "Shadows"], ["cgMid", "Midtones"], ["cgHigh", "Highlights"], ["cgGlobal", "Global"]], zone, function (v) { st.devZone = v; zone = v; fill(); }));
        b.appendChild(wrap);
        function fill() {
          wrap.textContent = "";
          var hueR, satR;
          var wh = AUI.wheel(function () { return p[zone]; }, function (hh, s) { p[zone][0] = hh; p[zone][1] = s; hueR._set(hh); satR._set(s); st.schedule(); }, "Colour wheel");
          wrap.appendChild(h("div", { "class": "pe-awheelbox" }, [wh]));
          hueR = rngA(wrap, "Hue", zone, 0, 0, 359, function () { wh._draw(); }); satR = rngA(wrap, "Amount", zone, 1, 0, 100, function () { wh._draw(); }); rngA(wrap, "Luminance", zone, 2, -100, 100);
        }
        fill();
        rng(b, "Blending", "cgBlend", 0, 100, 1); rng(b, "Balance", "cgBalance", -100, 100, 1);
      });
      sec("local", "Local adjustments", function (b) {
        var K2 = K, list = p.locals, cur = st.devLocal == null ? list.length - 1 : st.devLocal;
        if (cur >= list.length) cur = list.length - 1;
        st.devLocal = cur;
        function add(type) {
          list.push(type === "linear" ? { type: "linear", x0: 50, y0: 25, x1: 50, y1: 60, exposure: 0 } : type === "brush" ? { type: "brush", strokes: [], exposure: 0 } : { type: "radial", cx: 50, cy: 50, rx: 25, ry: 25, rotation: 0, feather: 50, exposure: 0 });
          st.devLocal = list.length - 1; open.local = true; build(); st.schedule();
        }
        b.appendChild(h("div", { "class": "row pe-arow" }, [K2.btn("Linear gradient", function () { add("linear"); }, "ghost", "i-plus", "Add a linear gradient mask: drag its start and end on the image"),
          K2.btn("Radial", function () { add("radial"); }, "ghost", "i-plus", "Add an elliptical mask: drag its centre and edges on the image"),
          K2.btn("Brush", function () { add("brush"); }, "ghost", "i-plus", "Paint a mask on the image (Alt erases)")]));
        if (!list.length) { b.appendChild(h("p", { "class": "faint pe-p", text: "Add a gradient to adjust part of the image; its handles appear on the canvas." })); return; }
        b.appendChild(h("div", { "class": "row pe-arow" }, [K2.select("Edit", list.map(function (L, i) { return [String(i), (i + 1) + ". " + (L.type === "linear" ? "Linear gradient" : L.type === "brush" ? "Brush" : "Radial")]; }), String(cur), function (v) { st.devLocal = +v; if (p.localShow != null) p.localShow = +v; build(); st.schedule(); }),
          K2.btn("", function () { list.splice(cur, 1); st.devLocal = list.length - 1; p.localShow = null; build(); st.schedule(); }, "ghost icon", "i-trash", "Delete this local adjustment")]));
        var L0 = list[cur];
        LOCAL_KEYS.forEach(function (k) {
          var r = K2.range(k[0], L0[k[1]] || 0, k[2], k[3], k[4], function (v) { L0[k[1]] = v; st.schedule(); }, fmtOf(k[4]));
          r.querySelector("input").addEventListener("dblclick", function () { L0[k[1]] = 0; r._set(0); st.schedule(); });
          b.appendChild(r);
        });
        if (L0.type === "radial") { var fr = K2.range("Feather", L0.feather == null ? 50 : L0.feather, 0, 100, 1, function (v) { L0.feather = v; st.schedule(); }); b.appendChild(fr); }
        if (L0.type === "brush") {
          var bs = st.devBrush = st.devBrush || { r: 5, feather: 50, flow: 100, erase: false };
          b.appendChild(group("Brush"));
          b.appendChild(K2.range("Size", bs.r, 0.5, 40, 0.5, function (v) { bs.r = v; }, function (v) { return v + "%"; }));
          b.appendChild(K2.range("Feather", bs.feather, 0, 100, 1, function (v) { bs.feather = v; }));
          b.appendChild(K2.range("Flow", bs.flow, 1, 100, 1, function (v) { bs.flow = v; }));
          b.appendChild(h("div", { "class": "row pe-arow" }, [K2.seg("", [["paint", "Paint"], ["erase", "Erase"]], bs.erase ? "erase" : "paint", function (v) { bs.erase = v === "erase"; }),
            K2.btn("Clear", function () { L0.strokes = []; st.schedule(); if (st.devStrokeInfo) st.devStrokeInfo(); }, "ghost small")]));
          var info = h("p", { "class": "faint pe-p" }); st.devStrokeInfo = function () { info.textContent = "Paint on the image; hold Alt to erase. Strokes: " + (L0.strokes || []).length + "."; }; st.devStrokeInfo();
          b.appendChild(info);
        }
        b.appendChild(h("div", { "class": "row pe-arow" }, [K2.check("Invert", !!L0.invert, function (v) { L0.invert = v; st.schedule(); }),
          K2.check("Show mask", p.localShow === cur, function (v) { p.localShow = v ? cur : null; st.schedule(); })]));
      });
      sec("detail", "Detail", function (b) {
        b.appendChild(group("Sharpening")); rng(b, "Amount", "sharpen", 0, 150, 1); rng(b, "Radius", "sharpRadius", 0.5, 3, 0.1, function (v) { return v.toFixed(1) + " px"; });
        rng(b, "Detail", "sharpDetail", 0, 100, 1); rng(b, "Masking", "sharpMask", 0, 100, 1);
        b.appendChild(group("Noise reduction")); rng(b, "Luminance", "nrLum", 0, 100, 1); rng(b, "Colour", "nrColor", 0, 100, 1);
      });
      sec("lens", "Lens", function (b) {
        rng(b, "Distortion (− barrel, + pincushion)", "distort", -100, 100, 1);
        b.appendChild(group("Colour fringes")); rng(b, "Red / cyan", "caRed", -100, 100, 1); rng(b, "Blue / yellow", "caBlue", -100, 100, 1);
        b.appendChild(group("Defringe")); rng(b, "Purple amount", "defringePurple", 0, 100, 1); rng(b, "Green amount", "defringeGreen", 0, 100, 1);
        b.appendChild(group("Vignette")); rng(b, "Amount", "vignette", -100, 100, 1); rng(b, "Midpoint", "vigMid", 0, 100, 1); rng(b, "Roundness", "vigRound", -100, 100, 1); rng(b, "Feather", "vigFeather", 0, 100, 1);
      });
      sec("calib", "Calibration", function (b) {
        rng(b, "Shadows tint (− green, + magenta)", "shadowTint", -100, 100, 1);
        [["Red primary", "calRed"], ["Green primary", "calGreen"], ["Blue primary", "calBlue"]].forEach(function (a) { b.appendChild(group(a[0])); rng(b, "Hue", a[1] + "H", -100, 100, 1); rng(b, "Saturation", a[1] + "S", -100, 100, 1); });
      });
      sec("effects", "Effects", function (b) { rng(b, "Grain amount", "grain", 0, 100, 1); rng(b, "Grain size", "grainSize", 0, 100, 1); rng(b, "Roughness", "grainRough", 0, 100, 1); });
      el.appendChild(h("p", { "class": "faint pe-p", text: "Double-click a slider to reset it." }));
    }
    function group(t) { return h("h4", { "class": "pe-agroup", text: t }); }
    function sec(id, title, fill) {
      var b = h("div", { "class": "pe-fbody pe-asecbody" }), d = h("details", { "class": "pe-asec" }, [h("summary", { text: title }), b]);
      if (open[id]) d.open = true;
      d.addEventListener("toggle", function () { open[id] = d.open; });
      fill(b); el.appendChild(d);
    }
    function fmtOf(step) { return function (v) { return step < 1 ? String(Math.round(v * 100) / 100) : (v > 0 ? "+" : "") + v; }; }
    function rng(box, label, key, min, max, step, fmt) {
      var r = K.range(label, p[key], min, max, step, function (v) { p[key] = v; st.schedule(); }, fmt || fmtOf(step));
      r.querySelector("input").addEventListener("dblclick", function () { p[key] = DEF[key]; r._set(DEF[key]); st.schedule(); });
      box.appendChild(r); return r;
    }
    function rngA(box, label, key, idx, min, max, after) {
      var r = K.range(label, p[key][idx], min, max, 1, function (v) { p[key][idx] = v; if (after) after(); st.schedule(); }, fmtOf(1));
      r.querySelector("input").addEventListener("dblclick", function () { p[key][idx] = DEF[key][idx]; r._set(DEF[key][idx]); if (after) after(); st.schedule(); });
      box.appendChild(r); return r;
    }
    function presetRow() {
      var opts = [["", "Presets…"]].concat(LOOKS.map(function (l) { return ["b:" + l[0], l[1]]; })).concat(userPresets().map(function (u, i) { return ["u:" + i, "★ " + u.name]; }));
      var sel = K.select("", opts, "", function (v) {
        if (!v) return;
        var src = v.charAt(0) === "b" ? LOOKS.filter(function (l) { return "b:" + l[0] === v; })[0][2] : userPresets()[+v.slice(2)].p;
        Object.assign(p, cleanParams(Object.assign(PIX.A.devDefaults(), JSON.parse(JSON.stringify(src)))));
        build(); st.schedule();
      });
      var save = K.btn("Save", function () {
        var name = (window.prompt("Name this preset", "My look") || "").trim().slice(0, 40); if (!name) return;
        var list = userPresets().filter(function (u) { return u.name !== name; }); list.push({ name: name, p: cleanParams(p) }); S3.store("pe-dev-presets", list.slice(-40));
        S3.toast("Preset “" + name + "” saved in this browser"); build();
      }, "ghost", "i-plus", "Save these settings as a preset (kept in this browser)");
      var del = K.btn("", function () {
        var list = userPresets(); if (!list.length) { S3.toast("No saved presets yet"); return; }
        var name = (window.prompt("Delete which preset? (" + list.map(function (u) { return u.name; }).join(", ") + ")", list[list.length - 1].name) || "").trim();
        var keep = list.filter(function (u) { return u.name !== name; }); if (keep.length === list.length) return;
        S3.store("pe-dev-presets", keep); build();
      }, "ghost icon", "i-trash", "Delete a saved preset");
      return h("div", { "class": "row pe-arow pe-apresets" }, [sel, save, del]);
    }
    build();
    AUI.handles(st, function () { return localHandles(st); });
  } });
  // on-canvas handles of the local adjustment being edited
  function localHandles(st) {
    var model = { handles: [] };
    function L() { var list = st.p.locals || []; return st.devLocal != null && list[st.devLocal] ? list[st.devLocal] : null; }
    function pctMove(o, kx, ky) { return function (a, d) { var q = a.toPct(d.x, d.y); o[kx] = Math.round(q.x * 10) / 10; o[ky] = Math.round(q.y * 10) / 10; st.schedule(); }; }
    function ln(ctx, p0, p1, dash) { ctx.save(); if (dash) ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.restore(); }
    var stroke = null;
    model.paint = {
      active: function () { var o = L(); return !!(o && o.type === "brush"); },
      down: function (a, d, e) {
        var o = L(), bs = st.devBrush || { r: 5, feather: 50, flow: 100, erase: false }, q = a.toPct(d.x, d.y);
        stroke = { r: bs.r, hard: 1 - bs.feather / 100, flow: bs.flow / 100, erase: bs.erase || e.altKey, pts: [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100] };
        (o.strokes = o.strokes || []).push(stroke); st.schedule();
      },
      move: function (a, d) {
        if (!stroke) return; var q = a.toPct(d.x, d.y), P = stroke.pts, lx = P[P.length - 2], ly = P[P.length - 1];
        if (Math.hypot(q.x - lx, q.y - ly) < 0.3 || P.length > 8000) return;
        P.push(Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100); st.schedule();
      },
      up: function () { stroke = null; st.schedule(); if (st.devStrokeInfo) st.devStrokeInfo(); }
    };
    model.draw = function (ctx, a) {
      var o = L(); model.handles = [];
      if (!o) return;
      if (o.type === "brush") {
        if (a.cursor) { var bs = st.devBrush || { r: 5, feather: 50 }, rr = bs.r / 100 * Math.min(a.r.w, a.r.h) * a.zoom(); ctx.beginPath(); ctx.arc(a.cursor.x, a.cursor.y, Math.max(2, rr), 0, Math.PI * 2); ctx.stroke(); ctx.save(); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(a.cursor.x, a.cursor.y, Math.max(1, rr * (1 - bs.feather / 100)), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
        return;
      }
      if (o.type === "linear") {
        var s0 = a.toDoc(o.x0, o.y0), s1 = a.toDoc(o.x1, o.y1), dx = s1.x - s0.x, dy = s1.y - s0.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, Lx = Math.hypot(a.r.w, a.r.h);
        [[s0, false], [s1, false], [{ x: (s0.x + s1.x) / 2, y: (s0.y + s1.y) / 2 }, true]].forEach(function (z) { var c = z[0], A0 = a.scr(c.x - nx * Lx, c.y - ny * Lx), B0 = a.scr(c.x + nx * Lx, c.y + ny * Lx); ln(ctx, A0, B0, z[1]); });
        model.handles = [{ big: true, at: function () { return a.scr(s0.x, s0.y); }, move: pctMove(o, "x0", "y0") }, { big: true, at: function () { return a.scr(s1.x, s1.y); }, move: pctMove(o, "x1", "y1") }];
      } else {
        var c0 = a.toDoc(o.cx, o.cy), rx = o.rx / 100 * a.r.w, ry = o.ry / 100 * a.r.h, rot = (o.rotation || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot), z = a.zoom(), sc0 = a.scr(c0.x, c0.y), fe = (o.feather == null ? 50 : o.feather) / 100;
        ctx.beginPath(); ctx.ellipse(sc0.x, sc0.y, Math.max(1, rx * z), Math.max(1, ry * z), rot, 0, Math.PI * 2); ctx.stroke();
        ctx.save(); ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.ellipse(sc0.x, sc0.y, Math.max(1, rx * z * (1 - fe)), Math.max(1, ry * z * (1 - fe)), rot, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        function pt(u, v) { return { x: c0.x + u * cr - v * sr, y: c0.y + u * sr + v * cr }; }
        function loc(d) { var ex = d.x - c0.x, ey = d.y - c0.y; return { u: ex * cr + ey * sr, v: -ex * sr + ey * cr }; }
        model.handles = [{ big: true, at: function () { return sc0; }, move: pctMove(o, "cx", "cy") },
          { at: function () { var q = pt(rx, 0); return a.scr(q.x, q.y); }, move: function (a2, d) { o.rx = Math.max(1, Math.round(Math.abs(loc(d).u) / a.r.w * 1000) / 10); st.schedule(); } },
          { at: function () { var q = pt(0, ry); return a.scr(q.x, q.y); }, move: function (a2, d) { o.ry = Math.max(1, Math.round(Math.abs(loc(d).v) / a.r.h * 1000) / 10); st.schedule(); } },
          { at: function () { var q = pt(rx * 0.7071 + 14 / z, -ry * 0.7071 - 14 / z); return a.scr(q.x, q.y); }, move: function (a2, d) { var ang = Math.atan2(d.y - c0.y, d.x - c0.x) + Math.atan2(ry, rx); o.rotation = Math.round(((ang * 180 / Math.PI + 540) % 360) - 180); st.schedule(); } }];
      }
    };
    return model;
  }
  AUI.addMenu("Filter", [["Develop…", "Ctrl+Shift+A", function () { AUI.open("develop"); }, AUI.has], "-"], "Gaussian blur");
  AUI.key("Ctrl+Shift+A", function () { AUI.open("develop"); });
})();
