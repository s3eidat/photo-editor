/* Selection lane: blending options "Blend if" (grey). A layer fades out where its own brightness, or the
   brightness of what is under it, is outside a range; each end has a soft ramp (from → to).
   L.blendIf = {self: [b0, b1, w0, w1], under: [b0, b1, w0, w1]} in 0..255 (b = black end, w = white end). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, h = S3.h;
  SX.KEYS.push("blendIf");
  function ramp(v, r) {          // 0..1 weight of a luminance value for one range
    if (!r) return 1;
    var b0 = r[0], b1 = r[1], w0 = r[2], w1 = r[3];
    if (v < b0 || v > w1) return 0;
    var a = v < b1 ? (b1 > b0 ? (v - b0) / (b1 - b0) : 1) : 1, b = v > w0 ? (w1 > w0 ? (w1 - v) / (w1 - w0) : 1) : 1;
    return Math.min(a, b);
  }
  SX.blendIfRamp = ramp;
  function weights(src, dst, B) {
    var n = src.length >> 2, k = new Uint8Array(n), s = B.self, u = B.under;
    for (var p = 0, i = 0; p < n; p++, i += 4) {
      if (!src[i + 3]) continue;
      var w = ramp(src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114, s);
      if (w > 0 && dst[i + 3]) w *= ramp(dst[i] * 0.299 + dst[i + 1] * 0.587 + dst[i + 2] * 0.114, u);
      k[p] = Math.round(w * 255);
    }
    return k;
  }
  SX.blendIfWeights = weights;
  SX.blendIfDraw = function (R, tgt, L, P) {
    if (P.behind) P.behind.forEach(function (q) { SX.compositeDoc(R, tgt, q, q.blend, q.alpha * L.opacity); });
    var rr = SX.devRect(R.M, P.m ? PE.mBounds(P.m, { x: P.x, y: P.y, w: P.img.width, h: P.img.height }) : { x: P.x, y: P.y, w: P.img.width, h: P.img.height });
    rr = PE.inter(rr, R.region);
    if (rr) {
      var src = SX.toDevice(R, P, rr, "bif"), c = tgt.c, d = c.getImageData(rr.x - tgt.ox, rr.y - tgt.oy, rr.w, rr.h);
      PIX.blendRegion(d.data, src, L.blend === "pass" ? "normal" : L.blend, Math.min(1, L.opacity * P.alpha), weights(src, d.data, L.blendIf), SX.posOf(R, rr));
      c.putImageData(d, rr.x - tgt.ox, rr.y - tgt.oy);
    }
    if (P.after) P.after.forEach(function (q) { SX.compositeDoc(R, tgt, q, q.blend, q.alpha * L.opacity); });
  };
  function clean(r) { if (!Array.isArray(r) || r.length !== 4) return null; var a = r.map(function (v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0; }); a[1] = Math.max(a[0], a[1]); a[2] = Math.max(a[1], a[2]); a[3] = Math.max(a[2], a[3]); return a; }
  SX.fields.blendIf = { save: function (L) { return L.blendIf ? PE.clone(L.blendIf) : undefined; }, parse: function (v) { if (!v || typeof v !== "object") return undefined; var s = clean(v.self), u = clean(v.under); return s && u ? { self: s, under: u } : undefined; } };

  // UI: a "Blend if" block at the top of the layer style panel
  SX.blendIfUI = function (body, L, changed) {
    var w = ED.ui.w, B = L.blendIf || { self: [0, 0, 255, 255], under: [0, 0, 255, 255] };
    var box = h("div", { "class": "pe-fxsec pe-bif" });
    function row(key, title) {
      box.appendChild(h("b", { "class": "pe-bifh", text: title }));
      [["Black from", 0], ["Black to", 1], ["White from", 2], ["White to", 3]].forEach(function (f) {
        box.appendChild(w.range(f[0], B[key][f[1]], 0, 255, 1, function (v) {
          var nb = PE.clone(L.blendIf || B), r = nb[key]; r[f[1]] = v;
          for (var i = 1; i < 4; i++) if (r[i] < r[i - 1]) r[i] = f[1] < i ? v : r[i - 1];
          var none = nb.self.join() === "0,0,255,255" && nb.under.join() === "0,0,255,255";
          if (none) delete L.blendIf; else L.blendIf = nb;
          changed();
        }));
      });
    }
    row("self", "This layer"); row("under", "Underlying layers");
    body.appendChild(h("div", { "class": "pe-fxhead open" }, [h("span", { "class": "pe-fxname", text: "Blend if (brightness)" })]));
    body.appendChild(box);
  };

  SX.tests.push(async function (ok, near) {
    ok(ramp(10, [0, 0, 255, 255]) === 1 && ramp(100, [50, 150, 255, 255]) === 0.5 && ramp(250, [0, 0, 200, 240]) === 0, "blend-if ramps");
    // white bg | black left half; a red layer blended only over the dark part (underlying white ends at 128)
    var bg = PE.mk(4, 1); PE.cx2(bg).fillStyle = "#fff"; PE.cx2(bg).fillRect(0, 0, 4, 1); PE.cx2(bg).fillStyle = "#000"; PE.cx2(bg).fillRect(0, 0, 2, 1);
    var B = PE.rasterFromCanvas(PE.touch(bg), "bg"), Rl = PE.rasterFromCanvas(SX.solid(4, 1, "#ff0000"), "red"); Rl.blendIf = { self: [0, 0, 255, 255], under: [0, 0, 100, 128] };
    var d = SX.scratch(4, 1, [B, Rl]), f = PE.flatten(d);
    ok(SX.px(f, 0, 0).join() === "255,0,0,255" && SX.px(f, 3, 0).join() === "255,255,255,255", "blend if underlying: shows only over dark pixels");
    Rl.blendIf = { self: [0, 0, 50, 60], under: [0, 0, 255, 255] }; f = PE.flatten(d); ok(SX.px(f, 0, 0).join() === "0,0,0,255" && SX.px(f, 3, 0).join() === "255,255,255,255", "blend if this layer: red (brightness 76) is past the white end (60), so hidden");
    Rl.blendIf = { self: [0, 0, 60, 92], under: [0, 0, 255, 255] }; f = PE.flatten(d); ok(near(SX.px(f, 3, 0)[1], 128, 4), "blend if soft ramp gives partial strength");
  });
})();
