/* Selection lane: Select › Subject and Layer › Remove background, with the same on-device AI as
   github.com/s3eidat/bg-remover: U²-Net small (Apache-2.0) on ONNX Runtime Web (MIT, WebAssembly).
   The engine and model (about 16 MB) load from this site the first time only; photos never leave the device. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, PIXS = window.PIXS, ED = PE.ed, SX = PE.sx;
  var SIZE = 320, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225], WORK_MAX = 1600;
  var ORT_JS = "lib/ort.wasm.min.js", WASM_URL = "lib/ort-wasm-simd-threaded.wasm", MODEL_URL = "models/u2netp/u2netp.onnx";

  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (window.ort) { res(); return; }
      var s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { rej(new Error("The AI engine could not be loaded (" + src + ")")); };
      document.head.appendChild(s);
    });
  }
  function fetchBytes(url, onProg) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Could not load " + url + " (HTTP " + res.status + ")");
      var total = +res.headers.get("content-length") || 0;
      if (!res.body || !res.body.getReader) return res.arrayBuffer().then(function (b) { onProg(b.byteLength, b.byteLength); return b; });
      var reader = res.body.getReader(), chunks = [], got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { var out = new Uint8Array(got), off = 0; chunks.forEach(function (c) { out.set(c, off); off += c.length; }); return out.buffer; }
          chunks.push(r.value); got += r.value.length; onProg(got, total); return pump();
        });
      }
      return pump();
    });
  }
  var modelP = null;
  function loadModel() {
    if (modelP) return modelP;
    var size = { w: 11.3e6, m: 4.6e6 }, got = { w: 0, m: 0 };
    function tick() { ED.emit("view", "Loading the AI model… " + Math.round((got.w + got.m) / (size.w + size.m) * 100) + "% (first time only)"); }
    modelP = loadScript(ORT_JS).then(function () {
      if (!window.ort) throw new Error("The AI engine did not start. Reload the page and try again.");
      tick();
      return Promise.all([fetchBytes(WASM_URL, function (g, t) { got.w = g; if (t) size.w = t; tick(); }), fetchBytes(MODEL_URL, function (g, t) { got.m = g; if (t) size.m = t; tick(); })]);
    }).then(function (both) {
      ED.emit("view", "Starting the AI engine…");
      var ort = window.ort;
      // GitHub Pages is not cross-origin isolated: one thread, no proxy worker; the engine files come from ./lib only.
      ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = new URL("lib/", location.href).href;
      ort.env.wasm.wasmBinary = both[0]; ort.env.logLevel = "error";
      return ort.InferenceSession.create(both[1], { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    });
    modelP.catch(function () { modelP = null; });
    return modelP;
  }
  SX.loadSubjectModel = loadModel;
  SX.subjectModelLoaded = function () { return !!modelP; };

  // Model input: 320 x 320, white behind transparency, ImageNet mean/std, NCHW.
  function preprocess(rgba) {
    var n = SIZE * SIZE, out = new Float32Array(3 * n);
    for (var i = 0; i < n; i++) { var j = i * 4; out[i] = (rgba[j] / 255 - MEAN[0]) / STD[0]; out[n + i] = (rgba[j + 1] / 255 - MEAN[1]) / STD[1]; out[2 * n + i] = (rgba[j + 2] / 255 - MEAN[2]) / STD[2]; }
    return out;
  }
  SX.preprocess = preprocess;
  function normalise(a) {
    var mi = Infinity, ma = -Infinity, i; for (i = 0; i < a.length; i++) { if (a[i] < mi) mi = a[i]; if (a[i] > ma) ma = a[i]; }
    var r = ma - mi, out = new Float32Array(a.length); if (!(r > 1e-12)) return out;
    for (i = 0; i < a.length; i++) out[i] = (a[i] - mi) / r;
    return out;
  }
  function onWhite(src, w, h) { var c = PE.mk(w, h), x = PE.cx2(c); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, w, h); return c; }
  // Saliency of a canvas: Float32 SIZE x SIZE in 0..1.
  function segment(src) {
    return loadModel().then(function (s) {
      var ort = window.ort, px = PE.getData(onWhite(src, SIZE, SIZE)).data, feeds = {};
      feeds[s.inputNames[0]] = new ort.Tensor("float32", preprocess(px), [1, 3, SIZE, SIZE]);
      return s.run(feeds).then(function (out) {
        var raw = normalise(out[s.outputNames[0]].data);
        Object.keys(out).forEach(function (k) { if (out[k].dispose) out[k].dispose(); });
        return raw;
      });
    });
  }
  SX.segment = segment;
  // Subject mask (Uint8, doc size) of a doc-size canvas: AI at 320 px, edges snapped at up to 1600 px, then scaled up.
  function subjectMask(src, threshold) {
    var d = ED.doc, k = Math.min(1, WORK_MAX / Math.max(d.w, d.h)), W = Math.max(1, Math.round(d.w * k)), H = Math.max(1, Math.round(d.h * k));
    return segment(src).then(function (raw) {
      var g = PE.getData(onWhite(src, W, H));
      return SX.work("subject", [raw, SIZE, SIZE, { data: g.data, width: W, height: H }, threshold == null ? 0.5 : threshold, 0.16]);
    }).then(function (m) { return W === d.w && H === d.h ? m : scaleMask(m, W, H, d.w, d.h); });
  }
  SX.subjectMask = subjectMask;
  function scaleMask(m, w, h, W, H) {
    var c = PE.mk(w, h), x = PE.cx2(c), im = x.createImageData(w, h);
    for (var i = 0; i < m.length; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = m[i]; }
    x.putImageData(im, 0, 0);
    var o = PE.mk(W, H), ox = PE.cx2(o); ox.imageSmoothingQuality = "high"; ox.drawImage(c, 0, 0, W, H);
    var d = ox.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
    for (var p = 0; p < out.length; p++) out[p] = d[p * 4 + 3];
    return out;
  }
  SX.scaleMask = scaleMask;
  function firstTime() { if (!modelP) S3.toast("The AI model (about 16 MB) downloads once from this site, then works offline. Nothing is uploaded."); }

  // ---------- commands ----------
  SX.selectSubject = function (mode) {
    if (!SX.need()) return;
    firstTime();
    var d = ED.doc;
    ED.working(subjectMask(PE.flatten(d)), "Finding the subject…").then(function (m) {
      if (!PE.makeSel(d, m)) { S3.toast("No clear subject found. Try the Quick selection tool or the Lasso.", "error"); return; }
      ED.setSelection(m, mode || "new", "Select subject");
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  SX.removeBackground = function () {
    if (!SX.need()) return;
    var d = ED.doc, L = ED.layer();
    if (!L || !ED.editable(L)) return;
    if (L.kind === "group" || L.kind === "adjust") { S3.toast("Pick a pixel, text or shape layer first", "error"); return; }
    firstTime();
    ED.working(subjectMask(PE.flatten(d, { only: [L.id] })), "Removing the background…").then(function (m) {
      if (!PE.makeSel(d, m)) { S3.toast("No clear subject found on this layer", "error"); return; }
      var c = PE.mk(d.w, d.h), x = PE.cx2(c), im = x.createImageData(d.w, d.h);
      for (var i = 0; i < m.length; i++) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = m[i]; }
      x.putImageData(im, 0, 0);
      if (L.mask) { x.globalCompositeOperation = "destination-in"; x.drawImage(L.mask.canvas, L.mask.x, L.mask.y); }
      ED.meta("Remove background", function () { L.mask = { canvas: PE.touch(c), x: 0, y: 0 }; L.maskOn = true; });
      ED.setActive(L.id, false);
      S3.toast("Background hidden with a layer mask: paint the mask to fix edges, or delete the mask to undo.");
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  SX.menu("Select", [["Subject", "", function () { SX.selectSubject(); }, SX.has]], "Inverse");
  SX.menu("Layer", [["Remove background", "", SX.removeBackground, SX.has]], "Add mask from selection");
  (ED.ui.optsTail = ED.ui.optsTail || []).push(function (t, items) {
    if (["marquee", "ellipse", "lasso", "polygon", "wand", "qsel"].indexOf(t) < 0) return;
    items.push(ED.ui.w.btn("Select subject", function () { SX.selectSubject(ED.o.sel.mode); }, "ghost", null, "Select the main subject with on-device AI"));
  });

  SX.tests.push(async function (ok, near) {
    var raw = new Float32Array(8 * 8); for (var r = 2; r < 6; r++) for (var c = 2; c < 6; c++) raw[r * 8 + c] = 1;
    var g = { data: new Uint8ClampedArray(10 * 10 * 4).fill(255), width: 10, height: 10 }, m = PIXS.subject(raw, 8, 8, g, 0.5, 0.16);
    ok(m[5 * 10 + 5] === 255 && m[0] === 0 && m.length === 100, "subject mask upscales and thresholds");
    var pre = SX.preprocess(new Uint8ClampedArray(320 * 320 * 4).fill(255)); ok(near(pre[0], (1 - 0.485) / 0.229, 1e-4) && near(pre[2 * 320 * 320], (1 - 0.406) / 0.225, 1e-4), "model input normalisation");
    var I = new Float32Array(100), P = new Float32Array(100); for (var i = 0; i < 100; i++) { I[i] = i % 10 < 5 ? 0 : 1; P[i] = i % 10 < 4 ? 0 : i % 10 > 5 ? 1 : 0.5; }
    var q = PIXS.guided(I, P, 10, 10, 2, 1e-3); ok(q[2] < 0.2 && q[7] > 0.8, "guided filter follows the guide's edge");
  });
})();
