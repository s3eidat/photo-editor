/* Files lane: "Export as" dialog (format, quality, size, transparency / matte, metadata, live preview with the real
   encoded file size), quick export with the last settings, and TIFF / BMP opening and writing.
   Everything is encoded on this device; nothing is uploaded. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, FX = PE.files, E = window.FENC, h = S3.h;
  var X = FX.exp = {};

  // ---------- workers ----------
  function zlib(u8, inflate) {
    if (typeof CompressionStream !== "function") return Promise.reject(new Error("This browser cannot compress"));
    var s = new (inflate ? DecompressionStream : CompressionStream)("deflate"), w = s.writable.getWriter();
    w.write(u8).catch(function () {}); w.close().catch(function () {});
    return new Response(s.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  var job = FX.worker("js/files/enc-worker.js", function (m) {
    if (m.op === "indexed") return X.indexed(m);
    if (m.op === "quantize") { var Q = window.FQUANT, q = Q.reduce(m.img, m.o), rgba = Q.toRGBA(q); return { data: rgba.data, width: rgba.width, height: rgba.height, pal: q.pal, transparent: q.transparent }; }
    if (m.op === "tiff") return E.tiff(m.img, m.o, function (u) { return zlib(u); });
    if (m.op === "bmp") return E.bmp(m.img, m.o);
    return E.readTiff(m.bytes, function (u) { return zlib(u, true); }, function (w, hh) { if (w * hh > m.maxPx || w > m.maxSide || hh > m.maxSide) throw new Error("This TIFF is too large (" + w + " × " + hh + ")"); });
  });

  X.indexed = function (m) {      // quantise + encode (same code as the worker)
    var Q = window.FQUANT, r = Q.reduce(m.img, m.o);
    return m.fmt === "gif" ? Q.gif(r) : Q.png8(r, function (u) { return zlib(u); }, PE.crc32);
  };
  X.job = function (m, tr) { return job(m, tr); };
  // ---------- formats ----------
  function canEncode(mime) { try { return PE.mk(2, 2).toDataURL(mime).indexOf("data:" + mime) === 0; } catch (e) { return false; } }
  var F = X.formats = {
    png: { label: "PNG", ext: "png", mime: "image/png", alpha: true, note: "Lossless" },
    jpg: { label: "JPG", ext: "jpg", mime: "image/jpeg", q: true, note: "Small photos, no transparency" },
    webp: { label: "WebP", ext: "webp", mime: "image/webp", alpha: true, q: true, note: "Small, keeps transparency" },
    avif: { label: "AVIF", ext: "avif", mime: "image/avif", alpha: true, q: true, note: "Smallest, newer browsers" },
    tiff: { label: "TIFF", ext: "tif", mime: "image/tiff", alpha: true, note: "Lossless, for print and archives" },
    bmp: { label: "BMP", ext: "bmp", mime: "image/bmp", alpha: true, note: "Uncompressed" },
    png8: { label: "PNG-8", ext: "png", mime: "image/png", alpha: true, idx: true, note: "Up to 256 colours, small" },
    gif: { label: "GIF", ext: "gif", mime: "image/gif", alpha: true, idx: true, note: "Up to 256 colours" }
  };
  X.available = function () { return Object.keys(F).filter(function (k) { var f = F[k]; return k === "tiff" || k === "bmp" || k === "png" || f.idx || (f.ok == null ? (f.ok = canEncode(f.mime)) : f.ok); }); };
  var DEF = { fmt: "png", q: 0.9, scale: 1, trans: true, matte: "#ffffff", comp: "lzw", meta: "none", artist: "", copyright: "", smooth: true, colors: 256, dither: "diffusion", palette: "adaptive" };
  X.settings = function () { var s = Object.assign({}, DEF, S3.store("pe-exportas") || {}); if (X.available().indexOf(s.fmt) < 0) s.fmt = "png"; return s; };
  function remember(st) { var k = {}; Object.keys(DEF).forEach(function (x) { k[x] = st[x]; }); S3.store("pe-exportas", k); quickLabel(); }

  // Render the document (or the selection) at the export size. st: settings; only: selection only.
  X.render = function (doc, st, only) {
    var r = only && doc.sel ? doc.sel.b : { x: 0, y: 0, w: doc.w, h: doc.h }, f = F[st.fmt], keepA = f.alpha && st.trans;
    var k = Math.min(st.scale || 1, PE.LIM.side * 2 / r.w, PE.LIM.side * 2 / r.h, Math.sqrt(80e6 / (r.w * r.h)));
    var c;
    if (st.smooth === false && k !== 1) {     // nearest neighbour for pixel art
      var base = PE.flatten(doc, { rect: only ? r : null, selMask: only }), W = Math.max(1, Math.round(r.w * k)), H = Math.max(1, Math.round(r.h * k));
      c = PE.mk(W, H); var x = PE.cx2(c); x.imageSmoothingEnabled = false; x.drawImage(base, 0, 0, W, H);
    } else c = PE.flatten(doc, { scale: k, rect: only ? r : null, selMask: only });
    if (!keepA) { var cx = PE.cx2(c); cx.globalCompositeOperation = "destination-over"; cx.fillStyle = PE.hex(st.matte, "#ffffff"); cx.fillRect(0, 0, c.width, c.height); cx.globalCompositeOperation = "source-over"; }
    return c;
  };
  function meta(st, doc) { return st.meta === "copyright" && (st.artist || st.copyright) ? { artist: String(st.artist || "").slice(0, 200), copyright: String(st.copyright || "").slice(0, 300), title: doc.name } : null; }
  // Encode a rendered canvas -> Promise<Blob>
  X.encode = function (c, st, doc) {
    var f = F[st.fmt], m = meta(st, doc || ED.doc), dpi = (doc || ED.doc || {}).dpi;
    if (f.idx) {
      var im = FX.imageData(c), ka = st.trans && hasAlpha(im.data);
      return job({ op: "indexed", fmt: st.fmt, img: { data: im.data, width: im.width, height: im.height }, o: { kind: st.palette || "adaptive", colors: PE.clamp(Math.round(st.colors || 256), 2, 256), dither: st.dither || "none", keepAlpha: ka } }, [im.data.buffer])
        .then(function (u8) { return new Blob([u8], { type: f.mime }); });
    }
    if (st.fmt === "tiff" || st.fmt === "bmp") {
      var img = FX.imageData(c), alpha = f.alpha && st.trans && hasAlpha(img.data);
      return job({ op: st.fmt, img: { data: img.data, width: img.width, height: img.height }, o: { alpha: alpha, compression: st.comp, dpi: dpi, artist: m && m.artist, copyright: m && m.copyright, description: m && m.title } }, [img.data.buffer])
        .then(function (u8) { return new Blob([u8], { type: f.mime }); });
    }
    return PE.toBlob(c, f.mime, f.q ? st.q : undefined).then(function (b) {
      if (b.type !== f.mime) throw new Error("This browser cannot write " + f.label + " files");
      if (!m || (st.fmt !== "jpg" && st.fmt !== "png")) return b;
      return PE.blobBytes(b).then(function (u8) { return new Blob([st.fmt === "jpg" ? E.jpegMeta(u8, m) : E.pngMeta(u8, m, PE.crc32)], { type: f.mime }); });
    });
  };
  function hasAlpha(d) { for (var i = 3; i < d.length; i += 4) if (d[i] < 255) return true; return false; }
  X.fileName = function (st, only, doc) { return FX.fname(F[st.fmt].ext, doc, only ? "-selection" : ""); };

  // ---------- the dialog ----------
  var W = ED.ui.w;
  X.dialog = function (selOnly) {
    if (!FX.need()) return; ED.flushProps();
    var d = ED.doc, st = X.settings(), only = !!(selOnly && d.sel), fit = true, token = 0, lastBlob = null, lastCanvas = null;
    var prev = h("canvas", { "class": "fx-prev-c" }), pbox = h("div", { "class": "fx-prev", title: "Click to switch between fit and 100%" }, [prev]);
    var info = h("div", { "class": "fx-info mono" }), busy = h("span", { "class": "faint fx-busy" });
    pbox.addEventListener("click", function () { fit = !fit; pbox.classList.toggle("full", !fit); draw(); });
    function rect() { return only ? d.sel.b : { w: d.w, h: d.h }; }
    function outSize() { var r = rect(), k = Math.min(st.scale, PE.LIM.side * 2 / r.w, PE.LIM.side * 2 / r.h, Math.sqrt(80e6 / (r.w * r.h))); return { w: Math.max(1, Math.round(r.w * k)), h: Math.max(1, Math.round(r.h * k)), k: k }; }
    // controls
    var fmtSel = h("select", { "class": "select", "aria-label": "Format" });
    X.available().forEach(function (k) { var o = h("option", { value: k, text: F[k].label + " — " + F[k].note }); if (k === st.fmt) o.selected = true; fmtSel.appendChild(o); });
    fmtSel.addEventListener("change", function () { st.fmt = fmtSel.value; sync(); update(); });
    var qR = W.range("Quality", st.q, 0.05, 1, 0.01, function (v) { st.q = v; update(); }, W.pct);
    var comp = W.seg("Compression", [["none", "None"], ["lzw", "LZW"], ["zip", "ZIP"]], st.comp, function (v) { st.comp = v; update(); });
    var colI = h("input", { type: "number", "class": "input", min: "2", max: "256", value: String(st.colors || 256) });
    colI.addEventListener("change", function () { st.colors = PE.clamp(Math.round(+colI.value || 256), 2, 256); colI.value = st.colors; update(); });
    var idxBox = h("div", { "class": "stack" }, [h("div", { "class": "pe-custom" }, [W.field("Colours", colI), W.select("Palette", [["adaptive", "Adaptive"], ["web", "Web"], ["uniform", "Uniform"], ["grey", "Greys"], ["bw", "Black & white"]], st.palette || "adaptive", function (v) { st.palette = v; update(); })]),
      W.seg("Dither", [["none", "None"], ["diffusion", "Diffusion"], ["pattern", "Pattern"]], st.dither || "diffusion", function (v) { st.dither = v; update(); })]);
    var trans = W.check("Transparency", st.trans, function (v) { st.trans = v; sync(); update(); });
    var matte = h("input", { type: "color", value: PE.hex(st.matte, "#ffffff"), "aria-label": "Matte colour" });
    matte.addEventListener("input", function () { st.matte = matte.value; update(); });
    var matteF = h("label", { "class": "pe-of" }, [h("span", { text: "Background" }), matte]);
    var wI = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side * 2) }), hI = h("input", { type: "number", "class": "input", min: "1", max: String(PE.LIM.side * 2) });
    var pI = h("input", { type: "number", "class": "input", min: "1", max: "1000", step: "1" });
    function sizeFields() { var s = outSize(); wI.value = s.w; hI.value = s.h; pI.value = Math.round(st.scale * 1000) / 10; }
    wI.addEventListener("change", function () { st.scale = PE.clamp((+wI.value || 1) / rect().w, 0.001, 10); sizeFields(); update(); });
    hI.addEventListener("change", function () { st.scale = PE.clamp((+hI.value || 1) / rect().h, 0.001, 10); sizeFields(); update(); });
    pI.addEventListener("change", function () { st.scale = PE.clamp((+pI.value || 100) / 100, 0.001, 10); sizeFields(); update(); });
    var presets = h("div", { "class": "fx-scales" });
    [0.25, 0.5, 1, 2, 3].forEach(function (k) { presets.appendChild(W.btn(k * 100 + "%", function () { st.scale = k; sizeFields(); update(); }, "ghost")); });
    var smooth = W.seg("Resample", [["1", "Smooth"], ["0", "Pixel art"]], st.smooth === false ? "0" : "1", function (v) { st.smooth = v === "1"; update(); });
    var selChk = W.check("Only the selection", only, function (v) { only = v && !!d.sel; sizeFields(); update(); });
    if (!d.sel) selChk.querySelector("input").disabled = true;
    var aI = h("input", { "class": "input", maxlength: "200", dir: "auto", placeholder: "Your name", value: st.artist || "" }), cI = h("input", { "class": "input", maxlength: "300", dir: "auto", placeholder: "© 2026 Your name", value: st.copyright || "" });
    aI.addEventListener("change", function () { st.artist = aI.value.trim(); update(); }); cI.addEventListener("change", function () { st.copyright = cI.value.trim(); update(); });
    var metaBox = h("div", { "class": "fx-meta" }, [W.field("Author", aI), W.field("Copyright", cI)]);
    var metaSeg = W.seg("Metadata", [["none", "None"], ["copyright", "Author & copyright"]], st.meta, function (v) { st.meta = v; sync(); update(); });
    var metaNote = h("p", { "class": "faint pe-p" });
    function sync() {
      var f = F[st.fmt];
      qR.hidden = !f.q; comp.hidden = st.fmt !== "tiff"; idxBox.hidden = !f.idx; trans.hidden = !f.alpha; matteF.hidden = f.alpha && st.trans;
      metaBox.hidden = st.meta !== "copyright";
      metaNote.textContent = st.meta === "none" ? "No metadata: camera, location and editing details are never written." : (st.fmt === "webp" || st.fmt === "avif" || st.fmt === "bmp") ? f.label + " files here carry no metadata; choose JPG, PNG or TIFF to include it." : "Writes the author and copyright into the file (XMP" + (st.fmt === "tiff" ? " and TIFF tags" : st.fmt === "png" ? " and PNG text" : "") + ").";
    }
    var right = h("div", { "class": "fx-side stack" }, [
      h("label", { "class": "pe-of" }, [h("span", { text: "Format" }), fmtSel]), qR, comp, idxBox, trans, matteF,
      h("h3", { text: "Image size" }), h("div", { "class": "pe-custom" }, [W.field("Width", wI), W.field("Height", hI), W.field("Percent", pI)]), presets, smooth, selChk,
      h("h3", { text: "Metadata" }), metaSeg, metaBox, metaNote]);
    var body = h("div", { "class": "fx-exp" }, [h("div", { "class": "fx-left" }, [pbox, h("div", { "class": "row fx-irow" }, [info, busy])]), right]);
    var go = W.btn("Export", function () {
      remember(st);
      var t = ++token; busy.textContent = "Encoding…";
      (lastBlob && lastBlob.sig === sig() ? Promise.resolve(lastBlob.b) : X.encode(X.render(d, st, only), st, d)).then(function (b) {
        if (t !== token) return;
        FX.download(b, X.fileName(st, only, d)); S3.done(); dlg.close();
      }).catch(function (e) { busy.textContent = ""; S3.toast(e.message, "error"); });
    }, "primary", "i-download");
    var dlg = W.modal(selOnly ? "Export selection" : "Export as", body, [h("span", { "class": "faint", text: "Nothing is uploaded." }), h("span", { "class": "grow" }), W.btn("Cancel", function () { dlg.close(); }, "ghost"), go], true);
    dlg.el.querySelector(".pe-sheet").classList.add("fx-wide");
    function sig() { return JSON.stringify([st.fmt, st.q, st.scale, st.trans, st.matte, st.comp, st.meta, st.artist, st.copyright, st.smooth, only, st.colors, st.dither, st.palette]); }
    function draw() {
      var src = lastCanvas; if (!src) return;
      var bw = pbox.clientWidth || 400, bh = pbox.clientHeight || 300, k = fit ? Math.min(1, bw / src.width, bh / src.height) : 1;
      prev.width = Math.max(1, Math.round(src.width * k)); prev.height = Math.max(1, Math.round(src.height * k));
      var x = PE.cx2(prev); x.imageSmoothingQuality = "high"; x.clearRect(0, 0, prev.width, prev.height); x.drawImage(src, 0, 0, prev.width, prev.height);
    }
    var update = S3.debounce(function () {
      var t = ++token, s = outSize(), key = sig();
      info.textContent = s.w + " × " + s.h + " px · …"; busy.textContent = "Encoding…";
      setTimeout(function () {
        if (t !== token) return;
        var c;
        try { c = X.render(d, st, only); } catch (e) { busy.textContent = ""; info.textContent = e.message; return; }
        X.encode(c, st, d).then(function (b) {
          if (t !== token) return;
          lastBlob = { b: b, sig: key };
          info.textContent = c.width + " × " + c.height + " px · " + F[st.fmt].label + " · " + S3.fmtBytes(b.size);
          var show = createImageBitmap(b).catch(function () { return c; });
          return show.then(function (bm) { if (t !== token) return; lastCanvas = bm; draw(); busy.textContent = ""; });
        }).catch(function (e) { if (t === token) { busy.textContent = ""; info.textContent = e.message; } });
      }, 0);
    }, d.w * d.h > 8e6 ? 450 : 200);
    sizeFields(); sync(); update();
  };

  // ---------- quick export with the last settings (full image, 100%) ----------
  var quickItem = ["Quick export as PNG", "", function () { X.quick(); }, FX.has];
  function quickLabel() { quickItem[0] = "Quick export as " + F[X.settings().fmt].label; }
  X.quick = function () {
    if (!FX.need()) return; ED.flushProps();
    var st = Object.assign(X.settings(), { scale: 1 }), d = ED.doc;
    ED.working(X.encode(X.render(d, st, false), st, d), "Exporting…").then(function (b) {
      FX.download(b, X.fileName(st, false, d)); S3.done(); S3.toast("Exported " + X.fileName(st, false, d) + " (" + S3.fmtBytes(b.size) + ")");
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };

  // ---------- TIFF opening ----------
  X.readTiff = function (u8) { var c = u8.slice(); return job({ op: "readTiff", bytes: c, maxPx: PE.LIM.layerPx, maxSide: PE.LIM.layerSide }, [c.buffer]); };
  function openTiff(f, asLayers) {
    var name = String(f.name || "Image");
    ED.working(f.arrayBuffer().then(function (ab) { return X.readTiff(new Uint8Array(ab)); }), "Opening TIFF…").then(function (r) {
      var c = FX.toCanvas(r), w = r.width, hh = r.height, k = Math.min(1, PE.LIM.side / w, PE.LIM.side / hh, Math.sqrt(PE.LIM.px / (w * hh)));
      if (k < 1) { var n = PE.mk(Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(hh * k))), x = PE.cx2(n); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, n.width, n.height); c = PE.touch(n); }
      var img = { canvas: c, w: c.width, h: c.height, ow: w, oh: hh, scaled: k < 1 };
      if (asLayers && ED.doc) ED.placeImage(img, name);
      else { ED.openImageDoc(img, name); if (r.dpi && r.dpi !== 72) ED.doc.dpi = r.dpi; if (ED.saveNow) ED.saveNow(); }
      S3.done();
    }).catch(function (e) { S3.toast(e.message, "error"); });
  }
  FX.openers.push({ test: function (f) { return /\.tiff?$/i.test(f.name || "") || f.type === "image/tiff"; }, open: openTiff });
  FX.accept(".tif"); FX.accept(".tiff");

  // ---------- wiring ----------
  ED.ui.exportExt = function (selOnly) { X.dialog(selOnly); return true; };
  (ED.ui.MENUS.filter(function (m) { return m[0] === "File"; })[0] || [0, []])[1].forEach(function (it) { if (it !== "-" && it[0] === "Export image…") it[0] = "Export as…"; });
  quickLabel();
  FX.menu("File", quickItem, "Export as…");

  // ---------- self-test ----------
  FX.tests.push(async function (ok, near, px, solid) {
    // LZW: round trip of repetitive and random data (forces table resets)
    var rnd = window.PIX.rng(3), a = new Uint8Array(70000), i;
    for (i = 0; i < a.length; i++) a[i] = i < 30000 ? (i % 7) * 30 : Math.floor(rnd() * 256);
    var z = E.lzw(a), back = E.unlzw(z, a.length), same = back.length === a.length;
    for (i = 0; same && i < a.length; i++) if (a[i] !== back[i]) same = false;
    ok(same && z.length < a.length, "tiff LZW round trip");
    ok(E.lzw(new Uint8Array([7, 7, 7, 7])).length > 0 && E.unlzw(E.lzw(new Uint8Array([7, 7, 7, 7])), 4).join() === "7,7,7,7", "tiff LZW short run");
    // TIFF: every compression, with and without alpha, decodes back exactly
    var W0 = 37, H0 = 23, img = { data: new Uint8ClampedArray(W0 * H0 * 4), width: W0, height: H0 };
    for (i = 0; i < W0 * H0; i++) { img.data[i * 4] = (i * 7) & 255; img.data[i * 4 + 1] = (i >> 3) & 255; img.data[i * 4 + 2] = 200; img.data[i * 4 + 3] = i % 5 ? 255 : 90; }
    var zip = function (u) { return zlib(u); }, unzip = function (u) { return zlib(u, true); };
    for (var cmp of ["none", "lzw", "zip"]) for (var al of [true, false]) {
      var t = await E.tiff(img, { alpha: al, compression: cmp, dpi: 300, artist: "A", copyright: "C" }, zip), r = await E.readTiff(t, unzip), good = r.width === W0 && r.height === H0 && near(r.dpi, 300, 0.01);
      for (i = 0; good && i < img.data.length; i++) if (r.data[i] !== ((i & 3) === 3 && !al ? 255 : img.data[i])) good = false;
      ok(good, "tiff " + cmp + (al ? " rgba" : " rgb") + " round trip");
    }
    var tw = await job({ op: "tiff", img: { data: new Uint8ClampedArray(img.data), width: W0, height: H0 }, o: { alpha: true, compression: "zip" } });
    var tr = await X.readTiff(tw); ok(tr.width === W0 && tr.data[5] === img.data[5], "tiff via worker");
    var bad = false; try { await X.readTiff(new TextEncoder().encode("II*\u0000garbage garbage")); } catch (e) { bad = true; } ok(bad, "tiff: damaged file fails cleanly");
    // BMP: the browser decodes what we write
    var bm = E.bmp(img, { alpha: true }), bi = await createImageBitmap(new Blob([bm], { type: "image/bmp" })), bc = PE.mk(W0, H0); PE.cx2(bc).drawImage(bi, 0, 0);
    ok(bi.width === W0 && px(bc, 3, 2).slice(0, 3).join() === Array.prototype.slice.call(img.data, (2 * W0 + 3) * 4, (2 * W0 + 3) * 4 + 3).join(), "bmp decodes back");
    var b24 = E.bmp(img, {}), bi2 = await createImageBitmap(new Blob([b24], { type: "image/bmp" })); ok(bi2.width === W0 && b24.length === 54 + ((W0 * 3 + 3) & ~3) * H0, "bmp 24-bit row padding");
    // metadata: files still decode and carry the XMP
    var c = solid(20, 10, "#3366cc"), m = { artist: "Omar <test>", copyright: "© 2026" };
    var jb = await PE.blobBytes(await PE.toBlob(c, "image/jpeg", 0.9)), jm = E.jpegMeta(jb, m), jbm = await createImageBitmap(new Blob([jm], { type: "image/jpeg" }));
    var txt = new TextDecoder().decode(jm);
    ok(jbm.width === 20 && txt.indexOf("Omar &lt;test&gt;") > 0 && txt.indexOf("© 2026") > 0, "jpg metadata");
    var pb = await PE.blobBytes(await PE.toBlob(c, "image/png")), pm = E.pngMeta(pb, m, PE.crc32), pbm = await createImageBitmap(new Blob([pm], { type: "image/png" }));
    ok(pbm.width === 20 && new TextDecoder("latin1").decode(pm).indexOf("Copyright") > 0, "png metadata (CRC valid, still decodes)");
    // render: size, matte, selection, nearest neighbour
    var d = PE.newDoc(40, 20, "exp"), L = PE.rasterFromCanvas(solid(20, 20, "#ff0000"), "r"); d.layers = [L];
    var st = Object.assign({}, DEF, { fmt: "jpg", scale: 0.5, trans: false, matte: "#00ff00" }), rc = X.render(d, st, false);
    ok(rc.width === 20 && rc.height === 10 && px(rc, 15, 5)[1] === 255 && px(rc, 15, 5)[3] === 255, "export size + matte");
    var pa = X.render(d, Object.assign({}, DEF, { scale: 4, smooth: false }), false); ok(pa.width === 160 && px(pa, 79, 3)[0] === 255 && px(pa, 80, 3)[3] === 0, "pixel-art resample is crisp");
    var blob = await X.encode(X.render(d, Object.assign({}, DEF, { fmt: "tiff" }), false), Object.assign({}, DEF, { fmt: "tiff" }), d);
    ok(blob.type === "image/tiff" && blob.size > 100, "tiff export blob");
  });
})();
