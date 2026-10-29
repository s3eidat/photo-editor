/* Selection lane: clipping masks. A layer with `clip` shows only where the nearest unclipped layer below it
   (the base) has pixels. The base's blend mode and opacity apply to the whole clipped stack; each clipped
   layer keeps its own blend mode, opacity and fill inside the base's shape. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx;

  // Render a group's members (isolated, with its mask) into a buffer: used when a group is a base or is clipped.
  function groupInto(R, buf, G) {
    var kids = R.tree.kids[G.id] || [], o = R.opts.over && R.opts.over[G.id];
    if (o) { SX.compositeDoc(R, buf, { img: o.canvas, x: o.x, y: o.y, m: o.m }, "normal", 1); return; }
    SX.renderList(R, buf, kids);
    var mask = G.mask && G.maskOn ? (R.opts.maskOver && R.opts.maskOver[G.id]) || G.mask : null;
    if (mask) { var c = buf.c; c.save(); SX.setT(c, buf, R.M); c.globalCompositeOperation = "destination-in"; c.drawImage(mask.canvas, mask.x, mask.y); c.restore(); }
  }
  SX.groupInto = groupInto;
  SX.drawClip = function (R, tgt, base, run) {
    var d = tgt.d + 1, B = SX.buffer(R, "clipB", d), rg = R.region, reg, shape, bd;
    if (base.kind === "group") {
      groupInto(R, B, base); reg = rg;
      bd = B.c.getImageData(0, 0, rg.w, rg.h);
      shape = new Uint8Array(rg.w * rg.h); for (var q = 0; q < shape.length; q++) shape[q] = bd.data[q * 4 + 3];
    } else {
      var P = SX.prep(R, base); if (!P) return;
      var Pc = base.fx ? SX.prep(R, base, { noFx: true }) : P;
      reg = SX.devRect(R.M, P.m ? PE.mBounds(P.m, { x: P.x, y: P.y, w: P.img.width, h: P.img.height }) : { x: P.x, y: P.y, w: P.img.width, h: P.img.height });
      reg = PE.inter(reg, rg); if (!reg) return;
      SX.drawPrepared(R, B, P, "normal", 1);
      var sd = SX.toDevice(R, Pc, reg, "shape");
      shape = new Uint8Array(reg.w * reg.h); for (var k = 0; k < shape.length; k++) shape[k] = sd[k * 4 + 3];
      bd = B.c.getImageData(reg.x - B.ox, reg.y - B.oy, reg.w, reg.h);
    }
    var pos = SX.posOf(R, reg);
    run.forEach(function (C) {
      if (C.kind === "adjust") { if (SX.adjustData) SX.adjustData(R, C, bd.data, reg); return; }
      var src, alpha = C.opacity;
      if (C.kind === "group") {
        var gb = SX.buffer(R, "clipG", d + 1); groupInto(R, gb, C);
        src = gb.c.getImageData(reg.x - gb.ox, reg.y - gb.oy, reg.w, reg.h).data;
        if (C.blend === "pass") C = Object.assign({}, C, { blend: "normal" });
      } else {
        var PC = SX.prep(R, C); if (!PC) return;
        src = SX.toDevice(R, PC, reg, "src"); alpha *= PC.alpha;
      }
      PIX.clipRegion(bd.data, src, shape, C.blend, Math.min(1, alpha), pos);
    });
    B.c.putImageData(bd, reg.x - B.ox, reg.y - B.oy);
    SX.compositeBuf(R, tgt, B, base.kind === "group" && base.blend === "pass" ? "normal" : base.blend, base.opacity);
  };

  // ---------- commands ----------
  SX.toggleClip = function (L) {
    L = L || ED.layer(); if (!SX.need() || !L) return;
    var d = ED.doc, sib = SX.groupsApi.siblings(L, SX.tree(d));
    if (!L.clip && sib.indexOf(L) === 0) { S3.toast("There is no layer below “" + L.name + "” to clip to", "error"); return; }
    ED.meta(L.clip ? "Release clipping mask" : "Create clipping mask", function () { if (L.clip) delete L.clip; else L.clip = true; });
    ED.emit("layers");
  };
  SX.fields.clip = { save: function (L) { return L.clip ? true : undefined; }, parse: function (v) { return v === true ? true : undefined; } };
  SX.menu("Layer", [["Create / release clipping mask", "Ctrl+Alt+G", function () { SX.toggleClip(); }, SX.has]], "Ungroup layers");
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey || e.code !== "KeyG" || !ED.doc) return false;
    e.preventDefault(); SX.toggleClip(); return true;
  });
  // Alt+click on a layer row toggles clipping (like the classic Alt+click between layers).
  document.addEventListener("click", function (e) {
    if (!e.altKey || !ED.doc) return;
    var row = e.target.closest && e.target.closest("#layerList .pe-layer"); if (!row) return;
    var L = PE.findLayer(ED.doc, row.getAttribute("data-id")); if (!L) return;
    e.stopPropagation(); e.preventDefault(); SX.toggleClip(L);
  }, true);

  SX.tests.push(async function (ok, near) {
    // base: a 2x1 shape, half transparent on the right; clipped: solid blue over a 4x1 doc
    var bg = PE.rasterFromCanvas(SX.solid(4, 1, "#ffffff"), "bg"), bc = PE.mk(4, 1), bx = PE.cx2(bc);
    bx.fillStyle = "#ff0000"; bx.fillRect(0, 0, 1, 1); bx.fillStyle = "rgba(255,0,0,0.5)"; bx.fillRect(1, 0, 1, 1);
    var base = PE.rasterFromCanvas(PE.touch(bc), "base"), blue = PE.rasterFromCanvas(SX.solid(4, 1, "#0000ff"), "blue"); blue.clip = true;
    var d = SX.scratch(4, 1, [bg, base, blue]), f = PE.flatten(d);
    ok(SX.px(f, 0, 0).join() === "0,0,255,255" && SX.px(f, 2, 0).join() === "255,255,255,255", "clipped layer shows only on its base");
    var e = SX.px(f, 1, 0); ok(near(e[0], 128, 3) && near(e[1], 128, 3) && e[2] === 255, "clipping keeps the base's soft edge");
    blue.blend = "multiply"; base.opacity = 0.5; f = PE.flatten(d);
    ok(near(SX.px(f, 0, 0)[0], 128, 3) && near(SX.px(f, 0, 0)[2], 128, 3) && near(SX.px(f, 1, 0)[0], 191, 3), "clipped blend + base opacity apply to the stack");
    base.opacity = 1; blue.blend = "normal"; base.visible = false; ok(SX.px(PE.flatten(d), 0, 0).join() === "255,255,255,255", "hidden base hides clipped layers");
    base.visible = true; var only = PE.flatten(d, { only: [blue.id] }); ok(SX.px(only, 3, 0)[2] === 255, "a clipped layer alone shows all its pixels");
    ED.setActive(blue.id); SX.toggleClip(); ok(!blue.clip, "release clipping"); ED.undo(); ok(blue.clip === true, "undo release");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer())); ok(od.layers[2].clip === true && !od.layers[1].clip, "clipping round-trips");
  });
})();
