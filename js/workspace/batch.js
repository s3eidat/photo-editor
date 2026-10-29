/* Workspace (files lane): File › Automate › Batch…. Plays an action on many images (picked files: JPG, PNG, WebP, GIF,
   BMP, AVIF, TIFF, PSD, .s3photo) or on every open document, and saves the results: the action's own export steps, or
   "save as" any export format. Results come as one .zip (or separate downloads). A file that fails is reported and
   skipped; Cancel stops after the current file. Batch documents are not added to Recent projects. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, A = WS.actions, h = S3.h, W = ED.ui.w;
  var B = WS.batch = {};

  function baseName(n) { return String(n || "image").replace(/\.[^.]+$/, "").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 100) || "image"; }
  // a file -> a document (not opened in a tab)
  B.docFromFile = function (f) {
    var name = baseName(f.name);
    if (/\.psd$/i.test(f.name)) return f.arrayBuffer().then(function (ab) { return FX.psd.open(new Uint8Array(ab), name); }).then(function (r) { return r.doc; });
    if (/\.s3photo$/i.test(f.name)) return f.arrayBuffer().then(function (ab) { return PE.openProject(new Uint8Array(ab)); });
    var tif = /\.tiff?$/i.test(f.name);
    var p = tif ? f.arrayBuffer().then(function (ab) { return FX.exp.readTiff(new Uint8Array(ab)); }).then(function (r) { var c = FX.toCanvas(r); return { canvas: c, w: c.width, h: c.height }; }) : PE.decodeImage(f);
    return p.then(function (img) {
      var c = img.canvas, k = Math.min(1, PE.LIM.side / img.w, PE.LIM.side / img.h, Math.sqrt(PE.LIM.px / (img.w * img.h)));
      if (k < 1) { var n = PE.mk(Math.floor(img.w * k), Math.floor(img.h * k)); PE.cx2(n).drawImage(c, 0, 0, n.width, n.height); c = PE.touch(n); }
      var d = PE.newDoc(c.width, c.height, name), L = PE.rasterFromCanvas(c, "Background"); d.layers = [L]; d.active = L.id; return d;
    });
  };
  function hasExport(act) { return act.steps.some(function (s) { return s.on !== false && (s.t === "exportAs" || s.t === "savePsd"); }); }
  // run: o = { act, files[] | docs[], override (export settings or null), suffix, zip }, progress(i, n, name), cancelled() -> results
  B.run = function (o, progress, cancelled) {
    var out = [], names = {}, errors = [], keep = { doc: ED.doc, hist: ED.hist, testing: ED.testing }, items = o.files || o.docs, i = 0;
    function add(blob, ext, base) {
      return PE.blobBytes(blob).then(function (u8) {
        var n = base + (o.suffix || "") + "." + ext, k = 2; while (names[n]) n = base + (o.suffix || "") + "-" + k++ + "." + ext;
        names[n] = 1; out.push({ name: n, data: u8, type: blob.type });
      });
    }
    function one(item) {
      var base = baseName(item.name || (item.doc && item.doc.name)), pend = [];
      var get = o.files ? B.docFromFile(item) : Promise.resolve(item.doc);
      return get.then(function (d) {
        ED.testing = true; ED.doc = d; ED.hist = o.files ? new PE.History(PE.historyBudget(), 60) : (item.hist || ED.hist || new PE.History(PE.historyBudget(), 60));
        ED.live = { over: {}, maskOver: {}, hide: null }; ED.maskEdit = false;
        var ctx = { batch: true, collect: function (blob, ext) { pend.push(add(blob, ext, base)); } };
        var act = o.override ? { steps: o.act.steps.filter(function (s) { return s.t !== "exportAs" && s.t !== "savePsd"; }) } : o.act;
        return A.play(act, ctx).then(function () {
          if (o.override || !hasExport(o.act)) { var st = o.override || Object.assign({}, FX.exp.settings(), { fmt: "png", scale: 1, meta: "none" }); return A.exportStep(st, ctx); }
        }).then(function () { return Promise.all(pend); });
      }).catch(function (e) { errors.push(base + ": " + e.message); });
    }
    var chain = Promise.resolve();
    items.forEach(function (it) { chain = chain.then(function () { if (cancelled && cancelled()) return; i++; if (progress) progress(i, items.length, it.name || (it.doc && it.doc.name)); return one(it); }); });
    return chain.then(function () {
      ED.doc = keep.doc; ED.hist = keep.hist; ED.testing = keep.testing; ED.live = { over: {}, maskOver: {}, hide: null };
      if (o.docs && WS.tabs) WS.tabs.list.forEach(function (t) { if (t.doc && t.doc === ED.doc) t.hist = ED.hist; });
      ED.changed(); if (ED.doc) ED.fit();
      return { files: out, errors: errors };
    });
  };
  B.dialog = function () {
    var acts = A.data().actions; if (!acts.length) { S3.toast("Record an action first (Window › Actions)", "error"); return; }
    var st = Object.assign({ act: 0, src: "files", ov: false, suffix: "", zip: true }, S3.store("pe-batch") || {}), files = [];
    st.act = Math.min(st.act, acts.length - 1);
    var pick = h("input", { type: "file", multiple: true, accept: "image/*,.psd,.tif,.tiff,.s3photo", hidden: true }), cnt = h("span", { "class": "faint", text: "No files chosen" });
    pick.addEventListener("change", function () { files = Array.prototype.slice.call(pick.files || []).slice(0, 500); cnt.textContent = files.length + " file" + (files.length === 1 ? "" : "s"); });
    var ovSt = Object.assign({}, FX.exp.settings(), { scale: 1, meta: "none" }), fmtSel = h("select", { "class": "select", "aria-label": "Save as format" });
    FX.exp.available().forEach(function (k) { var e = h("option", { value: k, text: FX.exp.formats[k].label }); if (k === ovSt.fmt) e.selected = true; fmtSel.appendChild(e); });
    fmtSel.addEventListener("change", function () { ovSt.fmt = fmtSel.value; qR.hidden = !FX.exp.formats[ovSt.fmt].q; });
    var qR = W.range("Quality", ovSt.q, 0.05, 1, 0.01, function (v) { ovSt.q = v; }, W.pct); qR.hidden = !FX.exp.formats[ovSt.fmt].q;
    var ovBox = h("div", { "class": "stack" }, [h("label", { "class": "pe-of" }, [h("span", { text: "Format" }), fmtSel]), qR]);
    var suf = h("input", { "class": "input", maxlength: "40", value: st.suffix, placeholder: "-edited" });
    var tabsN = WS.tabs ? WS.tabs.list.filter(function (t) { return t.doc; }).length : (ED.doc ? 1 : 0);
    var body = h("div", { "class": "stack" }, [
      W.select("Action", acts.map(function (a, i) { return [String(i), a.name]; }), String(st.act), function (v) { st.act = +v; }),
      W.seg("Source", [["files", "Files…"], ["open", "Open documents (" + tabsN + ")"]], st.src, function (v) { st.src = v; srcRow.hidden = v !== "files"; }),
      h("div", { "class": "pe-prow" }, [W.btn("Choose files…", function () { pick.click(); }, "", "i-upload"), cnt, pick]),
      W.check("Save as (ignore the action's own export steps)", st.ov, function (v) { st.ov = v; ovBox.hidden = !v; }), ovBox,
      h("div", { "class": "pe-custom" }, [W.field("Add to file names", suf)]),
      W.check("One .zip download", st.zip, function (v) { st.zip = v; }),
      h("p", { "class": "faint pe-p", text: "Open documents are changed in place (undo works per document). Picked files are opened, processed and saved without touching your open work." })]);
    var srcRow = body.children[2]; srcRow.hidden = st.src !== "files"; ovBox.hidden = !st.ov;
    var go = W.btn("Run batch", function () {
      st.suffix = suf.value.replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "").slice(0, 40);
      if (st.src === "files" && !files.length) { S3.toast("Choose some files first", "error"); return; }
      if (st.src === "open" && !tabsN) { S3.toast("No documents are open", "error"); return; }
      S3.store("pe-batch", st); dlg.close();
      var cancel = false, prog = h("p", { "class": "pe-p mono", text: "Starting…" }), bar = h("progress", { max: "1", value: "0", "class": "ws-bprog" });
      var pd = W.modal("Batch", h("div", { "class": "stack" }, [prog, bar]), [h("span", { "class": "grow" }), W.btn("Cancel", function () { cancel = true; prog.textContent = "Stopping after this file…"; }, "ghost")]);
      var o = { act: acts[st.act], suffix: st.suffix, override: st.ov ? ovSt : null };
      if (st.src === "files") o.files = files; else o.docs = WS.tabs ? WS.tabs.list.filter(function (t) { return t.doc; }).map(function (t) { return { doc: t.doc, hist: t.doc === ED.doc ? ED.hist : t.hist, name: t.doc.name }; }) : [{ doc: ED.doc, hist: ED.hist, name: ED.doc.name }];
      ED.cancelModes();
      B.run(o, function (i, n, name) { prog.textContent = i + " / " + n + "  " + (name || ""); bar.max = n; bar.value = i - 1; }, function () { return cancel; }).then(function (r) {
        pd.close();
        if (r.files.length) {
          if (st.zip && r.files.length > 1) FX.download(PE.zipWrite(r.files.map(function (f) { return { name: f.name, data: f.data }; })), "batch-" + new Date().toISOString().slice(0, 10) + ".zip");
          else r.files.forEach(function (f, k) { setTimeout(function () { FX.download(new Blob([f.data], { type: f.type }), f.name); }, k * 250); });
        }
        S3.toast("Batch done: " + r.files.length + " file" + (r.files.length === 1 ? "" : "s") + (r.errors.length ? ", " + r.errors.length + " failed" : ""), r.errors.length ? "error" : "");
        if (r.errors.length) W.modal("Batch problems", h("ul", { "class": "pe-p" }, r.errors.slice(0, 50).map(function (e) { return h("li", { text: e }); })), null);
      }).catch(function (e) { pd.close(); S3.toast(e.message, "error"); });
    }, "primary");
    var dlg = W.modal("Batch", body, [h("span", { "class": "faint", text: "Nothing is uploaded." }), h("span", { "class": "grow" }), go]);
  };
  FX.menu("File", ["Automate: batch…", "", B.dialog], "Print…");

  FX.tests.push(async function (ok, near, px, solid) {
    // two "files" (PNG blobs) through an action that fits and exports as JPG
    async function pngFile(name, w, hh, css) { var b = await PE.toBlob(solid(w, hh, css), "image/png"); return new File([b], name, { type: "image/png" }); }
    var files = [await pngFile("one.png", 400, 200, "#ff0000"), await pngFile("two.png", 100, 300, "#00ff00"), new File([new Uint8Array([1, 2, 3])], "bad.png", { type: "image/png" })];
    var act = { name: "fit", steps: [{ t: "fitImage", p: { w: 100, h: 100, up: false } }, { t: "exportAs", p: { st: { fmt: "jpg", q: 0.8, scale: 1, trans: false, matte: "#ffffff", comp: "lzw", meta: "none", smooth: true } } }] };
    var keep = ED.doc, r = await B.run({ act: act, files: files, suffix: "-small" });
    ok(r.files.length === 2 && r.files[0].name === "one-small.jpg" && r.errors.length === 1 && ED.doc === keep, "batch over files " + r.files.map(function (f) { return f.name; }) + " / " + r.errors.join(";"));
    var bm = await createImageBitmap(new Blob([r.files[1].data], { type: "image/jpeg" })); ok(bm.width === 33 && bm.height === 100, "batch result size " + bm.width + "x" + bm.height);
    var r2 = await B.run({ act: act, files: [files[0]], override: Object.assign({}, FX.exp.settings(), { fmt: "png", scale: 1, meta: "none" }) });
    ok(r2.files.length === 1 && r2.files[0].name === "one.png", "batch save-as override");
  });
})();
