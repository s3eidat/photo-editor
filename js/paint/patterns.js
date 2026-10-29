/* Photo Editor paint lane: patterns. Built-in tiles drawn here in code, your own from the selection or an image
   file (kept in this browser), the Patterns tab, Edit › Fill with pattern, the pattern stamp, and the alpha
   masks the brush engine's texture option uses. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, h = S3.h;
  var LIST = [], BY = {};
  function add(p) { if (BY[p.id]) LIST = LIST.filter(function (x) { return x.id !== p.id; }); BY[p.id] = p; LIST.push(p); return p; }
  function made(id, name, w, hh, draw) { var c = PE.mk(w, hh), x = PE.cx2(c); draw(x, w, hh, PPX.rng(id.length * 131 + w)); add({ id: id, name: name, canvas: c, w: w, h: hh, builtin: true }); }
  made("pt:checks", "Checks", 32, 32, function (x, w) { x.fillStyle = "#e8e8e8"; x.fillRect(0, 0, w, w); x.fillStyle = "#9a9a9a"; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16); });
  made("pt:stripes", "Stripes", 24, 24, function (x, w) { x.fillStyle = "#f2f2f2"; x.fillRect(0, 0, w, w); x.strokeStyle = "#555"; x.lineWidth = 6; for (var i = -1; i < 3; i++) { x.beginPath(); x.moveTo(i * 12 - 12, w + 12); x.lineTo(i * 12 + 12, -12); x.stroke(); } });
  made("pt:dots", "Dots", 20, 20, function (x, w) { x.fillStyle = "#fafafa"; x.fillRect(0, 0, w, w); x.fillStyle = "#3b3b3b"; [[5, 5], [15, 15]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 3.2, 0, Math.PI * 2); x.fill(); }); });
  made("pt:bricks", "Bricks", 64, 32, function (x, w, hh, R) { x.fillStyle = "#d9d2c5"; x.fillRect(0, 0, w, hh); [[0, 0, 64], [-32, 16, 64], [32, 16, 64]].forEach(function (b) { var g = 170 + R() * 40; x.fillStyle = "rgb(" + Math.round(g) + "," + Math.round(g * 0.45) + "," + Math.round(g * 0.32) + ")"; x.fillRect(b[0] + 2, b[1] + 2, b[2] - 4, 12); }); });
  made("pt:grain", "Grain", 96, 96, function (x, w, hh, R) { var im = x.createImageData(w, hh); for (var i = 0; i < w * hh; i++) { var v = 120 + (R() - 0.5) * 140; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } x.putImageData(im, 0, 0); });
  made("pt:weave", "Canvas weave", 32, 32, function (x, w, hh, R) {
    x.fillStyle = "#cfc6b4"; x.fillRect(0, 0, w, hh);
    for (var i = 0; i < 8; i++) for (var j = 0; j < 8; j++) { var over = (i + j) % 2, v = 175 + R() * 40; x.fillStyle = "rgb(" + Math.round(v) + "," + Math.round(v * 0.95) + "," + Math.round(v * 0.86) + ")"; if (over) x.fillRect(i * 4, j * 4 + 1, 4, 2); else x.fillRect(i * 4 + 1, j * 4, 2, 4); }
  });
  made("pt:paper", "Paper fibres", 128, 128, function (x, w, hh, R) { x.fillStyle = "#efece4"; x.fillRect(0, 0, w, hh); x.lineWidth = 0.7; for (var i = 0; i < 260; i++) { var px = R() * w, py = R() * hh, a = R() * Math.PI, l = 3 + R() * 12, v = 150 + R() * 80; x.strokeStyle = "rgba(" + Math.round(v) + "," + Math.round(v) + "," + Math.round(v * 0.95) + ",.55)"; for (var k = -1; k <= 1; k++) for (var m = -1; m <= 1; m++) { x.beginPath(); x.moveTo(px + k * w, py + m * hh); x.lineTo(px + k * w + Math.cos(a) * l, py + m * hh + Math.sin(a) * l); x.stroke(); } } });
  made("pt:wood", "Wood grain", 128, 64, function (x, w, hh, R) { var im = x.createImageData(w, hh); for (var yy = 0; yy < hh; yy++) for (var xx = 0; xx < w; xx++) { var t = Math.sin((yy / hh) * Math.PI * 2 * 5 + Math.sin(xx / w * Math.PI * 2 * 2) * 1.6) * 0.5 + 0.5, v = 0.72 + t * 0.28 + (R() - 0.5) * 0.05, q = (yy * w + xx) * 4; im.data[q] = 170 * v; im.data[q + 1] = 112 * v; im.data[q + 2] = 66 * v; im.data[q + 3] = 255; } x.putImageData(im, 0, 0); });
  made("pt:hex", "Hexagons", 42, 24, function (x, w, hh) { x.fillStyle = "#eaeaea"; x.fillRect(0, 0, w, hh); x.strokeStyle = "#6b6b6b"; x.lineWidth = 1.5; function hx(cx, cy) { x.beginPath(); for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i; x.lineTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7); } x.closePath(); x.stroke(); } hx(7, 0); hx(7, 24); hx(28, 12); hx(-14, 12); hx(49, 0); hx(49, 24); });
  made("pt:scales", "Scales", 24, 24, function (x, w) { x.fillStyle = "#3f6f5a"; x.fillRect(0, 0, w, w); x.strokeStyle = "#a8d5bf"; x.lineWidth = 1.4; [[0, 0], [24, 0], [12, 12], [0, 24], [24, 24]].forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], 12, 0, Math.PI); x.stroke(); }); });
  made("pt:hatch", "Cross hatch", 16, 16, function (x, w) { x.fillStyle = "#fbfbfb"; x.fillRect(0, 0, w, w); x.strokeStyle = "#444"; x.lineWidth = 1; x.beginPath(); x.moveTo(0, 0); x.lineTo(16, 16); x.moveTo(16, 0); x.lineTo(0, 16); x.stroke(); });

  PP.patternList = function () { return LIST.slice(); };
  PP.patternOf = function (id) { return BY[id] || null; };
  var cur = S3.store("pe-pattern") || "pt:checks";
  PP.currentPattern = function () { return BY[cur] || LIST[0]; };
  PP.setPattern = function (id) { if (!BY[id]) return; cur = id; S3.store("pe-pattern", id); PP.refreshPanel("patterns"); if (ED.tool === "pstamp") ED.ui.buildOpts(); };
  var TM = new Map();
  // alpha mask for texture: dark parts of the pattern take paint away
  PP.texMask = function (P, inv) {
    var key = P.id + (inv ? "i" : ""), hit = TM.get(key); if (hit) return hit;
    var c = PE.mk(P.w, P.h), x = PE.cx2(c), d = PE.getData(P.canvas), im = x.createImageData(P.w, P.h);
    var L = new Float32Array(P.w * P.h), lo = 1, hi = 0, i;
    for (i = 0; i < L.length; i++) { L[i] = (d.data[i * 4] * 0.299 + d.data[i * 4 + 1] * 0.587 + d.data[i * 4 + 2] * 0.114) / 255; if (L[i] < lo) lo = L[i]; if (L[i] > hi) hi = L[i]; }
    for (i = 0; i < L.length; i++) { var l = hi > lo ? (L[i] - lo) / (hi - lo) : 0.5; im.data[i * 4 + 3] = Math.round((inv ? l : 1 - l) * 255); }      // full contrast
    x.putImageData(im, 0, 0); TM.set(key, c); return c;
  };
  function fromRGBA(id, name, w, hh, data) { var c = PE.mk(w, hh); PE.cx2(c).putImageData(new ImageData(new Uint8ClampedArray(data), w, hh), 0, 0); return add({ id: id, name: name, canvas: c, w: w, h: hh }); }
  PP.lib.all("pattern").then(function (a) { a.forEach(function (r) { if (r.w > 0 && r.h > 0 && r.w <= 1024 && r.h <= 1024 && r.data && r.data.length === r.w * r.h * 4) fromRGBA(r.id, String(r.name || "Pattern").slice(0, 60), r.w, r.h, r.data); }); PP.refreshPanel("patterns"); }).catch(function () {});
  // Make a pattern from a canvas (scaled to at most 1024 px a side).
  PP.addPattern = function (canvas, name) {
    var k = Math.min(1, 1024 / Math.max(canvas.width, canvas.height)), w = Math.max(1, Math.round(canvas.width * k)), hh = Math.max(1, Math.round(canvas.height * k)), c = PE.mk(w, hh), x = PE.cx2(c);
    x.imageSmoothingQuality = "high"; x.drawImage(canvas, 0, 0, w, hh);
    var id = PE.uid("pat"), data = x.getImageData(0, 0, w, hh).data, p = add({ id: id, name: name, canvas: c, w: w, h: hh });
    PP.lib.put({ id: id, kind: "pattern", name: name, w: w, h: hh, data: new Uint8ClampedArray(data), order: Date.now() }).catch(function () {});
    PP.setPattern(id);
    return p;
  };
  PP.importPat = function (u8) {
    return PP.work("readPat", [u8]).then(function (list) {
      list.forEach(function (p) { var c = PE.mk(p.w, p.h); PE.cx2(c).putImageData(new ImageData(new Uint8ClampedArray(p.data), p.w, p.h), 0, 0); PP.addPattern(c, String(p.name).replace(/[\u0000-\u001f]/g, " ").slice(0, 60)); });
      return list.length;
    });
  };
  PP.removePattern = function (id) {
    if (!BY[id] || BY[id].builtin) return;
    LIST = LIST.filter(function (x) { return x.id !== id; }); delete BY[id]; PP.lib.del(id).catch(function () {});
    if (cur === id) cur = LIST[0].id;
    PP.refreshPanel("patterns");
  };
  function nameAsk(def, run) {
    var i = h("input", { "class": "input", value: def, maxlength: "60", dir: "auto", "aria-label": "Name" });
    var dlg = K.modal("Pattern name", h("div", { "class": "stack" }, [K.field("Name", i)]), [h("span", { "class": "grow" }), K.btn("Save", function () { dlg.close(); run(i.value.trim().slice(0, 60) || def); }, "primary")]);
  }
  PP.definePattern = function (name) {
    var d = ED.doc; if (!d || !d.sel) { S3.toast("Select the area to repeat first", "error"); return null; }
    return PP.addPattern(PE.flatten(d, { rect: d.sel.b }), name || "My pattern");
  };
  var file = null;
  function importImage() {
    if (!file) {
      file = h("input", { type: "file", accept: "image/*,.pat", hidden: true }); document.body.appendChild(file);
      file.addEventListener("change", function () {
        var f = file.files[0]; file.value = ""; if (!f) return;
        if (/\.pat$/i.test(f.name)) {
          if (f.size > 200e6) { S3.toast("That pattern file is too large", "error"); return; }
          ED.working(f.arrayBuffer().then(function (ab) { return PP.importPat(new Uint8Array(ab)); }), "Reading patterns…").then(function (n) { S3.toast("Imported " + n + " pattern" + (n === 1 ? "" : "s")); }).catch(function (e) { S3.toast(e.message, "error"); });
          return;
        }
        PE.decodeImage(f).then(function (img) { PP.addPattern(img.canvas, String(f.name).replace(/\.[^.]+$/, "").slice(0, 60) || "Pattern"); S3.toast("Pattern added"); }).catch(function (e) { S3.toast(e.message, "error"); });
      });
    }
    file.click();
  }
  function chip(p, onClick) {
    var cv = h("canvas", { width: "40", height: "40" }), x = cv.getContext("2d"); x.fillStyle = x.createPattern(p.canvas, "repeat"); x.fillRect(0, 0, 40, 40);
    var b = h("button", { type: "button", "class": "pp-pat" + (PP.currentPattern() === p ? " on" : ""), title: p.name + (p.builtin ? "" : " (Alt+click deletes)"), "aria-label": p.name }, [cv]);
    b.addEventListener("click", function (e) { onClick(e, p); });
    return b;
  }
  PP.patternChip = chip;
  PP.panelTab("patterns", "Patterns", function (el) {
    var grid = h("div", { "class": "pp-patgrid" });
    LIST.forEach(function (p) {
      grid.appendChild(chip(p, function (e) {
        if (e.altKey && !p.builtin) { PP.removePattern(p.id); return; }
        PP.setPattern(p.id);
      }));
    });
    el.appendChild(grid);
    el.appendChild(h("div", { "class": "pp-acts" }, [K.btn("From selection", function () { if (!K.need()) return; if (!ED.doc.sel) { S3.toast("Select the area to repeat first", "error"); return; } nameAsk("My pattern", PP.definePattern); }, "ghost"),
      K.btn("Import", importImage, "ghost", null, "Import an image or a .pat pattern file"), K.btn("Fill…", fillDialog, "ghost", null, "Fill the selection or layer with the pattern")]));
  });

  // ---------- Edit › Fill with pattern ----------
  var fo = PP.opts("patfill", { scale: 100, op: 1, mode: "normal" });
  PP.fillPattern = function (o) {
    o = Object.assign({}, fo, o || {});
    var t = PP.target("pixels"); if (!t) return false;
    var d = ED.doc, L = t.L, P = PP.currentPattern(), sel = d.sel;
    var R = PE.inter(sel ? { x: sel.b.x - L.x, y: sel.b.y - L.y, w: sel.b.w, h: sel.b.h } : { x: -L.x, y: -L.y, w: d.w, h: d.h }, { x: 0, y: 0, w: L.canvas.width, h: L.canvas.height });
    if (!R) { ED.push(t.grow); return false; }
    var e = PE.editPixels(d, "Fill with pattern", L, "canvas", R, function (c) {
      var tc = PE.mk(R.w, R.h), tx = PE.cx2(tc), pat = tx.createPattern(P.canvas, "repeat"), k = PE.clamp(o.scale, 1, 1000) / 100;
      pat.setTransform(new DOMMatrix([k, 0, 0, k, -(R.x + L.x), -(R.y + L.y)])); tx.fillStyle = pat; tx.fillRect(0, 0, R.w, R.h);
      if (sel) { tx.globalCompositeOperation = "destination-in"; tx.drawImage(PE.selCanvas(sel), -(R.x + L.x), -(R.y + L.y)); }
      c.save(); c.globalAlpha = PE.clamp(o.op, 0, 1); c.globalCompositeOperation = PE.gco(o.mode); c.drawImage(tc, R.x, R.y); c.restore();
    });
    ED.push(PE.compound("Fill with pattern", [t.grow, e]));
    return true;
  };
  function fillDialog() {
    if (!K.need()) return;
    var grid = h("div", { "class": "pp-patgrid" });
    function fill() { grid.textContent = ""; LIST.forEach(function (p) { grid.appendChild(chip(p, function (e, q) { PP.setPattern(q.id); fill(); })); }); }
    fill();
    var body = h("div", { "class": "stack" }, [grid, K.range("Scale", fo.scale, 1, 1000, 1, function (v) { fo.scale = v; }, function (v) { return v + "%"; }),
      K.range("Opacity", fo.op, 0.01, 1, 0.01, function (v) { fo.op = v; }, function (v) { return Math.round(v * 100) + "%"; }),
      K.select("Mode", PE.BLENDS.map(function (m) { return [m, m.charAt(0).toUpperCase() + m.slice(1)]; }), fo.mode, function (v) { fo.mode = v; }),
      h("p", { "class": "faint pe-p", text: ED.doc.sel ? "Fills the selection on the current layer." : "No selection: fills the whole layer." })]);
    var dlg = K.modal("Fill with pattern", body, [h("span", { "class": "grow" }), K.btn("Cancel", function () { dlg.close(); }, "ghost"), K.btn("Fill", function () { dlg.close(); ED.saveOpts(); PP.fillPattern(); }, "primary")]);
  }
  PP.menu("Edit", [["Fill with pattern…", "", fillDialog, function () { return !!ED.doc; }], ["Define pattern from selection…", "", function () { if (!K.need()) return; if (!ED.doc.sel) { S3.toast("Select the area to repeat first", "error"); return; } nameAsk("My pattern", PP.definePattern); }, function () { return !!(ED.doc && ED.doc.sel); }]], "Fill with surroundings…");

  // ---------- pattern stamp ----------
  PP.icons({ "t-pstamp": ["M9.2 13V9.8a2.8 2.8 0 1 1 5.6 0V13", "M4 17.5v-2.3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.3z", "M5.5 20.5h2M10 20.5h2M14.5 20.5h2"] });
  PP.engineTool("pstamp", {
    label: "Pattern stamp", fill: "pattern",
    begin: function (st, p) {
      var P = PP.currentPattern(); if (!P) return false;
      st.pat = st.bctx.createPattern(P.canvas, "repeat"); st.patK = PE.clamp(st.o.scale, 1, 1000) / 100;
      if (st.o.aligned) { st.patX = 0; st.patY = 0; } else { st.patX = p.x; st.patY = p.y; }
      return true;
    }
  }, { size: 60, hard: 0.7, aligned: true, scale: 100, sizeC: "off" });
  PP.addTool("pstamp", "Pattern stamp", "S", "clone", ED.TOOLS.pstamp);
  PP.group("S", ["clone", "pstamp"]);
  PP.optsFor.pstamp = function (items) {
    var o = ED.o.pstamp, P = PP.currentPattern(), b = P ? chip(P, function () { S3.store("pe-ptab", "patterns"); PP.refreshPanel(); var pn = document.querySelector(".pp-panel"); if (pn) { pn.open = true; pn.scrollIntoView({ block: "nearest" }); } }) : null;
    if (b) b.title = "Pattern: " + P.name + " (choose another in Paint › Patterns)";
    return PP.brushBar("pstamp", items, [b, K.check("Aligned", o.aligned, function (v) { o.aligned = v; ED.saveOpts(); }), K.field("Scale %", K.numInput(o.scale, 1, 1000, function (v) { o.scale = v; ED.saveOpts(); }), "pe-num")],
      "Paints with the current pattern. Aligned keeps the pattern continuous across strokes.");
  };

  PP.test("patterns", function (ok) {
    var s = PP.scratch(64, 32, "#ffffff"); PP.setPattern("pt:checks");
    ok(PP.fillPattern({ scale: 100, op: 1, mode: "normal" }), "fill with pattern");
    var a = PP.px(s.L.canvas, 4, 4), b = PP.px(s.L.canvas, 20, 4), c = PP.px(s.L.canvas, 36, 4);
    ok(a[0] === 154 && b[0] === 232 && c[0] === 154, "the pattern repeats, aligned to the document (" + a[0] + "," + b[0] + "," + c[0] + ")");
    ED.undo();
    Object.assign(ED.o.pstamp, { size: 12, hard: 1, op: 1, flow: 1, aligned: true, scale: 100 });
    PP.drive("pstamp", [{ x: 20, y: 6 }, { x: 40, y: 6 }]);
    ok(Math.abs(PP.px(s.L.canvas, 34, 6)[0] - 154) <= 2 && Math.abs(PP.px(s.L.canvas, 24, 6)[0] - 232) <= 2 && PP.px(s.L.canvas, 30, 26)[0] === 255, "pattern stamp paints the pattern in place");
    var m = PP.texMask(PP.patternOf("pt:checks"), false), q = PP.px(m, 4, 4)[3], q2 = PP.px(m, 20, 4)[3];
    ok(q === 255 && q2 === 0, "texture mask: dark parts take paint away (stretched to full contrast)");
    Object.assign(ED.o.brush, { size: 40, hard: 1, op: 1, flow: 1, spacing: 5, tex: "pt:checks", texDepth: 100, texScale: 100, texEach: false }); s.d.fg = "#000000";
    PP.drive("brush", [{ x: 10, y: 24 }, { x: 54, y: 24 }]);
    ok(PP.px(s.L.canvas, 24, 24)[0] === 255 && PP.px(s.L.canvas, 36, 24)[0] < 10, "stroke texture stays put under overlapping dabs");
    ED.o.brush.tex = "";
    var c2 = PE.mk(8, 8); PE.cx2(c2).fillStyle = "#123456"; PE.cx2(c2).fillRect(0, 0, 8, 8);
    var p = PP.addPattern(c2, "t"); ok(PP.currentPattern() === p && PP.patternList().indexOf(p) >= 0, "new pattern becomes current");
    PP.removePattern(p.id); ok(!PP.patternOf(p.id), "remove a pattern"); PP.setPattern("pt:checks");
  });
})();
