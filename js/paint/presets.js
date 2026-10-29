/* Photo Editor paint lane: brush presets. Sampled tips drawn here in code (chalk, spatter, bristles, leaf…),
   built-in presets, your own presets and tips (saved in this browser), the preset picker in the options bar,
   the Brushes tab, Edit › Define brush from selection, and .abr import (sampled tips, versions 1, 2, 6+). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PP = PE.paint, PPX = window.PPX, K = ED.ui.kit, h = S3.h;

  // ---------- tips ----------
  function tipFromGray(id, name, w, hh, gray) {
    var c = PE.mk(w, hh), x = PE.cx2(c), im = x.createImageData(w, hh);
    for (var i = 0; i < w * hh; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = gray[i]; }
    x.putImageData(im, 0, 0);
    var t = { id: id, name: name, canvas: c, w: w, h: hh };
    PP.tips[id] = t;
    return t;
  }
  PP.tipFromGray = tipFromGray;
  // draw(ctx, rnd, S) paints white with alpha on an S x S canvas
  function made(id, name, S, draw) {
    var c = PE.mk(S, S), x = PE.cx2(c); x.fillStyle = "#fff"; x.strokeStyle = "#fff";
    draw(x, PPX.rng(id.length * 7919 + S), S);
    PP.tips[id] = { id: id, name: name, canvas: c, w: S, h: S, builtin: true };
  }
  function dots(x, R, S, n, rmin, rmax, spread, alpha) { for (var i = 0; i < n; i++) { var a = R() * Math.PI * 2, d = Math.sqrt(R()) * spread * S / 2, r = rmin + R() * (rmax - rmin); x.globalAlpha = alpha ? alpha * (0.4 + R() * 0.6) : 1; x.beginPath(); x.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r, 0, Math.PI * 2); x.fill(); } x.globalAlpha = 1; }
  made("t:chalk", "Chalk", 96, function (x, R, S) { x.beginPath(); x.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2); x.fill(); x.globalCompositeOperation = "destination-out"; dots(x, R, S, 520, 0.6, 2.4, 1, 0.9); });
  made("t:spatter", "Spatter", 128, function (x, R, S) { dots(x, R, S, 70, 0.8, 7, 0.95, 0); });
  made("t:bristle", "Bristles", 96, function (x, R, S) { x.lineCap = "round"; for (var i = 0; i < 26; i++) { var px = S * 0.12 + R() * S * 0.76, w = 1.2 + R() * 3; x.globalAlpha = 0.45 + R() * 0.55; x.lineWidth = w; x.beginPath(); x.moveTo(px, S * 0.3 + R() * S * 0.1); x.lineTo(px + (R() - 0.5) * 4, S * 0.6 + R() * S * 0.1); x.stroke(); } x.globalAlpha = 1; });
  made("t:leaf", "Leaf", 96, function (x, R, S) { x.beginPath(); x.moveTo(S * 0.5, S * 0.06); x.bezierCurveTo(S * 0.92, S * 0.3, S * 0.84, S * 0.72, S * 0.5, S * 0.94); x.bezierCurveTo(S * 0.16, S * 0.72, S * 0.08, S * 0.3, S * 0.5, S * 0.06); x.fill(); x.globalCompositeOperation = "destination-out"; x.lineWidth = S * 0.025; x.beginPath(); x.moveTo(S * 0.5, S * 0.12); x.lineTo(S * 0.5, S * 0.9); x.stroke(); });
  made("t:star", "Star", 96, function (x, R, S) { x.beginPath(); for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? S * 0.2 : S * 0.47; if (i) x.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); else x.moveTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); } x.closePath(); x.fill(); });
  made("t:grass", "Grass", 128, function (x, R, S) { for (var i = 0; i < 9; i++) { var bx = S * 0.25 + R() * S * 0.5, lean = (R() - 0.5) * S * 0.5, top = S * (0.04 + R() * 0.3), w = S * (0.025 + R() * 0.03); x.globalAlpha = 0.6 + R() * 0.4; x.beginPath(); x.moveTo(bx - w, S * 0.98); x.quadraticCurveTo(bx + lean * 0.3, S * 0.55, bx + lean, top); x.quadraticCurveTo(bx + lean * 0.3 + w, S * 0.55, bx + w, S * 0.98); x.closePath(); x.fill(); } x.globalAlpha = 1; });
  made("t:square", "Square", 64, function (x, R, S) { x.fillRect(S * 0.06, S * 0.06, S * 0.88, S * 0.88); });
  made("t:charcoal", "Charcoal", 96, function (x, R, S) { x.save(); x.translate(S / 2, S / 2); x.scale(1, 0.38); x.beginPath(); x.arc(0, 0, S * 0.45, 0, Math.PI * 2); x.restore(); x.fill(); x.globalCompositeOperation = "destination-out"; for (var i = 0; i < 160; i++) { x.globalAlpha = 0.3 + R() * 0.7; x.fillRect(R() * S, R() * S, 1 + R() * 3, 1); } x.globalAlpha = 1; });
  made("t:blot", "Wet blot", 128, function (x, R, S) { var g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.46); g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(0.75, "rgba(255,255,255,.7)"); g.addColorStop(0.92, "rgba(255,255,255,.95)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.beginPath(); for (var i = 0; i <= 24; i++) { var a = i / 24 * Math.PI * 2, r = S * (0.38 + R() * 0.08); if (i) x.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); else x.moveTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); } x.fill(); });
  made("t:cloud", "Cloud", 128, function (x, R, S) { for (var i = 0; i < 40; i++) { var a = R() * Math.PI * 2, d = Math.sqrt(R()) * S * 0.28, r = S * (0.06 + R() * 0.12), g = x.createRadialGradient(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r); g.addColorStop(0, "rgba(255,255,255,.28)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, S, S); } });
  made("t:hatch", "Hatching", 96, function (x, R, S) { x.lineWidth = 1.6; x.lineCap = "round"; for (var i = 0; i < 9; i++) { var o = S * 0.1 + i * S * 0.1; x.globalAlpha = 0.6 + R() * 0.4; x.beginPath(); x.moveTo(o, S * 0.9); x.lineTo(o + S * 0.18, S * 0.1); x.stroke(); } x.globalAlpha = 1; });

  // ---------- presets ----------
  function P(id, name, s) { return { id: "p:" + id, name: name, s: s, builtin: true }; }
  var BUILTIN = [
    P("soft", "Soft round", { tip: "", hard: 0, size: 45, spacing: 12, sizeC: "pressure" }),
    P("hard", "Hard round", { tip: "", hard: 1, size: 20, spacing: 10, sizeC: "pressure" }),
    P("ink", "Ink pen", { tip: "", hard: 0.95, size: 8, spacing: 5, sizeC: "pressure", sizeMin: 10, smooth: 35 }),
    P("sketch", "Sketch pencil", { tip: "", hard: 0.7, size: 4, spacing: 8, sizeC: "off", opC: "pressure", op: 0.8 }),
    P("air", "Airbrush", { tip: "", hard: 0, size: 90, spacing: 8, flow: 0.08, buildup: true, sizeC: "off" }),
    P("callig", "Calligraphy", { tip: "", hard: 0.9, size: 26, round: 22, angle: 40, spacing: 4, sizeC: "pressure", sizeMin: 30 }),
    P("chalk", "Chalk", { tip: "t:chalk", size: 40, spacing: 22, angleJ: 100, sizeC: "pressure", sizeMin: 40 }),
    P("charcoal", "Charcoal", { tip: "t:charcoal", size: 36, spacing: 10, angleC: "direction", opC: "pressure", sizeC: "off" }),
    P("bristle", "Dry bristles", { tip: "t:bristle", size: 50, spacing: 6, angleC: "direction", angle: 90, flow: 0.6, sizeC: "pressure", sizeMin: 50 }),
    P("spatter", "Spatter", { tip: "t:spatter", size: 70, spacing: 45, scatter: 60, scatterBoth: true, angleJ: 100, sizeJ: 40, sizeC: "off" }),
    P("blot", "Watercolour", { tip: "t:blot", size: 80, spacing: 18, flow: 0.25, angleJ: 100, sizeJ: 20, sizeC: "off", briJ: 6 }),
    P("cloud", "Clouds", { tip: "t:cloud", size: 160, spacing: 30, flow: 0.5, angleJ: 100, sizeJ: 35, scatter: 40, scatterBoth: true, sizeC: "off" }),
    P("leaves", "Leaves", { tip: "t:leaf", size: 50, spacing: 60, scatter: 110, scatterBoth: true, count: 2, angleJ: 100, sizeJ: 50, sizeMin: 20, fgbgJ: 60, hueJ: 6, sizeC: "off" }),
    P("stars", "Stars", { tip: "t:star", size: 30, spacing: 120, scatter: 140, scatterBoth: true, angleJ: 30, sizeJ: 70, sizeC: "off", briJ: 15 }),
    P("grass", "Grass", { tip: "t:grass", size: 70, spacing: 30, scatter: 30, sizeJ: 45, angleJ: 8, fgbgJ: 50, sizeC: "off" }),
    P("hatch", "Hatching", { tip: "t:hatch", size: 40, spacing: 70, opJ: 20, sizeC: "off" }),
    P("pixel", "Square pixel", { tip: "t:square", size: 8, spacing: 50, hard: 1, sizeC: "off" })
  ];
  var USER = [];
  PP.presets = function () { return BUILTIN.concat(USER); };
  PP.lib.all("tip").then(function (a) {
    var budget = 64e6;      // stored tips are loaded within a pixel budget too
    a.forEach(function (r) { if (r.data && r.w > 0 && r.h > 0 && r.w <= 2500 && r.h <= 2500 && r.data.length === r.w * r.h && (budget -= r.w * r.h) >= 0) tipFromGray(r.id, String(r.name || "Tip").slice(0, 60), r.w, r.h, r.data); });
    return PP.lib.all("brush");
  }).then(function (a) { USER = a.filter(function (r) { return r.s && typeof r.s === "object"; }).map(function (r) { return { id: r.id, name: String(r.name || "Brush").slice(0, 60), s: r.s }; }); PP.refreshPanel("brushes"); }).catch(function () {});
  var SAFE = Object.keys(PP.BDEF).concat(["hard", "size", "op"]);
  function applyPreset(tool, pr) {
    var o = ED.o[tool]; if (!o) return;
    var keepSize = PP.lockSize && o.size;
    PP.DYN_KEYS.forEach(function (k) { if (["sym", "symN", "symX", "symY"].indexOf(k) < 0) o[k] = PP.BDEF[k]; });
    Object.keys(pr.s).forEach(function (k) { if (SAFE.indexOf(k) >= 0 && typeof pr.s[k] === typeof PP.BDEF[k]) o[k] = pr.s[k]; });
    if (keepSize) o.size = keepSize;
    PP.clampBrush(o);
    if (o.tip && !PP.tips[o.tip]) o.tip = "";
    o.preset = pr.id;
    ED.saveOpts(); if (ED.tool === tool) ED.ui.buildOpts(); ED.renderOvl(); PP.refreshPanel("brushes");
  }
  PP.applyPreset = applyPreset;
  function nameDialog(title, def, run) {
    var i = h("input", { "class": "input", value: def, maxlength: "60", dir: "auto", "aria-label": "Name" });
    var dlg = K.modal(title, h("div", { "class": "stack" }, [K.field("Name", i)]), [h("span", { "class": "grow" }), K.btn("Cancel", function () { dlg.close(); }, "ghost"), K.btn("Save", function () { var v = i.value.trim().slice(0, 60) || def; dlg.close(); run(v); }, "primary")]);
  }
  PP.savePreset = function (tool) {
    var o = ED.o[tool];
    nameDialog("Save brush preset", "My brush", function (name) {
      var s = {}; SAFE.forEach(function (k) { if (o[k] !== undefined && ["sym", "symN", "symX", "symY"].indexOf(k) < 0) s[k] = o[k]; });
      var pr = { id: PE.uid("p"), name: name, s: s }; USER.push(pr);
      PP.lib.put({ id: pr.id, kind: "brush", name: name, s: s, order: Date.now() }).catch(function () {});
      PP.refreshPanel("brushes"); S3.toast("Saved the brush “" + name + "”");
    });
  };
  function deletePreset(pr) {
    USER = USER.filter(function (x) { return x !== pr; }); PP.lib.del(pr.id).catch(function () {});
    var tip = pr.s && pr.s.tip; if (tip && PP.tips[tip] && !PP.tips[tip].builtin && !USER.some(function (u) { return u.s.tip === tip; })) { delete PP.tips[tip]; PP.lib.del(tip).catch(function () {}); }
    PP.refreshPanel("brushes");
  }
  PP.deletePreset = deletePreset;
  // Save a new sampled tip + a preset using it
  function addTip(name, w, hh, gray, spacing) {
    var id = PE.uid("tip"); tipFromGray(id, name, w, hh, gray);
    PP.lib.put({ id: id, kind: "tip", name: name, w: w, h: hh, data: gray }).catch(function () {});
    var pr = { id: PE.uid("p"), name: name, s: { tip: id, size: Math.min(1000, Math.max(w, hh)), spacing: PE.clamp(spacing || 25, 1, 300), sizeC: "off", hard: 1 } };
    USER.push(pr); PP.lib.put({ id: pr.id, kind: "brush", name: name, s: pr.s, order: Date.now() }).catch(function () {});
    return pr;
  }
  PP.addTip = addTip;
  // For library import: a tip without a preset (returns its new id), and a preset from settings.
  PP.importTip = function (name, w, hh, gray) { var id = PE.uid("tip"); tipFromGray(id, name, w, hh, gray); PP.lib.put({ id: id, kind: "tip", name: name, w: w, h: hh, data: gray }).catch(function () {}); return id; };
  PP.addPreset = function (name, s, quiet) {
    var clean = {}; Object.keys(s || {}).forEach(function (k) { if (SAFE.indexOf(k) >= 0 && typeof s[k] === typeof PP.BDEF[k]) clean[k] = s[k]; });
    PP.clampBrush(clean); if (clean.tip && !PP.tips[clean.tip]) clean.tip = "";
    var pr = { id: PE.uid("p"), name: String(name || "Brush").slice(0, 60), s: clean }; USER.push(pr);
    PP.lib.put({ id: pr.id, kind: "brush", name: pr.name, s: clean, order: Date.now() }).catch(function () {}); if (!quiet) PP.refreshPanel("brushes");
    return pr;
  };

  // ---------- thumbnails ----------
  var THUMB = new Map();
  function thumb(pr) {
    var key = pr.id + "|" + JSON.stringify(pr.s); if (THUMB.has(key)) return THUMB.get(key);
    var o = Object.assign({}, PP.BDEF, { size: 30, hard: 0.8, op: 1 }, pr.s), base = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#ddd";
    o.size = Math.min(o.size, 34); if (o.scatter) o.scatter = Math.min(o.scatter, 60);
    var c = PP.previewStroke(o, 200, 56, base); THUMB.set(key, c); return c;
  }
  function tile(tool, pr, onPick) {
    var o = ED.o[tool], cv = h("canvas", { width: "200", height: "56" }); cv.getContext("2d").drawImage(thumb(pr), 0, 0);
    var b = h("button", { type: "button", "class": "pp-bpre" + (o && o.preset === pr.id ? " on" : ""), title: pr.name + (pr.builtin ? "" : " (Alt+click deletes)"), "aria-label": pr.name }, [cv, h("span", { text: pr.name })]);
    b.addEventListener("click", function (e) { if (e.altKey && !pr.builtin) { deletePreset(pr); if (onPick) onPick(null); return; } applyPreset(tool, pr); if (onPick) onPick(pr); });
    return b;
  }
  function paintTool() { return PP.spec[ED.tool] ? ED.tool : "brush"; }

  // ---------- picker in the options bar ----------
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  PP.presetPicker = function (tool, anchor) {
    if (pop) { closePop(); return; }
    var o = ED.o[tool];
    pop = h("div", { "class": "pp-pop", role: "dialog", "aria-label": "Brush presets" });
    var grid = h("div", { "class": "pp-bgrid" });
    function fill() { grid.textContent = ""; PP.presets().forEach(function (pr) { grid.appendChild(tile(tool, pr, function (x) { if (x) closePop(); else fill(); })); }); }
    pop.appendChild(K.range("Size", o.size, 1, 1000, 1, function (v) { o.size = v; ED.saveOpts(); ED.renderOvl(); }, function (v) { return v + " px"; }));
    pop.appendChild(grid); fill();
    pop.appendChild(h("div", { "class": "pp-acts" }, [K.btn("Brush settings…", function () { closePop(); PP.settingsDialog(tool); }, "ghost"), K.btn("Save preset…", function () { closePop(); PP.savePreset(tool); }, "ghost")]));
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.left = Math.max(4, Math.min(r.left, innerWidth - w - 4)) + "px"; pop.style.top = (r.bottom + 6) + "px";
  };
  document.addEventListener("pointerdown", function (e) { if (pop && !pop.contains(e.target) && !e.target.closest(".pp-tipbtn")) closePop(); }, true);
  document.addEventListener("keydown", function (e) { if (pop && e.key === "Escape") { e.stopPropagation(); closePop(); } }, true);
  ED.on("tool", closePop);

  // ---------- .abr import ----------
  var file = null;
  PP.importAbr = function (u8, fname) {
    return PP.work("readAbr", [u8]).then(function (list) {
      if (!list.length) throw new Error("No sampled brushes in " + fname);
      var base = String(fname || "Brushes").replace(/\.abr$/i, "").slice(0, 40);
      list.forEach(function (b, i) { addTip(b.name && !/^Brush \d+$/.test(b.name) ? b.name : base + " " + (i + 1), b.w, b.h, b.data, b.spacing); });
      PP.refreshPanel("brushes"); S3.toast("Imported " + list.length + " brush" + (list.length > 1 ? "es" : ""));
      return list.length;
    });
  };
  function pickAbr() {
    if (!file) {
      file = h("input", { type: "file", accept: ".abr", multiple: true, hidden: true }); document.body.appendChild(file);
      file.addEventListener("change", function () {
        var fs = Array.prototype.slice.call(file.files); file.value = "";
        fs.forEach(function (f) {
          if (f.size > 60e6) { S3.toast(f.name + " is too large", "error"); return; }
          ED.working(f.arrayBuffer().then(function (ab) { return PP.importAbr(new Uint8Array(ab), f.name); }), "Reading brushes…").catch(function (e) { S3.toast(e.message, "error"); });
        });
      });
    }
    file.click();
  }

  // ---------- Edit › Define brush from selection ----------
  PP.defineBrush = function (name) {
    var d = ED.doc; if (!d || !d.sel) { S3.toast("Select the shape to make a brush from first", "error"); return null; }
    var b = d.sel.b, img = PE.getData(PE.flatten(d, { rect: b })), sm = PE.selFor(d, b), n = b.w * b.h, gray = new Uint8Array(n);
    for (var i = 0; i < n; i++) { var q = i * 4, l = img.data[q] * 0.299 + img.data[q + 1] * 0.587 + img.data[q + 2] * 0.114; gray[i] = Math.round((255 - l) * img.data[q + 3] / 255 * sm[i] / 255); }
    var k = Math.min(1, 1000 / Math.max(b.w, b.h)), w = b.w, hh = b.h;
    if (k < 1) {
      w = Math.max(1, Math.round(b.w * k)); hh = Math.max(1, Math.round(b.h * k));
      var t = tipFromGray("_tmp", "", b.w, b.h, gray), c = PE.mk(w, hh), x = PE.cx2(c); x.imageSmoothingQuality = "high"; x.drawImage(t.canvas, 0, 0, w, hh);
      var a = x.getImageData(0, 0, w, hh).data; gray = new Uint8Array(w * hh); for (i = 0; i < gray.length; i++) gray[i] = a[i * 4 + 3]; delete PP.tips._tmp;
    }
    var pr = addTip(name || "Custom brush", w, hh, gray, 25);
    applyPreset(paintTool(), pr);
    return pr;
  };
  PP.menu("Edit", [["Define brush from selection…", "", function () {
    if (!K.need()) return;
    if (!ED.doc.sel) { S3.toast("Select the shape to make a brush from first (dark pixels paint)", "error"); return; }
    nameDialog("Define brush", "Custom brush", function (n) { var pr = PP.defineBrush(n); if (pr) { if (!PP.spec[ED.tool]) ED.setTool("brush"); S3.toast("New brush “" + n + "” is selected"); } });
  }, function () { return !!(ED.doc && ED.doc.sel); }]], "Fill with surroundings…");

  // ---------- Brushes tab ----------
  PP.panelTab("brushes", "Brushes", function (el) {
    var tool = paintTool(), grid = h("div", { "class": "pp-bgrid pp-bgrid-side" });
    el.appendChild(h("div", { "class": "pp-sub" }, [h("span", { "class": "faint", text: "For: " + ((ED.uiTOOLS.filter(function (r) { return r[0] === tool; })[0] || [0, tool])[1]) })]));
    PP.presets().forEach(function (pr) { grid.appendChild(tile(tool, pr)); });
    el.appendChild(grid);
    el.appendChild(h("div", { "class": "pp-acts" }, [K.btn("Settings…", function () { PP.settingsDialog(tool); }, "ghost"), K.btn("Save…", function () { PP.savePreset(tool); }, "ghost"), K.btn("Import .abr", pickAbr, "ghost", null, "Import sampled brushes from an .abr file")]));
  });
  ED.on("tool", function () { PP.refreshPanel("brushes"); });
})();
