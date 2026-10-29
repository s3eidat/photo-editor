/* Selection lane compositor. Takes over PE.drawLayers (core.js hook) only when a document uses something the
   plain canvas loop cannot do: blend modes the canvas lacks, fill opacity, groups, clipping, adjustment layers,
   layer styles, vector masks. Otherwise the original fast loop runs unchanged.
   Everything is drawn in "device" pixels of the target canvas (the zoomed view, or the export canvas), so the
   pixel paths only touch what is on screen. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, SX = PE.sx;
  var NATIVE = PIX.BLEND_NATIVE, BASIC = { raster: 1, text: 1, shape: 1 };
  SX.prepExt = [];          // f(R, L, P, o) -> P : vector masks, layer styles…
  SX.drawExt = {};          // kind -> f(R, tgt, L) for kinds that do not draw pixels (adjustment layers)

  // 0: plain canvas loop is enough; 1: needs this compositor; 2: needs pixel reads (JS blend modes, clipping, adjustments).
  function special(doc) {
    var r = 0;
    for (var i = 0; i < doc.layers.length; i++) {
      var L = doc.layers[i];
      if (L.clip || L.kind === "adjust" || L.blendIf || (!NATIVE[L.blend] && L.blend !== "pass") || (SX.pixelKinds && SX.pixelKinds[L.kind])) return 2;
      if (!BASIC[L.kind] || L.parent || L.fx || L.vmask || (L.fillOp != null && L.fillOp < 1) || (SX.maskTweaked && SX.maskTweaked(L))) r = 1;
    }
    return r;
  }
  SX.special = special;

  // ---------- tree from the flat list (parent ids; bad or cyclic parents fall back to the top level) ----------
  function tree(doc) {
    var byId = {}, kids = {}, roots = [];
    doc.layers.forEach(function (L) { byId[L.id] = L; });
    function okParent(L) {
      var p = byId[L.parent], seen = 0;
      if (!p || p.kind !== "group" || p === L) return false;
      for (var q = p; q && seen < 120; q = byId[q.parent], seen++) if (q === L) return false;
      return seen < 120;
    }
    doc.layers.forEach(function (L) { if (L.parent && okParent(L)) (kids[L.parent] = kids[L.parent] || []).push(L); else roots.push(L); });
    return { byId: byId, kids: kids, roots: roots, parentOf: function (L) { return L.parent && okParent(L) ? byId[L.parent] : null; } };
  }
  SX.tree = tree;

  // ---------- canvases ----------
  // Canvases read back with getImageData are created CPU-backed (willReadFrequently): GPU readback is very slow.
  var POOL = {}, BIG = 4e6;
  function pooled(key, w, h, gpu) {
    var c = POOL[key + (gpu ? "@g" : "")];
    if (!c) { c = POOL[key + (gpu ? "@g" : "")] = PE.mk(w, h); if (!gpu) c.getContext("2d", { willReadFrequently: true }); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var x = PE.cx2(c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, w, h);
    return c;
  }
  SX.pooled = pooled;
  var MCACHE = new WeakMap();
  function masked(L, s, mask) {     // layer pixels with the layer mask applied (cached by versions)
    var key = PE.ver(s.canvas) + ":" + s.x + ":" + s.y + ":" + PE.ver(mask.canvas) + ":" + mask.x + ":" + mask.y, hit = MCACHE.get(L);
    if (hit && hit.key === key && hit.src === s.canvas && hit.mc === mask.canvas) return hit.out;
    var t = hit && hit.out.width === s.canvas.width && hit.out.height === s.canvas.height ? hit.out : PE.mk(s.canvas.width, s.canvas.height), c = PE.cx2(t);
    c.globalCompositeOperation = "copy"; c.drawImage(s.canvas, 0, 0);
    c.globalCompositeOperation = "destination-in"; c.drawImage(mask.canvas, mask.x - s.x, mask.y - s.y);
    c.globalCompositeOperation = "source-over"; PE.touch(t);
    MCACHE.set(L, { key: key, src: s.canvas, mc: mask.canvas, out: t });
    return t;
  }
  SX.masked = masked;

  // ---------- render context ----------
  // R: {doc, opts, M (doc -> device), region (device rect of the visible document), tree, only…}
  // tgt: {c: 2d context, ox, oy (device position of its pixel 0,0), d: depth}
  function setT(c, tgt, M) { c.setTransform(M.a, M.b, M.c, M.d, M.e - tgt.ox, M.f - tgt.oy); }
  function devRect(M, r) {
    var pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(function (p) { return { x: M.a * p[0] + M.c * p[1] + M.e, y: M.b * p[0] + M.d * p[1] + M.f }; });
    var b = PE.aabbOf(pts); return PE.rectI(b);
  }
  function imgDevRect(R, P) {
    var r = { x: P.x, y: P.y, w: P.img.width, h: P.img.height }, M = R.M;
    if (P.m) { var b = PE.mBounds(P.m, r); r = b; }
    return PE.inter(devRect(M, r), R.region);
  }
  SX.devRect = devRect;

  var nesting = 0;      // a render started while another is running (e.g. a group's pixels) uses its own canvases
  PE.drawHook = function (ctx, doc, opts) {
    var sp = special(doc);
    if (!sp) return false;
    var R = makeR(ctx, doc, opts, sp);
    if (R) run(R, ctx, R.tree.roots);
    return true;
  };
  // Draw `list` (default: the whole document) onto ctx, whose transform maps doc px -> target px.
  SX.renderInto = function (ctx, doc, list, opts) { opts = opts || {}; var R = makeR(ctx, doc, opts, Math.max(1, special(doc))); if (R) run(R, ctx, list ? list(R.tree) : R.tree.roots); return R; };
  function makeR(ctx, doc, opts, sp) {
    var M = ctx.getTransform(), cv = ctx.canvas, region = PE.inter(devRect(M, { x: 0, y: 0, w: doc.w, h: doc.h }), { x: 0, y: 0, w: cv.width, h: cv.height });
    if (!region) return null;
    var T = tree(doc), R = { doc: doc, opts: opts, M: M, region: region, tree: T, smooth: ctx.imageSmoothingEnabled, quality: ctx.imageSmoothingQuality, gpu: sp < 2, pfx: "" };
    if (opts.only) {      // only these layers: a group in the list brings its contents; groups above them are pass-through containers
      var self = {}, anc = {};
      opts.only.forEach(function (id) { self[id] = 1; for (var p = T.byId[id] && T.parentOf(T.byId[id]); p; p = T.parentOf(p)) anc[p.id] = 1; });
      R.inOnly = function (L) { if (self[L.id] || anc[L.id]) return true; for (var p = T.parentOf(L); p; p = T.parentOf(p)) if (self[p.id]) return true; return false; };
      R.container = function (L) { if (self[L.id]) return false; for (var p = T.parentOf(L); p; p = T.parentOf(p)) if (self[p.id]) return false; return !!anc[L.id]; };
    }
    return R;
  }
  function run(R, ctx, list) {
    R.pfx = nesting ? "n" + nesting + "-" : "";
    nesting++;
    try { run1(R, ctx, list); } finally { nesting--; }
    if (!nesting && R.region.w * R.region.h > BIG) Object.keys(POOL).forEach(function (k) { var c = POOL[k]; if (c.width * c.height > BIG) { c.width = 1; c.height = 1; } });   // export-size buffers: give the memory back
  }
  function run1(R, ctx, list) {
    ctx.save();
    if (R.gpu) renderList(R, { c: ctx, ox: 0, oy: 0, d: 0 }, list);
    else {           // pixel work: build the picture in a CPU canvas, then hand it to the target in one draw
      var root = buffer(R, "root", 0), rg = R.region;
      renderCached(R, root, list);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(root.canvas, rg.x, rg.y);
    }
    ctx.restore();
  }
  // A canvas's identity and version (a swapped-in canvas can carry the same version number as the old one).
  var CID = new WeakMap(), cidN = 0;
  function cv(c) { if (!c) return ""; var id = CID.get(c); if (!id) { id = ++cidN; CID.set(c, id); } return id + "." + PE.ver(c); }
  SX.cv = cv;
  // Signature of everything that affects how a layer (and its members) draws.
  function sig(L, R) {
    var o = R.opts, ov = o.over && o.over[L.id], mo = o.maskOver && o.maskOver[L.id], s = [L.id, L.kind, L.visible, L.opacity, L.blend, L.x, L.y, cv(L.canvas),
      L.mask ? cv(L.mask.canvas) + "@" + L.mask.x + "," + L.mask.y + L.maskOn : "", JSON.stringify(L.text || L.shape || ""), o.hide === L.id,
      ov ? cv(ov.canvas) + "@" + ov.x + "," + ov.y + (ov.m || "") : "", mo ? cv(mo.canvas) : "", R.inOnly ? R.inOnly(L) : ""];
    SX.KEYS.forEach(function (k) { var v = L[k]; s.push(v && typeof v === "object" ? (k === "smart" ? cv(v.src) + JSON.stringify(v.m || "") + JSON.stringify(v.filters || "") : JSON.stringify(v)) : v); });
    if (L.kind === "group") (R.tree.kids[L.id] || []).forEach(function (k) { s.push(sig(k, R)); });
    return s.join("|");
  }
  SX.sig = sig;
  // Top-level layers up to the last one that needs pixel reads are cached between frames (painting above an
  // adjustment layer or a JS blend mode does not redo them).
  var CACHE = { key: null, c: null };
  function needsPixels(L, R) { return L.clip || L.kind === "adjust" || L.blendIf || (!NATIVE[L.blend] && L.blend !== "pass") || (SX.pixelKinds && SX.pixelKinds[L.kind]) || (L.kind === "group" && (R.tree.kids[L.id] || []).some(function (k) { return needsPixels(k, R); })); }
  function renderCached(R, root, list) {
    var k = -1, i;
    for (i = 0; i < list.length; i++) if (needsPixels(list[i], R) || (list[i + 1] && list[i + 1].clip)) k = i;
    while (k >= 0 && k + 1 < list.length && list[k + 1].clip) k++;
    if (k < 0 || list !== R.tree.roots || R.pfx || R.region.w * R.region.h > BIG) { renderList(R, root, list); return; }   // (exports: no cache)
    var M = R.M, rg = R.region, key = [M.a, M.b, M.c, M.d, M.e, M.f, rg.x, rg.y, rg.w, rg.h, R.doc.w, R.doc.h, R.smooth].join(",") + "#" + list.slice(0, k + 1).map(function (L) { return sig(L, R); }).join("\n");
    if (CACHE.key === key && CACHE.c) root.c.drawImage(CACHE.c, 0, 0);
    else {
      renderList(R, root, list.slice(0, k + 1));
      if (!CACHE.c) CACHE.c = PE.mk(rg.w, rg.h);
      if (CACHE.c.width !== rg.w || CACHE.c.height !== rg.h) { CACHE.c.width = rg.w; CACHE.c.height = rg.h; }
      var cc = PE.cx2(CACHE.c); cc.globalCompositeOperation = "copy"; cc.drawImage(root.canvas, 0, 0); cc.globalCompositeOperation = "source-over";
      CACHE.key = key;
    }
    renderList(R, root, list.slice(k + 1));
  }
  function show(R, L) { return L.visible && R.opts.hide !== L.id && (!R.inOnly || R.inOnly(L)); }
  SX.show = show;

  function renderList(R, tgt, list) {
    var i = 0;
    while (i < list.length) {
      var L = list[i], j = i + 1;
      while (j < list.length && list[j].clip) j++;
      var run = list.slice(i + 1, j).filter(function (C) { return show(R, C); });
      if (show(R, L)) {
        if (run.length && L.kind !== "adjust" && SX.drawClip) SX.drawClip(R, tgt, L, run);
        else { drawItem(R, tgt, L); run.forEach(function (C) { drawItem(R, tgt, C); }); }
      } else if (R.inOnly) run.forEach(function (C) { drawItem(R, tgt, C); });    // asked for a clipped layer alone: its own pixels
      i = j;
    }
  }
  SX.renderList = renderList;

  function drawItem(R, tgt, L) {
    if (SX.drawExt[L.kind]) { SX.drawExt[L.kind](R, tgt, L); return; }
    var P = prep(R, L);
    if (!P) return;
    if (L.blendIf && SX.blendIfDraw) { SX.blendIfDraw(R, tgt, L, P); return; }
    drawPrepared(R, tgt, P, L.blend, L.opacity);
  }
  SX.drawItem = drawItem;
  // Layer pixels plus any style parts drawn behind (shadows, glows) and after (stroke, outer bevel), each with its own blend.
  function drawPrepared(R, tgt, P, blend, opacity) {
    if (P.behind) P.behind.forEach(function (q) { compositeDoc(R, tgt, q, q.blend, q.alpha * opacity); });
    compositeDoc(R, tgt, P, blend, opacity * P.alpha);
    if (P.after) P.after.forEach(function (q) { compositeDoc(R, tgt, q, q.blend, q.alpha * opacity); });
  }
  SX.drawPrepared = drawPrepared;

  // Pixels of a drawable layer, masked and styled: {img, x, y, m, alpha (fill opacity still to apply)}. o.noFx: content only.
  function prep(R, L, o) {
    var opts = R.opts, s = (opts.over && opts.over[L.id]) || PE.surface(L, R.doc);
    if (!s || !s.canvas) return null;
    var mask = L.mask && L.maskOn ? ((opts.maskOver && opts.maskOver[L.id]) || L.mask) : null;
    if (mask && SX.effMask) mask = SX.effMask(L, mask);
    var P = { img: mask ? masked(L, s, mask) : s.canvas, x: s.x, y: s.y, m: s.m, alpha: SX.fillOf(L) };
    for (var i = 0; i < SX.prepExt.length; i++) P = SX.prepExt[i](R, L, P, o || {}) || P;
    return P;
  }
  SX.prep = prep;

  // Draw doc-space pixels onto a target with a blend mode.
  function compositeDoc(R, tgt, P, blend, alpha) {
    if (!(alpha > 0)) return;
    var c = tgt.c, nat = NATIVE[blend];
    if (nat) {
      c.save(); setT(c, tgt, R.M); if (P.m) c.transform(P.m[0], P.m[1], P.m[2], P.m[3], P.m[4], P.m[5]);
      c.globalAlpha = Math.min(1, alpha); c.globalCompositeOperation = nat; c.drawImage(P.img, P.x, P.y); c.restore();
      return;
    }
    var rr = imgDevRect(R, P); if (!rr) return;
    var src = toDevice(R, P, rr, "src"), d = c.getImageData(rr.x - tgt.ox, rr.y - tgt.oy, rr.w, rr.h);
    PIX.blendRegion(d.data, src, blend, Math.min(1, alpha), null, posOf(R, rr));
    c.putImageData(d, rr.x - tgt.ox, rr.y - tgt.oy);
  }
  SX.compositeDoc = compositeDoc;
  function posOf(R, rr) { return { x0: rr.x, y0: rr.y, w: rr.w, sx: R.M.a || 1, sy: R.M.d || 1, ox: R.M.e, oy: R.M.f }; }
  SX.posOf = posOf;
  // Render doc-space pixels into device rect rr; returns the RGBA bytes.
  function toDevice(R, P, rr, key) {
    var t = pooled(R.pfx + "dev-" + key, rr.w, rr.h, false), c = PE.cx2(t);
    c.imageSmoothingEnabled = R.smooth; c.imageSmoothingQuality = R.quality;
    setT(c, { ox: rr.x, oy: rr.y }, R.M); if (P.m) c.transform(P.m[0], P.m[1], P.m[2], P.m[3], P.m[4], P.m[5]);
    c.drawImage(P.img, P.x, P.y);
    return c.getImageData(0, 0, rr.w, rr.h).data;
  }
  SX.toDevice = toDevice;
  // A full-region buffer for depth d (groups, clipping).
  function buffer(R, name, d) {
    var b = pooled(R.pfx + name + d, R.region.w, R.region.h, R.gpu), c = PE.cx2(b);
    c.imageSmoothingEnabled = R.smooth; c.imageSmoothingQuality = R.quality;
    return { c: c, ox: R.region.x, oy: R.region.y, d: d, canvas: b };
  }
  SX.buffer = buffer;
  // Draw a region buffer onto a target with a blend mode.
  function compositeBuf(R, tgt, buf, blend, alpha) {
    if (!(alpha > 0)) return;
    var c = tgt.c, nat = NATIVE[blend] || (blend === "pass" ? "source-over" : null), rg = R.region;
    if (nat) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = Math.min(1, alpha); c.globalCompositeOperation = nat; c.drawImage(buf.canvas, rg.x - tgt.ox, rg.y - tgt.oy); c.restore(); return; }
    var src = buf.c.getImageData(0, 0, rg.w, rg.h).data, d = c.getImageData(rg.x - tgt.ox, rg.y - tgt.oy, rg.w, rg.h);
    PIX.blendRegion(d.data, src, blend, Math.min(1, alpha), null, posOf(R, rg));
    c.putImageData(d, rg.x - tgt.ox, rg.y - tgt.oy);
  }
  SX.compositeBuf = compositeBuf;
  SX.setT = setT;

  SX.tests.push(async function (ok, near) {
    // every mode: compositor (pixel path or canvas) agrees with the per-pixel maths, on a 3x2 document
    var pairs = [[[200, 120, 40, 255], [30, 180, 250, 255], 1], [[90, 200, 160, 255], [240, 60, 120, 200], 0.6], [[10, 250, 128, 140], [200, 100, 30, 255], 0.8], [[128, 128, 128, 255], [64, 200, 255, 255], 0.5]];
    function rgba(p) { return "rgba(" + p.slice(0, 3).join(",") + "," + p[3] / 255 + ")"; }
    PE.BLENDS.forEach(function (mode) {
      pairs.forEach(function (pr, k) {
        var b = PE.rasterFromCanvas(SX.solid(3, 2, rgba(pr[0]))), s = PE.rasterFromCanvas(SX.solid(3, 2, rgba(pr[1])));
        s.blend = mode; s.opacity = pr[2]; s.fillOp = 1;
        var d = PE.newDoc(3, 2, "t"); d.layers = [b, s];
        var bb = SX.px(b.canvas, 0, 0), ss = SX.px(s.canvas, 0, 0), f = PE.flatten(d);
        for (var y = 0; y < 2; y++) for (var x = 0; x < 3; x++) {
          var got = SX.px(f, x, y), exp = PIX.compositePixel(mode, bb, ss, pr[2], x, y);
          if (!(near(got[3], exp[3], 2) && (exp[3] < 8 || (near(got[0], exp[0], 3) && near(got[1], exp[1], 3) && near(got[2], exp[2], 3))))) { ok(false, "blend " + mode + " #" + k + " at " + x + "," + y + " got " + got + " want " + exp); return; }
        }
      });
    });
    // known answers for the JS-only modes
    function one(mode, b, s) { return PIX.compositePixel(mode, [b, b, b, 255], [s, s, s, 255], 1).slice(0, 3)[0]; }
    ok(one("linear-burn", 200, 100) === 45 && one("linear-dodge", 200, 100) === 255 && one("subtract", 200, 100) === 100 && one("divide", 100, 200) === 128, "linear burn / dodge, subtract, divide");
    ok(one("hard-mix", 100, 200) === 255 && one("hard-mix", 100, 100) === 0 && one("pin-light", 200, 50) === 100 && one("linear-light", 100, 200) === 245, "hard mix, pin light, linear light");
    ok(one("vivid-light", 128, 255) === 255 && one("vivid-light", 128, 0) === 0, "vivid light ends");
    var dc = PIX.compositePixel("darker-color", [200, 0, 0, 255], [0, 0, 200, 255], 1); ok(dc.join() === "0,0,200,255", "darker colour picks the darker pixel whole");
    var lc = PIX.compositePixel("luminosity", [255, 0, 0, 255], [128, 128, 128, 255], 1); ok(near(0.3 * lc[0] + 0.59 * lc[1] + 0.11 * lc[2], 128, 2) && lc[0] > lc[1], "luminosity keeps hue, takes brightness");
    // dissolve: fully opaque or untouched pixels, about the right share
    var dz = 0; for (var q = 0; q < 4000; q++) dz += PIX.dissolveHash(q % 63, Math.floor(q / 63)) < 0.3 ? 1 : 0; ok(dz > 1050 && dz < 1350, "dissolve noise is uniform");
    // fill opacity: same as opacity without styles
    var fb = PE.rasterFromCanvas(SX.solid(2, 1, "#000")), fl = PE.rasterFromCanvas(SX.solid(2, 1, "#fff")); fl.fillOp = 0.5;
    var fd = PE.newDoc(2, 1, "f"); fd.layers = [fb, fl]; ok(near(SX.px(PE.flatten(fd), 0, 0)[0], 128, 2), "fill opacity 50%");
    // undo restores fill opacity; project round trip keeps blend + fill
    var ud = SX.scratch(4, 4, [PE.rasterFromCanvas(SX.solid(4, 4, "#f00"))]), uL = ud.layers[0];
    PE.ed.meta("Fill", function () { uL.fillOp = 0.25; uL.blend = "vivid-light"; }); PE.ed.undo(); ok(uL.fillOp === undefined && uL.blend === "normal", "undo fill opacity / blend");
    PE.ed.redo(); var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(ud)).arrayBuffer()));
    ok(od.layers[0].fillOp === 0.25 && od.layers[0].blend === "vivid-light" && od.layers[0].id === uL.id, "project keeps fill opacity, new blend modes and layer ids");
  });
})();
