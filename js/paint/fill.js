/* Photo Editor paint lane: filling from the surroundings. Edit › Fill with surroundings (the selection is rebuilt
   from the rest of the layer, PatchMatch-style, in a worker) and the spot healing brush (paint over a blemish,
   it is replaced from nearby texture and blended to the surrounding tone). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, PP = PE.paint, K = ED.ui.kit, h = S3.h;

  PP.icons({
    "t-spot": [["rect", { x: "2.5", y: "8.6", width: "19", height: "6.8", rx: "3.4", transform: "rotate(-45 12 12)" }], "M10.6 10.6h.01M13.4 13.4h.01M13.4 10.6h.01M10.6 13.4h.01", "M18.5 2.5v3M17 4h3"]
  });

  // Fill the hole of canvas cv (local coords). mask: Uint8Array cv-sized (>0 = hole, value = blend).
  // opts: {expand px, adapt (match the tone along the edge), quality 1..3, avoid: Uint8Array cv-sized, bbox}
  // Resolves to {rect, img} with the new pixels of rect (ImageData).
  PP.fillHole = function (cv, mask, opts) {
    opts = opts || {};
    var W = cv.width, H = cv.height, bb = opts.bbox || PIX.bounds(mask, W, H, 0);
    if (!bb) return Promise.reject(new Error("Nothing to fill"));
    var m = Math.round(PE.clamp(Math.max(bb.w, bb.h) * 1.3, 40, 900));
    var R = PE.inter({ x: bb.x - m, y: bb.y - m, w: bb.w + 2 * m, h: bb.h + 2 * m }, { x: 0, y: 0, w: W, h: H });
    var hole = new Uint8Array(R.w * R.h), avoid = opts.avoid ? new Uint8Array(R.w * R.h) : null, area = 0, x, y;
    for (y = 0; y < R.h; y++) for (x = 0; x < R.w; x++) {
      var v = mask[(y + R.y) * W + x + R.x]; if (v) { hole[y * R.w + x] = v; area++; }
      if (avoid && opts.avoid[(y + R.y) * W + x + R.x]) avoid[y * R.w + x] = 1;
    }
    if (opts.expand > 0) {
      var g = PIX.grow(hole.map(function (v2) { return v2 ? 255 : 0; }), R.w, R.h, opts.expand);
      for (var i = 0; i < g.length; i++) if (g[i] && !hole[i]) { hole[i] = g[i]; area++; }
    }
    var orig = PE.getData(cv, R), k = Math.min(1, Math.sqrt(140000 / Math.max(1, area))), q = opts.quality || (area > 90000 ? 1 : 2);
    var sw = Math.max(8, Math.round(R.w * k)), sh = Math.max(8, Math.round(R.h * k)), img = orig, sh2 = hole, sav = avoid;
    if (k < 1) {       // big holes are solved at a lower resolution, then scaled back up
      var t = PE.mk(sw, sh), tx = PE.cx2(t); tx.imageSmoothingQuality = "high"; tx.drawImage(cv, R.x, R.y, R.w, R.h, 0, 0, sw, sh); img = tx.getImageData(0, 0, sw, sh);
      sh2 = scaleMask(hole, R.w, R.h, sw, sh); if (avoid) sav = scaleMask(avoid, R.w, R.h, sw, sh);
    }
    var job = PP.work("inpaint", [{ data: img.data, width: img.width, height: img.height }, sh2, { avoid: sav, quality: q, seed: 7 + bb.x * 31 + bb.y }]);
    return job.then(function (res) {
      var fill = new ImageData(new Uint8ClampedArray(res.data), res.width, res.height);
      if (k < 1) { var a = PE.mk(res.width, res.height); PE.cx2(a).putImageData(fill, 0, 0); var b = PE.mk(R.w, R.h), bx = PE.cx2(b); bx.imageSmoothingQuality = "high"; bx.drawImage(a, 0, 0, R.w, R.h); fill = bx.getImageData(0, 0, R.w, R.h); }
      var hb = new Uint8Array(R.w * R.h); for (var j = 0; j < hb.length; j++) hb[j] = hole[j] ? 255 : 0;
      var src = { data: fill.data, width: R.w, height: R.h }, dst = { data: orig.data, width: R.w, height: R.h };
      var done = opts.adapt === false ? Promise.resolve(blend(dst, src, hb)) : PE.work("heal", [dst, src, hb]);
      return done.then(function (healed) {
        var out = new ImageData(new Uint8ClampedArray(healed.data), R.w, R.h), o = out.data, od = orig.data;
        for (var p = 0; p < hole.length; p++) if (hole[p] < 255) { var kk = hole[p] / 255; for (var c = 0; c < 4; c++) o[p * 4 + c] = od[p * 4 + c] + (o[p * 4 + c] - od[p * 4 + c]) * kk; }
        return { rect: R, img: out };
      });
    });
  };
  function blend(dst, src, m) { var o = new Uint8ClampedArray(dst.data); for (var p = 0; p < m.length; p++) if (m[p]) for (var c = 0; c < 4; c++) o[p * 4 + c] = src.data[p * 4 + c]; return { data: o, width: dst.width, height: dst.height }; }
  function scaleMask(m, w, hh, W2, H2) {
    var o = new Uint8Array(W2 * H2);
    for (var y = 0; y < H2; y++) for (var x = 0; x < W2; x++) {
      var x0 = Math.floor(x * w / W2), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / W2)), y0 = Math.floor(y * hh / H2), y1 = Math.max(y0 + 1, Math.floor((y + 1) * hh / H2)), v = 0;
      for (var yy = y0; yy < y1 && yy < hh; yy++) for (var xx = x0; xx < x1 && xx < w; xx++) if (m[yy * w + xx] > v) v = m[yy * w + xx];
      o[y * W2 + x] = v;
    }
    return o;
  }

  // ---------- Edit › Fill with surroundings ----------
  var FO = PP.opts("fillsur", { expand: 2, adapt: true, quality: 2, newLayer: false });
  PP.fillSurroundings = function (o) {
    o = Object.assign({}, FO, o || {});
    var d = ED.doc;
    if (!d || !d.sel) { S3.toast("Select the area to fill first (lasso around the object)", "error"); return Promise.resolve(false); }
    if (ED.maskEdit) { S3.toast("Fill with surroundings works on layer pixels: click the layer thumbnail first", "error"); return Promise.resolve(false); }
    var t = PP.target("pixels"); if (!t) return Promise.resolve(false);
    var L = t.L, cv = L.canvas, m = PE.selFor(d, { x: L.x, y: L.y, w: cv.width, h: cv.height });
    ED.push(t.grow);
    return PP.commitAsync(PP.fillHole(cv, m, { expand: o.expand, adapt: o.adapt, quality: o.quality }), "Filling from the surroundings…", function (res) {
      if (o.newLayer) {
        var c = PE.mk(res.rect.w, res.rect.h), x = PE.cx2(c); x.putImageData(res.img, 0, 0);
        var mk = PE.mk(res.rect.w, res.rect.h), g = PE.cx2(mk);
        if (o.expand > 0) g.filter = "blur(" + (o.expand / 2) + "px)";
        for (var k = 0; k < (o.expand > 0 ? 3 : 1); k++) g.drawImage(PE.selCanvas(d.sel), -(L.x + res.rect.x), -(L.y + res.rect.y));
        x.globalCompositeOperation = "destination-in"; x.drawImage(mk, 0, 0);
        ED.addLayer(PE.rasterFromCanvas(PE.touch(c), "Filled", L.x + res.rect.x, L.y + res.rect.y), "Fill with surroundings", L);
        return true;
      }
      var e = PE.editPixels(d, "Fill with surroundings", L, "canvas", res.rect, function (c) { c.putImageData(res.img, res.rect.x, res.rect.y); });
      PP.pushJoined(t.grow, e, "Fill with surroundings");
      return true;
    });
  };
  function fillDialog() {
    if (!K.need()) return;
    if (!ED.doc.sel) { S3.toast("Select the area to fill first (lasso around the object)", "error"); return; }
    var o = FO, body = h("div", { "class": "stack" }, [
      h("p", { "class": "faint pe-p", text: "Rebuilds the selection from the texture around it. Select a little beyond the object; it all happens on this device." }),
      K.range("Expand selection", o.expand, 0, 40, 1, function (v) { o.expand = v; }, function (v) { return v + " px"; }),
      K.seg("Quality", [["1", "Fast"], ["2", "Good"], ["3", "Best"]], String(o.quality), function (v) { o.quality = +v; }),
      K.check("Blend colour at the edges", o.adapt, function (v) { o.adapt = v; }),
      K.check("Put the result on a new layer", o.newLayer, function (v) { o.newLayer = v; })]);
    var dlg = K.modal("Fill with surroundings", body, [h("span", { "class": "grow" }), K.btn("Cancel", function () { dlg.close(); }, "ghost"), K.btn("Fill", function () { dlg.close(); ED.saveOpts(); PP.fillSurroundings(); }, "primary")]);
  }
  PP.menu("Edit", [["Fill with surroundings…", "Shift+Alt+Backspace", fillDialog, function () { return !!(ED.doc && ED.doc.sel); }]], "Fill…");
  window.addEventListener("keydown", function (e) {
    if (e.key !== "Backspace" || !e.shiftKey || !e.altKey || e.ctrlKey || e.metaKey || ED.isTyping(e) || document.querySelector(".s3-modal") || !ED.doc) return;
    e.preventDefault(); e.stopImmediatePropagation(); fillDialog();
  }, true);

  PP.shortcut("Fill with surroundings", "Shift+Alt+Backspace (with a selection)");

  // ---------- spot healing brush ----------
  PP.addTool("spot", "Spot healing brush", "J", "eyedropper", null);
  PP.engineTool("spot", {
    label: "Spot healing brush", fill: "color", sym: false, mask: false, noBuildup: true,
    begin: function (st) { st.fg = [70, 70, 90]; st.o.fgbgJ = st.o.hueJ = st.o.satJ = st.o.briJ = st.o.purity = 0; st.o.op = 1; },
    preview: function (st) {
      var lc = PE.cx2(st.live); lc.globalCompositeOperation = "copy"; lc.drawImage(st.holder.canvas, 0, 0);
      lc.globalCompositeOperation = "source-over"; lc.globalAlpha = 0.55; lc.drawImage(st.buf, 0, 0); lc.globalAlpha = 1; PE.touch(st.live);
      return { canvas: st.live, x: st.ox, y: st.oy };
    },
    commit: function (st, label) {
      var bb = st.bbox && PE.inter(PE.rectI(st.bbox), { x: 0, y: 0, w: st.w, h: st.h });
      if (!bb) { ED.stroke = null; ED.push(st.grow); ED.changed(); return; }
      var md = PE.getData(st.buf, bb).data, m = new Uint8Array(st.w * st.h);
      for (var y = 0; y < bb.h; y++) for (var x = 0; x < bb.w; x++) { var a = md[(y * bb.w + x) * 4 + 3]; if (a) m[(y + bb.y) * st.w + x + bb.x] = Math.min(255, a * 2); }
      var job = st.o.type === "proximity" ? proximity(st.holder.canvas, m, bb) : PP.fillHole(st.holder.canvas, m, { bbox: bb, expand: 1, adapt: true, quality: 2 });
      var grow = st.grow; PP.endStroke(st);
      PP.commitAsync(job, "Healing…", function (res) {
        PP.pushJoined(grow, PE.editPixels(ED.doc, label, st.holder, "canvas", res.rect, function (c) { c.putImageData(res.img, res.rect.x, res.rect.y); }), label);
      });
    }
  }, { size: 30, hard: 0.6, type: "content", sizeC: "off" });
  PP.group("J", ["spot", "heal"]);
  PP.optsFor.spot = function (items) {
    var o = ED.o.spot;
    return PP.brushBar("spot", items, [K.seg("Type", [["content", "Content-aware"], ["proximity", "Proximity match"]], o.type, function (v) { o.type = v; ED.saveOpts(); })],
      "Paint over a spot or a small object, a little larger than it. It is replaced from the texture around it.", { noOp: true, noFlow: true, noSym: true });
  };
  // Proximity match: copy the best-matching nearby patch (judged on the ring around the stroke), then heal.
  function proximity(cv, m, bb) {
    var W = cv.width, H = cv.height, pad = Math.max(4, Math.round(Math.max(bb.w, bb.h) * 0.25)), R = PE.inter({ x: bb.x - pad, y: bb.y - pad, w: bb.w + 2 * pad, h: bb.h + 2 * pad }, { x: 0, y: 0, w: W, h: H });
    var dst = PE.getData(cv, R), ring = [], x, y, best = null, bd = Infinity;
    for (y = 0; y < R.h; y += 2) for (x = 0; x < R.w; x += 2) if (!m[(y + R.y) * W + x + R.x]) ring.push(y * R.w + x);
    var step = Math.max(bb.w, bb.h) + pad, cands = [];
    for (var ring2 = 1; ring2 <= 2; ring2++) for (var a = 0; a < 16; a++) { var t = a / 16 * Math.PI * 2; cands.push({ x: Math.round(Math.cos(t) * step * ring2), y: Math.round(Math.sin(t) * step * ring2) }); }
    var all = PE.getData(cv).data;
    cands.forEach(function (o) {
      if (R.x + o.x < 0 || R.y + o.y < 0 || R.x + o.x + R.w > W || R.y + o.y + R.h > H) return;
      var s = 0;
      for (var i = 0; i < ring.length && s < bd; i++) {
        var p = ring[i], px = p % R.w, py = (p - px) / R.w, a1 = (py * R.w + px) * 4, b1 = ((py + R.y + o.y) * W + px + R.x + o.x) * 4;
        var e0 = dst.data[a1] - all[b1], e1 = dst.data[a1 + 1] - all[b1 + 1], e2 = dst.data[a1 + 2] - all[b1 + 2]; s += e0 * e0 + e1 * e1 + e2 * e2;
      }
      if (s < bd) { bd = s; best = o; }
    });
    if (!best) return PP.fillHole(cv, m, { bbox: bb, expand: 1 });
    var srcC = PE.mk(R.w, R.h); PE.cx2(srcC).drawImage(cv, -(R.x + best.x), -(R.y + best.y));
    var sm = new Uint8Array(R.w * R.h); for (y = 0; y < R.h; y++) for (x = 0; x < R.w; x++) sm[y * R.w + x] = m[(y + R.y) * W + x + R.x];
    return PE.work("heal", [{ data: dst.data, width: R.w, height: R.h }, PE.getData(srcC), sm]).then(function (res) { return { rect: R, img: new ImageData(new Uint8ClampedArray(res.data), R.w, R.h) }; });
  }
})();
