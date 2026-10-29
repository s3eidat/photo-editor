/* Files lane: File › Export layers to files… Each layer (all, visible only, or the selected one) becomes its own image,
   at canvas size or trimmed to its pixels, in any export format. Several files are bundled in one .zip download. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, FX = PE.files, X = FX.exp, h = S3.h, W = ED.ui.w;
  var LE = FX.layersExport = {};

  function safe(s) { return String(s || "layer").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "layer"; }
  LE.safe = safe;
  function content(L) { return L.kind === "raster" || L.kind === "text" || L.kind === "shape" || L.kind === "fill" || L.kind === "smart"; }
  LE.pick = function (d, which) {
    return d.layers.filter(function (L) { return content(L) && (which === "all" || (which === "visible" && L.visible) || (which === "active" && L.id === d.active)); });
  };
  // one layer alone, full canvas or trimmed, with or without its opacity; returns a canvas (or null when it is empty)
  LE.render = function (d, L, o) {
    var keep = { v: L.visible, op: L.opacity, b: L.blend };
    L.visible = true; if (!o.keepOpacity) L.opacity = 1; L.blend = "normal";
    var c; try { c = PE.flatten(d, { only: [L.id] }); } finally { L.visible = keep.v; L.opacity = keep.op; L.blend = keep.b; }
    if (o.trim) {
      var b = FX.trim.bounds(PE.getData(c), "alpha");
      if (!b) return null;
      var t = PE.mk(b.w, b.h); PE.cx2(t).drawImage(c, -b.x, -b.y); c = t;
    }
    if (o.scale && o.scale !== 1) { var s = PE.mk(Math.max(1, Math.round(c.width * o.scale)), Math.max(1, Math.round(c.height * o.scale))), x = PE.cx2(s); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, s.width, s.height); c = s; }
    return c;
  };
  LE.run = function (d, o, progress) {
    var layers = LE.pick(d, o.which), files = [], names = {}, i = 0, st = Object.assign({}, X.settings(), { fmt: o.fmt, q: o.q, trans: o.trans, matte: o.matte, comp: o.comp, meta: "none", scale: 1 }), f = X.formats[o.fmt];
    if (!layers.length) return Promise.reject(new Error("No layers to export"));
    var chain = Promise.resolve();
    layers.slice().reverse().forEach(function (L, k) {
      chain = chain.then(function () {
        if (progress) progress(k + 1, layers.length);
        var c = LE.render(d, L, o); if (!c) return;
        if (!(f.alpha && o.trans)) { var cx = PE.cx2(c); cx.globalCompositeOperation = "destination-over"; cx.fillStyle = PE.hex(o.matte, "#ffffff"); cx.fillRect(0, 0, c.width, c.height); }
        return X.encode(c, st, d).then(function (b) { return PE.blobBytes(b); }).then(function (u8) {
          var base = (o.prefix ? safe(o.prefix) + "_" : "") + ("000" + (++i)).slice(-4) + "_" + safe(L.name), n = base, q = 2;
          while (names[n]) n = base + "-" + q++;
          names[n] = 1; files.push({ name: n + "." + f.ext, data: u8 });
        });
      });
    });
    return chain.then(function () { return files; });
  };
  LE.dialog = function () {
    if (!FX.need()) return; ED.flushProps();
    var d = ED.doc, st = Object.assign({ which: "visible", fmt: "png", q: 0.9, trans: true, matte: "#ffffff", comp: "lzw", trim: true, keepOpacity: true, prefix: FX.base(d), scale: 1 }, S3.store("pe-layerexport") || {});
    if (X.available().indexOf(st.fmt) < 0) st.fmt = "png";
    st.prefix = FX.base(d);
    var fmtSel = h("select", { "class": "select", "aria-label": "Format" });
    X.available().forEach(function (k) { var o = h("option", { value: k, text: X.formats[k].label }); if (k === st.fmt) o.selected = true; fmtSel.appendChild(o); });
    var qR = W.range("Quality", st.q, 0.05, 1, 0.01, function (v) { st.q = v; }, W.pct);
    var pre = h("input", { "class": "input", maxlength: "60", dir: "auto", value: st.prefix }), sc = h("input", { type: "number", "class": "input", min: "1", max: "400", value: String(Math.round(st.scale * 100)) });
    var count = h("p", { "class": "faint pe-p" });
    function sync() { qR.hidden = !X.formats[st.fmt].q; var n = LE.pick(d, st.which).length; count.textContent = n + " layer" + (n === 1 ? "" : "s") + " → " + (n > 1 ? "one .zip with " + n + " files" : "one file"); }
    fmtSel.addEventListener("change", function () { st.fmt = fmtSel.value; sync(); });
    var body = h("div", { "class": "stack" }, [
      W.seg("Layers", [["visible", "Visible"], ["all", "All"], ["active", "Selected"]], st.which, function (v) { st.which = v; sync(); }),
      h("label", { "class": "pe-of" }, [h("span", { text: "Format" }), fmtSel]), qR,
      W.check("Trim to each layer's pixels", st.trim, function (v) { st.trim = v; }),
      W.check("Keep layer opacity", st.keepOpacity, function (v) { st.keepOpacity = v; }),
      W.check("Transparency", st.trans, function (v) { st.trans = v; }),
      h("div", { "class": "pe-custom" }, [W.field("File name prefix", pre), W.field("Scale %", sc)]), count]);
    var go = W.btn("Export", function () {
      st.prefix = pre.value.trim(); st.scale = PE.clamp((+sc.value || 100) / 100, 0.01, 4);
      S3.store("pe-layerexport", Object.assign({}, st, { prefix: "" }));
      dlg.close();
      ED.working(LE.run(d, st, function (k, n) { ED.emit("view", "Exporting layer " + k + " of " + n + "…"); }), "Exporting layers…").then(function (files) {
        if (!files.length) { S3.toast("Those layers are empty", "error"); return; }
        if (files.length === 1) FX.download(new Blob([files[0].data], { type: X.formats[st.fmt].mime }), files[0].name);
        else FX.download(PE.zipWrite(files), FX.fname("zip", d, "-layers"));
        S3.done(); S3.toast("Exported " + files.length + " layer" + (files.length === 1 ? "" : "s"));
      }).catch(function (e) { S3.toast(e.message, "error"); });
    }, "primary", "i-download");
    var dlg = W.modal("Export layers to files", body, [h("span", { "class": "faint", text: "Nothing is uploaded." }), h("span", { "class": "grow" }), go]);
    sync();
  };
  FX.menu("File", ["Export layers to files…", "", LE.dialog, FX.has], "Export selection…");

  FX.tests.push(async function (ok, near, px, solid) {
    var d = PE.newDoc(60, 40, "lx"), A = PE.rasterFromCanvas(solid(10, 10, "#f00"), "Red / one", 5, 5), B = PE.rasterFromCanvas(solid(20, 5, "#00f"), "Red / one", 30, 30), C = PE.rasterFromCanvas(solid(4, 4, "#0f0"), "hidden", 0, 0);
    A.opacity = 0.5; C.visible = false; d.layers = [A, B, C];
    var files = await LE.run(d, { which: "visible", fmt: "png", trans: true, trim: true, keepOpacity: false }, null);
    ok(files.length === 2 && files[0].name === "0001_Red - one.png" && files[1].name === "0002_Red - one.png", "export layers names " + files.map(function (f) { return f.name; }));
    var bm = await createImageBitmap(new Blob([files[1].data], { type: "image/png" }));
    ok(bm.width === 10 && bm.height === 10, "export layers trims to the layer");
    var all = await LE.run(d, { which: "all", fmt: "png", trans: true, trim: false, keepOpacity: true }, null), bm2 = await createImageBitmap(new Blob([all[2].data], { type: "image/png" })), c2 = PE.mk(60, 40); PE.cx2(c2).drawImage(bm2, 0, 0);
    ok(all.length === 3 && bm2.width === 60 && near(px(c2, 7, 7)[3], 128, 2), "export layers at canvas size with opacity");
    ok(A.opacity === 0.5 && !C.visible, "layer settings restored after export");
  });
})();
