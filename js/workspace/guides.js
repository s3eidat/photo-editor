/* Workspace (files lane): guides (drag from the rulers, move with the Move tool, drag back onto a ruler to delete,
   New guide…, New guide layout… with columns / rows / gutters / margins, lock, clear) and the grid.
   Guides belong to the document: they are undoable, saved in projects and in PSD files. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, h = S3.h;
  var G = WS.guides = { dragging: null };
  var MAXG = 400;

  function list() { return (ED.doc && ED.doc.guides) || []; }
  function valid(raw, doc) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAXG).map(function (g) {
      if (!g || (g.dir !== "h" && g.dir !== "v")) return null;
      var v = WS.num(g.pos, -3 * PE.LIM.side, 4 * PE.LIM.side); return v == null ? null : { dir: g.dir, pos: v };
    }).filter(Boolean);
  }
  G.valid = valid;
  WS.fields.guides = { save: function (doc) { return doc.guides && doc.guides.length ? doc.guides.map(function (g) { return { dir: g.dir, pos: g.pos }; }) : undefined; },
    open: function (raw, doc) { var v = valid(raw, doc); if (v.length) doc.guides = v; } };

  G.add = function (dir, pos) {
    if (list().length >= MAXG) { S3.toast("That is the most guides a document can have (" + MAXG + ")", "error"); return; }
    WS.edit("New guide", "guides", function (d) { d.guides = (d.guides || []).concat([{ dir: dir, pos: Math.round(pos * 1000) / 1000 }]); });
    if (!WS.p.guides) WS.set("guides", true);
  };
  G.clear = function () { if (list().length) WS.edit("Clear guides", "guides", function (d) { d.guides = []; }); };

  // ---------- drawing ----------
  function lineAt(c, dir, pos, color, dash) {
    var z = ED.zoom, stage = ED.stage.getBoundingClientRect(), d = ED.doc;
    c.strokeStyle = color; c.lineWidth = 1; c.setLineDash(dash || []); c.beginPath();
    if (dir === "h") { var y = Math.round(pos * z + ED.panY) + 0.5; c.moveTo(0, y); c.lineTo(stage.width, y); }
    else { var x = Math.round(pos * z + ED.panX) + 0.5; c.moveTo(x, 0); c.lineTo(x, stage.height); }
    c.stroke(); c.setLineDash([]);
    void d;
  }
  G.lineAt = lineAt;
  function drawGrid(c) {
    var d = ED.doc, z = ED.zoom, every = WS.fromUnit(WS.p.gridEvery, WS.p.gridUnit, "x"), sub = Math.max(1, Math.round(WS.p.gridSub));
    if (!(every > 0)) return;
    var step = every / sub, minor = step * z >= 6, x0 = ED.panX, y0 = ED.panY, W = d.w * z, H = d.h * z;
    c.save(); c.beginPath(); c.rect(x0, y0, W, H); c.clip();
    var col = WS.p.gridColor;
    function pass(st, alpha) {
      c.globalAlpha = alpha; c.strokeStyle = col; c.lineWidth = 1; c.beginPath();
      for (var x = 0; x <= d.w + 1e-6; x += st) { var sx = Math.round(x0 + x * z) + 0.5; c.moveTo(sx, y0); c.lineTo(sx, y0 + H); }
      for (var y = 0; y <= d.h + 1e-6; y += st) { var sy = Math.round(y0 + y * z) + 0.5; c.moveTo(x0, sy); c.lineTo(x0 + W, sy); }
      c.stroke();
    }
    if (minor && sub > 1 && (d.w / step) * (d.h / step) < 250000) pass(step, 0.22);
    if (every * z >= 4) pass(every, 0.55);
    c.restore();
  }
  (ED.ovlExt = ED.ovlExt || []).push(function (c) {
    var d = ED.doc; if (!d) return;
    if (WS.p.grid) drawGrid(c);
    if (WS.p.guides) list().forEach(function (g) { lineAt(c, g.dir, g.pos, WS.p.guideColor); });
    var gd = G.dragging;
    if (gd) {
      lineAt(c, gd.dir, gd.pos, gd.out ? "rgba(128,128,128,.6)" : WS.p.guideColor, gd.out ? [4, 4] : null);
      var s = gd.dir === "h" ? ED.toScr(0, gd.pos) : ED.toScr(gd.pos, 0), r = ED.stage.getBoundingClientRect(), lab = gd.out ? "Delete" : WS.fmt(gd.pos, null, gd.dir === "h" ? "y" : "x");
      c.font = "11px " + (getComputedStyle(document.documentElement).getPropertyValue("--mono") || "monospace");
      var tx = gd.dir === "h" ? 28 : Math.min(r.width - 70, s.x + 6), ty = gd.dir === "h" ? Math.max(14, s.y - 6) : 34, tw = c.measureText(lab).width + 8;
      c.fillStyle = "rgba(0,0,0,.72)"; c.fillRect(tx - 4, ty - 12, tw, 16); c.fillStyle = "#fff"; c.fillText(lab, tx, ty);
    }
  });

  // ---------- moving guides with the Move tool ----------
  function hit(p) {
    if (!ED.doc || !WS.p.guides || WS.p.lockGuides || ED.tool !== "move" || ED.xf) return -1;
    var L = list(), tol = 4 / ED.zoom, best = -1, bd = tol;
    for (var i = 0; i < L.length; i++) { var dd = Math.abs((L[i].dir === "h" ? p.y : p.x) - L[i].pos); if (dd <= bd) { bd = dd; best = i; } }
    return best;
  }
  var prevCursor = ED.cursorExt;
  ED.cursorExt = function (p) { var i = hit(p); if (i >= 0) return list()[i].dir === "h" ? "row-resize" : "col-resize"; return prevCursor ? prevCursor(p) : null; };
  var prevDown = ED.downExt;
  ED.downExt = function (p, e, s) {
    var i = hit(p);
    if (i < 0) return prevDown ? prevDown(p, e, s) : false;
    var d = ED.doc, g0 = list()[i], before = PE.clone(d.guides), stage = ED.stage, g = { dir: g0.dir, pos: g0.pos };
    d.guides = d.guides.filter(function (x, k) { return k !== i; });
    function at(ev) {
      var r = stage.getBoundingClientRect(), sp = { x: ev.clientX - r.left, y: ev.clientY - r.top }, q = ED.toDoc(sp.x, sp.y), v = g.dir === "h" ? q.y : q.x;
      if (WS.snap1 && !ev.ctrlKey) v = WS.snap1(v, g.dir === "h" ? "y" : "x", true);
      g.pos = Math.round(v * 1000) / 1000; g.out = WS.p.rulers ? (g.dir === "h" ? sp.y < 20 : sp.x < 20) : (g.dir === "h" ? sp.y < 0 || sp.y > r.height : sp.x < 0 || sp.x > r.width);
      G.dragging = g; ED.renderOvl(); if (WS.rulers) WS.rulers.render();
    }
    function move(ev) { at(ev); }
    function up(ev) {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      G.dragging = null; d.guides = before;
      if (ev.type !== "pointerup") { ED.renderOvl(); return; }
      if (g.out) WS.edit("Delete guide", "guides", function (dd) { dd.guides = dd.guides.filter(function (x, k) { return k !== i; }); });
      else if (g.pos !== g0.pos) WS.edit("Move guide", "guides", function (dd) { dd.guides = dd.guides.map(function (x, k) { return k === i ? { dir: g.dir, pos: g.pos } : x; }); });
      ED.renderOvl();
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    at(e);
    return true;
  };

  // ---------- dialogs ----------
  var W = ED.ui.w;
  function unitSel(val, onSet) { return W.select("Units", WS.UNITS, val, onSet); }
  G.newDialog = function () {
    if (!FX.need()) return;
    var dir = "h", unit = WS.p.units, pos = h("input", { type: "number", "class": "input", step: "any", value: "0" });
    var body = h("div", { "class": "stack" }, [W.seg("Orientation", [["h", "Horizontal"], ["v", "Vertical"]], dir, function (v) { dir = v; }),
      h("div", { "class": "pe-custom" }, [W.field("Position", pos), unitSel(unit, function (v) { unit = v; })])]);
    var go = W.btn("Add", function () { var v = WS.fromUnit(+pos.value || 0, unit, dir === "h" ? "y" : "x"); dlg.close(); G.add(dir, v); }, "primary");
    var dlg = W.modal("New guide", body, [h("span", { "class": "grow" }), go]);
  };
  // Columns / rows with gutters inside margins -> guides at every column and gutter edge
  G.layout = function (o, doc) {
    doc = doc || ED.doc; var out = [], m = o.margin || [0, 0, 0, 0];      // top, left, bottom, right (px)
    function axis(n, gut, a0, a1, dir) {
      if (!(n > 0)) return;
      var span = a1 - a0, w = (span - gut * (n - 1)) / n;
      if (w <= 0) return;
      for (var i = 0; i < n; i++) { var s = a0 + i * (w + gut); out.push({ dir: dir, pos: s }); out.push({ dir: dir, pos: s + w }); }
    }
    if (o.margins) { out.push({ dir: "h", pos: m[0] }, { dir: "v", pos: m[1] }, { dir: "h", pos: doc.h - m[2] }, { dir: "v", pos: doc.w - m[3] }); }
    axis(o.cols, o.colGut || 0, o.margins ? m[1] : 0, doc.w - (o.margins ? m[3] : 0), "v");
    axis(o.rows, o.rowGut || 0, o.margins ? m[0] : 0, doc.h - (o.margins ? m[2] : 0), "h");
    var seen = {};
    return out.map(function (g) { return { dir: g.dir, pos: Math.round(g.pos * 1000) / 1000 }; }).filter(function (g) { var k = g.dir + g.pos; if (seen[k]) return false; seen[k] = 1; return true; });
  };
  G.layoutDialog = function () {
    if (!FX.need()) return;
    var st = Object.assign({ cols: 8, colGut: 20, rows: 0, rowGut: 20, margins: false, m: [40, 40, 40, 40], clear: true }, S3.store("pe-guidelayout") || {}), unit = "px";
    function num(v, step) { return h("input", { type: "number", "class": "input", min: "0", step: step || "any", value: String(v) }); }
    var cI = num(st.cols, "1"), cg = num(st.colGut), rI = num(st.rows, "1"), rg = num(st.rowGut), mI = st.m.map(function (v) { return num(v); });
    var mBox = h("div", { "class": "pe-custom" }, [W.field("Top", mI[0]), W.field("Left", mI[1]), W.field("Bottom", mI[2]), W.field("Right", mI[3])]);
    var body = h("div", { "class": "stack" }, [
      h("div", { "class": "pe-custom" }, [W.field("Columns", cI), W.field("Column gutter", cg)]),
      h("div", { "class": "pe-custom" }, [W.field("Rows", rI), W.field("Row gutter", rg)]),
      W.check("Margins", st.margins, function (v) { st.margins = v; mBox.hidden = !v; preview(); }), mBox,
      unitSel(unit, function (v) { unit = v; }), W.check("Clear existing guides", st.clear, function (v) { st.clear = v; preview(); })]);
    mBox.hidden = !st.margins;
    var keep = PE.clone(ED.doc.guides);
    function read() {
      function px(i, axis) { return Math.max(0, WS.fromUnit(+i.value || 0, unit, axis)); }
      st.cols = Math.min(100, Math.round(+cI.value || 0)); st.rows = Math.min(100, Math.round(+rI.value || 0));
      st.colGut = px(cg, "x"); st.rowGut = px(rg, "y"); st.m = [px(mI[0], "y"), px(mI[1], "x"), px(mI[2], "y"), px(mI[3], "x")];
      return { cols: st.cols, rows: st.rows, colGut: st.colGut, rowGut: st.rowGut, margins: st.margins, margin: st.m };
    }
    function preview() { var g = G.layout(read()); ED.doc.guides = (st.clear ? [] : (keep || [])).concat(g).slice(0, MAXG); if (!WS.p.guides) WS.set("guides", true); ED.renderOvl(); }
    [cI, cg, rI, rg].concat(mI).forEach(function (i) { i.addEventListener("input", preview); });
    var ok = false;
    var go = W.btn("Add guides", function () {
      ok = true; var next = ED.doc.guides; ED.doc.guides = keep;
      S3.store("pe-guidelayout", { cols: st.cols, colGut: +cg.value || 0, rows: st.rows, rowGut: +rg.value || 0, margins: st.margins, m: mI.map(function (i) { return +i.value || 0; }), clear: st.clear });
      dlg.close(); WS.edit("New guide layout", "guides", function (d) { d.guides = next; });
    }, "primary");
    var dlg = W.modal("New guide layout", body, [h("span", { "class": "grow" }), W.btn("Cancel", function () { dlg.close(); }, "ghost"), go]);
    var mo = new MutationObserver(function () { if (!document.body.contains(dlg.el)) { mo.disconnect(); if (!ok && ED.doc) { ED.doc.guides = keep; ED.renderOvl(); } } });
    mo.observe(document.body, { childList: true });
    preview();
  };
  G.gridDialog = function () {
    var every = h("input", { type: "number", "class": "input", min: "0.01", step: "any", value: String(WS.p.gridEvery) }), unit = WS.p.gridUnit;
    var sub = h("input", { type: "number", "class": "input", min: "1", max: "64", step: "1", value: String(WS.p.gridSub) }), col = h("input", { type: "color", value: WS.p.gridColor });
    var gcol = h("input", { type: "color", value: WS.p.guideColor });
    var body = h("div", { "class": "stack" }, [h("div", { "class": "pe-custom" }, [W.field("Gridline every", every), unitSel(unit, function (v) { unit = v; }), W.field("Subdivisions", sub)]),
      h("div", { "class": "pe-custom" }, [h("label", { "class": "pe-of" }, [h("span", { text: "Grid colour" }), col]), h("label", { "class": "pe-of" }, [h("span", { text: "Guide colour" }), gcol])])]);
    var go = W.btn("OK", function () {
      var e = +every.value; if (!(e > 0)) { S3.toast("Enter a grid spacing", "error"); return; }
      WS.set("gridEvery", e); WS.set("gridUnit", unit); WS.set("gridSub", PE.clamp(Math.round(+sub.value || 1), 1, 64)); WS.set("gridColor", col.value); WS.set("guideColor", gcol.value);
      if (!WS.p.grid) WS.set("grid", true);
      dlg.close();
    }, "primary");
    var dlg = W.modal("Guides & grid", body, [h("span", { "class": "grow" }), go]);
  };

  // ---------- self-test ----------
  FX.tests.push(async function (ok, near) {
    var d = PE.newDoc(1000, 500, "g"), L = G.layout({ cols: 4, colGut: 20, rows: 0, margins: true, margin: [10, 40, 10, 40] }, d);
    var v = L.filter(function (g) { return g.dir === "v"; }).map(function (g) { return g.pos; }).sort(function (a, b) { return a - b; });
    // 4 columns in 920 px with 3 gutters of 20: width 215 -> edges 40,255,275,490,510,725,745,960
    ok(v.join() === "40,255,275,490,510,725,745,960" && L.filter(function (g) { return g.dir === "h"; }).length === 2, "guide layout maths " + v.join());
    ok(valid([{ dir: "h", pos: 5 }, { dir: "x", pos: 1 }, { dir: "v", pos: "1e99" }, null, { dir: "v", pos: 7.5 }]).length === 3, "guides validated");
    // undoable + saved in projects
    var keep = { doc: ED.doc, hist: ED.hist };
    var td = PE.newDoc(100, 80, "g2"); td.layers = [PE.rasterFromCanvas(PE.mk(100, 80), "b")]; ED.doc = td; ED.hist = new PE.History(1e8, 60);
    G.add("h", 30); G.add("v", 12.5); ok(td.guides.length === 2, "add guides");
    ED.undo(); ok(td.guides.length === 1, "undo guide"); ED.redo(); ok(td.guides.length === 2, "redo guide");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(td)).arrayBuffer()));
    ok(od.guides && od.guides.length === 2 && od.guides[1].pos === 12.5 && od.guides[1].dir === "v", "guides saved in projects");
    ok(near(WS.toUnit(300, "in", "x", { dpi: 300, w: 1, h: 1 }), 1, 1e-9) && near(WS.toUnit(118.11, "cm", "x", { dpi: 300 }), 1, 1e-3) && near(WS.fromUnit(50, "%", "y", { h: 80 }), 40, 1e-9), "unit conversions");
    ED.doc = keep.doc; ED.hist = keep.hist;
  });
})();
