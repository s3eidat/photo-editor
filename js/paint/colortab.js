/* Photo Editor paint lane: the Colour tab (quick foreground / background sliders in HSB or RGB, a hue ramp to
   click, hex) and a brush cursor that shows a sampled tip's real shape. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, h = S3.h, RAD = Math.PI / 180;
  var which = "fg", model = S3.store("pe-ctab-model") || "hsb";
  function cur() { return ED.doc ? (which === "bg" ? ED.doc.bg : ED.doc.fg) : "#000000"; }
  function setCur(hx, live) { if (!ED.doc) return; if (which === "bg") ED.doc.bg = hx; else ED.doc.fg = hx; ED.ui.colors(); if (!live) { ED.emit("colors"); ED.emit("tool"); } }
  // a slider whose track shows the colours it would give
  function channel(label, min, max, val, colorAt, onSet) {
    var r = h("input", { type: "range", min: String(min), max: String(max), step: "1", value: String(Math.round(val)), "aria-label": label, "class": "pp-cch" });
    var stops = []; for (var i = 0; i <= 6; i++) stops.push(colorAt(min + (max - min) * i / 6) + " " + Math.round(i / 6 * 100) + "%");
    r.style.background = "linear-gradient(90deg," + stops.join(",") + ")";
    var out = h("output", { text: String(Math.round(val)) });
    r.addEventListener("input", function () { out.textContent = r.value; onSet(+r.value, true); });
    r.addEventListener("change", function () { onSet(+r.value, false); });
    return h("label", { "class": "pp-crow" }, [h("span", { text: label }), r, out]);
  }
  function hex3(c) { return PE.toHex(c[0], c[1], c[2]); }
  function build(el) {
    var c = PE.rgbOf(cur()), hsb = PPX.rgb2hsb(c[0], c[1], c[2]);
    var fgB = h("button", { type: "button", "class": "pp-cchip" + (which === "fg" ? " on" : ""), title: "Edit the foreground colour", "aria-label": "Foreground" }), bgB = h("button", { type: "button", "class": "pp-cchip" + (which === "bg" ? " on" : ""), title: "Edit the background colour", "aria-label": "Background" });
    fgB.style.background = ED.doc ? ED.doc.fg : "#000"; bgB.style.background = ED.doc ? ED.doc.bg : "#fff";
    fgB.addEventListener("click", function () { if (which === "fg") PP.pickColor("fg"); which = "fg"; PP.refreshPanel("color"); });
    bgB.addEventListener("click", function () { if (which === "bg") PP.pickColor("bg"); which = "bg"; PP.refreshPanel("color"); });
    var hx = h("input", { "class": "input mono pp-chx", value: cur(), maxlength: "7", "aria-label": "Hex colour", spellcheck: "false" });
    hx.addEventListener("change", function () { var v = hx.value.trim(); if (!/^#/.test(v)) v = "#" + v; if (PE.hex(v, null)) setCur(v.toLowerCase()); else hx.value = cur(); });
    el.appendChild(h("div", { "class": "pp-chead" }, [fgB, bgB, hx, K.seg("", [["hsb", "HSB"], ["rgb", "RGB"]], model, function (v) { model = v; S3.store("pe-ctab-model", v); PP.refreshPanel("color"); })]));
    var rows = h("div", { "class": "pp-crows" });
    if (model === "hsb") {
      rows.appendChild(channel("H", 0, 360, hsb[0], function (v) { return hex3(PPX.hsb2rgb(v, Math.max(hsb[1], 60), Math.max(hsb[2], 60))); }, function (v, live) { hsb[0] = v; setCur(hex3(PPX.hsb2rgb(hsb[0], hsb[1], hsb[2])), live); }));
      rows.appendChild(channel("S", 0, 100, hsb[1], function (v) { return hex3(PPX.hsb2rgb(hsb[0], v, hsb[2])); }, function (v, live) { hsb[1] = v; setCur(hex3(PPX.hsb2rgb(hsb[0], hsb[1], hsb[2])), live); }));
      rows.appendChild(channel("B", 0, 100, hsb[2], function (v) { return hex3(PPX.hsb2rgb(hsb[0], hsb[1], v)); }, function (v, live) { hsb[2] = v; setCur(hex3(PPX.hsb2rgb(hsb[0], hsb[1], hsb[2])), live); }));
    } else {
      ["R", "G", "B"].forEach(function (n, k) {
        rows.appendChild(channel(n, 0, 255, c[k], function (v) { var q = c.slice(); q[k] = v; return hex3(q); }, function (v, live) { c[k] = v; setCur(hex3(c), live); }));
      });
    }
    el.appendChild(rows);
    // a spectrum strip: click to pick
    var sp = h("canvas", { "class": "pp-cspec", width: "260", height: "36", "aria-label": "Spectrum: click to pick a colour" }), x = sp.getContext("2d"), im = x.createImageData(260, 36);
    for (var yy = 0; yy < 36; yy++) for (var xx = 0; xx < 260; xx++) {
      var t = yy / 35, rgb = PPX.hsb2rgb(xx / 259 * 360, t < 0.5 ? t * 2 * 100 : 100, t < 0.5 ? 100 : (1 - (t - 0.5) * 2) * 100), q = (yy * 260 + xx) * 4;
      im.data[q] = rgb[0]; im.data[q + 1] = rgb[1]; im.data[q + 2] = rgb[2]; im.data[q + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    sp.addEventListener("click", function (e) { var r = sp.getBoundingClientRect(), px = Math.floor((e.clientX - r.left) / r.width * 260), py = Math.floor((e.clientY - r.top) / r.height * 36), d = x.getImageData(PE.clamp(px, 0, 259), PE.clamp(py, 0, 35), 1, 1).data; setCur(PE.toHex(d[0], d[1], d[2])); PP.refreshPanel("color"); });
    el.appendChild(sp);
  }
  PP.panelTab("color", "Colour", build, true);
  ED.on("colors", function () { if (!document.activeElement || !document.activeElement.classList || !document.activeElement.classList.contains("pp-cch")) PP.refreshPanel("color"); });

  // ---------- brush cursor with the tip's shape ----------
  var TINT = new WeakMap();
  function tinted(tip) { var hit = TINT.get(tip); if (hit) return hit; var c = PE.mk(tip.w, tip.h), x = PE.cx2(c); x.drawImage(tip.canvas, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = "#1b8cff"; x.fillRect(0, 0, tip.w, tip.h); TINT.set(tip, c); return c; }
  PP.overlay(function (c, docPath, curPt, dpr) {
    var o = ED.o[ED.tool]; if (!curPt || ED.modal || !PP.spec[ED.tool] || !o || !o.tip) return;
    var tip = PP.tipOf(o.tip); if (!tip) return;
    var d = Math.max(2, o.size * ED.zoom), k = d / Math.max(tip.w, tip.h);
    c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.translate(curPt.x, curPt.y); c.rotate((o.angle || 0) * RAD); c.scale((o.flipX ? -1 : 1) * k, k * PE.clamp(o.round, 1, 100) / 100);
    c.globalAlpha = 0.45; c.drawImage(tinted(tip), -tip.w / 2, -tip.h / 2); c.restore();
  });
})();
