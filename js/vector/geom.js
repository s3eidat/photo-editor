/* Vector lane geometry: cubic bezier paths, flattening, exact bounds, hit tests, anchor editing, polygon booleans
   (unite / subtract / intersect / exclude), curve fitting, parametric shapes (polygon, star, arrows) and the built-in
   custom shape library. Pure maths, no DOM, so the worker can load it too.
   A path is a list of components: { op: "add" | "sub" | "int" | "xor", closed: bool, pts: [[x, y, ix, iy, ox, oy, smooth], ...] }
   where (ix, iy) is the handle coming into the anchor and (ox, oy) the handle going out (both absolute). */
(function (G) {
  "use strict";
  var VG = {};
  var K = 0.5522847498;      // circle quarter as one cubic

  // ---------- anchors and components ----------
  function P(x, y) { return [x, y, x, y, x, y, 0]; }
  function Pc(x, y, ix, iy, ox, oy, s) { return [x, y, ix, iy, ox, oy, s === 2 ? 2 : s ? 1 : 0]; }
  VG.P = P; VG.Pc = Pc;
  function comp(pts, closed, op) { return { op: op || "add", closed: closed !== false, pts: pts }; }
  VG.comp = comp;
  function cloneComps(cs) { return cs.map(function (c) { return { op: c.op, closed: c.closed, pts: c.pts.map(function (p) { return p.slice(); }) }; }); }
  VG.clone = cloneComps;
  function isLine(a, b) { return a[4] === a[0] && a[5] === a[1] && b[2] === b[0] && b[3] === b[1]; }
  VG.isLine = isLine;
  // Apply f(x, y) -> {x, y} (or [x, y]) to every anchor and handle.
  function mapComps(cs, f) {
    return cs.map(function (c) {
      return { op: c.op, closed: c.closed, pts: c.pts.map(function (p) {
        var a = f(p[0], p[1]), i = f(p[2], p[3]), o = f(p[4], p[5]);
        return [ax(a), ay(a), ax(i), ay(i), ax(o), ay(o), p[6] || 0];
      }) };
    });
  }
  function ax(q) { return Array.isArray(q) ? q[0] : q.x; }
  function ay(q) { return Array.isArray(q) ? q[1] : q.y; }
  VG.map = mapComps;
  VG.affine = function (cs, m) { return mapComps(cs, function (x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }); };
  // Each segment of a component: [a, b] anchor pairs (closing segment included when closed).
  function segs(c) {
    var out = [], n = c.pts.length;
    for (var i = 0; i < n - 1; i++) out.push([c.pts[i], c.pts[i + 1], i]);
    if (c.closed && n > 1) out.push([c.pts[n - 1], c.pts[0], n - 1]);
    return out;
  }
  VG.segs = segs;

  // ---------- cubic maths ----------
  function bez(t, a, b, c, d) { var u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; }
  VG.bez = bez;
  function segPt(a, b, t) { return { x: bez(t, a[0], a[4], b[2], b[0]), y: bez(t, a[1], a[5], b[3], b[1]) }; }
  VG.segPt = segPt;
  function roots(a, b, c, d) {      // t in (0,1) where the derivative of the 1-D cubic is 0
    var A = 3 * (-a + 3 * b - 3 * c + d), B = 6 * (a - 2 * b + c), C = 3 * (b - a), out = [];
    if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) out.push(-C / B); }
    else { var D = B * B - 4 * A * C; if (D >= 0) { var s = Math.sqrt(D); out.push((-B + s) / (2 * A), (-B - s) / (2 * A)); } }
    return out.filter(function (t) { return t > 0 && t < 1; });
  }
  // Exact bounding box of the curves (not of the handles).
  VG.bounds = function (cs) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    function add(x, y) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    cs.forEach(function (c) {
      c.pts.forEach(function (p) { add(p[0], p[1]); });
      segs(c).forEach(function (s) {
        var a = s[0], b = s[1];
        roots(a[0], a[4], b[2], b[0]).concat(roots(a[1], a[5], b[3], b[1])).forEach(function (t) { var q = segPt(a, b, t); add(q.x, q.y); });
      });
    });
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  // Polyline of one segment, adaptive: enough steps that the chord error stays under tol.
  function flatSeg(a, b, tol, out) {
    if (isLine(a, b)) { out.push({ x: b[0], y: b[1] }); return; }
    var dd = Math.hypot(a[4] - a[0], a[5] - a[1]) + Math.hypot(b[2] - a[4], b[3] - a[5]) + Math.hypot(b[0] - b[2], b[1] - b[3]);
    var n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(dd / Math.max(tol, 1e-6)) * 0.9)));
    for (var i = 1; i <= n; i++) out.push(segPt(a, b, i / n));
  }
  VG.flatComp = function (c, tol) {
    if (!c.pts.length) return [];
    var out = [{ x: c.pts[0][0], y: c.pts[0][1] }];
    segs(c).forEach(function (s) { flatSeg(s[0], s[1], tol || 0.25, out); });
    if (c.closed && out.length > 1) { var f = out[0], l = out[out.length - 1]; if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop(); }
    return out;
  };
  VG.flatten = function (cs, tol) { return cs.map(function (c) { return VG.flatComp(c, tol); }); };
  // Add components to a canvas / Path2D context.
  VG.trace = function (ctx, cs) {
    cs.forEach(function (c) {
      if (!c.pts.length) return;
      ctx.moveTo(c.pts[0][0], c.pts[0][1]);
      segs(c).forEach(function (s) { var a = s[0], b = s[1]; if (isLine(a, b)) ctx.lineTo(b[0], b[1]); else ctx.bezierCurveTo(a[4], a[5], b[2], b[3], b[0], b[1]); });
      if (c.closed) ctx.closePath();
    });
  };
  VG.traceRings = function (ctx, rings, closed) {
    rings.forEach(function (r) { if (!r.length) return; ctx.moveTo(r[0].x, r[0].y); for (var i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y); if (closed !== false) ctx.closePath(); });
  };
  // Split segment i of component c at t (de Casteljau): returns a new component with an anchor inserted.
  VG.splitAt = function (c, i, t) {
    var n = c.pts.length, a = c.pts[i], b = c.pts[(i + 1) % n], pts = c.pts.map(function (p) { return p.slice(); });
    var line = isLine(a, b);
    var x01 = a[0] + (a[4] - a[0]) * t, y01 = a[1] + (a[5] - a[1]) * t, x12 = a[4] + (b[2] - a[4]) * t, y12 = a[5] + (b[3] - a[5]) * t, x23 = b[2] + (b[0] - b[2]) * t, y23 = b[3] + (b[1] - b[3]) * t;
    var xa = x01 + (x12 - x01) * t, ya = y01 + (y12 - y01) * t, xb = x12 + (x23 - x12) * t, yb = y12 + (y23 - y12) * t, x = xa + (xb - xa) * t, y = ya + (yb - ya) * t;
    var np = line ? P(x, y) : Pc(x, y, xa, ya, xb, yb, 1);
    if (!line) { pts[i][4] = x01; pts[i][5] = y01; var j = (i + 1) % n; pts[j][2] = x23; pts[j][3] = y23; }
    pts.splice(i + 1, 0, np);
    return { op: c.op, closed: c.closed, pts: pts };
  };
  // Nearest point on any segment: {ci, si, t, x, y, d}.
  VG.nearestSeg = function (cs, x, y) {
    var best = null;
    cs.forEach(function (c, ci) {
      segs(c).forEach(function (s) {
        var a = s[0], b = s[1], N = isLine(a, b) ? 1 : 24, prev = { x: a[0], y: a[1] }, bt = 0, bd = Infinity;
        for (var k = 1; k <= N; k++) {      // coarse: closest point on each chord
          var q = N === 1 ? { x: b[0], y: b[1] } : segPt(a, b, k / N), dx = q.x - prev.x, dy = q.y - prev.y, L2 = dx * dx + dy * dy;
          var u = L2 ? Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / L2)) : 0, px = prev.x + dx * u, py = prev.y + dy * u, d = Math.hypot(x - px, y - py);
          if (d < bd) { bd = d; bt = (k - 1 + u) / N; }
          prev = q;
        }
        if (N > 1) {      // refine t by local search
          var step = 1 / N / 2;
          for (var it = 0; it < 12; it++) {
            [bt - step, bt + step].forEach(function (tt) { if (tt < 0 || tt > 1) return; var q2 = segPt(a, b, tt), d2 = Math.hypot(x - q2.x, y - q2.y); if (d2 < bd) { bd = d2; bt = tt; } });
            step /= 2;
          }
        }
        var qq = segPt(a, b, bt);
        if (!best || bd < best.d) best = { ci: ci, si: s[2], t: bt, x: qq.x, y: qq.y, d: bd };
      });
    });
    return best;
  };

  // ---------- polygons ----------
  function area(r) { var s = 0; for (var i = 0, n = r.length; i < n; i++) { var a = r[i], b = r[(i + 1) % n]; s += a.x * b.y - b.x * a.y; } return s / 2; }
  VG.area = area;
  VG.areaRings = function (rs) { return rs.reduce(function (s, r) { return s + area(r); }, 0); };
  function winding(rings, x, y) {
    var w = 0;
    for (var k = 0; k < rings.length; k++) {
      var r = rings[k], n = r.length;
      for (var i = 0; i < n; i++) {
        var a = r[i], b = r[(i + 1) % n];
        if (a.y <= y) { if (b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) w++; }
        else if (b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) w--;
      }
    }
    return w;
  }
  VG.winding = winding;
  var OPS = { add: function (a, b) { return a || b; }, sub: function (a, b) { return a && !b; }, int: function (a, b) { return a && b; }, xor: function (a, b) { return a !== b; } };
  // Boolean of two ring sets (each filled with the non-zero rule). Split every edge at every crossing, keep the pieces
  // that separate "in the result" from "not in the result", oriented with the inside on the left, then chain them.
  VG.bool = function (A, B, op) {
    var f = OPS[op] || OPS.add, E = [], i, j;
    [A, B].forEach(function (rs, tag) {
      rs.forEach(function (r) {
        for (var k = 0, n = r.length; k < n; k++) { var a = r[k], b = r[(k + 1) % n]; if (a.x !== b.x || a.y !== b.y) E.push({ a: a, b: b, t: [], tag: tag }); }
      });
    });
    if (!E.length) return [];
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    E.forEach(function (e) { bx0 = Math.min(bx0, e.a.x); bx1 = Math.max(bx1, e.a.x); by0 = Math.min(by0, e.a.y); by1 = Math.max(by1, e.a.y); });
    var diag = Math.hypot(bx1 - bx0, by1 - by0) || 1, eps = diag * 1e-9;
    E.forEach(function (e) { e.x0 = Math.min(e.a.x, e.b.x); e.x1 = Math.max(e.a.x, e.b.x); e.y0 = Math.min(e.a.y, e.b.y); e.y1 = Math.max(e.a.y, e.b.y); });
    var order = E.map(function (e, k) { return k; }).sort(function (p, q) { return E[p].x0 - E[q].x0; });
    for (var oi = 0; oi < order.length; oi++) {
      var e1 = E[order[oi]];
      for (var oj = oi + 1; oj < order.length; oj++) {
        var e2 = E[order[oj]];
        if (e2.x0 > e1.x1 + eps) break;
        if (e2.y0 > e1.y1 + eps || e2.y1 < e1.y0 - eps) continue;
        cross(e1, e2);
      }
    }
    function cross(p, q) {
      var rx = p.b.x - p.a.x, ry = p.b.y - p.a.y, sx = q.b.x - q.a.x, sy = q.b.y - q.a.y, den = rx * sy - ry * sx, qpx = q.a.x - p.a.x, qpy = q.a.y - p.a.y;
      var lr = Math.hypot(rx, ry), ls = Math.hypot(sx, sy);
      if (Math.abs(den) <= 1e-12 * lr * ls) {      // parallel: split each at the other's endpoints when collinear and overlapping
        if (Math.abs(qpx * ry - qpy * rx) > eps * lr) return;
        [[p, q.a], [p, q.b], [q, p.a], [q, p.b]].forEach(function (z) {
          var e = z[0], pt = z[1], dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, u = ((pt.x - e.a.x) * dx + (pt.y - e.a.y) * dy) / (dx * dx + dy * dy);
          if (u > 1e-9 && u < 1 - 1e-9) e.t.push([u, pt]);
        });
        return;
      }
      var t = (qpx * sy - qpy * sx) / den, u = (qpx * ry - qpy * rx) / den;
      if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return;
      var pt = { x: p.a.x + rx * t, y: p.a.y + ry * t };
      if (t <= 1e-9) pt = p.a; else if (t >= 1 - 1e-9) pt = p.b; else if (u <= 1e-9) pt = q.a; else if (u >= 1 - 1e-9) pt = q.b;
      if (t > 1e-9 && t < 1 - 1e-9) p.t.push([t, pt]);
      if (u > 1e-9 && u < 1 - 1e-9) q.t.push([u, pt]);
    }
    // registry so equal points share one key
    var q = diag * 1e-7, reg = {};
    function key(pt) { return Math.round(pt.x / q) + "," + Math.round(pt.y / q); }
    function canon(pt) { var k = key(pt); return reg[k] || (reg[k] = { x: pt.x, y: pt.y, k: k }); }
    var pieces = [], seen = {};
    E.forEach(function (e) {
      e.t.sort(function (m, n) { return m[0] - n[0]; });
      var list = [e.a].concat(e.t.map(function (z) { return z[1]; }), [e.b]);
      for (var k = 0; k < list.length - 1; k++) {
        var a = canon(list[k]), b = canon(list[k + 1]);
        if (a === b) continue;
        var uk = a.k < b.k ? a.k + "|" + b.k : b.k + "|" + a.k;
        if (seen[uk]) continue;      // coincident pieces count once
        seen[uk] = 1; pieces.push([a, b]);
      }
    });
    var off = diag * 1e-6, kept = [];
    pieces.forEach(function (pc) {
      var a = pc[0], b = pc[1], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), nx = -dy / len * off, ny = dx / len * off, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var inL = f(winding(A, mx + nx, my + ny) !== 0, winding(B, mx + nx, my + ny) !== 0), inR = f(winding(A, mx - nx, my - ny) !== 0, winding(B, mx - nx, my - ny) !== 0);
      if (inL === inR) return;
      kept.push(inL ? [a, b] : [b, a]);
    });
    return chain(kept);
  };
  function chain(edges) {
    var from = {}, used = new Uint8Array(edges.length), rings = [];
    edges.forEach(function (e, k) { (from[e[0].k] = from[e[0].k] || []).push(k); });
    for (var s = 0; s < edges.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      var ring = [edges[s][0]], cur = edges[s][1], start = edges[s][0].k, guard = 0, prev = edges[s];
      while (cur.k !== start && guard++ < edges.length + 2) {
        ring.push(cur);
        var cand = (from[cur.k] || []).filter(function (k) { return !used[k]; });
        if (!cand.length) break;
        var nx = cand[0];
        if (cand.length > 1) {      // several ways on: take the sharpest left turn so touching rings stay apart
          var ix = prev[1].x - prev[0].x, iy = prev[1].y - prev[0].y, bestA = Infinity;
          cand.forEach(function (k) { var e = edges[k], ox = e[1].x - e[0].x, oy = e[1].y - e[0].y, ang = Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy); var turn = -ang; if (turn < bestA) { bestA = turn; nx = k; } });
        }
        used[nx] = 1; prev = edges[nx]; cur = edges[nx][1];
      }
      if (ring.length >= 3) rings.push(simplifyRing(ring));
    }
    return rings.filter(function (r) { return r.length >= 3 && Math.abs(area(r)) > 1e-12; });
  }
  function simplifyRing(r) {      // drop exactly collinear points
    var out = [];
    for (var i = 0, n = r.length; i < n; i++) {
      var a = r[(i + n - 1) % n], b = r[i], c = r[(i + 1) % n], cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      var sc = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y);
      if (Math.abs(cr) > 1e-10 * sc || (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) out.push({ x: b.x, y: b.y });
    }
    return out;
  }
  // Apply the components' operations in order (the first one starts from nothing). Returns rings (non-zero fill).
  VG.combine = function (cs, tol) {
    var acc = [];
    cs.forEach(function (c) { if (c.pts.length < 2) return; var r = VG.flatComp(c, tol); if (r.length < 3) return; acc = VG.bool(acc, [r], c.op || "add"); });
    return acc;
  };
  VG.needsBool = function (cs) { return cs.length > 1 && cs.every(function (c) { return c.closed; }) && cs.some(function (c, i) { return i > 0 && (c.op || "add") !== "add"; }); };
  // Rings -> components of straight anchors (collinear points removed).
  VG.ringsToComps = function (rings) { return rings.map(function (r) { return comp(r.map(function (p) { return P(p.x, p.y); }), true, "add"); }); };

  // ---------- simplify + fit (freeform pen, selection to path) ----------
  VG.rdp = function (pts, tol, closed) {
    if (pts.length < 3) return pts.slice();
    var keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      var s = stack.pop(), a = pts[s[0]], b = pts[s[1]], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), md = -1, mi = -1;
      for (var i = s[0] + 1; i < s[1]; i++) { var p = pts[i], d = L ? Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L : Math.hypot(p.x - a.x, p.y - a.y); if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; stack.push([s[0], mi], [mi, s[1]]); }
    }
    void closed;
    return pts.filter(function (p, i) { return keep[i]; });
  };
  // Schneider-style least-squares cubic fitting. pts: [{x,y}], returns anchors.
  VG.fit = function (pts, err, closed) {
    pts = pts.filter(function (p, i) { return !i || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6; });
    if (closed && pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) > 1e-6) pts = pts.concat([pts[0]]);
    if (pts.length < 2) return pts.map(function (p) { return P(p.x, p.y); });
    if (pts.length === 2) return [P(pts[0].x, pts[0].y), P(pts[1].x, pts[1].y)];
    var curves = [];
    function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
    function addv(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
    function mul(a, k) { return { x: a.x * k, y: a.y * k }; }
    function dot(a, b) { return a.x * b.x + a.y * b.y; }
    function norm(a) { var l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; }
    function tanL(i) { return norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[i])); }
    function tanR(i) { return norm(sub(pts[Math.max(i - 1, 0)], pts[i])); }
    function tanC(i) { return norm(sub(pts[i - 1], pts[i + 1])); }
    function q(bz, t) { var u = 1 - t; return { x: u * u * u * bz[0].x + 3 * u * u * t * bz[1].x + 3 * u * t * t * bz[2].x + t * t * t * bz[3].x, y: u * u * u * bz[0].y + 3 * u * u * t * bz[1].y + 3 * u * t * t * bz[2].y + t * t * t * bz[3].y }; }
    function chord(f, l) { var u = [0]; for (var i = f + 1; i <= l; i++) u.push(u[i - f - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)); var T = u[u.length - 1] || 1; return u.map(function (v) { return v / T; }); }
    function gen(f, l, u, t1, t2) {
      var A = u.map(function (t) { var v = 1 - t; return [mul(t1, 3 * v * v * t), mul(t2, 3 * v * t * t)]; });
      var C = [[0, 0], [0, 0]], X = [0, 0], p0 = pts[f], p3 = pts[l];
      for (var i = 0; i < u.length; i++) {
        C[0][0] += dot(A[i][0], A[i][0]); C[0][1] += dot(A[i][0], A[i][1]); C[1][1] += dot(A[i][1], A[i][1]);
        var t = u[i], v = 1 - t, tmp = sub(pts[f + i], addv(mul(p0, v * v * v + 3 * v * v * t), mul(p3, 3 * v * t * t + t * t * t)));
        X[0] += dot(A[i][0], tmp); X[1] += dot(A[i][1], tmp);
      }
      C[1][0] = C[0][1];
      var det = C[0][0] * C[1][1] - C[1][0] * C[0][1], a1 = det ? (X[0] * C[1][1] - X[1] * C[0][1]) / det : 0, a2 = det ? (C[0][0] * X[1] - C[1][0] * X[0]) / det : 0;
      var seg = Math.hypot(p3.x - p0.x, p3.y - p0.y), e = 1e-6 * seg;
      if (a1 < e || a2 < e || a1 > seg * 2 || a2 > seg * 2) { a1 = a2 = seg / 3; }      // degenerate or runaway handles
      return [p0, addv(p0, mul(t1, a1)), addv(p3, mul(t2, a2)), p3];
    }
    function maxErr(f, l, bz, u) { var md = 0, mi = Math.floor((l - f + 1) / 2) + f; for (var i = f + 1; i < l; i++) { var p = q(bz, u[i - f]), d = Math.pow(p.x - pts[i].x, 2) + Math.pow(p.y - pts[i].y, 2); if (d >= md) { md = d; mi = i; } } return [md, mi]; }
    function reparam(bz, f, l, u) {
      return u.map(function (t, k) {
        var p = pts[f + k], d1 = [mul(sub(bz[1], bz[0]), 3), mul(sub(bz[2], bz[1]), 3), mul(sub(bz[3], bz[2]), 3)], d2 = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
        var v = 1 - t, qt = q(bz, t), q1 = addv(addv(mul(d1[0], v * v), mul(d1[1], 2 * v * t)), mul(d1[2], t * t)), q2 = addv(mul(d2[0], v), mul(d2[1], t));
        var num = dot(sub(qt, p), q1), den = dot(q1, q1) + dot(sub(qt, p), q2);
        return den ? Math.max(0, Math.min(1, t - num / den)) : t;
      });
    }
    function fitC(f, l, t1, t2, depth) {
      if (l - f === 1) { var d = Math.hypot(pts[l].x - pts[f].x, pts[l].y - pts[f].y) / 3; curves.push([pts[f], addv(pts[f], mul(t1, d)), addv(pts[l], mul(t2, d)), pts[l]]); return; }
      var u = chord(f, l), bz = gen(f, l, u, t1, t2), me = maxErr(f, l, bz, u), E2 = err * err;
      if (me[0] < E2) { curves.push(bz); return; }
      if (me[0] < E2 * 64) for (var it = 0; it < 6; it++) { u = reparam(bz, f, l, u); bz = gen(f, l, u, t1, t2); me = maxErr(f, l, bz, u); if (me[0] < E2) { curves.push(bz); return; } }
      var sp = Math.max(f + 1, Math.min(l - 1, me[1]));
      if (depth > 40) { curves.push(bz); return; }
      var tc = tanC(sp);
      fitC(f, sp, t1, tc, depth + 1); fitC(sp, l, mul(tc, -1), t2, depth + 1);
    }
    var t1 = closed ? norm(sub(pts[1], pts[pts.length - 2])) : tanL(0), t2 = closed ? mul(t1, -1) : tanR(pts.length - 1);
    fitC(0, pts.length - 1, t1, t2, 0);
    var out = [];
    curves.forEach(function (c, i) {
      if (!i) out.push(Pc(c[0].x, c[0].y, c[0].x, c[0].y, c[1].x, c[1].y, 0));
      else { out[out.length - 1][4] = c[1].x; out[out.length - 1][5] = c[1].y; }
      out.push(Pc(c[3].x, c[3].y, c[2].x, c[2].y, c[3].x, c[3].y, 1));
    });
    if (closed && out.length > 2) { var last = out.pop(); out[0][2] = last[2]; out[0][3] = last[3]; out[0][6] = 1; }
    // anchors where the tangent breaks become corners
    out.forEach(function (p) { var a1 = Math.atan2(p[1] - p[3], p[0] - p[2]), a2 = Math.atan2(p[5] - p[1], p[4] - p[0]); if ((p[2] === p[0] && p[3] === p[1]) || (p[4] === p[0] && p[5] === p[1]) || Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))) > 0.2) p[6] = 0; });
    return out;
  };

  // ---------- parametric shapes (unit box 0..1 unless said) ----------
  function ellipseComp(x, y, w, h) {
    var cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, kx = rx * K, ky = ry * K;
    return comp([Pc(cx, y, cx - kx, y, cx + kx, y, 1), Pc(x + w, cy, x + w, cy - ky, x + w, cy + ky, 1), Pc(cx, y + h, cx + kx, y + h, cx - kx, y + h, 1), Pc(x, cy, x, cy + ky, x, cy - ky, 1)], true);
  }
  VG.ellipse = ellipseComp;
  // Rounded polygon from corner points (absolute units, so the radius is round in the real shape).
  function roundPoly(pts, r) {
    if (!(r > 0)) return comp(pts.map(function (p) { return P(p.x, p.y); }), true);
    var n = pts.length, out = [];
    for (var i = 0; i < n; i++) {
      var a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
      var d1 = Math.hypot(a.x - b.x, a.y - b.y), d2 = Math.hypot(c.x - b.x, c.y - b.y);
      var u1 = { x: (a.x - b.x) / d1, y: (a.y - b.y) / d1 }, u2 = { x: (c.x - b.x) / d2, y: (c.y - b.y) / d2 };
      var ang = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))), t = r / Math.tan(ang / 2);
      t = Math.min(t, d1 / 2, d2 / 2);
      var rr = t * Math.tan(ang / 2), hk = 4 / 3 * Math.tan((Math.PI - ang) / 4) * rr;
      var p1 = { x: b.x + u1.x * t, y: b.y + u1.y * t }, p2 = { x: b.x + u2.x * t, y: b.y + u2.y * t };
      out.push(Pc(p1.x, p1.y, p1.x, p1.y, p1.x - u1.x * hk, p1.y - u1.y * hk, 0));
      out.push(Pc(p2.x, p2.y, p2.x - u2.x * hk, p2.y - u2.y * hk, p2.x, p2.y, 0));
    }
    return comp(out, true);
  }
  VG.roundPoly = roundPoly;
  // Regular polygon / star corner points inside box (x, y, w, h); first point at the top.
  VG.polyPts = function (x, y, w, h, n, indent) {
    n = Math.max(3, Math.min(100, Math.round(n || 5)));
    var pts = [], star = indent > 0, m = star ? n * 2 : n, cx = x + w / 2, cy = y + h / 2;
    for (var i = 0; i < m; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / m, r = star && i % 2 ? 1 - Math.min(0.99, indent) : 1;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    var bx = pts.reduce(function (s, p) { return { x0: Math.min(s.x0, p.x), x1: Math.max(s.x1, p.x), y0: Math.min(s.y0, p.y), y1: Math.max(s.y1, p.y) }; }, { x0: 1, x1: -1, y0: 1, y1: -1 });
    return pts.map(function (p) { return { x: x + (p.x - bx.x0) / (bx.x1 - bx.x0) * w, y: y + (p.y - bx.y0) / (bx.y1 - bx.y0) * h }; });
    void cx; void cy;
  };
  // Arrowhead polygon at tip (x, y) pointing along angle a. w, l = width and length; c = concavity -0.5..0.5.
  VG.arrowHead = function (x, y, a, w, l, c) {
    var ca = Math.cos(a), sa = Math.sin(a);
    function T(u, v) { return { x: x + u * ca - v * sa, y: y + u * sa + v * ca }; }
    return [T(0, 0), T(-l, w / 2), T(-l + l * (c || 0), 0), T(-l, -w / 2)];
  };

  // ---------- path data (tiny SVG subset: M L H V C Q Z, absolute) -> components in a 0..100 box ----------
  VG.parseD = function (d) {
    var tok = String(d).match(/[MLHVCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [], i = 0, cs = [], cur = null, x = 0, y = 0;
    function n() { return +tok[i++]; }
    while (i < tok.length) {
      var c = tok[i++].toUpperCase();
      if (c === "M") { x = n(); y = n(); cur = comp([P(x, y)], false); cs.push(cur); }
      else if (c === "L") { x = n(); y = n(); cur.pts.push(P(x, y)); }
      else if (c === "H") { x = n(); cur.pts.push(P(x, y)); }
      else if (c === "V") { y = n(); cur.pts.push(P(x, y)); }
      else if (c === "C") { var a = n(), b = n(), e = n(), f = n(); x = n(); y = n(); var l = cur.pts[cur.pts.length - 1]; l[4] = a; l[5] = b; cur.pts.push(Pc(x, y, e, f, x, y, 0)); }
      else if (c === "Q") { var qx = n(), qy = n(), ex = n(), ey = n(), lp = cur.pts[cur.pts.length - 1]; lp[4] = lp[0] + 2 / 3 * (qx - lp[0]); lp[5] = lp[1] + 2 / 3 * (qy - lp[1]); cur.pts.push(Pc(ex, ey, ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey, 0)); x = ex; y = ey; }
      else if (c === "Z") {
        cur.closed = true;
        var f0 = cur.pts[0], ll = cur.pts[cur.pts.length - 1];
        if (cur.pts.length > 1 && Math.abs(f0[0] - ll[0]) < 1e-9 && Math.abs(f0[1] - ll[1]) < 1e-9) { f0[2] = ll[2]; f0[3] = ll[3]; cur.pts.pop(); }
      } else if (/[0-9.-]/.test(c)) { i--; cur.pts.push(P(x = n(), y = n())); }
    }
    cs.forEach(function (c) { c.pts.forEach(function (p) { var a1 = Math.atan2(p[1] - p[3], p[0] - p[2]), a2 = Math.atan2(p[5] - p[1], p[4] - p[0]); p[6] = (p[2] !== p[0] || p[3] !== p[1]) && (p[4] !== p[0] || p[5] !== p[1]) && Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))) < 0.05 ? 1 : 0; }); });
    return cs;
  };
  // Built-in custom shapes, drawn for this app in a 100 x 100 box.
  VG.LIB = [
    ["heart", "Heart", "M50 92 C20 70 2 52 2 31 C2 14 15 4 28 4 C38 4 46 10 50 19 C54 10 62 4 72 4 C85 4 98 14 98 31 C98 52 80 70 50 92 Z"],
    ["check", "Check mark", "M6 54 L20 40 L38 58 L80 14 L94 28 L38 86 Z"],
    ["cross", "Cross", "M20 6 L50 36 L80 6 L94 20 L64 50 L94 80 L80 94 L50 64 L20 94 L6 80 L36 50 L6 20 Z"],
    ["plus", "Plus", "M38 4 H62 V38 H96 V62 H62 V96 H38 V62 H4 V38 H38 Z"],
    ["bubble", "Speech bubble", "M14 6 H86 C93 6 98 11 98 18 V60 C98 67 93 72 86 72 H44 L22 94 L26 72 H14 C7 72 2 67 2 60 V18 C2 11 7 6 14 6 Z"],
    ["thought", "Thought cloud", "M30 70 C14 72 2 62 6 48 C0 36 10 22 24 24 C28 10 46 4 58 12 C70 2 92 10 90 26 C100 34 98 54 84 58 C84 70 68 76 58 68 C50 76 36 76 30 70 Z M16 84 C16 80 20 78 23 80 C26 82 25 87 21 88 C18 88 16 87 16 84 Z M6 96 C6 94 8 93 10 94 C12 95 11 98 9 98 C7 98 6 97 6 96 Z"],
    ["bolt", "Lightning", "M58 2 L16 56 H44 L36 98 L84 38 H54 L66 2 Z"],
    ["drop", "Drop", "M50 2 C50 2 14 46 14 66 C14 86 30 98 50 98 C70 98 86 86 86 66 C86 46 50 2 50 2 Z"],
    ["moon", "Crescent", "M62 4 C34 8 14 30 14 56 C14 80 34 98 58 98 C76 98 90 88 96 74 C88 78 80 80 72 80 C48 80 30 62 30 40 C30 24 42 10 62 4 Z"],
    ["sun", "Sun burst", "M50 0 L57 20 L75 7 L72 29 L94 25 L80 43 L100 50 L80 57 L94 75 L72 71 L75 93 L57 80 L50 100 L43 80 L25 93 L28 71 L6 75 L20 57 L0 50 L20 43 L6 25 L28 29 L25 7 L43 20 Z"],
    ["badge", "Seal", "M50 0 L60 8 L73 5 L78 17 L91 20 L90 33 L99 43 L92 54 L96 67 L84 73 L81 86 L68 86 L60 97 L50 90 L40 97 L32 86 L19 86 L16 73 L4 67 L8 54 L1 43 L10 33 L9 20 L22 17 L27 5 L40 8 Z"],
    ["ribbon", "Banner", "M0 30 H18 V18 H82 V30 H100 L90 48 L100 66 H70 V58 H30 V66 H0 L10 48 Z"],
    ["tag", "Tag", "M4 34 L34 4 H92 C95 4 96 5 96 8 V66 L66 96 C64 98 61 98 59 96 L4 41 C2 39 2 36 4 34 Z M74 18 C70 18 68 21 68 24 C68 28 70 30 74 30 C78 30 80 28 80 24 C80 21 78 18 74 18 Z"],
    ["arrowr", "Arrow right", "M2 34 H58 V10 L98 50 L58 90 V66 H2 Z"],
    ["arrowc", "Curved arrow", "M10 86 C10 46 34 24 66 24 V6 L96 36 L66 66 V48 C44 48 28 60 26 86 Z"],
    ["chevron", "Chevron", "M10 4 H48 L88 50 L48 96 H10 L50 50 Z"],
    ["dblarrow", "Double arrow", "M2 50 L30 20 V38 H70 V20 L98 50 L70 80 V62 H30 V80 Z"],
    ["house", "House", "M50 4 L96 46 H82 V96 H60 V66 H40 V96 H18 V46 H4 Z"],
    ["pin", "Map pin", "M50 98 C50 98 14 58 14 36 C14 16 30 2 50 2 C70 2 86 16 86 36 C86 58 50 98 50 98 Z M50 22 C42 22 36 28 36 36 C36 44 42 50 50 50 C58 50 64 44 64 36 C64 28 58 22 50 22 Z"],
    ["bell", "Bell", "M50 4 C56 4 58 8 58 12 C74 16 82 30 82 48 V66 L94 82 H6 L18 66 V48 C18 30 26 16 42 12 C42 8 44 4 50 4 Z M38 88 H62 C62 94 57 98 50 98 C43 98 38 94 38 88 Z"],
    ["leaf", "Leaf", "M8 92 C8 40 40 6 94 6 C94 60 60 92 8 92 Z"],
    ["flower", "Flower", "M50 30 C54 12 74 10 74 26 C90 22 96 42 80 50 C96 58 90 78 74 74 C74 90 54 88 50 70 C46 88 26 90 26 74 C10 78 4 58 20 50 C4 42 10 22 26 26 C26 10 46 12 50 30 Z"],
    ["puzzle", "Puzzle piece", "M10 22 H36 C34 16 34 6 46 6 C58 6 58 16 56 22 H82 V46 C88 44 96 44 96 56 C96 68 88 68 82 66 V90 H58 C60 84 60 76 48 76 C36 76 36 84 38 90 H10 V66 C16 68 24 68 24 56 C24 44 16 44 10 46 Z"],
    ["frame", "Frame", "M0 0 H100 V100 H0 Z M12 12 V88 H88 V12 Z"]
  ];
  VG.USER = [];      // shapes the user defined: [id, name, unit comps]
  VG.libComps = function (id) {
    var u = VG.USER.filter(function (x) { return x[0] === id; })[0];
    if (u) return cloneComps(u[2]);
    var e = VG.LIB.filter(function (x) { return x[0] === id; })[0];
    if (!e) return null;
    var cs = VG.parseD(e[2]), b = VG.bounds(cs);
    return mapComps(cs, function (x, y) { return [(x - b.x) / b.w, (y - b.y) / b.h]; });
  };

  G.VG = VG;
  if (G.PE) G.PE.VG = VG;
})(typeof self !== "undefined" ? self : this);
