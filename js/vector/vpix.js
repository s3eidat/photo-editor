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

  VPIX.call = function (fn, args) {
    if (typeof VPIX[fn] !== "function" || fn === "call") throw new Error("Unknown job " + fn);
    return VPIX[fn].apply(null, args);
  };
  G.VPIX = VPIX;
})(typeof self !== "undefined" ? self : this);
