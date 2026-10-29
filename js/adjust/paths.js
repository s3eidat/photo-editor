/* Adjust lane: path-driven filters. Blur › Path blur (pixels smear along drawn motion paths) and Render › Flame
   (flames rising along drawn paths). Paths: p.paths = [[x%, y%, x%, y%, ...], ...] in layer percent, drawn in the
   panel with on-canvas handles. Pure maths (flame uses a 2D canvas; OffscreenCanvas in the worker). */
(function (G) {
  "use strict";
  var PIX = G.PIX, A = PIX.A, clamp = A.clamp, num = A.num;
  function sc(p) { return clamp(num(p._scale, 1), 0.01, 1); }
  // paths in layer percent -> pixel polylines (Catmull-Rom smoothed so a few clicks give a curve)
  A.pathPoints = function (paths, w, h, smoothPts) {
    return (Array.isArray(paths) ? paths : []).slice(0, 16).map(function (P) {
      var pts = [];
      for (var i = 0; i + 1 < (P || []).length && i < 400; i += 2) pts.push([num(P[i], 0) / 100 * w, num(P[i + 1], 0) / 100 * h]);
      if (!smoothPts || pts.length < 3) return pts;
      var out = [];
      for (var k = 0; k < pts.length - 1; k++) {
        var p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)];
        for (var t = 0; t < 1; t += 0.125) {
          var t2 = t * t, t3 = t2 * t;
          out.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
        }
      }
      out.push(pts[pts.length - 1]);
      return out;
    }).filter(function (P) { return P.length >= 2; });
  };
  // Motion field: at every pixel, the direction of the nearest bit of path (inverse-distance blend of all paths) and a
  // strength that tapers along each path. Computed on a coarse grid and interpolated.
  function field(paths, w, h, taper) {
    var step = Math.max(4, Math.round(Math.max(w, h) / 160)), GW = Math.ceil(w / step) + 1, GH = Math.ceil(h / step) + 1, fx = new Float32Array(GW * GH), fy = new Float32Array(GW * GH), fs = new Float32Array(GW * GH);
    for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
      var X = gx * step, Y = gy * step, sx = 0, sy = 0, sw = 0, ss = 0;
      paths.forEach(function (P) {
        var best = Infinity, bdx = 0, bdy = 0, bt = 0, total = 0, at = 0, k;
        for (k = 0; k < P.length - 1; k++) total += Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
        for (k = 0; k < P.length - 1; k++) {
          var ax = P[k][0], ay = P[k][1], dx = P[k + 1][0] - ax, dy = P[k + 1][1] - ay, l2 = dx * dx + dy * dy || 1, t = clamp(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1), cx = ax + dx * t, cy = ay + dy * t, dd = (X - cx) * (X - cx) + (Y - cy) * (Y - cy), sl = Math.sqrt(l2);
          if (dd < best) { best = dd; bdx = dx / sl; bdy = dy / sl; bt = (at + t * sl) / (total || 1); }
          at += sl;
        }
        var wgt = 1 / (best + step * step);
        sx += bdx * wgt; sy += bdy * wgt; sw += wgt; ss += (1 - taper * bt) * wgt;
      });
      var q = gy * GW + gx, l = Math.hypot(sx, sy) || 1; fx[q] = sx / l; fy[q] = sy / l; fs[q] = sw ? ss / sw : 0;
    }
    return { step: step, GW: GW, GH: GH, x: fx, y: fy, s: fs };
  }
  function fAt(F, x, y, o) {
    var u = clamp(x / F.step, 0, F.GW - 1.001), v = clamp(y / F.step, 0, F.GH - 1.001), i = u | 0, j = v | 0, tx = u - i, ty = v - j, q = j * F.GW + i;
    function L(a) { return (a[q] * (1 - tx) + a[q + 1] * tx) * (1 - ty) + (a[q + F.GW] * (1 - tx) + a[q + F.GW + 1] * tx) * ty; }
    o[0] = L(F.x); o[1] = L(F.y); o[2] = L(F.s); return o;
  }
  A.reg("pathBlur", A.filter(function (img, p) {
    var w = img.width, h = img.height, S = sc(p), paths = A.pathPoints(p.paths, w, h, true);
    if (!paths.length) return img;
    var len = clamp(num(p.speed, 50), 0, 500) * S, taper = clamp(num(p.taper, 0), 0, 100) / 100, centred = p.centred !== false;
    if (len < 1) return img;
    var F = field(paths, w, h, taper), b = A.toP4(img), out = new Float32Array(b.length), o = [0, 0, 0], T = clamp(Math.round(len / 1.5), 4, 48), W1 = w - 1, H1 = h - 1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      fAt(F, x, y, o);
      var L = len * Math.max(0, o[2]), st = L / T, s0 = 0, s1 = 0, s2 = 0, s3 = 0, cnt = 0;
      // walk along the field (a streamline), backwards then forwards from the pixel (or only backwards when not centred)
      for (var dir = -1; dir <= 1; dir += 2) {
        if (dir > 0 && !centred) break;
        var px = x, py = y, n = centred ? T >> 1 : T, d2 = [0, 0, 0];
        for (var k = 0; k < n; k++) {
          var X = px < 0 ? 0 : px > W1 ? W1 : px, Y = py < 0 ? 0 : py > H1 ? H1 : py, x0 = X | 0, y0 = Y | 0, tx = X - x0, ty = Y - y0, x1 = x0 < W1 ? x0 + 1 : x0, y1 = y0 < H1 ? y0 + 1 : y0;
          var i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4, w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
          s0 += b[i00] * w00 + b[i10] * w10 + b[i01] * w01 + b[i11] * w11; s1 += b[i00 + 1] * w00 + b[i10 + 1] * w10 + b[i01 + 1] * w01 + b[i11 + 1] * w11;
          s2 += b[i00 + 2] * w00 + b[i10 + 2] * w10 + b[i01 + 2] * w01 + b[i11 + 2] * w11; s3 += b[i00 + 3] * w00 + b[i10 + 3] * w10 + b[i01 + 3] * w01 + b[i11 + 3] * w11; cnt++;
          fAt(F, px, py, d2); px += d2[0] * st * dir; py += d2[1] * st * dir;
        }
      }
      var oi = (y * w + x) * 4; out[oi] = s0 / cnt; out[oi + 1] = s1 / cnt; out[oi + 2] = s2 / cnt; out[oi + 3] = s3 / cnt;
    }
    return A.fromP4(out, img);
  }));

  // ---------- flame: tongues of fire along each path ----------
  var FIRE = { fire: [[255, 250, 220], [255, 200, 60], [240, 90, 20], [160, 20, 10]], blue: [[230, 250, 255], [120, 200, 255], [40, 90, 230], [20, 20, 120]],
    green: [[240, 255, 220], [150, 255, 90], [40, 180, 40], [10, 80, 20]], violet: [[255, 230, 255], [230, 120, 255], [140, 40, 220], [60, 10, 110]] };
  A.reg("flame", A.filter(function (img, p) {
    var w = img.width, h = img.height, S = sc(p), paths = A.pathPoints(p.paths, w, h, true);
    if (!paths.length) return img;
    var flen = clamp(num(p.length, 12), 1, 60) / 100 * Math.min(w, h), fw = clamp(num(p.width, 30), 5, 100) / 100, turb = clamp(num(p.turbulence, 40), 0, 100) / 100, dens = clamp(num(p.density, 50), 5, 100) / 100;
    var pal = FIRE[p.colors] || FIRE.fire, R = A.rng((num(p.seed, 1) | 0) * 31 + 7), c = A.canvas2d(w, h), x = c.getContext("2d"), seed = (num(p.seed, 1) | 0) * 17;
    paths.forEach(function (P) {
      var total = 0; for (var k = 0; k < P.length - 1; k++) total += Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]);
      var gap = Math.max(1, flen * 0.1 / dens), at = 0, seg = 0, segL = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
      // a soft glow along the base first
      x.save(); x.globalCompositeOperation = "lighter"; x.lineCap = "round"; x.lineJoin = "round";
      [[flen * 0.5, 0.10], [flen * 0.22, 0.22]].forEach(function (gw) { x.strokeStyle = "rgba(" + pal[2][0] + "," + pal[2][1] + "," + pal[2][2] + "," + gw[1] + ")"; x.lineWidth = gw[0]; x.beginPath(); P.forEach(function (q, i) { if (i) x.lineTo(q[0], q[1] - flen * 0.1); else x.moveTo(q[0], q[1] - flen * 0.1); }); x.stroke(); });
      x.restore();
      for (var d = 0; d < total; d += gap * (0.6 + R() * 0.8)) {
        while (d > at + segL && seg < P.length - 2) { at += segL; seg++; segL = Math.hypot(P[seg + 1][0] - P[seg][0], P[seg + 1][1] - P[seg][1]); }
        var t = (d - at) / (segL || 1), bx = P[seg][0] + (P[seg + 1][0] - P[seg][0]) * t, by = P[seg][1] + (P[seg + 1][1] - P[seg][1]) * t, L = flen * (0.45 + R() * 0.8), W = L * fw * 0.5;
        var lean = (A.vnoise(bx / (flen * 0.8), by / (flen * 0.8), seed) - 0.5) * turb * 1.6;
        for (var layer = 3; layer >= 0; layer--) {      // outer dark-red tongue first, white-hot core last
          var k2 = 1 - (3 - layer) * 0.22, col = pal[layer], g = x.createLinearGradient(bx, by, bx + lean * L, by - L * k2);
          g.addColorStop(0, "rgba(" + col[0] + "," + col[1] + "," + col[2] + "," + (0.5 + (3 - layer) * 0.12) + ")"); g.addColorStop(0.6, "rgba(" + col[0] + "," + col[1] + "," + col[2] + "," + (0.3 + (3 - layer) * 0.05) + ")"); g.addColorStop(1, "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0)");
          x.fillStyle = g; x.beginPath(); x.moveTo(bx - W * k2, by);
          x.bezierCurveTo(bx - W * k2, by - L * k2 * 0.45, bx + lean * L * 0.6 - W * k2 * 0.3, by - L * k2 * 0.75, bx + lean * L, by - L * k2);
          x.bezierCurveTo(bx + lean * L * 0.6 + W * k2 * 0.3, by - L * k2 * 0.75, bx + W * k2, by - L * k2 * 0.45, bx + W * k2, by);
          x.closePath(); x.fill();
        }
      }
    });
    // turbulence: wobble the fire sideways with noise, then screen it over the image
    var f = x.getImageData(0, 0, w, h).data, d2 = img.data, sz = Math.max(4, flen * 0.25);
    for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
      var off = turb ? (A.vnoise(xx / sz, y / sz, seed + 3) - 0.5) * sz * 1.2 * turb : 0, sx = Math.round(clamp(xx + off, 0, w - 1)), j = (y * w + sx) * 4, i = (y * w + xx) * 4;
      var a = f[j + 3] / 255; if (!a) continue;
      for (var ch = 0; ch < 3; ch++) d2[i + ch] = 255 - (255 - d2[i + ch]) * (255 - f[j + ch] * a) / 255;
      d2[i + 3] = Math.max(d2[i + 3], f[j + 3]);
    }
    return img;
  }));
})(typeof self !== "undefined" ? self : this);
