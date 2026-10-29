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
  // rings of pixel corners -> smooth bezier components (staircases become diagonals, then curves are fitted)
  VPIX.maskToComps = function (m, w, h, tol) {
    var rings = VPIX.traceMask(m, w, h, 128), out = [];
    rings.forEach(function (r) {
      var n = r.length / 2, pts = [];
      for (var i = 0; i < n; i++) { var j = (i + 1) % n; pts.push({ x: (r[i * 2] + r[j * 2]) / 2, y: (r[i * 2 + 1] + r[j * 2 + 1]) / 2 }); }
      if (pts.length > 6) {      // drop the staircase corners: keep points where the direction really changes
        var sm = VG.rdp(pts.concat([pts[0]]), Math.max(0.3, tol * 0.35)); sm.pop(); pts = sm;
      }
      if (pts.length < 3) return;
      var anchors = tol > 0 ? VG.fit(pts, tol, true) : pts.map(function (p) { return VG.P(p.x, p.y); });
      if (anchors.length >= 2) out.push(VG.comp(anchors, true));
    });
    return out;
  };

  // ---------- mesh warp: a regular grid over the source rect (sx0, sy0, sw, sh) goes to dst points (gw x gh, output px) ----------
  // Every grid cell is two triangles; each output pixel inside one samples the source (bilinear, premultiplied).
  // Pixels up to ~1 px outside the mesh still sample (the source is transparent there), which anti-aliases the edge.
  VPIX.meshWarp = function (img, sx0, sy0, sw, sh, gw, gh, dst, outW, outH) {
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
      var a = (j * gw + i) * 2, b = a + 2, c = a + gw * 2, d = c + 2;
      var ua = sx0 + i / (gw - 1) * sw, ub = sx0 + (i + 1) / (gw - 1) * sw, va = sy0 + j / (gh - 1) * sh, vc = sy0 + (j + 1) / (gh - 1) * sh;
      tri(dst[a], dst[a + 1], dst[b], dst[b + 1], dst[d], dst[d + 1], ua, va, ub, va, ub, vc);
      tri(dst[a], dst[a + 1], dst[d], dst[d + 1], dst[c], dst[c + 1], ua, va, ub, vc, ua, vc);
    }
    for (var o = 0; o < wt.length; o++) if (wt[o] > 0 && wt[o] < 2) out[o * 4 + 3] = Math.round(out[o * 4 + 3] * wt[o]);      // edge coverage
    return { data: out, width: outW, height: outH };
  };

  VPIX.call = function (fn, args) {
    if (typeof VPIX[fn] !== "function" || fn === "call") throw new Error("Unknown job " + fn);
    return VPIX[fn].apply(null, args);
  };
  G.VPIX = VPIX;
})(typeof self !== "undefined" ? self : this);
