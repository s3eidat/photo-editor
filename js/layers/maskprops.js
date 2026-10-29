/* Selection lane: layer mask density and feather (Properties). Both are settings, not pixel edits: the mask keeps
   its pixels and the compositor uses a softened / lightened copy (cached per mask version and setting). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, PIX = window.PIX;
  SX.KEYS.push("maskDensity", "maskFeather");
  function num(v, a, b) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : undefined; }
  SX.fields.maskDensity = { save: function (L) { return L.maskDensity != null && L.maskDensity < 1 ? Math.round(L.maskDensity * 1000) / 1000 : undefined; }, parse: function (v) { var n = num(v, 0, 1); return n == null || n >= 1 ? undefined : n; } };
  SX.fields.maskFeather = { save: function (L) { return L.maskFeather > 0 ? L.maskFeather : undefined; }, parse: function (v) { var n = num(v, 0, 1000); return n > 0 ? n : undefined; } };
  SX.maskTweaked = function (L) { return !!(L.mask && (L.maskFeather > 0 || (L.maskDensity != null && L.maskDensity < 1))); };

  // Feathered (Gaussian, sigma = feather / 2, edges held) and density-lifted copy of a mask canvas.
  function soften(src, feather, density, out) {
    var w = src.width, h = src.height, c = out && out.width === w && out.height === h ? out : PE.mk(w, h), x = PE.cx2(c), sg = feather / 2;
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1;
    if (!(sg > 0.2)) { x.globalCompositeOperation = "copy"; x.drawImage(src, 0, 0); x.globalCompositeOperation = "source-over"; }
    else {      // blurred at a reduced size (sigma about 4 px there, at most 2.5 MP), then scaled back up
      var k = Math.min(1, 4 / sg, Math.sqrt(2.5e6 / (w * h))), sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k)), s = PE.mk(sw, sh), sx = s.getContext("2d", { willReadFrequently: true });
      sx.imageSmoothingQuality = "high"; sx.drawImage(src, 0, 0, sw, sh);
      var id = sx.getImageData(0, 0, sw, sh), d = id.data, a = new Float32Array(sw * sh), i;
      for (i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      PIX.blurPlane(a, sw, sh, sg * k);
      for (i = 0; i < a.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a[i]; }
      sx.putImageData(id, 0, 0);
      x.globalCompositeOperation = "copy"; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(s, 0, 0, w, h); x.globalCompositeOperation = "source-over";
    }
    if (density < 1) { x.globalAlpha = 1 - density; x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.globalAlpha = 1; }
    return PE.touch(c);
  }
  var CACHE = new WeakMap();
  // The mask the compositor should use for L (mask = L.mask or a live painting copy of it).
  SX.effMask = function (L, mask) {
    if (!mask || !SX.maskTweaked(L)) return mask;
    var f = +L.maskFeather || 0, dn = L.maskDensity == null ? 1 : L.maskDensity, key = PE.ver(mask.canvas) + ":" + f + ":" + dn, hit = CACHE.get(mask.canvas);
    if (!hit || hit.key !== key) { hit = { key: key, c: soften(mask.canvas, f, dn, hit && hit.c) }; CACHE.set(mask.canvas, hit); }
    return { canvas: hit.c, x: mask.x, y: mask.y };
  };

  // ---------- Properties ----------
  function block(P, L) {
    if (!L.mask) return;
    var w = ED.ui.w;
    P.appendChild(w.range("Mask density", Math.round((L.maskDensity == null ? 1 : L.maskDensity) * 100), 0, 100, 1, function (v) { SX.liveEdit(L, function () { L.maskDensity = v >= 100 ? undefined : v / 100; }, "Mask density"); }, function (v) { return v + "%"; }));
    P.appendChild(w.range("Mask feather", L.maskFeather || 0, 0, 250, 0.5, function (v) { SX.liveEdit(L, function () { L.maskFeather = v > 0 ? v : undefined; }, "Mask feather"); }, function (v) { return v + " px"; }));
  }
  var tail0 = ED.ui.propsTail;
  ED.ui.propsTail = function (P, L) { if (tail0) tail0(P, L); block(P, L); };
  var mp0 = SX.maskProps;
  SX.maskProps = function (P, L) { if (mp0) mp0(P, L); block(P, L); };

  SX.tests.push(async function (ok, near) {
    var base = PE.rasterFromCanvas(SX.solid(40, 10, "#ff0000"), "red"), d = SX.scratch(40, 10, [base]);
    var m = PE.mk(40, 10), mx = PE.cx2(m); mx.fillStyle = "#fff"; mx.fillRect(0, 0, 20, 10); base.mask = { canvas: PE.touch(m), x: 0, y: 0 }; base.maskOn = true;
    var hard = SX.px(PE.flatten(d), 17, 5)[3];
    base.maskFeather = 8; var f = PE.flatten(d), soft17 = SX.px(f, 17, 5)[3], soft23 = SX.px(f, 23, 5)[3], edge0 = SX.px(f, 0, 5)[3];
    ok(hard === 255 && soft17 < 250 && soft17 > 128 && soft23 > 0 && soft23 < 128 && edge0 === 255, "mask feather softens the mask edge, not the picture's edge");
    base.maskFeather = undefined; base.maskDensity = 0.25;
    ok(near(SX.px(PE.flatten(d), 30, 5)[3], 191, 2) && SX.px(PE.flatten(d), 5, 5)[3] === 255, "mask density lets hidden parts show through");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer()));
    ok(od.layers[0].maskDensity === 0.25 && near(SX.px(PE.flatten(od), 30, 5)[3], 191, 2), "mask density round-trips in projects");
  });
})();
