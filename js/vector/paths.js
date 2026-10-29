/* Vector lane: Paths panel. Work path, saved paths and the selected shape layer's outline; new, save, rename
   (double-click), duplicate, delete; fill path, stroke path (brush, pencil or eraser tip, optional taper), load as
   selection (feather, anti-alias, new / add / subtract / intersect), make a path from the selection, path to shape layer. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, UI = VX.ui, h = S3.h;

  function doc() { return ED.doc; }
  function curComps() { var t = VX.target(); return t ? t.get() : null; }
  function needPath() { var cs = curComps(); if (!cs || !cs.length) { S3.toast("Draw or select a path first (pen tool, P)", "error"); return null; } return cs; }
  // rings with operations applied (non-overlapping), for filling and selections
  function ringsOf(cs) {
    var b = VG.bounds(cs) || { w: 100, h: 100 }, tol = Math.max(0.05, Math.max(b.w, b.h) / 6000);
    var closed = cs.map(function (c) { return { op: c.op, closed: true, pts: c.pts }; });
    return VG.combine(closed, tol);
  }
  VX.ringsOf = ringsOf;

  // ---------- path -> selection ----------
  function maskOf(cs, aa) {
    var d = doc(), rings = ringsOf(cs), b = VG.bounds(cs);
    if (!b) return new Uint8Array(d.w * d.h);
    var m = PE.pathMask(d, b, function (c) { c.beginPath(); VG.traceRings(c, rings, true); });
    if (aa === false) for (var i = 0; i < m.length; i++) m[i] = m[i] >= 128 ? 255 : 0;
    return m;
  }
  VX.maskOf = maskOf;
  VX.pathToSelection = function (opts) {
    var cs = needPath(); if (!cs) return;
    opts = opts || {};
    ED.setSelection(maskOf(cs, opts.aa), opts.mode || "new", "Make selection", opts.feather || 0);
  };
  function selectionDialog() {
    var cs = needPath(); if (!cs) return;
    var w = ED.ui.w, st = { feather: 0, aa: true, mode: "new" };
    var body = h("div", { "class": "stack" }, [w.field("Feather radius (px)", w.numInput(0, 0, 250, function (v) { st.feather = v; }, 0.5)), w.check("Anti-aliased", true, function (v) { st.aa = v; }),
      w.seg("Operation", [["new", "New"], ["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]], doc().sel ? "new" : "new", function (v) { st.mode = v; })]);
    var go = w.btn("OK", function () { dlg.close(); VX.pathToSelection(st); }, "primary");
    var dlg = w.modal("Make selection", body, [h("span", { "class": "grow" }), go]);
  }

  // ---------- selection -> path ----------
  VX.selectionToPath = function (tol) {
    var d = doc(); if (!d || !d.sel) { S3.toast("Make a selection first", "error"); return; }
    tol = tol == null ? 2 : tol;
    ED.working(VX.work("maskToComps", [d.sel.m, d.w, d.h, tol]), "Making path…").then(function (cs) {
      if (!cs.length) { S3.toast("The selection is too small to trace", "error"); return; }
      VX.pathEdit("Make work path", function () { d.work = { id: "work", name: "Work path", comps: cs }; d.apath = "work"; });
      VX.clearPathSel(); ED.renderOvl(); render();
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  function selToPathDialog() {
    if (!doc() || !doc().sel) { S3.toast("Make a selection first", "error"); return; }
    var w = ED.ui.w, tol = 2;
    var body = h("div", { "class": "stack" }, [w.field("Tolerance (px)", w.numInput(2, 0.5, 10, function (v) { tol = v; }, 0.5)), h("p", { "class": "faint pe-p", text: "Lower follows the edge more closely with more anchor points." })]);
    var go = w.btn("OK", function () { dlg.close(); VX.selectionToPath(tol); }, "primary");
    var dlg = w.modal("Make work path", body, [h("span", { "class": "grow" }), go]);
  }

  // ---------- fill / stroke onto the current layer ----------
  function pixelTarget() {
    var L = ED.layer(); if (!ED.editable(L, "pixels")) return null;
    if (ED.maskEdit && !L.mask) ED.maskEdit = false;
    return L;
  }
  // draw(ctx) paints in layer-local coords; composite with opacity (destination-out for erasing)
  function paintOnLayer(label, L, bbox, draw, op, erase) {
    var d = doc(), mask = ED.maskEdit && L.mask, before = PE.snap(d);
    var grew = mask ? PE.ensureMaskCovers(L, ED.docRect()) : PE.ensureCovers(L, ED.docRect()), hd = mask ? L.mask : L;
    var g = grew ? PE.metaEntry("Grow", d, before) : null;
    var r = PE.inter(PE.rectI({ x: bbox.x - hd.x - 2, y: bbox.y - hd.y - 2, w: bbox.w + 4, h: bbox.h + 4 }), { x: 0, y: 0, w: hd.canvas.width, h: hd.canvas.height });
    if (!r) { ED.push(g); return; }
    var e = PE.editPixels(d, label, hd, "canvas", r, function (c, cv) {
      var t = PE.mk(cv.width, cv.height), tc = PE.cx2(t);
      tc.translate(-hd.x, -hd.y); draw(tc, mask); tc.setTransform(1, 0, 0, 1, 0, 0);
      c.save(); c.globalAlpha = PE.clamp(op == null ? 1 : op, 0, 1);
      if (erase || (mask && draw.hide)) c.globalCompositeOperation = "destination-out";
      c.drawImage(t, 0, 0); c.restore();
    });
    ED.push(PE.compound(label, [g, e]));
  }
  VX.fillPath = function (color, op) {
    var cs = needPath(); if (!cs) return; var L = pixelTarget(); if (!L) return;
    var rings = ringsOf(cs), b = VG.bounds(cs);
    color = color || doc().fg;
    function draw(c, mask) {
      var col = color;
      if (mask) { var q = PE.rgbOf(color), lum = q[0] * 0.299 + q[1] * 0.587 + q[2] * 0.114; col = "#ffffff"; draw.hide = lum < 128; }
      c.beginPath(); VG.traceRings(c, rings, true); c.fillStyle = col; c.fill("nonzero");
    }
    paintOnLayer("Fill path", L, b, draw, op);
  };
  // dabs of the brush tip along the path; taper = simulate pressure (thin - full - thin)
  VX.strokePath = function (tool, taper) {
    var cs = needPath(); if (!cs) return; var L = pixelTarget(); if (!L) return;
    tool = tool || "brush";
    var o = ED.o[tool === "eraser" ? "eraser" : "brush"], size = o.size, hard = tool === "pencil" ? 1 : o.hard, op = o.op, b = VG.bounds(cs);
    var color = doc().fg;
    function draw(c, mask) {
      var col = mask ? "#ffffff" : color;
      if (mask && tool !== "eraser") { var q = PE.rgbOf(color); draw.hide = q[0] * 0.299 + q[1] * 0.587 + q[2] * 0.114 < 128; }
      VG.flatten(cs, 0.25).forEach(function (r, i) {
        if (cs[i].closed && r.length) r = r.concat([r[0]]);
        var total = 0, k; for (k = 1; k < r.length; k++) total += Math.hypot(r[k].x - r[k - 1].x, r[k].y - r[k - 1].y);
        var step = Math.max(0.5, size * (tool === "pencil" ? 0.08 : 0.12)), acc = 0, next = 0;
        function dab(x, y, s) { var rad = Math.max(0.5, size / 2 * (taper ? Math.max(0.05, Math.sin(Math.PI * PE.clamp(s / Math.max(total, 1e-6), 0, 1))) : 1)); if (tool === "pencil") { c.fillStyle = col; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); } else ED.tipFill(c, x, y, rad, hard, col); }
        if (r.length === 1) { dab(r[0].x, r[0].y, 0); return; }
        for (k = 1; k < r.length; k++) {
          var a = r[k - 1], bq = r[k], seg = Math.hypot(bq.x - a.x, bq.y - a.y);
          while (next <= acc + seg) { var t = seg ? (next - acc) / seg : 0; dab(a.x + (bq.x - a.x) * t, a.y + (bq.y - a.y) * t, next); next += step; }
          acc += seg;
        }
      });
    }
    var pad = size;
    paintOnLayer("Stroke path", L, { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, draw, op, tool === "eraser");
  };
  function fillDialog() {
    if (!needPath()) return;
    var w = ED.ui.w, st = { use: "fg", op: 1 };
    var body = h("div", { "class": "stack" }, [w.seg("Use", [["fg", "Foreground"], ["bg", "Background"], ["#000000", "Black"], ["#ffffff", "White"], ["#808080", "50% grey"]], "fg", function (v) { st.use = v; }),
      w.range("Opacity", 1, 0.01, 1, 0.01, function (v) { st.op = v; }, w.pct), h("p", { "class": "faint pe-p", text: "Paints the inside of the path on the current layer." })]);
    var go = w.btn("Fill", function () { dlg.close(); VX.fillPath(st.use === "fg" ? doc().fg : st.use === "bg" ? doc().bg : st.use, st.op); }, "primary");
    var dlg = w.modal("Fill path", body, [h("span", { "class": "grow" }), go]);
  }
  function strokeDialog() {
    if (!needPath()) return;
    var w = ED.ui.w, st = { tool: "brush", taper: false };
    var body = h("div", { "class": "stack" }, [w.seg("Tool", [["brush", "Brush"], ["pencil", "Pencil"], ["eraser", "Eraser"]], "brush", function (v) { st.tool = v; }),
      w.check("Simulate pressure (taper the ends)", false, function (v) { st.taper = v; }),
      h("p", { "class": "faint pe-p", text: "Uses that tool's size, hardness and opacity, and the foreground colour." })]);
    var go = w.btn("Stroke", function () { dlg.close(); VX.strokePath(st.tool, st.taper); }, "primary");
    var dlg = w.modal("Stroke path", body, [h("span", { "class": "grow" }), go]);
  }

  // ---------- path -> shape layer ----------
  VX.pathToShape = function () {
    var cs = needPath(); if (!cs) return;
    var d = doc(), o = ED.o.shape, n = d.layers.filter(function (x) { return /^Shape \d+$/.test(x.name); }).length + 1;
    var L = PE.newLayer("shape", { name: "Shape " + n, shape: { type: "path", x: 0, y: 0, w: 1, h: 1, comps: [], fill: o.noFill ? "" : PE.hex(o.fill, d.fg), stroke: PE.hex(o.stroke, "#111111"), sw: o.sw || 0 } });
    VX.setDocComps(L, VG.clone(cs));
    d.apath = null;
    ED.addLayer(L, "Shape from path");
    render();
  };

  // ---------- panel ----------
  var panel = null, list = null;
  function thumb(cs) {
    var d = doc(), c = h("canvas", { width: "80", height: "60" }), x = c.getContext("2d");
    if (!d || !cs || !cs.length) return c;
    var k = Math.min(80 / d.w, 60 / d.h), ox = (80 - d.w * k) / 2, oy = (60 - d.h * k) / 2;
    x.setTransform(k, 0, 0, k, ox, oy);
    x.fillStyle = "rgba(127,127,127,.18)"; x.fillRect(0, 0, d.w, d.h);
    x.beginPath(); VG.trace(x, cs); x.fillStyle = "rgba(127,127,127,.75)"; x.fill("nonzero");
    x.lineWidth = 1.5 / k; x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#ddd"; x.stroke();
    return c;
  }
  function select(id) { var d = doc(); d.apath = id; VX.clearPathSel(); if (VX.pen) VX.pen = null; render(); ED.renderOvl(); ED.emit("tool"); }
  function rename(p, el) {
    var i = h("input", { "class": "input pe-rename", value: p.name, maxlength: "100", dir: "auto", "aria-label": "Path name" }), done = false;
    el.replaceWith(i); i.focus(); i.select();
    function end(save) {
      if (done) return; done = true;
      var v = i.value.trim().slice(0, 100);
      if (save && v && v !== p.name) {
        if (p.id === "work") VX.pathEdit("Save path", function () { var d = doc(); var np = { id: PE.uid("p"), name: v, comps: d.work.comps }; (d.vpaths = d.vpaths || []).push(np); d.work = null; d.apath = np.id; });
        else VX.pathEdit("Rename path", function () { p.name = v; });
      }
      render();
    }
    i.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") end(true); if (e.key === "Escape") end(false); });
    i.addEventListener("blur", function () { end(true); });
  }
  function row(p, on, kind) {
    var nm = h("span", { "class": "pe-lname", text: p.name, title: kind === "layer" ? "The selected shape layer's outline" : "Double-click to " + (p.id === "work" ? "save" : "rename") });
    var r = h("div", { "class": "pe-vrow" + (on ? " on" : "") + (p.id === "work" ? " work" : ""), tabindex: "0", role: "option", "aria-selected": String(on) }, [thumb(p.comps), nm]);
    r.addEventListener("click", function (e) { e.stopPropagation(); select(kind === "layer" ? null : p.id); });
    r.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.click(); } });
    if (kind !== "layer") nm.addEventListener("dblclick", function (e) { e.stopPropagation(); rename(p, nm); });
    return r;
  }
  function render() {
    if (!list) return;
    list.textContent = "";
    var d = doc();
    if (!d) { list.appendChild(h("p", { "class": "faint pe-p", text: "No document open." })); return; }
    var L = ED.layer(), any = false;
    if (L && L.kind === "shape") { list.appendChild(row({ name: L.name + " outline", comps: VX.docComps(L) }, !d.apath, "layer")); any = true; }
    if (d.work) { list.appendChild(row(d.work, d.apath === "work")); any = true; }
    (d.vpaths || []).forEach(function (p) { list.appendChild(row(p, d.apath === p.id)); any = true; });
    if (!any) list.appendChild(h("p", { "class": "faint pe-p", text: "Draw with the pen (P) in Path mode, or make a path from a selection." }));
  }
  VX.renderPaths = render;
  var soon = S3.debounce(render, 120);
  function build() {
    var side = document.querySelector(".pe-side"); if (!side) return;
    var w = ED.ui.w;
    list = h("div", { "class": "pe-vlist", role: "listbox", "aria-label": "Paths" });
    list.addEventListener("click", function () { if (doc() && doc().apath) select(null); });
    function act(fn) { return function () { if (!ED.ui.w.need()) return; fn(); }; }
    var foot = h("div", { "class": "pe-vfoot" }, [
      w.btn("", act(function () { if (!needPath()) return; VX.fillPath(doc().fg, 1); }), "ghost icon", "t-bucket", "Fill path with the foreground colour (Alt-click: options)"),
      w.btn("", act(function () { if (!needPath()) return; VX.strokePath("brush", false); }), "ghost icon", "t-brush", "Stroke path with the brush (Alt-click: options)"),
      w.btn("", act(function () { VX.pathToSelection(); }), "ghost icon", "t-marquee", "Load path as a selection (Alt-click: options)"),
      w.btn("", act(function () { VX.selectionToPath(2); }), "ghost icon", "v-path", "Make work path from the selection (Alt-click: tolerance)"),
      w.btn("", act(function () { VX.pathToShape(); }), "ghost icon", "t-shape", "New shape layer from the path"),
      h("span", { "class": "grow" }),
      w.btn("", act(function () { var d = doc(); VX.pathEdit("New path", function () { var n = (d.vpaths || []).length + 1, p = { id: PE.uid("p"), name: "Path " + n, comps: [] }; (d.vpaths = d.vpaths || []).push(p); d.apath = p.id; }); ED.setTool("pen"); ED.o.pen.mode = "path"; ED.ui.buildOpts(); }), "ghost icon", "i-plus", "New path (then draw it with the pen)"),
      w.btn("", act(duplicate), "ghost icon", "i-copy", "Duplicate path (saves the work path)"),
      w.btn("", act(remove), "ghost icon", "i-trash", "Delete path")
    ]);
    // Alt-click opens the dialog versions
    var bs = foot.querySelectorAll("button");
    [fillDialog, strokeDialog, selectionDialog, selToPathDialog].forEach(function (f, i) { bs[i].addEventListener("click", function (e) { if (e.altKey) { e.stopImmediatePropagation(); f(); } }, true); });
    panel = h("details", { "class": "pe-panel", open: true }, [h("summary", { text: "Paths" }), h("div", { "class": "pe-pbody" }, [list, foot])]);
    var hist = Array.prototype.filter.call(side.querySelectorAll(".pe-panel"), function (p) { return p.querySelector("#hist"); })[0];
    side.insertBefore(panel, hist || null);
    render();
  }
  function duplicate() {
    var d = doc(), p = d.apath && VX.findPath(d, d.apath);
    var src = p ? p.comps : curComps(); if (!src || !src.length) { S3.toast("Select a path first", "error"); return; }
    VX.pathEdit("Duplicate path", function () { var np = { id: PE.uid("p"), name: (p ? p.name : "Path") + (p && p.id === "work" ? "" : " copy"), comps: VG.clone(src) }; if (p && p.id === "work") { np.name = "Path " + ((d.vpaths || []).length + 1); d.work = null; } (d.vpaths = d.vpaths || []).push(np); d.apath = np.id; });
  }
  function remove() {
    var d = doc(), id = d.apath;
    if (!id) { S3.toast("Select a saved or work path in the Paths panel first", "error"); return; }
    VX.pathEdit("Delete path", function () { if (id === "work") d.work = null; else d.vpaths = (d.vpaths || []).filter(function (p) { return p.id !== id; }); d.apath = null; });
    VX.clearPathSel(); ED.renderOvl();
  }
  ED.on("paths", soon); ED.on("changed", soon); ED.on("layers", soon);
  ED.on("vready", build);

  // ---------- menus ----------
  function hasPath() { var cs = ED.doc ? curComps() : null; return !!(cs && cs.length); }
  function hasSel() { return !!(ED.doc && ED.doc.sel); }
  UI.menu("Select", ["-", ["Load path as selection…", "", selectionDialog, hasPath], ["Make work path from selection…", "", selToPathDialog, hasSel]]);
  UI.menu("Edit", ["-", ["Fill path…", "", fillDialog, hasPath], ["Stroke path…", "", strokeDialog, hasPath]], "Clear selection pixels");
  // Ctrl+Enter: path to selection (when a path tool is active)
  UI.keys.push(function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && UI.groupOf(ED.tool) && hasPath()) { VX.pathToSelection(); return true; }
    return false;
  });
})();
