/* Adjust lane: Filter › Place in perspective — map a picture (another layer, or the merged image) onto a plane
   given by four corners dragged on the canvas, optionally tiled, with opacity and a blend mode. Inverse homography
   per pixel, bilinear. Preview at about screen size, result at full size (main thread). */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, AUI = PE.adjUI, A = PIX.A, h = S3.h;
  function K() { return ED.adjKit; }
  // Homography mapping the unit square (0,0)(1,0)(1,1)(0,1) onto quad q = [[x,y] x4]; returns its inverse as well.
  A.squareToQuad = function (q) {
    var x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1], x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, g, hh;
    var den = dx1 * dy2 - dx2 * dy1; if (Math.abs(den) < 1e-12) den = 1e-12;
    g = (sx * dy2 - dx2 * sy) / den; hh = (dx1 * sy - sx * dy1) / den;
    var a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
    var M = [a, b, c, d, e, f, g, hh, 1];
    // inverse (adjugate)
    var I = [e - f * hh, c * hh - b, b * f - c * e, f * g - d, a - c * g, c * d - a * f, d * hh - e * g, b * g - a * hh, a * e - b * d];
    return { m: M, inv: I };
  };
  A.applyH = function (M, x, y) { var w = M[6] * x + M[7] * y + M[8]; return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w]; };
  // Draw source (image data) into target (image data, layer-local) inside the quad (layer-local px).
  A.placeOnPlane = function (tgt, src, quad, o) {
    var H = A.squareToQuad(quad), inv = H.inv, w = tgt.width, hh = tgt.height, d = tgt.data, s = { data: src.data, width: src.width, height: src.height }, px = [0, 0, 0, 0];
    var xs = quad.map(function (q) { return q[0]; }), ys = quad.map(function (q) { return q[1]; }), x0 = Math.max(0, Math.floor(Math.min.apply(null, xs))), x1 = Math.min(w - 1, Math.ceil(Math.max.apply(null, xs))), y0 = Math.max(0, Math.floor(Math.min.apply(null, ys))), y1 = Math.min(hh - 1, Math.ceil(Math.max.apply(null, ys)));
    var tx = Math.max(1, +o.tilesX || 1), ty = Math.max(1, +o.tilesY || 1), op = Math.max(0, Math.min(1, o.opacity == null ? 1 : +o.opacity)), f = A.BLEND2 && A.BLEND2[o.mode] || null, shade = Math.max(0, Math.min(1, +o.shade || 0));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var uv = A.applyH(inv, x + 0.5, y + 0.5), u = uv[0], v = uv[1];
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
      var su = o.tile ? ((u * tx) % 1) * s.width : u * s.width, sv = o.tile ? ((v * ty) % 1) * s.height : v * s.height;
      A.sample(s, su, sv, px, o.tile ? "wrap" : "clamp");
      var a = px[3] / 255 * op; if (!a) continue;
      var i = (y * w + x) * 4;
      for (var c = 0; c < 3; c++) {
        var bv = d[i + c] / 255, sv2 = px[c] / 255;
        if (shade) sv2 *= 1 - shade + shade * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255 * 1.6;      // take on the wall's light and shade
        var r = f ? f(bv, Math.min(1, sv2)) : sv2;
        d[i + c] = (bv + (r - bv) * a) * 255;
      }
      d[i + 3] = d[i + 3] + (255 - d[i + 3]) * a;
    }
    return tgt;
  };

  function sourceImage(id, scale) {
    var d = ED.doc, c;
    if (id === "__merged") c = PE.flatten(d);
    else { var L = PE.findLayer(d, id); if (!L) return null; c = L.kind === "raster" ? L.canvas : PE.surface(L, d).canvas; }
    var w = Math.max(1, Math.round(c.width * scale)), hh = Math.max(1, Math.round(c.height * scale)), t = PE.mk(w, hh), x = t.getContext("2d");
    x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, w, hh);
    var im = x.getImageData(0, 0, w, hh); return { data: im.data, width: w, height: hh };
  }

  function placeDialog() {
    var Kt = K(), t = Kt.adjTarget(); if (!t) return;
    var L = t.L, W = t.r.w, H = t.r.h, s = AUI.proxyScale(W, H), w = Math.max(1, Math.round(W * s)), hh = Math.max(1, Math.round(H * s));
    var small = s < 1 ? AUI.downImg(t.img, w, hh) : t.img, others = ED.doc.layers.filter(function (l) { return l !== L; });
    var p = { src: others.length ? others[others.length - 1].id : "__merged", q: [25, 25, 75, 30, 75, 75, 25, 70], tile: false, tilesX: 2, tilesY: 2, opacity: 1, mode: "normal", shade: 0 }, cache = {}, prev = PE.mk(w, hh), full = s < 1 ? PE.mk(W, H) : null, raf = 0;
    var st = { p: p, t: t, ver: 0, set: function (k, v) { p[k] = v; soon(); }, schedule: function () { soon(); } };
    function quad(scale) { var Q = []; for (var i = 0; i < 8; i += 2) Q.push([p.q[i] / 100 * W * scale, p.q[i + 1] / 100 * H * scale]); return Q; }
    function src(scale) { var k = p.src + "@" + scale; return cache[k] || (cache[k] = sourceImage(p.src, Math.min(1, scale * 1.5))); }
    function show() {
      raf = 0; st.ver++;
      var im = { data: new Uint8ClampedArray(small.data), width: w, height: hh }, sc = src(s); if (sc) A.placeOnPlane(im, sc, quad(s), p);
      prev.getContext("2d").putImageData(new ImageData(im.data, w, hh), 0, 0);
      var c = prev; if (full) { var fx = full.getContext("2d"); fx.save(); fx.globalCompositeOperation = "copy"; fx.imageSmoothingQuality = "high"; fx.drawImage(prev, 0, 0, W, H); fx.restore(); c = full; }
      ED.live.over[L.id] = { canvas: PE.touch(c), x: t.r.x, y: t.r.y }; ED.render();
    }
    function soon() { st.ver++; if (!raf) raf = requestAnimationFrame(show); }
    AUI.panel("Place in perspective", function (el) {
      el.appendChild(Kt.select("Picture", [["__merged", "Merged (all visible)"]].concat(others.slice().reverse().map(function (l) { return [l.id, l.name]; })), p.src, function (v) { p.src = v; soon(); }));
      el.appendChild(Kt.check("Tile it across the plane", false, function (v) { p.tile = v; soon(); }));
      el.appendChild(Kt.range("Tiles across", 2, 1, 20, 1, function (v) { p.tilesX = v; soon(); }));
      el.appendChild(Kt.range("Tiles down", 2, 1, 20, 1, function (v) { p.tilesY = v; soon(); }));
      el.appendChild(Kt.range("Opacity", 100, 0, 100, 1, function (v) { p.opacity = v / 100; soon(); }, AUI.pc));
      el.appendChild(Kt.select("Blending", [["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["softLight", "Soft light"], ["darken", "Darken"], ["lighten", "Lighten"]], "normal", function (v) { p.mode = v; soon(); }));
      el.appendChild(Kt.range("Take on the surface's shading", 0, 0, 100, 1, function (v) { p.shade = v / 100; soon(); }, AUI.pc));
      el.appendChild(h("p", { "class": "faint pe-p", text: "Drag the four corners onto the surface (a wall, a floor, a screen). Hide the source layer if you placed a layer." }));
      AUI.handles(st, function () { return planeModel(st); });
      show();
    }, function () {
      if (raf) cancelAnimationFrame(raf); delete ED.live.over[L.id];
      var im = { data: new Uint8ClampedArray(t.img.data), width: W, height: H }, sc = sourceImage(p.src, 1);
      if (sc) A.placeOnPlane(im, sc, quad(1), p);
      Kt.commitAdjusted(t, im, "Place in perspective");
    }, function () { if (raf) cancelAnimationFrame(raf); delete ED.live.over[L.id]; });
  }
  // four corner handles + a perspective grid through the plane
  function planeModel(st) {
    var p = st.p;
    function corner(k) { return { big: true, at: function (a) { var d = a.toDoc(p.q[k * 2], p.q[k * 2 + 1]); return a.scr(d.x, d.y); }, move: function (a, d) { var q = a.toPct(d.x, d.y); p.q[k * 2] = Math.round(q.x * 10) / 10; p.q[k * 2 + 1] = Math.round(q.y * 10) / 10; st.schedule(); } }; }
    return {
      handles: [corner(0), corner(1), corner(2), corner(3)],
      draw: function (ctx, a) {
        var Q = []; for (var i = 0; i < 8; i += 2) { var d = a.toDoc(p.q[i], p.q[i + 1]); Q.push(a.scr(d.x, d.y)); }
        var Hm = A.squareToQuad(Q.map(function (q) { return [q.x, q.y]; })).m, n = 8;
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(61,214,208,.8)";
        for (var k = 0; k <= n; k++) {
          var t = k / n, a0 = A.applyH(Hm, t, 0), a1 = A.applyH(Hm, t, 1), b0 = A.applyH(Hm, 0, t), b1 = A.applyH(Hm, 1, t);
          ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.stroke();
        }
        ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.beginPath(); Q.forEach(function (q, i) { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke();
      }
    };
  }
  AUI.addMenu("Filter", [["Place in perspective…", "Ctrl+Alt+V", placeDialog, AUI.has]], "Gaussian blur");
  AUI.key("Ctrl+Alt+V", placeDialog);
  AUI.placeDialog = placeDialog;
})();
