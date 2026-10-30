/* Vector lane pixel maths: pure functions on typed arrays (no DOM), shared by the page and vworker.js.
   Masks are Uint8Array (0..255), images {data: Uint8ClampedArray RGBA, width, height}. */
(function (G) {
  "use strict";
  var VPIX = {}, VG = G.VG;

  // ---------- selection mask -> rings (pixel-corner outlines, inside on the right in screen coordinates) ----------
  VPIX.traceMask = function (m, w, h, thr) {
    thr = thr == null ? 128 : thr;
    function inside(x, y) { return x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] >= thr; }
    var W1 = w + 1, N0 = new Map(), N1 = new Map(), starts = [];
    // each vertex can have up to two outgoing edges (at diagonal touches); slot 0 / 1 (sparse: only boundary vertices)
    var next = { get: function (k) { var s = k & 1, v = (k - s) / 2, r = (s ? N1 : N0).get(v); return r == null ? -1 : r; }, set: function (k, val) { var s = k & 1, v = (k - s) / 2; if (val < 0) (s ? N1 : N0).delete(v); else (s ? N1 : N0).set(v, val); } };
    function add(x0, y0, x1, y1) {
      var k = (y0 * W1 + x0) * 2, v = y1 * W1 + x1;
      if (next.get(k) < 0) next.set(k, v); else next.set(k + 1, v);
      starts.push(k);
    }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (m[y * w + x] < thr) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
    var rings = [];
    for (var s = 0; s < starts.length; s++) {
      var k0 = starts[s]; if (next.get(k0) < 0 && next.get(k0 + 1) < 0) continue;
      var v0 = k0 / 2, ring = [], v = v0, guard = 0, px = -1, py = -1;
      do {
        var kk = v * 2, n0 = next.get(kk), n1 = next.get(kk + 1), slot = n0 >= 0 ? 0 : 1;
        if (n0 >= 0 && n1 >= 0 && px >= 0) {      // two ways on: turn right (keeps diagonal pixels apart)
          var vx = v % W1, vy = (v - vx) / W1, dx = vx - px, dy = vy - py;
          var ax = n0 % W1 - vx, ay = (n0 - n0 % W1) / W1 - vy;
          slot = dx * ay - dy * ax > 0 ? 0 : 1;
        }
        var nv = slot ? n1 : n0; if (nv < 0) break;
        next.set(kk + slot, -1);
        var cx = v % W1, cy = (v - cx) / W1;
        ring.push(cx, cy); px = cx; py = cy; v = nv;
      } while (v !== v0 && guard++ < 4e7);
      if (ring.length >= 8) rings.push(ring);
    }
    return rings;      // flat [x0, y0, x1, y1, ...]
  };
  // ---------- sub-pixel contours (marching squares on pixel centres, iso-level thr), oriented for non-zero filling ----------
  var MS = [[], [["L", "B"]], [["B", "R"]], [["L", "R"]], [["T", "R"]], null, [["T", "B"]], [["T", "L"]], [["T", "L"]], [["T", "B"]], null, [["T", "R"]], [["L", "R"]], [["B", "R"]], [["L", "B"]], []];
  VPIX.contours = function (m, w, h, thr) {
    thr = thr == null ? 128 : thr;
    var W = w + 2, H = h + 2;
    function v(x, y) { x -= 1; y -= 1; return x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]; }
    var next = new Map(), pt = new Map(), starts = [];
    function ep(e, x, y, a, b, c, d) {      // edge point: key + interpolated position (pixel-centre grid, minus the padding)
      var k, px, py;
      if (e === "T") { k = "h" + x + "," + y; px = x + (thr - a) / (b - a); py = y; }
      else if (e === "B") { k = "h" + x + "," + (y + 1); px = x + (thr - d) / (c - d); py = y + 1; }
      else if (e === "L") { k = "v" + x + "," + y; px = x; py = y + (thr - a) / (d - a); }
      else { k = "v" + (x + 1) + "," + y; px = x + 1; py = y + (thr - b) / (c - b); }
      if (!pt.has(k)) pt.set(k, { x: px - 1 + 0.5, y: py - 1 + 0.5 });
      return k;
    }
    for (var y = 0; y < H - 1; y++) for (var x = 0; x < W - 1; x++) {
      var a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1);      // tl, tr, br, bl
      var idx = (a >= thr ? 8 : 0) | (b >= thr ? 4 : 0) | (c >= thr ? 2 : 0) | (d >= thr ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      var segs = MS[idx];
      if (!segs) { var mid = (a + b + c + d) / 4 >= thr; segs = idx === 5 ? (mid ? [["T", "L"], ["B", "R"]] : [["T", "R"], ["L", "B"]]) : (mid ? [["T", "R"], ["L", "B"]] : [["T", "L"], ["B", "R"]]); }
      for (var s = 0; s < segs.length; s++) {
        var k1 = ep(segs[s][0], x, y, a, b, c, d), k2 = ep(segs[s][1], x, y, a, b, c, d), p1 = pt.get(k1), p2 = pt.get(k2);
        // orient: the inside must be on the right of the walking direction. Judge by a corner the segment cuts off
        // (the corner between two adjacent edges, else the top-left one), which is never on the line.
        var pair = segs[s][0] + segs[s][1], cx0 = 0, cy0 = 0, cv = a;
        if (/T/.test(pair) && /R/.test(pair)) { cx0 = 1; cv = b; } else if (/B/.test(pair) && /R/.test(pair)) { cx0 = 1; cy0 = 1; cv = c; } else if (/L/.test(pair) && /B/.test(pair)) { cy0 = 1; cv = d; }
        var qx = x + cx0 - 0.5, qy = y + cy0 - 0.5, cr = (p2.x - p1.x) * (qy - p1.y) - (p2.y - p1.y) * (qx - p1.x);
        if ((cr > 0) === (cv >= thr)) { next.set(k1, k2); starts.push(k1); } else { next.set(k2, k1); starts.push(k2); }
      }
    }
    var rings = [];
    starts.forEach(function (k0) {
      if (!next.has(k0)) return;
      var ring = [], k = k0, guard = 0;
      while (next.has(k) && guard++ < 1e7) { var q = pt.get(k); ring.push({ x: q.x, y: q.y }); var n = next.get(k); next.delete(k); k = n; if (k === k0) break; }
      if (ring.length >= 3) rings.push(ring);
    });
    return rings;
  };
  // mask -> smooth bezier components (sub-pixel contours, simplified, curves fitted with tolerance tol px)
  VPIX.maskToComps = function (m, w, h, tol) {
    var out = [];
    VPIX.contours(m, w, h, 127.5).forEach(function (pts) {
      if (Math.abs(VG.area(pts)) < 6) return;      // specks from anti-aliasing
      if (pts.length > 8) { var sm = VG.rdp(pts.concat([pts[0]]), Math.max(0.15, tol * 0.25)); sm.pop(); pts = sm; }
      if (pts.length < 3) return;
      var anchors = tol > 0 ? VG.fit(pts, tol, true) : pts.map(function (p) { return VG.P(p.x, p.y); });
      if (anchors.length >= 2) out.push(VG.comp(anchors, true));
    });
    return out;
  };

  // ---------- mesh warp: a regular grid over the source rect (sx0, sy0, sw, sh) goes to dst points (gw x gh, output px) ----------
  // Every grid cell is two triangles; each output pixel inside one samples the source (bilinear, premultiplied).
  // Pixels up to ~1 px outside the mesh still sample (the source is transparent there), which anti-aliases the edge.
  VPIX.meshWarp = function (img, sx0, sy0, sw, sh, gw, gh, dst, outW, outH, cells) {      // cells: optional (gw-1)*(gh-1) mask of the cells to draw
    var W = img.width, H = img.height, S = img.data, out = new Uint8ClampedArray(outW * outH * 4), wt = new Float32Array(outW * outH);
    var cx0 = sx0 + 0.5, cx1 = sx0 + sw - 0.5, cy0 = sy0 + 0.5, cy1 = sy0 + sh - 0.5;
    function sample(x, y, o, k) {
      x = (x < cx0 ? cx0 : x > cx1 ? cx1 : x) - 0.5; y = (y < cy0 ? cy0 : y > cy1 ? cy1 : y) - 0.5;      // edges are anti-aliased by coverage, not by fading the source
      var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, r = 0, g = 0, b = 0, a = 0;
      for (var j = 0; j < 2; j++) for (var i = 0; i < 2; i++) {
        var xx = x0 + i, yy = y0 + j; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        var w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), q = (yy * W + xx) * 4, al = S[q + 3] * w;
        r += S[q] * al; g += S[q + 1] * al; b += S[q + 2] * al; a += al;
      }
      if (k > wt[o]) {      // keep the sample from the triangle that covers this pixel best
        wt[o] = k; var p = o * 4;
        if (a > 0) { out[p] = r / a; out[p + 1] = g / a; out[p + 2] = b / a; out[p + 3] = a; } else { out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0; }
      }
    }
    function tri(ax, ay, bx, by, cx, cy, us, vs, ut, vt, uu, vu) {
      var den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) return;
      var A2 = Math.abs(den), ha = A2 / (Math.hypot(cx - bx, cy - by) || 1), hb = A2 / (Math.hypot(ax - cx, ay - cy) || 1), hc = A2 / (Math.hypot(bx - ax, by - ay) || 1);
      var x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1)), x1 = Math.min(outW - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
      var y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1)), y1 = Math.min(outH - 1, Math.ceil(Math.max(ay, by, cy) + 1));
      for (var y = y0; y <= y1; y++) {
        var py = y + 0.5;
        for (var x = x0; x <= x1; x++) {
          var px = x + 0.5, w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
          var d = Math.min(w0 * ha, w1 * hb, w2 * hc);      // signed distance (px) to the nearest edge
          if (d <= -0.5) continue;
          sample(w0 * us + w1 * ut + w2 * uu, w0 * vs + w1 * vt + w2 * vu, y * outW + x, d >= 0 ? 2 : 0.5 + d);
        }
      }
    }
    for (var j = 0; j < gh - 1; j++) for (var i = 0; i < gw - 1; i++) {
      if (cells && !cells[j * (gw - 1) + i]) continue;
      var a = (j * gw + i) * 2, b = a + 2, c = a + gw * 2, d = c + 2;
      var ua = sx0 + i / (gw - 1) * sw, ub = sx0 + (i + 1) / (gw - 1) * sw, va = sy0 + j / (gh - 1) * sh, vc = sy0 + (j + 1) / (gh - 1) * sh;
      tri(dst[a], dst[a + 1], dst[b], dst[b + 1], dst[d], dst[d + 1], ua, va, ub, va, ub, vc);
      tri(dst[a], dst[a + 1], dst[d], dst[d + 1], dst[c], dst[c + 1], ua, va, ub, vc, ua, vc);
    }
    for (var o = 0; o < wt.length; o++) if (wt[o] > 0 && wt[o] < 2) out[o * 4 + 3] = Math.round(out[o * 4 + 3] * wt[o]);      // edge coverage
    return { data: out, width: outW, height: outH };
  };

  // ---------- liquify: apply a displacement field (fw x fh, in field px; field px = k image px) to the full image ----------
  VPIX.liquifyApply = function (img, D, fw, fh, k) {
    var W = img.width, H = img.height, S = img.data, out = new Uint8ClampedArray(W * H * 4);
    function fieldAt(fx, fy, o) {      // bilinear displacement at field coords
      fx = Math.max(0, Math.min(fw - 1.001, fx)); fy = Math.max(0, Math.min(fh - 1.001, fy));
      var x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, i00 = (y0 * fw + x0) * 2, i10 = i00 + 2, i01 = i00 + fw * 2, i11 = i01 + 2;
      if (x0 + 1 >= fw) { i10 = i00; i11 = i01; } if (y0 + 1 >= fh) { i01 = i00; i11 = i10; }
      o[0] = (D[i00] * (1 - tx) + D[i10] * tx) * (1 - ty) + (D[i01] * (1 - tx) + D[i11] * tx) * ty;
      o[1] = (D[i00 + 1] * (1 - tx) + D[i10 + 1] * tx) * (1 - ty) + (D[i01 + 1] * (1 - tx) + D[i11 + 1] * tx) * ty;
    }
    var d = [0, 0];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      fieldAt((x + 0.5) * k - 0.5, (y + 0.5) * k - 0.5, d);
      var sx = x + d[0] / k - 0, sy = y + d[1] / k, o = (y * W + x) * 4;
      if (d[0] === 0 && d[1] === 0) { out[o] = S[o]; out[o + 1] = S[o + 1]; out[o + 2] = S[o + 2]; out[o + 3] = S[o + 3]; continue; }
      var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, r = 0, g = 0, b = 0, a = 0;
      for (var j = 0; j < 2; j++) for (var i = 0; i < 2; i++) {
        var xx = Math.max(0, Math.min(W - 1, x0 + i)), yy = Math.max(0, Math.min(H - 1, y0 + j)), w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), q = (yy * W + xx) * 4, al = S[q + 3] * w;
        r += S[q] * al; g += S[q + 1] * al; b += S[q + 2] * al; a += al;
      }
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a; }
    }
    return { data: out, width: W, height: H };
  };

  // ---------- seam carving ----------
  // Removal order of the n lowest-energy vertical seams: order[y * w + x] = seam number, -1 = kept.
  // protect (optional, 0..255) and skin tones make pixels expensive to remove.
  VPIX.carveOrder = function (img, protect, n, skin) {
    var w = img.width, h = img.height, d = img.data, N = w * h, i, x, y;
    n = Math.max(0, Math.min(n, w - 1));
    var Lm = new Float32Array(N), P = new Float32Array(N), O = new Int32Array(N), E = new Float32Array(N), M = new Float32Array(N), order = new Int32Array(N).fill(-1);
    for (i = 0; i < N; i++) {
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
      Lm[i] = (0.299 * r + 0.587 * g + 0.114 * b) * a / 255 + (255 - a) * 0.5;
      P[i] = protect ? protect[i] * 40 : 0;
      if (skin && r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15 && a > 128) P[i] += 6000;
      O[i] = i % w;
    }
    var cw = w;
    function en(x, y) {
      var row = y * w, l = Lm[row + (x > 0 ? x - 1 : x)], rr = Lm[row + (x < cw - 1 ? x + 1 : x)], u = Lm[(y > 0 ? y - 1 : y) * w + x], dn = Lm[(y < h - 1 ? y + 1 : y) * w + x];
      return Math.abs(rr - l) + Math.abs(dn - u) + P[row + x];
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) E[y * w + x] = en(x, y);
    var seam = new Int32Array(h);
    for (var it = 0; it < n; it++) {
      for (x = 0; x < cw; x++) M[x] = E[x];
      for (y = 1; y < h; y++) {
        var row = y * w, prev = row - w;
        for (x = 0; x < cw; x++) {
          var m = M[prev + x];
          if (x > 0 && M[prev + x - 1] < m) m = M[prev + x - 1];
          if (x < cw - 1 && M[prev + x + 1] < m) m = M[prev + x + 1];
          M[row + x] = E[row + x] + m;
        }
      }
      var last = (h - 1) * w, bx = 0;
      for (x = 1; x < cw; x++) if (M[last + x] < M[last + bx]) bx = x;
      seam[h - 1] = bx;
      for (y = h - 2; y >= 0; y--) {
        var px = seam[y + 1], best = px, base = y * w;
        if (px > 0 && M[base + px - 1] < M[base + best]) best = px - 1;
        if (px < cw - 1 && M[base + px + 1] < M[base + best]) best = px + 1;
        seam[y] = best;
      }
      for (y = 0; y < h; y++) {
        var rw = y * w, sx = seam[y];
        order[rw + O[rw + sx]] = it;
        Lm.copyWithin(rw + sx, rw + sx + 1, rw + cw); P.copyWithin(rw + sx, rw + sx + 1, rw + cw); O.copyWithin(rw + sx, rw + sx + 1, rw + cw); E.copyWithin(rw + sx, rw + sx + 1, rw + cw);
      }
      cw--;
      for (y = 0; y < h; y++) for (x = Math.max(0, seam[y] - 2); x <= Math.min(cw - 1, seam[y] + 1); x++) E[y * w + x] = en(x, y);
    }
    return order;
  };
  function transpose(img) {
    var w = img.width, h = img.height, s = img.data, o = new Uint8ClampedArray(s.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var a = (y * w + x) * 4, b = (x * h + y) * 4; o[b] = s[a]; o[b + 1] = s[a + 1]; o[b + 2] = s[a + 2]; o[b + 3] = s[a + 3]; }
    return { data: o, width: h, height: w };
  }
  function transposeMask(m, w, h) { if (!m) return null; var o = new Uint8Array(m.length); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) o[x * h + y] = m[y * w + x]; return o; }
  function scaleMask(m, w, h, W2, H2) { if (!m) return null; var o = new Uint8Array(W2 * H2); for (var y = 0; y < H2; y++) for (var x = 0; x < W2; x++) o[y * W2 + x] = m[Math.min(h - 1, Math.floor(y * h / H2)) * w + Math.min(w - 1, Math.floor(x * w / W2))]; return o; }
  function scaleImg(img, W2, H2) {      // box-ish downscale for finding seams
    var w = img.width, h = img.height, s = img.data, o = new Uint8ClampedArray(W2 * H2 * 4);
    for (var y = 0; y < H2; y++) for (var x = 0; x < W2; x++) {
      var x0 = Math.floor(x * w / W2), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / W2)), y0 = Math.floor(y * h / H2), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / H2)), r = 0, g = 0, b = 0, a = 0, n = 0;
      for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) { var q = (yy * w + xx) * 4; r += s[q]; g += s[q + 1]; b += s[q + 2]; a += s[q + 3]; n++; }
      var p = (y * W2 + x) * 4; o[p] = r / n; o[p + 1] = g / n; o[p + 2] = b / n; o[p + 3] = a / n;
    }
    return { data: o, width: W2, height: H2 };
  }
  // change the width of img to tw by removing (or doubling) the cheapest seams, found on a reduced copy
  function carveWidth(img, protect, tw, skin, maxSide) {
    var w = img.width, h = img.height, n = Math.abs(tw - w);
    if (!n) return img;
    var s = Math.min(1, (maxSide || 700) / Math.max(w, h)), lw = Math.max(2, Math.round(w * s)), lh = Math.max(1, Math.round(h * s));
    var low = s < 1 ? scaleImg(img, lw, lh) : img, lp = s < 1 ? scaleMask(protect, w, h, lw, lh) : protect;
    var nl = Math.min(lw - 1, Math.ceil(n * lw / w) + 1), order = VPIX.carveOrder(low, lp, nl, skin);
    var out = new Uint8ClampedArray(tw * h * 4), src = img.data, cols = new Int32Array(w), rank = new Float64Array(w);
    for (var y = 0; y < h; y++) {
      var ly = Math.min(lh - 1, Math.floor(y * lh / h)), x;
      for (x = 0; x < w; x++) { var lx = Math.min(lw - 1, Math.floor(x * lw / w)), o = order[ly * lw + lx]; rank[x] = o < 0 ? 1e9 + x : o * 1e5 + x; cols[x] = x; }
      var sorted = Array.prototype.slice.call(cols).sort(function (a, b) { return rank[a] - rank[b]; }), pick = new Uint8Array(w);
      for (x = 0; x < Math.min(n, w); x++) pick[sorted[x]] = 1;
      var row = y * w * 4, ro = y * tw * 4, k = 0;
      for (x = 0; x < w && k < tw; x++) {
        if (tw < w && pick[x]) continue;
        var q = row + x * 4; out[ro + k * 4] = src[q]; out[ro + k * 4 + 1] = src[q + 1]; out[ro + k * 4 + 2] = src[q + 2]; out[ro + k * 4 + 3] = src[q + 3]; k++;
        if (tw > w && pick[x] && k < tw) {      // enlarge: a new pixel between this one and the next
          var q2 = row + Math.min(w - 1, x + 1) * 4;
          for (var c = 0; c < 4; c++) out[ro + k * 4 + c] = (src[q + c] + src[q2 + c]) / 2;
          k++;
        }
      }
    }
    return { data: out, width: tw, height: h };
  }
  // full job: width first, then height (on the transposed image). n > width (or height) - 1 per pass is split into passes.
  VPIX.carve = function (img, protect, tw, th, skin, maxSide) {
    var cur = img, pm = protect;
    function steps(from, to) { var out = []; while (from !== to) { var next = to < from ? Math.max(to, Math.ceil(from / 2)) : Math.min(to, from * 2 - 1); out.push(next); from = next; } return out; }
    steps(cur.width, tw).forEach(function (t) { var w0 = cur.width; cur = carveWidth(cur, pm, t, skin, maxSide); pm = pm ? scaleMask(pm, w0, cur.height, cur.width, cur.height) : null; });
    if (th !== cur.height) {
      var T = transpose(cur), tp = pm ? transposeMask(pm, cur.width, cur.height) : null;
      steps(T.width, th).forEach(function (t) { var w0 = T.width; T = carveWidth(T, tp, t, skin, maxSide); tp = tp ? scaleMask(tp, w0, T.height, T.width, T.height) : null; });
      cur = transpose(T);
    }
    return cur;
  };

  VPIX.call = function (fn, args) {
    if (typeof VPIX[fn] !== "function" || fn === "call") throw new Error("Unknown job " + fn);
    return VPIX[fn].apply(null, args);
  };
  G.VPIX = VPIX;
})(typeof self !== "undefined" ? self : this);
