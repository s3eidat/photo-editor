/* Workspace (files lane): View › Proof colours (Ctrl+Y), Proof setup… and Gamut warning (Ctrl+Shift+Y).
   A display-only preview, nothing in the image changes: the canvas is shown through an SVG filter (GPU) that simulates
   print on coated, uncoated or newsprint paper (gamut squeeze, dot gain, paper white, ink black), greyscale, the current
   duotone inks, the 216-colour web palette, or colour-blindness (protanopia, deuteranopia, tritanopia; Machado 2009).
   The CMYK simulation uses no ICC profile: it is an approximation, labelled "simulated". The gamut warning greys out
   colours that a typical CMYK press cannot print (approximate Lab chroma limits per hue and lightness). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, C = WS.color, h = S3.h, W = ED.ui.w;
  var PF = WS.proof = {};
  var NS = "http://www.w3.org/2000/svg";
  var PRESETS = PF.PRESETS = {
    coated: { label: "Simulated CMYK — coated paper", sat: 0.86, gamma: 1.08, paper: "#f7f6f2", ink: "#2a2526" },
    uncoated: { label: "Simulated CMYK — uncoated paper", sat: 0.74, gamma: 1.2, paper: "#f1efe8", ink: "#3d393a" },
    newsprint: { label: "Simulated CMYK — newsprint", sat: 0.6, gamma: 1.32, paper: "#e7e2d4", ink: "#4d4946" },
    grey: { label: "Greyscale" }, duotone: { label: "Duotone (current inks)" }, web: { label: "Web palette (216 colours)" },
    protan: { label: "Colour-blindness: protanopia" }, deutan: { label: "Colour-blindness: deuteranopia" }, tritan: { label: "Colour-blindness: tritanopia" }
  };
  var CB = { protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
    tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900] };
  var st = Object.assign({ on: false, kind: "coated", paper: true, ink: true, gamut: false }, S3.store("pe-proof") || {});
  PF.state = st;
  function save() { S3.store("pe-proof", st); }

  // ---------- the SVG filter ----------
  var svg = null, filt = null;
  function el(tag, attrs, kids) { var e = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); (kids || []).forEach(function (k) { e.appendChild(k); }); return e; }
  function transfer(fn) { return el("feComponentTransfer", { "color-interpolation-filters": "sRGB" }, ["R", "G", "B"].map(function (c, i) { return el("feFunc" + c, fn(i)); })); }
  function matrix(m9) { var m = m9; return el("feColorMatrix", { type: "matrix", "color-interpolation-filters": "linearRGB", values: [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(" ") }); }
  PF.build = function () {
    if (!svg) { svg = el("svg", { width: "0", height: "0", "aria-hidden": "true", style: "position:absolute;width:0;height:0" }); document.body.appendChild(svg); }
    svg.textContent = "";
    var k = st.kind, P = PRESETS[k], kids = [];
    if (P.sat) {
      var paper = PE.rgbOf(st.paper ? P.paper : "#ffffff"), ink = PE.rgbOf(st.ink ? P.ink : "#000000");
      kids.push(el("feColorMatrix", { type: "saturate", values: String(P.sat), "color-interpolation-filters": "sRGB" }));
      kids.push(transfer(function () { return { type: "gamma", amplitude: "1", exponent: String(P.gamma), offset: "0" }; }));
      kids.push(transfer(function (i) { return { type: "linear", slope: String((paper[i] - ink[i]) / 255), intercept: String(ink[i] / 255) }; }));
    } else if (k === "grey" || k === "duotone") {
      kids.push(el("feColorMatrix", { type: "matrix", "color-interpolation-filters": "sRGB", values: "0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0" }));
      if (k === "duotone") {
        var lut = WS.modes.duoLut(S3.store("pe-duo") || WS.modes.DUO.Sepia), tv = [0, 1, 2].map(function (c) { var a = []; for (var s = 0; s <= 32; s++) a.push((lut[Math.min(255, s * 8) * 3 + c] / 255).toFixed(4)); return a.join(" "); });
        kids.push(transfer(function (i) { return { type: "table", tableValues: tv[i] }; }));
      }
    } else if (k === "web") kids.push(transfer(function () { return { type: "discrete", tableValues: "0 0.2 0.4 0.6 0.8 1" }; }));
    else if (CB[k]) kids.push(matrix(CB[k]));
    filt = el("filter", { id: "ws-proof", x: "0", y: "0", width: "100%", height: "100%", "color-interpolation-filters": "sRGB" }, kids);
    svg.appendChild(filt);
  };
  function applyView() {
    var v = document.getElementById("view"); if (!v) return;
    if (st.on && ED.doc) { PF.build(); v.style.filter = "url(#ws-proof)"; } else v.style.filter = "";
    badge();
  }
  PF.apply = applyView;
  var chip = null;
  function badge() {
    if (!chip) { chip = h("span", { "class": "chip ws-proofchip", title: "Proof colours are on (Ctrl+Y turns them off). The image itself is unchanged." }); var s = document.querySelector(".pe-status .grow"); if (s) s.parentNode.insertBefore(chip, s); }
    chip.hidden = !(st.on && ED.doc) && !(st.gamut && ED.doc);
    chip.textContent = (st.on ? "Proof: " + PRESETS[st.kind].label.replace("Simulated CMYK — ", "CMYK ") : "") + (st.gamut ? (st.on ? " · " : "") + "gamut warning" : "");
  }
  PF.toggle = function () { st.on = !st.on; save(); applyView(); S3.toast(st.on ? "Proof colours: " + PRESETS[st.kind].label : "Proof colours off"); };

  // ---------- gamut warning ----------
  var HUE = [[0, 70, 50], [40, 78, 55], [70, 85, 70], [95, 95, 88], [130, 70, 60], [160, 62, 50], [200, 48, 58], [230, 45, 50], [270, 58, 30], [300, 65, 35], [330, 72, 45], [360, 70, 50]];
  PF.inGamut = function (r, g, b) {     // approximate press gamut (SWOP-like) in Lab: max chroma by hue, shrinking away from each hue's best lightness
    var lab = C.rgb2lab(r, g, b), L = lab[0], ch = Math.hypot(lab[1], lab[2]);
    if (ch < 30) return true;            // greys and soft colours print
    var hue = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360, i = 0; while (HUE[i + 1][0] < hue) i++;
    var a = HUE[i], z = HUE[i + 1], t = (hue - a[0]) / (z[0] - a[0]), cmax = a[1] + (z[1] - a[1]) * t, lopt = a[2] + (z[2] - a[2]) * t;
    var lim = cmax * Math.max(0, 1 - Math.pow((L - lopt) / 60, 2));
    return ch <= Math.max(30, lim);
  };
  var gmask = null, gsig = "", gtok = 0;
  function gamut() {
    var d = ED.doc; if (!d || !st.gamut) { gmask = null; return; }
    var sig = d.id + ":" + (ED.hist ? ED.hist.pos + ":" + ED.hist.list.length : "") + ":" + d.w + "x" + d.h; if (sig === gsig && gmask) return; gsig = sig;
    var t = ++gtok, k = Math.min(1, Math.sqrt(2e6 / (d.w * d.h))), c = PE.flatten(d, { scale: k }), im = PE.getData(c), dd = im.data, cache = new Map();
    var m = PE.mk(c.width, c.height), mx = PE.cx2(m), out = mx.createImageData(c.width, c.height), o = out.data;
    for (var i = 0; i < dd.length; i += 4) {
      if (dd[i + 3] < 16) continue;
      var key = (dd[i] >> 2) << 12 | (dd[i + 1] >> 2) << 6 | (dd[i + 2] >> 2), v = cache.get(key);
      if (v === undefined) { v = PF.inGamut(dd[i], dd[i + 1], dd[i + 2]); cache.set(key, v); }
      if (!v) { o[i] = o[i + 1] = o[i + 2] = 128; o[i + 3] = 255; }
    }
    if (t !== gtok) return;
    mx.putImageData(out, 0, 0); gmask = m; ED.renderOvl();
  }
  var gsoon = S3.debounce(gamut, 250);
  (ED.ovlExt = ED.ovlExt || []).push(function (c) {
    if (!st.gamut || !gmask || !ED.doc) return;
    var a = ED.toScr(0, 0), b = ED.toScr(ED.doc.w, ED.doc.h);
    c.save(); c.imageSmoothingEnabled = false; c.globalAlpha = 0.9; c.drawImage(gmask, a.x, a.y, b.x - a.x, b.y - a.y); c.restore();
  });
  PF.toggleGamut = function () { st.gamut = !st.gamut; save(); gsig = ""; if (st.gamut) gamut(); ED.renderOvl(); badge(); S3.toast(st.gamut ? "Gamut warning on: grey marks colours a press cannot print (approximate)" : "Gamut warning off"); };

  PF.setup = function () {
    var q = Object.assign({}, st);
    var body = h("div", { "class": "stack" }, [
      W.select("Simulate", Object.keys(PRESETS).map(function (k) { return [k, PRESETS[k].label]; }), q.kind, function (v) { q.kind = v; }),
      W.check("Simulate paper colour", q.paper, function (v) { q.paper = v; }), W.check("Simulate black ink", q.ink, function (v) { q.ink = v; }),
      h("p", { "class": "faint pe-p", text: "Only the screen changes. The CMYK simulations are approximations without colour profiles: use them to spot dull blues, greens and oranges before printing." })]);
    var dlg = W.modal("Proof setup", body, [h("span", { "class": "grow" }), W.btn("Cancel", function () { dlg.close(); }, "ghost"),
      W.btn("Proof", function () { Object.assign(st, q, { on: true }); save(); dlg.close(); applyView(); }, "primary")]);
  };
  var V = ED.ui.MENUS.filter(function (m) { return m[0] === "View"; })[0][1], at = V.findIndex(function (it) { return it !== "-" && String(it[0]).replace(/^[✓ ] /, "") === "Rulers"; });
  function tick(label, sc, fn, on) { var it = [label, sc, fn, null]; Object.defineProperty(it, 0, { get: function () { return (on() ? "✓ " : "\u2003 ") + label; } }); return it; }
  var items = [tick("Proof colours", "Ctrl+Y", PF.toggle, function () { return st.on; }), tick("Gamut warning", "Ctrl+Shift+Y", PF.toggleGamut, function () { return st.gamut; }), ["Proof setup…", "", PF.setup], "-"];
  V.splice.apply(V, [at, 0].concat(items));
  WS.key(function (e) { return WS.ctrl(e) && !e.altKey && e.key.toLowerCase() === "y" && !e.shiftKey; }, PF.toggle);
  WS.key(function (e) { return WS.ctrl(e) && !e.altKey && e.key.toLowerCase() === "y" && e.shiftKey; }, PF.toggleGamut);
  ED.on("changed", function () { applyView(); if (st.gamut) gsoon(); });
  document.addEventListener("DOMContentLoaded", function () { applyView(); if (st.gamut) gsoon(); });

  FX.tests.push(async function (ok) {
    ok(PF.inGamut(128, 128, 128) && PF.inGamut(200, 160, 120) && !PF.inGamut(0, 0, 255) && !PF.inGamut(0, 255, 0) && PF.inGamut(230, 200, 40), "gamut model: greys, skin and yellow print; RGB blue / green do not");
    var keep = Object.assign({}, st); st.kind = "coated"; PF.build(); ok(document.getElementById("ws-proof") && document.querySelectorAll("#ws-proof > *").length === 3, "proof filter built");
    st.kind = "protan"; PF.build(); ok(document.querySelector("#ws-proof feColorMatrix").getAttribute("values").indexOf("0.152286") === 0, "colour-blindness matrix");
    Object.assign(st, keep);
  });
})();
