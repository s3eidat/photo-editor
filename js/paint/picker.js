/* Photo Editor paint lane: colour picker for the foreground / background colours.
   A colour field + slider for any channel (H, S, B, R, G, B, L, a, b), numeric HSB / RGB / Lab / CMYK / hex,
   only-web-colours, new vs current swatch, add to swatches. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, h = S3.h, clamp = PE.clamp;
  var CH = [["h", "H", "Hue (°)"], ["s", "S", "Saturation (%)"], ["v", "B", "Brightness (%)"], ["r", "R", "Red"], ["g", "G", "Green"], ["b", "B", "Blue"], ["L", "L", "Lightness (Lab)"], ["A", "a", "a (green–red)"], ["B", "b", "b (blue–yellow)"]];
  // For each channel: the slider range and which two channels the field shows (x, y).
  var MODE = { h: { min: 0, max: 360, x: "s", y: "v" }, s: { min: 0, max: 100, x: "h", y: "v" }, v: { min: 0, max: 100, x: "h", y: "s" },
    r: { min: 0, max: 255, x: "b", y: "g" }, g: { min: 0, max: 255, x: "b", y: "r" }, b: { min: 0, max: 255, x: "r", y: "g" },
    L: { min: 0, max: 100, x: "A", y: "B" }, A: { min: -128, max: 127, x: "B", y: "L" }, B: { min: -128, max: 127, x: "A", y: "L" } };
  var RANGE = { h: [0, 360], s: [0, 100], v: [0, 100], r: [0, 255], g: [0, 255], b: [0, 255], L: [0, 100], A: [-128, 127], B: [-128, 127] };
  function space(k) { return "hsv".indexOf(k) >= 0 ? "hsb" : "rgb".indexOf(k) >= 0 ? "rgb" : "lab"; }

  // The colour state keeps every model so hue survives greys and Lab edits stay exact.
  function State(hex) { this.set("rgb", PE.rgbOf(hex)); }
  State.prototype.set = function (sp, v) {
    if (sp === "rgb") { this.rgb = v.slice(); this.hsb = PPX.rgb2hsb(v[0], v[1], v[2]); this.lab = PPX.rgb2lab(v[0], v[1], v[2]); }
    else if (sp === "hsb") { this.hsb = v.slice(); this.rgb = PPX.hsb2rgb(v[0], v[1], v[2]); this.lab = PPX.rgb2lab(this.rgb[0], this.rgb[1], this.rgb[2]); }
    else { this.lab = v.slice(); this.rgb = PPX.lab2rgbRaw(v[0], v[1], v[2]).map(function (x) { return clamp(x, 0, 255); }); this.hsb = PPX.rgb2hsb(this.rgb[0], this.rgb[1], this.rgb[2]); }
    if (this.hsb[1] < 1e-6 && this.keepH != null) this.hsb[0] = this.keepH;
    this.keepH = this.hsb[0];
  };
  State.prototype.get = function (k) { var sp = space(k), i = sp === "hsb" ? "hsv".indexOf(k) : sp === "rgb" ? "rgb".indexOf(k) : "LAB".indexOf(k); return this[sp][i]; };
  State.prototype.put = function (k, val) { var sp = space(k), arr = this[sp].slice(), i = sp === "hsb" ? "hsv".indexOf(k) : sp === "rgb" ? "rgb".indexOf(k) : "LAB".indexOf(k); arr[i] = clamp(val, RANGE[k][0], RANGE[k][1]); this.set(sp, arr); };
  State.prototype.hex = function () { return PE.toHex(this.rgb[0], this.rgb[1], this.rgb[2]); };
  // rgb of a hypothetical colour with channel values given (others from the state)
  function rgbWith(st, vals) {
    var sp = space(Object.keys(vals)[0]), base = st[sp].slice();
    Object.keys(vals).forEach(function (k) { base[sp === "hsb" ? "hsv".indexOf(k) : sp === "rgb" ? "rgb".indexOf(k) : "LAB".indexOf(k)] = vals[k]; });
    if (sp === "rgb") return base;
    if (sp === "hsb") return PPX.hsb2rgb(base[0], base[1], base[2]);
    return PPX.lab2rgbRaw(base[0], base[1], base[2]);
  }

  var FS = 256;
  function drawField(cv, st, ch) {
    var m = MODE[ch], x = cv.getContext("2d"), im = x.createImageData(FS, FS), d = im.data, rx = RANGE[m.x], ry = RANGE[m.y], v = {};
    for (var j = 0; j < FS; j++) for (var i = 0; i < FS; i++) {
      v = {}; v[m.x] = rx[0] + (rx[1] - rx[0]) * i / (FS - 1); v[m.y] = ry[1] - (ry[1] - ry[0]) * j / (FS - 1);
      var c = rgbWith(st, v), q = (j * FS + i) * 4, out = space(ch) === "lab" && !PPX.inGamut(c);
      d[q] = out ? 128 : c[0]; d[q + 1] = out ? 128 : c[1]; d[q + 2] = out ? 128 : c[2]; d[q + 3] = out ? 60 : 255;
    }
    x.putImageData(im, 0, 0);
    var px = (st.get(m.x) - rx[0]) / (rx[1] - rx[0]) * (FS - 1), py = (ry[1] - st.get(m.y)) / (ry[1] - ry[0]) * (FS - 1);
    x.beginPath(); x.arc(px, py, 6, 0, Math.PI * 2); x.lineWidth = 2; x.strokeStyle = "#fff"; x.stroke(); x.beginPath(); x.arc(px, py, 7.5, 0, Math.PI * 2); x.lineWidth = 1; x.strokeStyle = "#000"; x.stroke();
  }
  function drawSlider(cv, st, ch) {
    var x = cv.getContext("2d"), r = RANGE[ch], im = x.createImageData(1, FS);
    for (var j = 0; j < FS; j++) {
      var v = {}; v[ch] = r[1] - (r[1] - r[0]) * j / (FS - 1);
      if (ch === "h") v = { h: v.h, s: 100, v: 100 };
      var c = rgbWith(st, v), q = j * 4; im.data[q] = c[0]; im.data[q + 1] = c[1]; im.data[q + 2] = c[2]; im.data[q + 3] = 255;
    }
    var t = PE.mk(1, FS); PE.cx2(t).putImageData(im, 0, 0);
    x.imageSmoothingEnabled = false; x.clearRect(0, 0, cv.width, cv.height); x.drawImage(t, 4, 0, cv.width - 8, FS);
    var y = (r[1] - st.get(ch)) / (r[1] - r[0]) * (FS - 1);
    x.fillStyle = "#fff"; x.strokeStyle = "#000"; x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, y - 5); x.lineTo(5, y); x.lineTo(0, y + 5); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(cv.width, y - 5); x.lineTo(cv.width - 5, y); x.lineTo(cv.width, y + 5); x.closePath(); x.fill(); x.stroke();
  }

  // Open the picker. which: "fg" | "bg", or opts {color, title, onPick(hex)} for any colour.
  PP.pickColor = function (which, opts) {
    opts = opts || {};
    if (!opts.color && !ED.doc) { S3.toast("Open a photo or make a new document first"); return; }
    var cur = opts.color || (which === "bg" ? ED.doc.bg : ED.doc.fg), st = new State(cur), ch = S3.store("pe-pick-ch") || "h", web = !!S3.store("pe-pick-web");
    if (!MODE[ch]) ch = "h";
    var field = h("canvas", { "class": "pp-cfield", width: String(FS), height: String(FS), "aria-label": "Colour field" });
    var slider = h("canvas", { "class": "pp-cslider", width: "26", height: String(FS), "aria-label": "Channel slider" });
    var sNew = h("span", { "class": "pp-cnew", title: "New colour" }), sCur = h("button", { type: "button", "class": "pp-ccur", title: "Current colour (click to go back to it)", "aria-label": "Current colour" });
    sCur.style.background = cur;
    var inputs = {}, radios = h("div", { "class": "pp-cnums" });
    function num(k, label, unit) {
      var r = RANGE[k], i = h("input", { type: "number", "class": "input", min: String(r[0]), max: String(r[1]), step: "1", "aria-label": label });
      i.addEventListener("input", function () { var v = +i.value; if (i.value === "" || !isFinite(v)) return; st.put(k, v); snap(); upd(k); });
      inputs[k] = i;
      var rb = h("input", { type: "radio", name: "pp-ch", value: k, "aria-label": "Show " + label + " on the slider" }); rb.checked = k === ch;
      rb.addEventListener("change", function () { ch = k; S3.store("pe-pick-ch", ch); upd(); });
      return h("label", { "class": "pp-cnum", title: label }, [rb, h("span", { text: CH.filter(function (c) { return c[0] === k; })[0][1] }), i, h("span", { "class": "faint", text: unit || "" })]);
    }
    var cmyk = ["C", "M", "Y", "K"].map(function (n, idx) {
      var i = h("input", { type: "number", "class": "input", min: "0", max: "100", step: "1", "aria-label": n + " %" });
      i.addEventListener("input", function () { var v = cmyk.map(function (x) { return +x.querySelector("input").value || 0; }); st.set("rgb", PPX.cmyk2rgb(v[0], v[1], v[2], v[3])); snap(); upd("cmyk"); });
      void idx; return h("label", { "class": "pp-cnum" }, [h("span", { text: n }), i, h("span", { "class": "faint", text: "%" })]);
    });
    var hexIn = h("input", { "class": "input mono", maxlength: "7", "aria-label": "Hex colour", spellcheck: "false" });
    hexIn.addEventListener("input", function () { var v = hexIn.value.trim(); if (!/^#/.test(v)) v = "#" + v; if (/^#[0-9a-f]{3}$/i.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; if (PE.hex(v, null)) { st.set("rgb", PE.rgbOf(v)); snap(); upd("hex"); } });
    radios.appendChild(h("div", { "class": "pp-ccol" }, [num("h", "Hue", "°"), num("s", "Saturation", "%"), num("v", "Brightness", "%")]));
    radios.appendChild(h("div", { "class": "pp-ccol" }, [num("r", "Red"), num("g", "Green"), num("b", "Blue")]));
    radios.appendChild(h("div", { "class": "pp-ccol" }, [num("L", "Lightness"), num("A", "a"), num("B", "b")]));
    radios.appendChild(h("div", { "class": "pp-ccol" }, cmyk));
    var webChk = K.check("Only web colours", web, function (v) { web = v; S3.store("pe-pick-web", v); snap(); upd(); });
    function snap() { if (web) st.set("rgb", PPX.webSafe(st.rgb)); }
    function upd(except) {
      drawField(field, st, ch); drawSlider(slider, st, ch);
      Object.keys(inputs).forEach(function (k) { if (k !== except) inputs[k].value = Math.round(st.get(k)); });
      if (except !== "cmyk") { var cm = PPX.rgb2cmyk(st.rgb[0], st.rgb[1], st.rgb[2]); cmyk.forEach(function (l, i) { l.querySelector("input").value = Math.round(cm[i]); }); }
      if (except !== "hex") hexIn.value = st.hex();
      sNew.style.background = st.hex();
    }
    function dragOn(cv, fn) {
      function at(e) { var r = cv.getBoundingClientRect(); fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)); snap(); upd(); }
      cv.addEventListener("pointerdown", function (e) { cv.setPointerCapture(e.pointerId); at(e); cv._d = true; });
      cv.addEventListener("pointermove", function (e) { if (cv._d) at(e); });
      cv.addEventListener("pointerup", function () { cv._d = false; });
    }
    dragOn(field, function (u, v) {
      var m = MODE[ch], rx = RANGE[m.x], ry = RANGE[m.y], vals = {}; vals[m.x] = rx[0] + u * (rx[1] - rx[0]); vals[m.y] = ry[1] - v * (ry[1] - ry[0]);
      var sp = space(ch), arr = st[sp].slice();
      Object.keys(vals).forEach(function (k) { arr[sp === "hsb" ? "hsv".indexOf(k) : sp === "rgb" ? "rgb".indexOf(k) : "LAB".indexOf(k)] = vals[k]; });
      if (sp === "lab") { var raw = PPX.lab2rgbRaw(arr[0], arr[1], arr[2]); if (!PPX.inGamut(raw)) return; }
      st.set(sp, arr);
    });
    dragOn(slider, function (u, v) { var r = RANGE[ch]; void u; st.put(ch, r[1] - v * (r[1] - r[0])); });
    field.addEventListener("keydown", function (e) {
      var m = MODE[ch], dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
      if (!dx && !dy) return; e.preventDefault(); var k = e.shiftKey ? 10 : 1;
      if (dx) st.put(m.x, st.get(m.x) + dx * k); if (dy) st.put(m.y, st.get(m.y) + dy * k); snap(); upd();
    });
    field.tabIndex = 0;
    sCur.addEventListener("click", function () { st.set("rgb", PE.rgbOf(cur)); snap(); upd(); });
    var addSw = PP.addSwatch ? K.btn("Add to swatches", function () { PP.addSwatch(st.hex()); }, "ghost") : null;
    var body = h("div", { "class": "pp-picker" }, [h("div", { "class": "pp-cwrap" }, [field, slider, h("div", { "class": "pp-cside" }, [h("div", { "class": "pp-cswatch" }, [sNew, sCur]), h("label", { "class": "pp-chex" }, [h("span", { text: "#" }), hexIn]), webChk])]), radios]);
    var ok = K.btn("OK", function () {
      dlg.close(); var hx = st.hex();
      if (opts.onPick) { opts.onPick(hx); return; }
      if (which === "bg") ED.doc.bg = hx; else ED.doc.fg = hx;
      ED.emit("colors"); ED.emit("tool"); if (PP.recent) PP.recent(hx);
    }, "primary");
    var dlg = K.modal(opts.title || (which === "bg" ? "Background colour" : "Foreground colour"), body, [addSw, h("span", { "class": "grow" }), K.btn("Cancel", function () { dlg.close(); }, "ghost"), ok], true);
    snap(); upd();
    return { state: st, close: dlg.close, ok: function () { ok.click(); }, set: function (k, v) { st.put(k, v); snap(); upd(); }, setWeb: function (v) { web = v; snap(); upd(); } };
  };

  // The tool bar's foreground / background swatches open this picker instead of the browser's.
  PP.ready.push(function () {
    var box = document.querySelector(".pe-colors"); if (!box) return;
    function which(t) { return t.closest(".pe-fg") ? "fg" : t.closest(".pe-bg") ? "bg" : null; }
    box.addEventListener("click", function (e) { var w = which(e.target); if (!w) return; e.preventDefault(); e.stopPropagation(); PP.pickColor(w); }, true);
    box.addEventListener("keydown", function (e) { var w = which(e.target); if (!w || (e.key !== "Enter" && e.key !== " ")) return; e.preventDefault(); e.stopPropagation(); PP.pickColor(w); }, true);
  });
})();
