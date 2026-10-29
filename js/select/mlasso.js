/* Selection lane: Magnetic lasso. Click once, then move along an edge: the outline snaps to the strongest edges
   (shortest path over an edge-cost map, Dijkstra in a window around the pointer) and drops anchor points as it
   goes. Click to add an anchor, Backspace removes one, double-click / Enter / click the start point closes,
   Esc cancels. Shift adds, Alt subtracts, as with the other lassos. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx;
  SX.addIcons({ "t-mlasso": '<path d="M7 15.5c-3-1.7-3.6-5.6-.4-8.2 3.4-2.8 10-2.6 11.8.6 1.6 2.9-1.5 6.6-6.4 6.8-2.2.1-3.6-.4-5-1.2"/><path d="M7.4 14.6c-1.3 1.6-.8 3.7 1 4.2 1.4.4 2.3-.7 1.9-2"/><path d="M15 17.5v3M13.5 19h3" />' });
  var saved = (S3.store("pe-opts") || {}).mlasso;
  ED.o.mlasso = Object.assign({ width: 10, freq: 50 }, saved && typeof saved === "object" ? saved : {});
  var tools = ED.ui.TOOLS, pi = tools.map(function (t) { return t[0]; }).indexOf("polygon");
  tools.splice(pi + 1, 0, ["mlasso", "Magnetic lasso", "L"]);
  var WORK = 1400, ML = null;

  // ---------- edge costs and shortest paths ----------
  function costMap(img) {
    var w = img.width, h = img.height, d = img.data, g = new Float32Array(w * h), mx = 1e-6, x, y;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var best = 0;
      for (var c = 0; c < 3; c++) {
        var i = (y * w + x) * 4 + c, gx = (d[i + 4 - w * 4] + 2 * d[i + 4] + d[i + 4 + w * 4]) - (d[i - 4 - w * 4] + 2 * d[i - 4] + d[i - 4 + w * 4]), gy = (d[i + w * 4 - 4] + 2 * d[i + w * 4] + d[i + w * 4 + 4]) - (d[i - w * 4 - 4] + 2 * d[i - w * 4] + d[i - w * 4 + 4]);
        var m = gx * gx + gy * gy; if (m > best) best = m;
      }
      g[y * w + x] = Math.sqrt(best); if (g[y * w + x] > mx) mx = g[y * w + x];
    }
    var s = Float32Array.from(g).sort(), ref = Math.max(s[Math.floor(s.length * 0.97)], mx * 0.2), cost = new Float32Array(w * h);
    for (var p = 0; p < cost.length; p++) { var t = Math.min(1, g[p] / ref); cost[p] = 0.03 + (1 - t) * (1 - t); }
    return cost;
  }
  SX.edgeCost = costMap;
  // Cheapest 8-connected path from a to b inside a window (binary heap Dijkstra). Points are pixel indices.
  function livePath(cost, w, h, a, b, margin) {
    var ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
    var x0 = Math.max(0, Math.min(ax, bx) - margin), y0 = Math.max(0, Math.min(ay, by) - margin), x1 = Math.min(w - 1, Math.max(ax, bx) + margin), y1 = Math.min(h - 1, Math.max(ay, by) + margin);
    var W = x1 - x0 + 1, H = y1 - y0 + 1, n = W * H, dist = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    var heap = new Int32Array(n * 4 + 8), hk = new Float32Array(n * 4 + 8), hs = 0;
    function push(i, k) { var j = hs++; heap[j] = i; hk[j] = k; while (j > 0) { var pj = (j - 1) >> 1; if (hk[pj] <= hk[j]) break; var ti = heap[pj], tk = hk[pj]; heap[pj] = heap[j]; hk[pj] = hk[j]; heap[j] = ti; hk[j] = tk; j = pj; } }
    function pop() { var top = heap[0]; hs--; heap[0] = heap[hs]; hk[0] = hk[hs]; var j = 0; for (;;) { var l = 2 * j + 1, r = l + 1, m = j; if (l < hs && hk[l] < hk[m]) m = l; if (r < hs && hk[r] < hk[m]) m = r; if (m === j) break; var ti = heap[m], tk = hk[m]; heap[m] = heap[j]; hk[m] = hk[j]; heap[j] = ti; hk[j] = tk; j = m; } return top; }
    var s = (ay - y0) * W + (ax - x0), t = (by - y0) * W + (bx - x0);
    dist[s] = 0; push(s, 0);
    var DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], DL = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];
    while (hs) {
      var u = pop(); if (done[u]) continue; done[u] = 1; if (u === t) break;
      var ux = u % W, uy = (u - ux) / W;
      for (var k = 0; k < 8; k++) {
        var vx = ux + DX[k], vy = uy + DY[k]; if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
        var v = vy * W + vx; if (done[v]) continue;
        var nd = dist[u] + cost[(vy + y0) * w + vx + x0] * DL[k];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(v, nd); }
      }
    }
    var out = [];
    for (var q = t; q >= 0; q = prev[q]) { out.push((Math.floor(q / W) + y0) * w + (q % W) + x0); if (q === s) break; }
    return out.reverse();
  }
  SX.livePath = livePath;

  // ---------- tool ----------
  function start(p, e) {
    var d = ED.doc, k = Math.min(1, WORK / Math.max(d.w, d.h)), c = PE.flatten(d, { scale: k, bg: "#808080" }), img = PE.getData(c);
    ML = { k: k, w: c.width, h: c.height, cost: costMap({ data: img.data, width: c.width, height: c.height }), pts: [], live: [], mode: e.shiftKey && e.altKey ? "intersect" : e.shiftKey ? "add" : e.altKey ? "subtract" : ED.o.sel.mode, anchors: [] };
    var a = idx(p); ML.pts = [a]; ML.anchors = [0];
    ED.emit("tool"); ED.renderOvl();
  }
  function idx(p) { var x = PE.clamp(Math.round(p.x * ML.k), 0, ML.w - 1), y = PE.clamp(Math.round(p.y * ML.k), 0, ML.h - 1); return y * ML.w + x; }
  function docPt(i, m) { m = m || ML; var x = i % m.w, y = (i - x) / m.w; return { x: (x + 0.5) / m.k, y: (y + 0.5) / m.k }; }
  var raf = 0, hoverP = null;
  function hover(p) {
    if (!ML) return; hoverP = p;
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0; if (!ML || !hoverP) return;
      var o = ED.o.mlasso, last = ML.pts[ML.pts.length - 1], path = livePath(ML.cost, ML.w, ML.h, last, idx(hoverP), Math.max(4, Math.round(o.width * ML.k * 2)));
      var freq = Math.max(8, o.freq * ML.k);
      if (path.length > freq * 1.4) {       // fasten the settled part of the path
        var cut = Math.floor(path.length * 0.65);
        ML.pts = ML.pts.concat(path.slice(1, cut + 1)); ML.anchors.push(ML.pts.length - 1);
        path = path.slice(cut);
      }
      ML.live = path; ED.renderOvl();
    });
  }
  function anchor() { if (!ML || !ML.live.length) return; ML.pts = ML.pts.concat(ML.live.slice(1)); ML.anchors.push(ML.pts.length - 1); ML.live = []; ED.renderOvl(); }
  function close() {
    var m = ML; ML = null; ED.emit("tool"); ED.renderOvl();
    if (!m) return;
    var all = m.pts.concat(m.live.slice(1));
    if (all.length < 3) return;
    var pts = all.map(function (i) { return docPt(i, m); });
    ED.setSelection(ED.polyMask(pts), m.mode, "Magnetic lasso", ED.o.sel.feather);
  }
  SX.closeMagnetic = close;
  function cancel() { ML = null; ED.emit("tool"); ED.renderOvl(); }
  ED.TOOLS.mlasso = {
    down: function (p, e) {
      if (!ML) { start(p, e); return; }
      var first = docPt(ML.pts[0]);
      if (ML.pts.length > 3 && Math.hypot(p.x - first.x, p.y - first.y) * ED.zoom <= 9) { hover(first); ML.live = livePath(ML.cost, ML.w, ML.h, ML.pts[ML.pts.length - 1], ML.pts[0], 8); close(); return; }
      if (e.detail >= 2) { close(); return; }
      hoverP = p; ML.live = livePath(ML.cost, ML.w, ML.h, ML.pts[ML.pts.length - 1], idx(p), Math.max(4, Math.round(ED.o.mlasso.width * ML.k * 2))); anchor();
    },
    hover: hover
  };
  ED.on("overlay", function (o) {
    if (!ML || ED.tool !== "mlasso") return;
    o.docPath(o.c, function (c, px) {
      var p = new Path2D(), all = ML.pts.concat(ML.live.slice(1));
      all.forEach(function (i, n) { var q = docPt(i); if (n) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y); });
      c.lineWidth = px; c.setLineDash([4 * px, 4 * px]); c.strokeStyle = "#000"; c.stroke(p); c.strokeStyle = "#fff"; c.lineDashOffset = 4 * px; c.stroke(p); c.setLineDash([]);
      ML.anchors.forEach(function (ai) { var q = docPt(ML.pts[ai]); c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.lineWidth = px; c.fillRect(q.x - 2.5 * px, q.y - 2.5 * px, 5 * px, 5 * px); c.strokeRect(q.x - 2.5 * px, q.y - 2.5 * px, 5 * px, 5 * px); });
    });
  });
  ED.on("tool", function () { if (ML && ED.tool !== "mlasso") cancel(); });
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (ML && ED.tool === "mlasso") {
      if (e.key === "Enter") { e.preventDefault(); close(); return true; }
      if (e.key === "Escape") { e.preventDefault(); cancel(); return true; }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (ML.anchors.length > 1) { ML.anchors.pop(); ML.pts = ML.pts.slice(0, ML.anchors[ML.anchors.length - 1] + 1); ML.live = []; ED.renderOvl(); } else cancel();
        return true;
      }
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "l" || e.key === "L") && ED.doc) {
      var cyc = ["lasso", "polygon", "mlasso"], i = cyc.indexOf(ED.tool); e.preventDefault(); ED.setTool(cyc[(i + 1) % cyc.length]); return true;
    }
    return false;
  });
  (ED.ui.optsTail = ED.ui.optsTail || []).unshift(function (t, items) {
    if (t !== "mlasso") return;
    var w = ED.ui.w, o = ED.o.mlasso;
    items.push(w.seg("", [["new", "New", "New selection", "t-snew"], ["add", "Add", "Add (Shift)", "t-sadd"], ["subtract", "Subtract", "Subtract (Alt)", "t-ssub"], ["intersect", "Intersect", "Intersect (Shift+Alt)", "t-sint"]], ED.o.sel.mode, function (v) { ED.o.sel.mode = v; ED.saveOpts(); }));
    items.push(w.range("Width", o.width, 1, 64, 1, function (v) { o.width = v; ED.saveOpts(); }, w.px));
    items.push(w.range("Anchor every", o.freq, 10, 200, 1, function (v) { o.freq = v; ED.saveOpts(); }, w.px));
    items.push(S3.h("span", { "class": "pe-hint", text: ML ? "Move along the edge. Click adds a point, Backspace removes one, double-click or Enter closes, Esc cancels." : "Click on an edge to start, then move along it." }));
  });
  (ED.ui.optsTail = ED.ui.optsTail || []).push(function (t, items) {
    if (t !== "mlasso") return;
    items.push(ED.ui.w.btn("Select subject", function () { SX.selectSubject(ED.o.sel.mode); }, "ghost", null, "Select the main subject with on-device AI"));
    items.push(ED.ui.w.btn("Refine…", function () { SX.openRefine(); }, "ghost", null, "Refine the selection's edge (Ctrl+Alt+R)"));
  });

  SX.tests.push(async function (ok) {
    // a dark square on light ground: the cheapest path between two points on its edge follows the edge
    var W = 60, img = { data: new Uint8ClampedArray(W * W * 4), width: W, height: W };
    for (var y = 0; y < W; y++) for (var x = 0; x < W; x++) { var i = (y * W + x) * 4, v = x >= 15 && x < 45 && y >= 15 && y < 45 ? 30 : 220; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    var cost = costMap(img), path = livePath(cost, W, W, 15 * W + 20, 15 * W + 40, 20);
    var onEdge = path.filter(function (q) { var yy = Math.floor(q / W); return yy >= 13 && yy <= 16; }).length;
    ok(path.length >= 20 && onEdge === path.length, "live path snaps to the edge");
    var diag = livePath(cost, W, W, 15 * W + 15, 44 * W + 44, 40), side = diag.filter(function (q) { var xx = q % W, yy = Math.floor(q / W); return Math.min(Math.abs(xx - 15), Math.abs(xx - 44), Math.abs(yy - 15), Math.abs(yy - 44)) <= 2; }).length;
    ok(side / diag.length > 0.9, "corner to corner goes round the edge, not across");
  });
})();
