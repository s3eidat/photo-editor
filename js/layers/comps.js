/* Selection lane: layer comps. A comp remembers, for every layer, its visibility, position and/or appearance
   (opacity, blend, fill, style); applying one puts the layers back that way in one undo step. Comps live on a
   hidden helper layer (kind "comps"), so they undo and save with the project. Export all comps as PNGs in a zip. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  PE.kindsExt.push("comps"); SX.KEYS.push("comps");
  SX.HELPER = SX.HELPER || {}; SX.HELPER.comps = 1; SX.HELPER.qmask = 1; SX.HELPER.channel = 1;
  SX.drawExt.comps = function () {};
  PE.surfaceExt.comps = function () { return { canvas: PE.mk(1, 1), x: 0, y: 0 }; };
  PE.vboxExt.comps = function () { return { x: 0, y: 0, w: 1, h: 1, rot: 0, fx: false, fy: false }; };
  PE.xfExt.comps = function () {};
  function store(d) { d = d || ED.doc; for (var i = 0; i < d.layers.length; i++) if (d.layers[i].kind === "comps") return d.layers[i]; return null; }
  function list() { var S = store(); return S && S.comps ? S.comps : []; }
  SX.comps = list;
  function real(d) { return d.layers.filter(function (L) { return !SX.HELPER[L.kind]; }); }
  function capture(o) {
    var d = ED.doc, layers = {};
    real(d).forEach(function (L) {
      var r = {};
      if (o.vis) r.v = L.visible;
      if (o.pos) { r.x = L.x; r.y = L.y; if (L.text) { r.ax = L.text.ax; r.ay = L.text.ay; } if (L.shape) { r.sx = L.shape.x; r.sy = L.shape.y; } if (L.smart) r.m = L.smart.m.slice(); if (L.mask) { r.mx = L.mask.x; r.my = L.mask.y; } if (L.vmask) r.vm = PE.clone(L.vmask.paths); }
      if (o.look) { r.op = L.opacity; r.bl = L.blend; r.fo = L.fillOp == null ? 1 : L.fillOp; r.fx = L.fx ? PE.clone(L.fx) : null; }
      layers[L.id] = r;
    });
    return { id: PE.uid("c"), name: o.name, vis: !!o.vis, pos: !!o.pos, look: !!o.look, layers: layers };
  }
  function applyRec(c) {
    var d = ED.doc;
    real(d).forEach(function (L) {
      var r = c.layers[L.id]; if (!r) return;
      if (c.vis && r.v != null) L.visible = r.v;
      if (c.pos) {
        if (r.x != null) L.x = r.x; if (r.y != null) L.y = r.y;
        if (L.text && r.ax != null) { L.text.ax = r.ax; L.text.ay = r.ay; }
        if (L.shape && r.sx != null) { L.shape.x = r.sx; L.shape.y = r.sy; }
        if (L.smart && r.m) L.smart = Object.assign({}, L.smart, { m: r.m.slice() });
        if (L.mask && r.mx != null) L.mask = { canvas: L.mask.canvas, x: r.mx, y: r.my };
        if (L.vmask && r.vm) L.vmask = Object.assign({}, L.vmask, { paths: PE.clone(r.vm) });
      }
      if (c.look) { if (r.op != null) L.opacity = r.op; if (r.bl) L.blend = r.bl; if (r.fo != null) { if (r.fo >= 1) delete L.fillOp; else L.fillOp = r.fo; } if (r.fx) L.fx = PE.clone(r.fx); else if (r.fx === null) delete L.fx; }
    });
  }
  SX.newComp = function (o) {
    var d = ED.doc, S = store(d), c = capture(o);
    ED.meta("New layer comp", function () {
      if (!S) { S = PE.newLayer("comps", { name: "Layer comps" }); S.canvas = null; S.parent = null; S.comps = []; d.layers.unshift(S); }
      S.comps = S.comps.concat([c]);
    });
    return c;
  };
  SX.applyComp = function (id) { var c = list().filter(function (x) { return x.id === id; })[0]; if (!c) return; ED.meta("Apply layer comp", function () { applyRec(c); }); ED.emit("layers"); };
  SX.updateComp = function (id) { var S = store(); if (!S) return; ED.meta("Update layer comp", function () { S.comps = S.comps.map(function (c) { if (c.id !== id) return c; var n = capture(c); n.id = c.id; return n; }); }); };
  SX.deleteComp = function (id) { var S = store(); if (!S) return; ED.meta("Delete layer comp", function () { S.comps = S.comps.filter(function (c) { return c.id !== id; }); }); };
  SX.exportComps = function () {
    var d = ED.doc, all = list(); if (!all.length) { S3.toast("Make a layer comp first", "error"); return; }
    var before = PE.snap(d), files = [], name = String(d.name || "image").replace(/[\\\/:*?"<>|]+/g, "-");
    var chain = Promise.resolve();
    all.forEach(function (c, i) { chain = chain.then(function () { applyRec(c); return PE.toBlob(PE.flatten(d), "image/png"); }).then(PE.blobBytes).then(function (b) { files.push({ name: (i + 1) + " " + c.name.replace(/[\\\/:*?"<>|]+/g, "-") + ".png", data: b }); }); });
    ED.working(chain.then(function () { PE.restore(d, before); ED.changed(); S3.download(S3.zip(files), name + "-comps.zip", "application/zip"); S3.done(); }), "Exporting comps…").catch(function (e) { PE.restore(d, before); ED.changed(); S3.toast(e.message, "error"); });
  };

  function dialog() {
    if (!SX.need()) return;
    var w = ED.ui.w, body = h("div", { "class": "stack" }), dlg;
    function render() {
      body.textContent = "";
      var all = list();
      body.appendChild(h("p", { "class": "faint pe-p", text: "Save how the layers look now (visibility, position, appearance) and switch between versions in one click." }));
      var box = h("div", { "class": "pe-comps" });
      if (!all.length) box.appendChild(h("p", { "class": "empty", text: "No layer comps yet." }));
      all.forEach(function (c, i) {
        var what = [c.vis ? "visibility" : "", c.pos ? "position" : "", c.look ? "appearance" : ""].filter(Boolean).join(", ");
        box.appendChild(h("div", { "class": "pe-comp" }, [h("span", { "class": "pe-lmid" }, [h("b", { text: (i + 1) + ". " + c.name }), h("span", { "class": "faint", text: what })]),
          w.btn("Apply", function () { SX.applyComp(c.id); }, "primary"), w.btn("Update", function () { SX.updateComp(c.id); S3.toast("“" + c.name + "” updated"); }, "ghost", null, "Store the current state in this comp"),
          w.btn("", function () { SX.deleteComp(c.id); render(); }, "ghost icon", "i-trash", "Delete comp")]));
      });
      body.appendChild(box);
      var name = h("input", { "class": "input", value: "Comp " + (all.length + 1), maxlength: "60" }), o = { vis: true, pos: true, look: true };
      body.appendChild(h("h3", { text: "New comp from the current layers" }));
      body.appendChild(h("div", { "class": "pe-custom" }, [w.field("Name", name)]));
      body.appendChild(h("div", { "class": "pe-prow" }, [w.check("Visibility", true, function (v) { o.vis = v; }), w.check("Position", true, function (v) { o.pos = v; }), w.check("Appearance (opacity, blend, style)", true, function (v) { o.look = v; })]));
      body.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Add comp", function () { o.name = name.value.trim().slice(0, 60) || "Comp"; SX.newComp(o); render(); }, "", "i-plus"), all.length ? w.btn("Export all as PNG (zip)", SX.exportComps, "ghost", "i-download") : null]));
    }
    dlg = w.modal("Layer comps", body, null, true);
    render();
  }
  SX.menu("Layer", [["Layer comps…", "", dialog, SX.has]], "Stamp visible");

  SX.fields.comps = {
    save: function (L) { return L.kind === "comps" && L.comps ? PE.clone(L.comps) : undefined; },
    parse: function (v, out) {
      if (out.kind !== "comps" || !Array.isArray(v)) return undefined;
      return v.slice(0, 200).map(function (c) {
        c = c && typeof c === "object" ? c : {};
        var layers = {}, src = c.layers && typeof c.layers === "object" ? c.layers : {};
        Object.keys(src).slice(0, 400).forEach(function (id) { if (!SX.idOk(id)) return; var r = SX.cleanVal(src[id], 0); if (r && !Array.isArray(r)) { if (src[id].fx) r.fx = SX.fields.fx.parse(src[id].fx); if (src[id].vm) r.vm = (SX.fields.vmask.parse({ paths: src[id].vm }) || {}).paths; if (typeof r.bl === "string" && PE.BLENDS.indexOf(r.bl) < 0 && r.bl !== "pass") delete r.bl; layers[id] = r; } });
        return { id: SX.idOk(c.id) || PE.uid("c"), name: typeof c.name === "string" ? c.name.slice(0, 60) : "Comp", vis: c.vis === true, pos: c.pos === true, look: c.look === true, layers: layers };
      });
    }
  };
  ["dupExt", "removeExt", "mergeExt", "moveExt"].forEach(function (k) { var f = PE[k]; PE[k] = function (a) { if (a && a.kind === "comps") return true; return f ? f.apply(this, arguments) : false; }; });

  SX.tests.push(async function (ok) {
    var a = PE.rasterFromCanvas(SX.solid(4, 4, "#f00"), "a"), b = PE.rasterFromCanvas(SX.solid(4, 4, "#0f0"), "b"), d = SX.scratch(10, 10, [a, b]);
    var c1 = SX.newComp({ name: "one", vis: true, pos: true, look: true });
    ED.meta("change", function () { b.visible = false; a.x = 5; a.opacity = 0.5; a.blend = "screen"; });
    var c2 = SX.newComp({ name: "two", vis: true, pos: true, look: true });
    SX.applyComp(c1.id); ok(b.visible && a.x === 0 && a.opacity === 1 && a.blend === "normal", "apply comp restores visibility, position, appearance");
    SX.applyComp(c2.id); ok(!b.visible && a.x === 5 && a.blend === "screen", "switch comps");
    ED.undo(); ok(b.visible && a.x === 0, "undo apply comp");
    ok(d.layers[0].kind === "comps" && SX.px(PE.flatten(d), 1, 1)[1] === 255, "comps are hidden from the picture");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())), oc = od.layers.filter(function (L) { return L.kind === "comps"; })[0];
    ok(oc && oc.comps.length === 2 && oc.comps[1].layers[a.id].x === 5, "layer comps round-trip");
  });
})();

/* Helper layers (alpha channels, layer comps) survive Flatten image / Merge visible, which rebuild the layer list. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;
  var keep = new WeakMap();
  ED.on("changed", function () {
    var d = ED.doc; if (!d || !ED.hist) return;
    var helpers = d.layers.filter(function (L) { return L.kind === "channel" || L.kind === "comps"; }), last = ED.hist.list[ED.hist.pos - 1];
    var prev = keep.get(d) || [];
    if (last && (last.label === "Flatten image" || last.label === "Merge visible")) {
      var lost = prev.filter(function (L) { return d.layers.indexOf(L) < 0; });
      if (lost.length) { d.layers = lost.concat(d.layers); helpers = helpers.concat(lost); ED.render(); }
    }
    keep.set(d, helpers);
  });
  SX.tests.push(async function (ok) {
    var d = SX.scratch(6, 6, [PE.rasterFromCanvas(SX.solid(6, 6, "#fff"), "bg"), PE.rasterFromCanvas(SX.solid(2, 2, "#000"), "dot")]);
    ED.changed(); d.sel = PE.makeSel(d, window.PIX.rectMask(6, 6, 0, 0, 3, 3)); SX.saveSelection(); ED.LOPS.flatten();
    ok(SX.channels(d).length === 1 && d.layers.filter(function (L) { return L.kind === "raster"; }).length === 1, "alpha channels survive flatten");
  });
})();
