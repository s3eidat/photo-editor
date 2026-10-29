/* Adjust lane: Render › Picture frame and Render › Tree, drawn with a 2D canvas (OffscreenCanvas in the worker).
   Sizes are relative to the layer, so a reduced preview shows the same picture. Pure page/worker code, no DOM. */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num;
  A.canvas2d = function (w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    if (typeof document !== "undefined") { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
    throw new Error("This browser cannot draw here (no OffscreenCanvas)");
  };
  // draw(ctx, w, h) on a transparent canvas, then put it over the image (or replace inside a mask when cut = true)
  function overlay(img, draw, cut) {
    var w = img.width, h = img.height, c = A.canvas2d(w, h), x = c.getContext("2d");
    if (cut) x.putImageData(new ImageData(new Uint8ClampedArray(img.data), w, h), 0, 0);
    draw(x, w, h);
    var o = x.getImageData(0, 0, w, h).data, d = img.data;
    if (cut) { d.set(o); return img; }
    for (var i = 0; i < d.length; i += 4) {        // source-over of the drawing onto the image (straight alpha)
      var a = o[i + 3] / 255; if (!a) continue;
      var ab = d[i + 3] / 255, ao = a + ab * (1 - a);
      for (var k = 0; k < 3; k++) d[i + k] = (o[i + k] * a + d[i + k] * ab * (1 - a)) / ao;
      d[i + 3] = ao * 255;
    }
    return img;
  }
  function rgba(hex, a) { var c = A.hex(hex, [0, 0, 0]); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  // ---------- picture frame ----------
  A.reg("pictureFrame", A.filter(function (img, p) {
    var style = p.style || "mat", m = clamp(num(p.margin, 8), 1, 40) / 100, col = p.color || "#3a2a1c", col2 = p.color2 || "#f4efe4", R = A.rng((num(p.seed, 1) | 0) * 7 + 3);
    var cut = style === "scallop" || style === "rounded";
    return overlay(img, function (x, w, h) {
      var b = Math.max(2, Math.round(Math.min(w, h) * m));
      function ring(t, fill) { x.fillStyle = fill; x.beginPath(); x.rect(0, 0, w, h); x.rect(t, t, w - 2 * t, h - 2 * t); x.fill("evenodd"); }
      if (style === "plain") ring(b, col);
      else if (style === "mat") {
        ring(b, col2); ring(Math.round(b * 0.45), col);
        x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = Math.max(1, b * 0.04); x.strokeRect(b - x.lineWidth / 2, b - x.lineWidth / 2, w - 2 * b + x.lineWidth, h - 2 * b + x.lineWidth);
        x.strokeStyle = "rgba(255,255,255,.25)"; x.lineWidth = Math.max(1, b * 0.03); x.strokeRect(b * 0.45, b * 0.45, w - b * 0.9, h - b * 0.9);
      } else if (style === "wood") {
        var g = x.createImageData(w, h), base = A.hex(col, [110, 70, 40]);
        for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
          if (!(xx < b || y < b || y >= h - b || xx >= w - b)) continue;
          var hor = y < b || y >= h - b, u = hor ? xx : y, v = hor ? y : xx, n = A.vnoise(u / 140, v / 9, 4) * 0.6 + A.vnoise(u / 30, v / 3, 9) * 0.4, ring2 = 0.75 + 0.25 * Math.sin(v * 0.9 + n * 9), i = (y * w + xx) * 4;
          g.data[i] = base[0] * ring2; g.data[i + 1] = base[1] * ring2; g.data[i + 2] = base[2] * ring2; g.data[i + 3] = 255;
        }
        x.putImageData(g, 0, 0);
        // bevel: light top-left, dark bottom-right, mitred corners
        x.fillStyle = "rgba(255,255,255,.18)"; x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w - b, b); x.lineTo(b, b); x.lineTo(b, h - b); x.lineTo(0, h); x.closePath(); x.fill();
        x.fillStyle = "rgba(0,0,0,.22)"; x.beginPath(); x.moveTo(w, h); x.lineTo(0, h); x.lineTo(b, h - b); x.lineTo(w - b, h - b); x.lineTo(w - b, b); x.lineTo(w, 0); x.closePath(); x.fill();
        x.strokeStyle = "rgba(0,0,0,.5)"; x.lineWidth = Math.max(1, b * 0.05); x.strokeRect(b, b, w - 2 * b, h - 2 * b);
      } else if (style === "film") {
        ring(b, "#111"); x.fillStyle = col2 === "#f4efe4" ? "#f2f2f2" : col2;
        var hs = b * 0.32, gap = hs * 1.8;
        for (var fx = gap / 2; fx < w - hs; fx += gap) { x.fillRect(fx, b * 0.34, hs, hs * 0.8); x.fillRect(fx, h - b * 0.34 - hs * 0.8, hs, hs * 0.8); }
      } else if (style === "instant") {
        x.fillStyle = col2; x.beginPath(); x.rect(0, 0, w, h); x.rect(b * 0.7, b * 0.7, w - b * 1.4, h - b * 0.7 - b * 2.4); x.fill("evenodd");
      } else if (style === "vine") {
        ring(b, col2);
        x.strokeStyle = col; x.fillStyle = rgba(col, 0.9); x.lineWidth = Math.max(1, b * 0.06); x.lineCap = "round";
        var per = 2 * (w + h - 2 * b), steps = Math.max(40, Math.round(per / (b * 0.15)));
        function at(t) {       // point on the band's centre line, t in 0..1 around the image
          var s = t * per, hb = b / 2;
          if (s < w - b) return [hb + s, hb]; s -= w - b;
          if (s < h - b) return [w - hb, hb + s]; s -= h - b;
          if (s < w - b) return [w - hb - s, h - hb]; s -= w - b;
          return [hb, h - hb - s];
        }
        x.beginPath();
        for (var k = 0; k <= steps; k++) { var t = k / steps, q = at(t), wv = Math.sin(t * per / (b * 1.6)) * b * 0.22; var nq = at(Math.min(1, t + 1 / steps)), dx = nq[0] - q[0], dy = nq[1] - q[1], l = Math.hypot(dx, dy) || 1; var px = q[0] - dy / l * wv, py = q[1] + dx / l * wv; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
        x.stroke();
        for (k = 0; k < steps; k += 2) { var tt = k / steps, qq = at(tt), lf = b * (0.12 + R() * 0.08), an = R() * Math.PI * 2; x.save(); x.translate(qq[0] + (R() - 0.5) * b * 0.4, qq[1] + (R() - 0.5) * b * 0.4); x.rotate(an); x.beginPath(); x.ellipse(0, 0, lf, lf * 0.45, 0, 0, Math.PI * 2); x.fill(); x.restore(); }
      } else if (style === "scallop" || style === "rounded") {
        x.globalCompositeOperation = "destination-in"; x.fillStyle = "#000"; x.beginPath();
        if (style === "rounded") { var rr = b * 1.6, ins = b * 0.25; x.moveTo(ins + rr, ins); x.arcTo(w - ins, ins, w - ins, h - ins, rr); x.arcTo(w - ins, h - ins, ins, h - ins, rr); x.arcTo(ins, h - ins, ins, ins, rr); x.arcTo(ins, ins, w - ins, ins, rr); x.closePath(); }
        else { var sr = b * 0.5, ix = b * 0.6; x.rect(ix, ix, w - 2 * ix, h - 2 * ix); for (var sx = ix; sx <= w - ix; sx += sr * 2) { x.moveTo(sx + sr, ix); x.arc(sx, ix, sr, 0, Math.PI * 2); x.moveTo(sx + sr, h - ix); x.arc(sx, h - ix, sr, 0, Math.PI * 2); } for (var sy = ix; sy <= h - ix; sy += sr * 2) { x.moveTo(ix + sr, sy); x.arc(ix, sy, sr, 0, Math.PI * 2); x.moveTo(w - ix + sr, sy); x.arc(w - ix, sy, sr, 0, Math.PI * 2); } }
        x.fill(); x.globalCompositeOperation = "source-over";
        if (style === "rounded") { x.strokeStyle = col; x.lineWidth = Math.max(1, b * 0.12); x.stroke(); }
      }
    }, cut);
  }));

  // ---------- tree ----------
  A.reg("tree", A.filter(function (img, p) {
    var R = A.rng((num(p.seed, 1) | 0) * 13 + 5), bx = clamp(num(p.x, 50), 0, 100) / 100, by = clamp(num(p.y, 96), 0, 100) / 100, size = clamp(num(p.size, 45), 5, 100) / 100;
    var spread = clamp(num(p.spread, 28), 5, 70) * Math.PI / 180, depthMax = clamp(Math.round(num(p.depth, 8)), 3, 11), leafAmt = clamp(num(p.leaves, 60), 0, 100) / 100, bend = clamp(num(p.bend, 15), 0, 60) / 100;
    var trunk = p.trunk || "#4a3424", leaf = A.hex(p.leaf, [70, 140, 60]), leafSize = clamp(num(p.leafSize, 50), 5, 100) / 100;
    return overlay(img, function (x, w, h) {
      var H0 = h * size * 0.32, x0 = bx * w, y0 = by * h, tips = [];
      x.lineCap = "round"; x.strokeStyle = trunk;
      (function branch(px, py, ang, len, wid, d) {
        var c = (R() - 0.5) * bend, ex = px + Math.sin(ang) * len, ey = py - Math.cos(ang) * len, mx = (px + ex) / 2 + Math.cos(ang) * len * c, my = (py + ey) / 2 + Math.sin(ang) * len * c;
        x.lineWidth = Math.max(0.6, wid); x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(mx, my, ex, ey); x.stroke();
        if (d >= depthMax || len < 2) { tips.push([ex, ey]); return; }
        var n = R() < 0.3 ? 3 : 2;
        for (var k = 0; k < n; k++) {
          var a2 = ang + (n === 2 ? (k ? 1 : -1) * spread * (0.6 + R() * 0.6) : (k - 1) * spread * (0.8 + R() * 0.5));
          branch(ex, ey, a2, len * (0.68 + R() * 0.12), wid * 0.68, d + 1);
        }
        if (d > depthMax - 3) tips.push([ex, ey]);
      })(x0, y0, (R() - 0.5) * 0.1, H0, Math.max(1.5, H0 * 0.12), 1);
      var ls = Math.max(1.5, H0 * 0.05 * leafSize * 2);
      tips.forEach(function (t) {
        var cnt = Math.round(leafAmt * 6);
        for (var k = 0; k < cnt; k++) {
          var j = 0.8 + R() * 0.4; x.fillStyle = "rgba(" + Math.round(leaf[0] * j) + "," + Math.round(leaf[1] * j) + "," + Math.round(leaf[2] * j) + ",0.9)";
          x.save(); x.translate(t[0] + (R() - 0.5) * ls * 3, t[1] + (R() - 0.5) * ls * 3); x.rotate(R() * Math.PI * 2); x.beginPath(); x.ellipse(0, 0, ls, ls * 0.5, 0, 0, Math.PI * 2); x.fill(); x.restore();
        }
      });
    }, false);
  }));
})(typeof self !== "undefined" ? self : this);
