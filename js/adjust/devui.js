/* Adjust lane: the Develop panel (raw-style controls in sections, colour wheels, presets). Maths in develop.js. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, AUI = PE.adjUI, h = S3.h, $ = S3.$;
  function kit() { return ED.adjKit; }
  var DEF = PIX.A.devDefaults();
  var BAND_NAMES = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];

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
      if (k === "curve") { if (v && typeof v === "object") ["rgb", "r", "g", "b"].forEach(function (c) { var a = v[c]; if (Array.isArray(a) && a.length >= 2 && a.length <= 16) out.curve[c] = a.map(function (q) { return [Math.max(0, Math.min(255, Math.round(+q[0] || 0))), Math.max(0, Math.min(255, Math.round(+q[1] || 0)))]; }); }); }
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
  AUI.adj("develop", { t: "Develop", proxy: true, ui: function (el, st) {
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
        var autoB = K.btn("Auto", function () { Object.assign(p, PIX.A.devAuto(st.src, null)); build(); st.schedule(); }, "ghost", null, "Suggested exposure, contrast, highlights, shadows, whites and blacks");
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
        AUI.curveEditor(b, p.curve, function () { st.schedule(); }, st.src);
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
      sec("detail", "Detail", function (b) {
        b.appendChild(group("Sharpening")); rng(b, "Amount", "sharpen", 0, 150, 1); rng(b, "Radius", "sharpRadius", 0.5, 3, 0.1, function (v) { return v.toFixed(1) + " px"; });
        rng(b, "Detail", "sharpDetail", 0, 100, 1); rng(b, "Masking", "sharpMask", 0, 100, 1);
        b.appendChild(group("Noise reduction")); rng(b, "Luminance", "nrLum", 0, 100, 1); rng(b, "Colour", "nrColor", 0, 100, 1);
      });
      sec("lens", "Lens", function (b) {
        rng(b, "Distortion (− barrel, + pincushion)", "distort", -100, 100, 1);
        b.appendChild(group("Colour fringes")); rng(b, "Red / cyan", "caRed", -100, 100, 1); rng(b, "Blue / yellow", "caBlue", -100, 100, 1);
        b.appendChild(group("Vignette")); rng(b, "Amount", "vignette", -100, 100, 1); rng(b, "Midpoint", "vigMid", 0, 100, 1); rng(b, "Roundness", "vigRound", -100, 100, 1); rng(b, "Feather", "vigFeather", 0, 100, 1);
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
  } });
  AUI.addMenu("Filter", [["Develop…", "Ctrl+Shift+A", function () { AUI.open("develop"); }, AUI.has], "-"], "Gaussian blur");
  AUI.key("Ctrl+Shift+A", function () { AUI.open("develop"); });
})();
