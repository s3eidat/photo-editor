/* Workspace (files lane): Image › Mode. Greyscale (luminosity, average or one channel), duotone / tritone / quadtone
   (up to four inks, each with amount and midtone curve, presets), indexed colour (adaptive / web / uniform / greys /
   black & white palettes, 2–256 colours, diffusion or pattern dither, transparency) with a live preview, palette export
   (.act colour table, .gpl, hex list) and PNG-8 / GIF export, and a note on bit depth. The document stays RGB inside;
   converting changes every layer's pixels (and text / shape colours) as one undo step. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, Q = window.FQUANT, h = S3.h, W = ED.ui.w;
  var M = WS.modes = {};

  // ---------- greyscale ----------
  var GW = { lum: [0.299, 0.587, 0.114], avg: [1 / 3, 1 / 3, 1 / 3], r: [1, 0, 0], g: [0, 1, 0], b: [0, 0, 1] };
  M.greyData = function (d, method) { var w = GW[method] || GW.lum; for (var i = 0; i < d.length; i += 4) { var v = d[i] * w[0] + d[i + 1] * w[1] + d[i + 2] * w[2]; d[i] = d[i + 1] = d[i + 2] = v; } return d; };
  function greyHex(hx, method) { var c = PE.rgbOf(hx), w = GW[method] || GW.lum, v = c[0] * w[0] + c[1] * w[1] + c[2] * w[2]; return PE.toHex(v, v, v); }
  // map every layer's pixels with fn(data) and colours with fc(hex); one history step
  function convert(label, fn, fc, mode) {
    if (!FX.need()) return; ED.cancelModes();
    var d = ED.doc, out = new Map();
    d.layers.forEach(function (L) {
      if (L.kind === "raster" && L.canvas) { var c = PE.cloneCanvas(L.canvas), x = PE.cx2(c), im = x.getImageData(0, 0, c.width, c.height); fn(im.data); x.putImageData(im, 0, 0); out.set(L, PE.touch(c)); }
    });
    ED.meta(label, function () {
      d.layers.forEach(function (L) {
        if (out.has(L)) L.canvas = out.get(L);
        if (L.text) L.text.color = fc(L.text.color);
        if (L.shape) { if (L.shape.fill) L.shape.fill = fc(L.shape.fill); if (L.shape.stroke) L.shape.stroke = fc(L.shape.stroke); }
      });
    });
    d.mode = mode; ED.emit("ws", "mode");
  }
  M.toGrey = function (method) { convert("Mode: greyscale", function (dd) { M.greyData(dd, method); }, function (c) { return greyHex(c, method); }, "grey"); };
  M.greyDialog = function () {
    if (!FX.need()) return; var m = "lum";
    var dlg = W.modal("Convert to greyscale", h("div", { "class": "stack" }, [W.seg("From", [["lum", "Luminosity"], ["avg", "Average"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]], m, function (v) { m = v; }),
      h("p", { "class": "faint pe-p", text: "Every layer loses its colour (text and shape colours too). Masks, opacity and blending stay. For a softer mix of channels use Image › Black & white…" })]),
      [h("span", { "class": "grow" }), W.btn("Convert", function () { dlg.close(); M.toGrey(m); }, "primary")]);
  };

  // ---------- duotone ----------
  var PRESETS = M.DUO = {
    "Sepia": [{ c: "#000000", a: 100, m: 1 }, { c: "#a8763e", a: 85, m: 0.55 }],
    "Cyan & black": [{ c: "#000000", a: 100, m: 1.3 }, { c: "#00a0c6", a: 80, m: 0.6 }],
    "Warm red": [{ c: "#1a0f0a", a: 100, m: 1 }, { c: "#d0413a", a: 70, m: 0.5 }],
    "Blue monotone": [{ c: "#203a72", a: 100, m: 0.9 }],
    "Gold tritone": [{ c: "#000000", a: 100, m: 1.2 }, { c: "#8d6b2f", a: 70, m: 0.7 }, { c: "#e8c46a", a: 45, m: 0.4 }],
    "Quadtone greys": [{ c: "#000000", a: 100, m: 1.4 }, { c: "#4a4a4a", a: 60, m: 1 }, { c: "#8a8a8a", a: 40, m: 0.7 }, { c: "#c8c8c8", a: 25, m: 0.5 }]
  };
  M.duoLut = function (inks) {
    var lut = new Uint8Array(256 * 3);
    for (var v = 0; v < 256; v++) {
      var t = v / 255, col = [1, 1, 1];
      inks.forEach(function (ik) { var c = PE.rgbOf(ik.c), dd = PE.clamp(ik.a / 100, 0, 1) * Math.pow(1 - t, ik.m > 0 ? ik.m : 1); for (var k = 0; k < 3; k++) col[k] *= 1 - dd * (1 - c[k] / 255); });
      lut[v * 3] = Math.round(col[0] * 255); lut[v * 3 + 1] = Math.round(col[1] * 255); lut[v * 3 + 2] = Math.round(col[2] * 255);
    }
    return lut;
  };
  M.duoData = function (d, lut) { for (var i = 0; i < d.length; i += 4) { var v = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * 3; d[i] = lut[v]; d[i + 1] = lut[v + 1]; d[i + 2] = lut[v + 2]; } return d; };
  M.toDuotone = function (inks) { var lut = M.duoLut(inks); convert("Mode: duotone", function (dd) { M.duoData(dd, lut); }, function (c) { var q = PE.rgbOf(c), v = Math.round(q[0] * 0.299 + q[1] * 0.587 + q[2] * 0.114) * 3; return PE.toHex(lut[v], lut[v + 1], lut[v + 2]); }, "duotone"); };
  function thumb(maxS) { var d = ED.doc, k = Math.min(1, maxS / Math.max(d.w, d.h)); return PE.flatten(d, { scale: k, bg: "#ffffff" }); }
  M.duoDialog = function () {
    if (!FX.need()) return;
    var inks = PE.clone(S3.store("pe-duo") || PRESETS.Sepia), src = thumb(420), prev = h("canvas", { "class": "ws-mprev" }), rows = h("div", { "class": "stack" }), ramp = h("canvas", { "class": "ws-ramp", width: "256", height: "14" });
    function draw() {
      var lut = M.duoLut(inks), c = PE.cloneCanvas(src), x = PE.cx2(c), im = x.getImageData(0, 0, c.width, c.height); M.duoData(im.data, lut); x.putImageData(im, 0, 0);
      prev.width = c.width; prev.height = c.height; PE.cx2(prev).drawImage(c, 0, 0);
      var rx = ramp.getContext("2d"); for (var v = 0; v < 256; v++) { rx.fillStyle = "rgb(" + lut[v * 3] + "," + lut[v * 3 + 1] + "," + lut[v * 3 + 2] + ")"; rx.fillRect(v, 0, 1, 14); }
    }
    function build() {
      rows.textContent = "";
      inks.forEach(function (ik, i) {
        var col = h("input", { type: "color", value: ik.c, "aria-label": "Ink " + (i + 1) }); col.addEventListener("input", function () { ik.c = col.value; draw(); });
        var del = inks.length > 1 ? W.btn("", function () { inks.splice(i, 1); build(); draw(); }, "ghost icon", "i-trash", "Remove ink") : null;
        rows.appendChild(h("div", { "class": "ws-ink" }, [h("b", { text: "Ink " + (i + 1) }), col,
          W.range("Amount", ik.a, 0, 100, 1, function (v) { ik.a = v; draw(); }, function (v) { return v + "%"; }),
          W.range("Midtones", ik.m, 0.2, 4, 0.05, function (v) { ik.m = v; draw(); }, function (v) { return (+v).toFixed(2); }), del]));
      });
      if (inks.length < 4) rows.appendChild(W.btn("Add ink", function () { inks.push({ c: "#808080", a: 50, m: 0.7 }); build(); draw(); }, "ghost", "i-plus"));
    }
    var pre = h("select", { "class": "select", "aria-label": "Preset" }); pre.appendChild(h("option", { value: "", text: "Presets…" }));
    Object.keys(PRESETS).forEach(function (k) { pre.appendChild(h("option", { value: k, text: k })); });
    pre.addEventListener("change", function () { if (PRESETS[pre.value]) { inks = PE.clone(PRESETS[pre.value]); build(); draw(); } });
    var body = h("div", { "class": "ws-mode" }, [h("div", { "class": "ws-mbox" }, [prev, ramp]), h("div", { "class": "stack" }, [pre, rows])]);
    var dlg = W.modal("Duotone", body, [h("span", { "class": "faint", text: "1 ink = monotone, 2 = duotone, 3 = tritone, 4 = quadtone" }), h("span", { "class": "grow" }), W.btn("Cancel", function () { dlg.close(); }, "ghost"),
      W.btn("Convert", function () { S3.store("pe-duo", inks); dlg.close(); M.toDuotone(inks); }, "primary")], true);
    build(); draw();
  };

  // ---------- indexed colour ----------
  M.indexedDialog = function () {
    if (!FX.need()) return; ED.flushProps();
    var d = ED.doc, st = Object.assign({ kind: "adaptive", colors: 256, dither: "diffusion", amount: 100, trans: true }, S3.store("pe-indexed") || {});
    var prev = h("canvas", { "class": "ws-mprev" }), pbox = h("div", { "class": "ws-mbox fx-prev", title: "Click: fit / 100%" }, [prev]), sw = h("div", { "class": "ws-swatches" }), info = h("p", { "class": "faint pe-p mono" }), fit = true, last = null, token = 0;
    var colI = h("input", { type: "number", "class": "input", min: "2", max: "256", value: String(st.colors) });
    colI.addEventListener("change", function () { st.colors = PE.clamp(Math.round(+colI.value || 256), 2, 256); colI.value = st.colors; run(); });
    pbox.addEventListener("click", function () { fit = !fit; pbox.classList.toggle("full", !fit); show(); });
    function opts() { return { kind: st.kind, colors: st.colors, dither: st.dither, amount: st.amount / 100, keepAlpha: st.trans }; }
    function show() {
      if (!last) return; var c = FX.toCanvas(last), bw = pbox.clientWidth || 420, bh = pbox.clientHeight || 320, k = fit ? Math.min(1, bw / c.width, bh / c.height) : 1;
      prev.width = Math.max(1, Math.round(c.width * k)); prev.height = Math.max(1, Math.round(c.height * k)); var x = PE.cx2(prev); x.imageSmoothingEnabled = !fit || k < 1; x.drawImage(c, 0, 0, prev.width, prev.height);
    }
    var run = S3.debounce(function () {
      var t = ++token, img = FX.imageData(PE.flatten(d)), o = opts(); info.textContent = "Reducing…";
      if (o.keepAlpha) { var any = false; for (var i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) { any = true; break; } o.keepAlpha = any; }
      FX.exp.job({ op: "quantize", img: { data: img.data, width: img.width, height: img.height }, o: o }, [img.data.buffer]).then(function (r) {
        if (t !== token) return; last = r; show();
        sw.textContent = ""; r.pal.forEach(function (p) { var e = h("span", { title: PE.toHex(p[0], p[1], p[2]) }); e.style.background = PE.toHex(p[0], p[1], p[2]); sw.appendChild(e); });
        info.textContent = r.pal.length + " colours" + (r.transparent >= 0 ? " + transparent" : "");
      }).catch(function (e) { info.textContent = e.message; });
    }, d.w * d.h > 6e6 ? 400 : 150);
    function setter(k) { return function (v) { st[k] = v; run(); }; }
    function exportAs(fmt) {
      var x = FX.exp, s2 = Object.assign({}, x.settings(), { fmt: fmt, scale: 1, trans: st.trans, colors: st.colors, dither: st.dither === "none" ? "none" : st.dither, palette: st.kind, meta: "none" });
      ED.working(x.encode(x.render(d, s2, false), s2, d), "Encoding…").then(function (b) { FX.download(b, FX.fname(x.formats[fmt].ext, d)); S3.done(); }).catch(function (e) { S3.toast(e.message, "error"); });
    }
    function palFile(kind) {
      if (!last) return; var pal = last.pal, base = FX.base(d) + "-palette";
      if (kind === "act") FX.download(new Blob([Q.act(pal, last.transparent >= 0 ? pal.length : -1)], { type: "application/octet-stream" }), base + ".act");
      else if (kind === "gpl") FX.download(new Blob([Q.gpl(pal, d.name)], { type: "text/plain" }), base + ".gpl");
      else FX.download(new Blob([Q.hexList(pal)], { type: "text/plain" }), base + ".txt");
    }
    var side = h("div", { "class": "stack" }, [
      W.select("Palette", [["adaptive", "Adaptive (median cut)"], ["web", "Web (216)"], ["uniform", "Uniform"], ["grey", "Greys"], ["bw", "Black & white"]], st.kind, setter("kind")),
      W.field("Colours", colI),
      W.seg("Dither", [["none", "None"], ["diffusion", "Diffusion"], ["pattern", "Pattern"]], st.dither, setter("dither")),
      W.range("Dither amount", st.amount, 0, 100, 1, setter("amount"), function (v) { return v + "%"; }),
      W.check("Keep transparency", st.trans, setter("trans")), info, sw,
      h("div", { "class": "pe-prow" }, [W.btn(".act", function () { palFile("act"); }, "ghost", null, "Export the palette as a colour table (.act)"), W.btn(".gpl", function () { palFile("gpl"); }, "ghost", null, "Export the palette (.gpl)"), W.btn("Hex", function () { palFile("txt"); }, "ghost", null, "Export the palette as a hex list")]),
      h("div", { "class": "pe-prow" }, [W.btn("Export PNG-8", function () { exportAs("png8"); }, "ghost", "i-download"), W.btn("Export GIF", function () { exportAs("gif"); }, "ghost", "i-download")])]);
    var body = h("div", { "class": "ws-mode" }, [pbox, side]);
    var dlg = W.modal("Indexed colour", body, [h("span", { "class": "faint", text: "Apply flattens the image to one layer of palette colours." }), h("span", { "class": "grow" }), W.btn("Close", function () { S3.store("pe-indexed", st); dlg.close(); }, "ghost"),
      W.btn("Apply", function () {
        if (!last) return; S3.store("pe-indexed", st); dlg.close(); var r = last;
        ED.meta("Mode: indexed colour", function () { var nl = PE.rasterFromCanvas(FX.toCanvas(r), "Indexed"); d.layers = [nl]; d.active = nl.id; ED.maskEdit = false; });
        d.mode = "indexed"; d.palette = r.pal; ED.emit("ws", "mode");
      }, "primary")], true);
    run();
  };
  M.depthDialog = function () {
    W.modal("Bits per channel", h("div", { "class": "stack" }, [h("p", { "class": "pe-p", text: "This editor works in 8 bits per channel (RGB plus transparency)." }),
      h("p", { "class": "faint pe-p", text: "16- and 32-bit PSD and TIFF files open converted to 8-bit (32-bit linear light is converted to sRGB). Exports are 8-bit. Greyscale, duotone and indexed modes above are applied to the RGB pixels." })]), null);
  };
  FX.menu("Image", ["Mode: greyscale…", "", M.greyDialog, FX.has], "Threshold…", true);
  FX.menu("Image", ["Mode: duotone…", "", M.duoDialog, FX.has], "Mode: greyscale…");
  FX.menu("Image", ["Mode: indexed colour…", "", M.indexedDialog, FX.has], "Mode: duotone…");
  FX.menu("Image", ["Mode: bits per channel…", "", M.depthDialog], "Mode: indexed colour…");

  FX.tests.push(async function (ok, near, px, solid) {
    var g = M.greyData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), "lum"); ok(near(g[0], 76, 1) && g[0] === g[2] && near(g[4], 150, 1), "greyscale luminosity");
    var lut = M.duoLut([{ c: "#000000", a: 100, m: 1 }]); ok(lut[0] === 0 && lut[255 * 3] === 255 && near(lut[128 * 3], 128, 1), "monotone black = greys");
    var sep = M.duoLut(PRESETS.Sepia); ok(sep[128 * 3] > sep[128 * 3 + 2], "sepia is warm");
    // quantiser: 3 flat colours stay exact with an adaptive palette
    var w = 30, img = { data: new Uint8ClampedArray(w * 10 * 4), width: w, height: 10 }, cols = [[200, 30, 40], [10, 120, 220], [250, 250, 250]];
    for (var i = 0; i < w * 10; i++) { var c = cols[Math.floor((i % w) / 10)]; img.data.set([c[0], c[1], c[2], 255], i * 4); }
    var r = Q.reduce(img, { kind: "adaptive", colors: 8, dither: "none" }), back = Q.toRGBA(r), maxd = 0;
    for (i = 0; i < back.data.length; i++) maxd = Math.max(maxd, Math.abs(back.data[i] - img.data[i]));
    ok(r.pal.length === 3 && maxd <= 4, "adaptive palette keeps flat colours (" + r.pal.length + ", " + maxd + ")");
    var bw = Q.reduce(img, { kind: "bw", dither: "diffusion" }); ok(bw.pal.length === 2, "black & white palette");
    // PNG-8 and GIF decode back to the same pixels
    var z = function (u) { var s = new CompressionStream("deflate"), wr = s.writable.getWriter(); wr.write(u); wr.close(); return new Response(s.readable).arrayBuffer().then(function (a) { return new Uint8Array(a); }); };
    var t = { data: new Uint8ClampedArray(img.data), width: w, height: 10 }; t.data[3] = 0;
    var m = Q.reduce(t, { kind: "adaptive", colors: 16, dither: "none", keepAlpha: true });
    for (var fmt of ["png", "gif"]) {
      var bytes = fmt === "png" ? await Q.png8(m, z, PE.crc32) : Q.gif(m), bm = await createImageBitmap(new Blob([bytes], { type: "image/" + fmt })), cc = PE.mk(w, 10), xx = PE.cx2(cc); xx.drawImage(bm, 0, 0);
      var dd = xx.getImageData(0, 0, w, 10).data, good = dd[3] === 0;
      for (i = 4; good && i < dd.length; i += 4) if (Math.abs(dd[i] - t.data[i]) > 4 || dd[i + 3] !== 255) good = false;
      ok(good, fmt + " indexed export decodes back");
    }
    var big = { data: new Uint8ClampedArray(300 * 200 * 4), width: 300, height: 200 }, rnd = window.PIX.rng(4); for (i = 0; i < big.data.length; i++) big.data[i] = (i & 3) === 3 ? 255 : rnd() * 256;
    var gm = Q.reduce(big, { kind: "adaptive", colors: 256, dither: "diffusion" }), gb = await createImageBitmap(new Blob([Q.gif(gm)], { type: "image/gif" }));
    var gc = PE.mk(300, 200), gx = PE.cx2(gc); gx.drawImage(gb, 0, 0); var gd = gx.getImageData(0, 0, 300, 200).data, exp = Q.toRGBA(gm).data, same = gb.width === 300;
    for (i = 0; same && i < gd.length; i++) if (gd[i] !== exp[i]) same = false;
    ok(same, "GIF with 256 colours and table resets decodes exactly");
    ok(Q.act(gm.pal, -1).length === 772 && Q.gpl([[1, 2, 3]], "x").indexOf("  1   2   3") > 0, "palette files");
  });
})();
