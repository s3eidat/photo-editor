/* Selection lane: Edit › Replace sky…. Finds the sky (js/select/sky.js), puts another sky behind a soft mask and
   tints the foreground towards the new sky's light. Result: a "Sky replacement" group with a masked sky layer and a
   masked soft-light colour fill, all editable afterwards. Skies: five drawn in code, any raster layer, or a photo. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  var RS = null, BUILTIN = [["clear", "Clear blue"], ["clouds", "Blue with clouds"], ["golden", "Golden hour"], ["dusk", "Dusk"], ["overcast", "Overcast"]];
  var DEF = { shift: 0, fade: 4, bright: 0, temp: 0, scale: 100, ox: 0, oy: 0, flip: false, light: 30, edgeFix: 70 };

  // ---------- skies drawn in code (2:1, horizon at the bottom) ----------
  var built = {};
  function builtin(name) {
    if (built[name]) return built[name];
    var W = 2400, H = 1200, c = PE.mk(W, H), x = PE.cx2(c), seed = 11, i;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    function grad(stops) { var g = x.createLinearGradient(0, 0, 0, H); stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); x.fillStyle = g; x.fillRect(0, 0, W, H); }
    function blobs(n, col, y0, y1, r0, r1, a) {
      for (i = 0; i < n; i++) {
        var cx = rnd() * W, cy = y0 + rnd() * (y1 - y0), r = r0 + rnd() * (r1 - r0), g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, "rgba(" + col + "," + a + ")"); g.addColorStop(1, "rgba(" + col + ",0)"); x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
    }
    if (name === "clouds") { grad([[0, "#2a66c8"], [0.7, "#86b6ea"], [1, "#cfe3f6"]]); blobs(160, "255,255,255", H * 0.1, H * 0.75, 40, 150, 0.55); }
    else if (name === "golden") { grad([[0, "#44589a"], [0.5, "#c98a86"], [0.8, "#f0a46c"], [1, "#fad79e"]]); blobs(1, "255,236,190", H * 0.95, H * 0.95, 500, 500, 0.9); blobs(40, "255,190,140", H * 0.3, H * 0.6, 60, 200, 0.25); }
    else if (name === "dusk") { grad([[0, "#121838"], [0.45, "#4b3a78"], [0.8, "#c86f72"], [1, "#efa978"]]); x.fillStyle = "rgba(255,255,240,0.9)"; for (i = 0; i < 260; i++) { var sy = rnd() * H * 0.4; x.globalAlpha = 1 - sy / (H * 0.4); x.fillRect(rnd() * W, sy, 2, 2); } x.globalAlpha = 1; }
    else if (name === "overcast") { grad([[0, "#7c8794"], [1, "#c8ced5"]]); blobs(120, "214,219,225", 0, H * 0.8, 80, 260, 0.35); blobs(60, "120,128,140", 0, H * 0.5, 80, 220, 0.25); }
    else grad([[0, "#2c6cd0"], [0.7, "#8fbdf0"], [1, "#d2e6f8"]]);
    built[name] = PE.touch(c); return c;
  }

  function sources() {
    var out = BUILTIN.map(function (b) { return ["b:" + b[0], b[1]]; });
    ED.doc.layers.slice().reverse().forEach(function (L) { if (L.kind === "raster" && L.canvas) out.push(["l:" + L.id, "Layer: " + L.name]); });
    out.push(["file", "Photo from file…"]);
    return out;
  }
  function srcCanvas(key) {
    if (key.indexOf("b:") === 0) return builtin(key.slice(2));
    if (key.indexOf("l:") === 0) { var L = PE.findLayer(ED.doc, key.slice(2)); return L && L.canvas ? PE.surface(L, ED.doc).canvas : builtin("clear"); }
    return RS && RS.file ? RS.file : builtin("clear");
  }

  // ---------- rendering ----------
  // Lowest sky row of a mask (W x H), or H when the mask is empty.
  function horizon(m, W, H) { for (var y = H - 1; y >= 0; y--) for (var x = 0, r = y * W; x < W; x++) if (m[r + x] >= 128) return y + 1; return H; }
  // The new sky at w x h: covers the canvas width and down to the horizon, bottom-aligned, then moved / flipped / toned.
  function skyAt(src, w, h, hz, o) {
    var c = PE.mk(w, h), x = PE.cx2(c), y1 = Math.max(h * 0.2, hz), k = Math.max(w / src.width, y1 * 1.05 / src.height) * Math.max(0.1, o.scale / 100);
    var dw = src.width * k, dh = src.height * k, dx = (w - dw) / 2 + o.ox / 100 * w / 2, dy = y1 - dh + y1 * 0.05 + o.oy / 100 * h / 2;
    x.imageSmoothingQuality = "high";
    if (o.flip) { x.translate(w, 0); x.scale(-1, 1); dx = w - dx - dw; }
    x.drawImage(src, dx, dy, dw, dh); x.setTransform(1, 0, 0, 1, 0, 0);
    if (dy > 0) { x.drawImage(c, 0, Math.ceil(dy), w, 1, 0, 0, w, Math.ceil(dy)); }               // stretch the top row if moved down
    if (o.bright || o.temp) {
      var id = x.getImageData(0, 0, w, h), d = id.data, b = Math.pow(2, o.bright / 100), t = o.temp / 100, kr = b * (1 + 0.22 * t), kb = b * (1 - 0.22 * t);
      for (var i = 0; i < d.length; i += 4) { d[i] = d[i] * kr; d[i + 1] = d[i + 1] * b; d[i + 2] = d[i + 2] * kb; }
      x.putImageData(id, 0, 0);
    }
    return PE.touch(c);
  }
  function maskCanvas(m, w, h) {
    var c = PE.mk(w, h), x = PE.cx2(c), id = x.createImageData(w, h);
    for (var i = 0; i < m.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = m[i]; }
    x.putImageData(id, 0, 0); return PE.touch(c);
  }
  // Average colour of the sky canvas where the mask is on (sampled small).
  function avgColour(sky, mc) {
    var c = PE.mk(32, 32), x = PE.cx2(c); x.drawImage(sky, 0, 0, 32, 32); x.globalCompositeOperation = "destination-in"; x.drawImage(mc, 0, 0, 32, 32);
    var d = x.getImageData(0, 0, 32, 32).data, s = [0, 0, 0], n = 0;
    for (var i = 0; i < d.length; i += 4) { var a = d[i + 3] / 255; s[0] += d[i] * a; s[1] += d[i + 1] * a; s[2] += d[i + 2] * a; n += a; }
    if (n < 1e-3) return "#808080";
    return "#" + s.map(function (v) { return ("0" + Math.round(Math.min(255, v / n)).toString(16)).slice(-2); }).join("");
  }
  // Edge colour: the photo with the old sky taken out of partly-sky pixels (PIXS.unmix), RGBA bytes -> canvas.
  function edgeCanvas(rgb, w, h) { var c = PE.mk(w, h), x = PE.cx2(c), id = x.createImageData(w, h); id.data.set(rgb); x.putImageData(id, 0, 0); return PE.touch(c); }
  // Composite preview at the working size: photo, edge colour, soft-light tint on the foreground, masked sky.
  function render() {
    var r = RS; if (!r || !r.edge) return;
    var W = r.W, H = r.H, o = r.o, c = r.prev || (r.prev = PE.mk(W, H)), x = PE.cx2(c), sky = skyAt(srcCanvas(r.src), W, H, horizon(r.edge, W, H), o), mc = maskCanvas(r.edge, W, H);
    x.globalCompositeOperation = "copy"; x.drawImage(r.base, 0, 0);
    x.globalCompositeOperation = "source-over"; if (o.edgeFix > 0 && r.deco) x.drawImage(r.deco, 0, 0);
    if (o.light > 0) {
      var t = PE.mk(W, H), tx = PE.cx2(t); tx.fillStyle = avgColour(sky, mc); tx.fillRect(0, 0, W, H); tx.globalCompositeOperation = "destination-out"; tx.drawImage(mc, 0, 0);
      x.globalCompositeOperation = "soft-light"; x.globalAlpha = o.light / 100; x.drawImage(t, 0, 0); x.globalAlpha = 1;
    }
    var s = PE.cx2(sky); s.globalCompositeOperation = "destination-in"; s.drawImage(mc, 0, 0);
    x.globalCompositeOperation = "source-over"; x.drawImage(sky, 0, 0);
    PE.touch(c); ED.renderOvl();
  }
  // Mask edge (shift / fade) in the worker, then render.
  function edge() {
    var r = RS; if (!r) return;
    if (r.busy) { r.again = true; return; }
    r.busy = true; r.again = false;
    var k = r.W / ED.doc.w;
    SX.work("maskEdge", [new Uint8Array(r.m), r.W, r.H, r.o.shift * k, r.o.fade * k]).then(function (e) {
      if (RS !== r) return; r.edge = e;
      if (!(r.o.edgeFix > 0)) { r.deco = null; return; }
      return SX.work("unmix", [{ data: r.baseData.data, width: r.W, height: r.H }, e, r.m, r.o.edgeFix / 100, 8]).then(function (rgb) { if (RS === r) r.deco = edgeCanvas(rgb, r.W, r.H); });
    }).then(function () { if (RS === r) render(); })
      .catch(function (e) { S3.toast(e.message, "error"); }).then(function () { r.busy = false; if (RS === r && r.again) edge(); });
  }
  var edgeSoon = S3.debounce(edge, 60), renderSoon = S3.debounce(render, 30);
  ED.on("overlay", function (o) { if (RS && RS.prev && ED.doc) o.docPath(o.c, function (c) { c.imageSmoothingEnabled = true; c.drawImage(RS.prev, 0, 0, ED.doc.w, ED.doc.h); }); });

  // ---------- commit: one undo step ----------
  SX.replaceSkyApply = function (m, W, H, srcKey, o) {
    var d = ED.doc, k = W / d.w, e = PIXS.maskEdge(m, W, H, o.shift * k, o.fade * k), full = W === d.w && H === d.h ? e : SX.scaleMask(e, W, H, d.w, d.h);
    var mc = maskCanvas(full, d.w, d.h), sky = skyAt(srcCanvas(srcKey), d.w, d.h, horizon(full, d.w, d.h), o);
    var G = PE.newLayer("group", { name: "Sky replacement", blend: "pass" }), S = PE.rasterFromCanvas(sky, "Sky", 0, 0), F = PE.newLayer("fill", { name: "Sky lighting" });
    G.canvas = null; G.open = true; G.parent = null;
    S.parent = G.id; S.mask = { canvas: mc, x: 0, y: 0 }; S.maskOn = true;
    var inv = PE.mk(d.w, d.h), ix = PE.cx2(inv); ix.fillStyle = "#fff"; ix.fillRect(0, 0, d.w, d.h); ix.globalCompositeOperation = "destination-out"; ix.drawImage(mc, 0, 0);
    F.parent = G.id; F.canvas = null; F.fillSpec = { type: "solid", color: avgColour(sky, mc) }; F.blend = "soft-light"; F.opacity = o.light / 100; F.visible = o.light > 0;
    F.mask = { canvas: PE.touch(inv), x: 0, y: 0 }; F.maskOn = true;
    var E = null;
    if (o.edgeFix > 0) {
      var bc = PE.mk(W, H), bx = PE.cx2(bc); bx.imageSmoothingQuality = "high"; bx.drawImage(PE.flatten(d), 0, 0, W, H);
      var bd = PE.getData(bc), rgb = PIXS.unmix({ data: bd.data, width: W, height: H }, e, m, o.edgeFix / 100, 8), small = edgeCanvas(rgb, W, H);
      var ec = PE.mk(d.w, d.h), ex = PE.cx2(ec), am = new Uint8Array(full.length);
      for (var i = 0; i < full.length; i++) am[i] = full[i] > 0 ? 255 : 0;
      ex.imageSmoothingQuality = "high"; ex.drawImage(small, 0, 0, d.w, d.h); ex.globalCompositeOperation = "destination-in"; ex.drawImage(maskCanvas(am, d.w, d.h), 0, 0);
      E = PE.rasterFromCanvas(PE.touch(ec), "Sky edge colour", 0, 0); E.parent = G.id;
    }
    var hide = srcKey.indexOf("l:") === 0 ? PE.findLayer(d, srcKey.slice(2)) : null;
    ED.meta("Replace sky", function () {
      d.layers.push(G); if (E) d.layers.push(E); d.layers.push(F); d.layers.push(S);
      d.layers = SX.groupsApi.serialize(SX.tree(d));
      if (hide) hide.visible = false;
      d.active = S.id; ED.maskEdit = false;
    });
    ED.emit("layers");
    return { group: G, sky: S, light: F, edge: E };
  };

  // ---------- panel ----------
  SX.openReplaceSky = function () {
    if (!SX.need() || RS) return;
    ED.cancelModes();
    var d = ED.doc, flat = PE.flatten(d);
    ED.working(SX.skyWork(flat), "Finding the sky…").then(function (r) {
      if (!r.m.some(function (v) { return v >= 128; })) { S3.toast("No sky found along the top of the picture", "error"); return; }
      var base = PE.mk(r.W, r.H), bx = PE.cx2(base); bx.imageSmoothingQuality = "high"; bx.drawImage(flat, 0, 0, r.W, r.H);
      var st = S3.store("pe-skyswap") || {}, o = {}, known = BUILTIN.some(function (b) { return "b:" + b[0] === st.src; });
      Object.keys(DEF).forEach(function (k) { o[k] = typeof st[k] === typeof DEF[k] ? st[k] : DEF[k]; });
      RS = { d: d, m: r.m, W: r.W, H: r.H, base: base, baseData: PE.getData(base), deco: null, o: o, src: known ? st.src : "b:clouds", file: null, edge: null, prev: null };
      build(); edge();
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  function build() {
    var w = ED.ui.w, r = RS, box = h("div", { "class": "pe-float pe-fxpanel pe-rmpanel", role: "dialog", "aria-label": "Replace sky" }), body = h("div", { "class": "pe-fbody" });
    function save() { var s = { src: r.src }; Object.keys(DEF).forEach(function (k) { s[k] = r.o[k]; }); S3.store("pe-skyswap", s); }
    function set(k, slow) { return function (v) { r.o[k] = v; save(); if (slow) edgeSoon(); else renderSoon(); }; }
    var file = h("input", { type: "file", accept: "image/*", hidden: true });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0]; file.value = ""; if (!f) return;
      ED.working(PE.decodeImage(f), "Opening…").then(function (img) { if (RS !== r) return; r.file = img.canvas; r.src = "file"; render(); }).catch(function (e) { S3.toast(e.message, "error"); });
    });
    var pick = w.select("Sky", sources(), r.src, function (v) { if (v === "file") { file.click(); return; } r.src = v; save(); render(); });
    body.appendChild(h("p", { "class": "faint pe-p", text: "Puts a new sky behind a soft mask and tints the foreground to match. Everything stays editable in the Sky replacement group." }));
    body.appendChild(pick); body.appendChild(file);
    body.appendChild(w.range("Shift edge", r.o.shift, -60, 60, 1, set("shift", true), w.px));
    body.appendChild(w.range("Fade edge", r.o.fade, 0, 60, 1, set("fade", true), w.px));
    body.appendChild(w.range("Sky brightness", r.o.bright, -100, 100, 1, set("bright")));
    body.appendChild(w.range("Sky temperature", r.o.temp, -100, 100, 1, set("temp")));
    body.appendChild(w.range("Scale", r.o.scale, 50, 300, 1, set("scale"), function (v) { return v + "%"; }));
    body.appendChild(w.range("Move across", r.o.ox, -100, 100, 1, set("ox")));
    body.appendChild(w.range("Move up / down", r.o.oy, -100, 100, 1, set("oy")));
    body.appendChild(w.check("Flip horizontally", r.o.flip, set("flip")));
    body.appendChild(w.range("Foreground lighting", r.o.light, 0, 100, 1, set("light"), function (v) { return v + "%"; }));
    body.appendChild(w.range("Edge colour fix", r.o.edgeFix, 0, 100, 1, set("edgeFix", true), function (v) { return v + "%"; }));
    box.appendChild(h("div", { "class": "row between pe-fhead" }, [h("b", { text: "Replace sky" })]));
    box.appendChild(body);
    box.appendChild(h("div", { "class": "row pe-ffoot" }, [h("span", { "class": "grow" }), w.btn("Cancel", function () { close(false); }, "ghost"), w.btn("OK", function () { close(true); }, "primary")]));
    S3.$("#stage").appendChild(box); r.box = box;
  }
  function close(ok) {
    var r = RS; if (!r) return;
    RS = null; r.box.remove(); ED.renderOvl();
    if (ok && ED.doc === r.d) { SX.replaceSkyApply(r.m, r.W, r.H, r.src, r.o); S3.toast("Sky replaced: the Sky layer and its mask stay editable"); }
  }
  SX.closeReplaceSky = close;
  ED.on("changed", function (why) { if (RS && why === "open") { var r = RS; RS = null; r.box.remove(); } });
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!RS) return false;
    if (e.key === "Escape") { e.preventDefault(); close(false); return true; }
    if (e.key === "Enter" && !ED.isTyping(e)) { e.preventDefault(); close(true); return true; }
    return false;
  });
  SX.menu("Edit", [["Replace sky…", "", function () { SX.openReplaceSky(); }, SX.has]], "Fill…");

  SX.tests.push(async function (ok) {
    var m = new Uint8Array(20 * 20); for (var p = 0; p < 200; p++) m[p] = 255;          // top half selected
    var e = PIXS.maskEdge(m, 20, 20, 3, 0);
    // a half-sky pixel (blue sky, orange branch) next to sure sky unmixes to the branch colour
    var um = { data: new Uint8ClampedArray(9 * 4), width: 9, height: 1 }, mm = new Uint8Array(9), raw = new Uint8Array(9);
    for (var q = 0; q < 9; q++) { var half = q === 8; um.data.set(half ? [100, 50, 128, 255] : [0, 0, 255, 255], q * 4); mm[q] = half ? 128 : 255; raw[q] = half ? 0 : 255; }
    var u = PIXS.unmix(um, mm, raw, 1, 4);
    ok(Math.abs(u[32] - 200) <= 3 && Math.abs(u[33] - 100) <= 3 && u[34] <= 3 && u[35] === 255, "replace sky: edge colour takes the old sky out of a half-sky pixel");
    ok(e[12 * 20 + 5] === 255 && e[14 * 20 + 5] === 0, "replace sky: shift edge moves the sky edge down 3 px");
    // a doc with sky on top and ground below: replacing gives a group with a masked sky layer
    ED.newBlank(200, 100, "#ffffff", "Sky test");
    var L = ED.layer(), x = L.canvas.getContext("2d"); x.fillStyle = "#7fb0ee"; x.fillRect(0, 0, 200, 60); x.fillStyle = "#4a6a2a"; x.fillRect(0, 60, 200, 40); PE.touch(L.canvas);
    var r = await SX.skyWork(PE.flatten(ED.doc));
    var out = SX.replaceSkyApply(r.m, r.W, r.H, "b:dusk", { shift: 0, fade: 0, bright: 0, temp: 0, scale: 100, ox: 0, oy: 0, flip: false, light: 30 });
    var mk = PE.getData(out.sky.mask.canvas).data, f = PE.getData(PE.flatten(ED.doc)).data;
    ok(ED.doc.layers.length === 4 && out.sky.parent === out.group.id && out.light.parent === out.group.id, "replace sky: one group holds the sky and the lighting fill");
    ok(mk[(10 * 200 + 100) * 4 + 3] === 255 && mk[(90 * 200 + 100) * 4 + 3] === 0, "replace sky: the sky layer's mask covers the sky only");
    ok(f[(5 * 200 + 100) * 4 + 1] < 100 && f[(5 * 200 + 100) * 4 + 2] < 160, "replace sky: the new (dusk) sky shows at the top");
    ED.undo();
    ok(ED.doc.layers.length === 1, "replace sky: one undo step removes it");
  });
})();
