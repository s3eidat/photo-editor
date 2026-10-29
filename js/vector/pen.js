/* Vector lane: pen tools and path selection.
   Pen (click = corner, drag = smooth curve, click the first anchor to close, Alt on the last anchor = cusp),
   curvature pen (the curve flows through every click; double-click toggles corner), freeform pen (draw, then curves
   are fitted), add / delete / convert anchor point, path selection (whole components: select, move, Alt-drag copy,
   delete, combine mode) and direct selection (anchors, handles and curve segments, marquee, nudge).
   Paths go into a new or the current shape layer ("Shape" mode) or into the document's work / saved path ("Path" mode). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, UI = VX.ui, h = S3.h;
  var PO = ED.o.pen = Object.assign({ mode: "shape", op: "new", auto: true, rubber: true, fit: 2 }, ((S3.store("pe-opts") || {}).pen) || {});
  var OPS = [["new", "New layer", "New shape layer", "v-new"], ["add", "Combine", "Combine shapes (unite)", "v-unite"], ["sub", "Subtract", "Subtract front shape", "v-sub"], ["int", "Intersect", "Intersect shape areas", "v-int"], ["xor", "Exclude", "Exclude overlapping areas", "v-xor"]];
  VX.OPS = OPS;

  // ---------- targets: a shape layer or one of the document's paths ----------
  function layerTg(L) {
    return { kind: "layer", key: "L:" + L.id, L: L, get: function () { return VX.docComps(L); }, put: function (cs) { VX.setDocComps(L, cs); }, name: L.name };
  }
  function pathTg(p) {
    return { kind: "path", key: "P:" + p.id, p: p, get: function () { return VG.clone(p.comps); }, put: function (cs) { p.comps = cs; }, name: p.name };
  }
  VX.layerTg = layerTg; VX.pathTg = pathTg;
  function curTarget() {
    var d = ED.doc; if (!d) return null;
    if (d.apath) { var p = VX.findPath(d, d.apath); if (p) return pathTg(p); d.apath = null; }
    var L = ED.layer();
    return L && L.kind === "shape" && L.visible ? layerTg(L) : null;
  }
  VX.target = curTarget;
  function okLayer(tg) { return tg.kind !== "layer" || ED.editable(tg.L); }
  // One undoable step around a change to the target (layer snapshot or paths state).
  function begin(kind) {
    if (kind === "path") return VX.pathBegin();
    var before = PE.snap(ED.doc);
    return { commit: function (label) { ED.push(PE.metaEntry(label, ED.doc, before)); }, cancel: function () { PE.restore(ED.doc, before); ED.changed(); } };
  }
  function once(tg, label, fn) {
    var s = begin(tg.kind), cs = tg.get(), r = fn(cs);
    tg.put(r || cs); s.commit(label); refresh();
  }
  VX.editTarget = once;
  function refresh() { ED.render(); ED.renderOvl(); }

  // ---------- hit testing (document units; tolerance from the zoom) ----------
  function tol() { return 7 / ED.zoom; }
  function dist(a, x, y) { return Math.hypot(a[0] - x, a[1] - y); }
  function hitAnchor(cs, p, t) {
    var best = null, bd = t;
    cs.forEach(function (c, ci) { c.pts.forEach(function (q, pi) { var d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d <= bd) { bd = d; best = { ci: ci, pi: pi }; } }); });
    return best;
  }
  function visibleHandles(cs) {      // handles drawn (and draggable): selected anchors and the ends of the segments next to them
    var out = [], sel = selFor(curKey());
    cs.forEach(function (c, ci) {
      var n = c.pts.length;
      c.pts.forEach(function (q, pi) {
        var on = sel[ci + ":" + pi] || sel[ci + ":" + ((pi + 1) % n)] && (pi + 1 < n || c.closed) || sel[ci + ":" + ((pi - 1 + n) % n)] && (pi > 0 || c.closed);
        if (!on) return;
        if (q[2] !== q[0] || q[3] !== q[1]) out.push({ ci: ci, pi: pi, w: "in", x: q[2], y: q[3] });
        if (q[4] !== q[0] || q[5] !== q[1]) out.push({ ci: ci, pi: pi, w: "out", x: q[4], y: q[5] });
      });
    });
    if (VX.pen && VX.pen.key === curKey()) {      // while drawing, the last anchor's handles too
      var c2 = cs[VX.pen.ci]; if (c2 && c2.pts.length) { var li = c2.pts.length - 1, l = c2.pts[li]; if (l[4] !== l[0] || l[5] !== l[1]) out.push({ ci: VX.pen.ci, pi: li, w: "out", x: l[4], y: l[5] }); if (l[2] !== l[0] || l[3] !== l[1]) out.push({ ci: VX.pen.ci, pi: li, w: "in", x: l[2], y: l[3] }); }
    }
    return out;
  }
  function hitHandle(cs, p, t) { var best = null, bd = t; visibleHandles(cs).forEach(function (q) { var d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= bd) { bd = d; best = q; } }); return best; }
  function hitSeg(cs, p, t) { var n = VG.nearestSeg(cs, p.x, p.y); return n && n.d <= t ? n : null; }
  function hitComp(cs, p, t) {
    for (var ci = cs.length - 1; ci >= 0; ci--) {
      var c = cs[ci], r = VG.flatComp(c, 0.5 / ED.zoom);
      if (c.pts.length > 2 && VG.winding([r], p.x, p.y) !== 0) return ci;
      if (hitSeg([c], p, t)) return ci;
    }
    return -1;
  }
  // the topmost visible shape layer whose outline or fill is under p
  function shapeLayerAt(p) {
    var d = ED.doc;
    for (var i = d.layers.length - 1; i >= 0; i--) {
      var L = d.layers[i]; if (L.kind !== "shape" || !L.visible) continue;
      if (hitComp(VX.docComps(L), p, tol()) >= 0) return L;
    }
    return null;
  }

  // ---------- selection state ----------
  var SEL = { key: null, pts: {}, comps: {} };
  VX.vsel = SEL;
  function curKey() { var t = curTarget(); return t ? t.key : null; }
  function selFor(key) { if (SEL.key !== key) { SEL.key = key; SEL.pts = {}; SEL.comps = {}; } return SEL.pts; }
  function compsFor(key) { selFor(key); return SEL.comps; }
  function clearSel() { SEL.pts = {}; SEL.comps = {}; }
  VX.clearPathSel = clearSel;
  function selectedAnchors(cs) { var s = selFor(curKey()), out = []; Object.keys(s).forEach(function (k) { var a = k.split(":"), ci = +a[0], pi = +a[1]; if (cs[ci] && cs[ci].pts[pi]) out.push([ci, pi]); }); return out; }

  // ---------- anchor edits ----------
  function constrain(a, p, e) {
    if (!e || !e.shiftKey || !a) return p;
    var dx = p.x - a.x, dy = p.y - a.y, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(dx, dy) * Math.cos(Math.atan2(dy, dx) - ang);
    return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
  }
  function setOut(q, x, y, mirror) {
    q[4] = x; q[5] = y;
    if (mirror) { q[2] = 2 * q[0] - x; q[3] = 2 * q[1] - y; q[6] = 1; }
  }
  // move one handle; a smooth anchor turns its other handle to stay opposite (keeping that handle's length) unless broken
  function moveHandle(q, w, x, y, brk) {
    var i = w === "in" ? 2 : 4, o = w === "in" ? 4 : 2;
    q[i] = x; q[i + 1] = y;
    if (brk) { q[6] = 0; return; }
    if (q[6]) {
      var lo = Math.hypot(q[o] - q[0], q[o + 1] - q[1]), dx = q[0] - x, dy = q[1] - y, l = Math.hypot(dx, dy);
      if (l > 1e-9 && lo > 1e-9) { q[o] = q[0] + dx / l * lo; q[o + 1] = q[1] + dy / l * lo; }
    }
  }
  function moveAnchor(q, dx, dy) { q[0] += dx; q[1] += dy; q[2] += dx; q[3] += dy; q[4] += dx; q[5] += dy; }
  function removeAnchor(cs, ci, pi) {
    var c = cs[ci]; c.pts.splice(pi, 1);
    if (c.pts.length < 2) cs.splice(ci, 1);
    else if (c.pts.length < 3 && c.closed) c.closed = false;
    return cs;
  }
  // curvature-pen anchors (flag 2) get handles so the curve flows through their neighbours
  function autoSmooth(c) {
    var n = c.pts.length;
    c.pts.forEach(function (q, i) {
      if (q[6] !== 2) return;
      var pv = i > 0 ? c.pts[i - 1] : c.closed ? c.pts[n - 1] : null, nx = i < n - 1 ? c.pts[i + 1] : c.closed ? c.pts[0] : null;
      if (!pv && !nx) { q[2] = q[4] = q[0]; q[3] = q[5] = q[1]; return; }
      var tx = (nx ? nx[0] : q[0]) - (pv ? pv[0] : q[0]), ty = (nx ? nx[1] : q[1]) - (pv ? pv[1] : q[1]), tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      var li = pv ? Math.hypot(q[0] - pv[0], q[1] - pv[1]) / 3 : 0, lo = nx ? Math.hypot(nx[0] - q[0], nx[1] - q[1]) / 3 : 0;
      q[2] = q[0] - tx * li; q[3] = q[1] - ty * li; q[4] = q[0] + tx * lo; q[5] = q[1] + ty * lo;
    });
    return c;
  }
  VX.autoSmooth = autoSmooth;
  // reshape a curve so the point at t follows the pointer (straight segments move both anchors)
  function dragSegment(c0, c, si, t, dx, dy) {
    var n = c.pts.length, a = c.pts[si], b = c.pts[(si + 1) % n], a0 = c0.pts[si], b0 = c0.pts[(si + 1) % n];
    if (VG.isLine(a0, b0)) { [[a, a0], [b, b0]].forEach(function (z) { for (var k = 0; k < 6; k++) z[0][k] = z[1][k] + (k % 2 ? dy : dx); }); return; }
    t = PE.clamp(t, 0.02, 0.98);
    var w = t <= 1 / 6 ? 0 : t <= 0.5 ? Math.pow((6 * t - 1) / 2, 3) / 2 : t <= 5 / 6 ? (1 - Math.pow((6 * (1 - t) - 1) / 2, 3)) / 2 + 0.5 : 1;
    var k0 = (1 - w) / (3 * t * (1 - t) * (1 - t)), k1 = w / (3 * t * t * (1 - t));
    a[4] = a0[4] + dx * k0; a[5] = a0[5] + dy * k0; b[2] = b0[2] + dx * k1; b[3] = b0[3] + dy * k1;
    [[a, 4, 2], [b, 2, 4]].forEach(function (z) {      // smooth anchors keep their other handle in line
      var q = z[0]; if (!q[6]) return;
      var i = z[1], o = z[2], lo = Math.hypot(q[o] - q[0], q[o + 1] - q[1]), ddx = q[0] - q[i], ddy = q[1] - q[i + 1], l = Math.hypot(ddx, ddy);
      if (l > 1e-9) { q[o] = q[0] + ddx / l * lo; q[o + 1] = q[1] + ddy / l * lo; }
    });
  }

  // ---------- starting a new component (pen, curvature pen, freeform pen) ----------
  function shapeStyle() {
    var o = ED.o.shape, s = { type: "path", x: 0, y: 0, w: 1, h: 1, fill: o.noFill ? "" : PE.hex(o.fill, ED.doc.fg), stroke: PE.hex(o.stroke, "#111111"), sw: o.sw || 0, comps: [] };
    var d = VX.DASHES[o.dash]; if (d) s.dash = d.slice();
    if (o.align && o.align !== "center") s.align = o.align;
    return s;
  }
  // returns { tg, sess, ci } with the component already in the target (not yet committed)
  function newComp(c) {
    var d = ED.doc, op = PO.op === "new" ? "add" : PO.op, sess, tg;
    c.op = op;
    if (PO.mode === "path") {
      sess = begin("path");
      var p = d.apath && VX.findPath(d, d.apath);
      if (!p) { if (!d.work) d.work = { id: "work", name: "Work path", comps: [] }; else d.work.comps = []; p = d.work; d.apath = "work"; c.op = "add"; }
      tg = pathTg(p);
    } else {
      var L = ED.layer(), add = PO.op !== "new" && L && L.kind === "shape" && L.visible && !L.locked;
      sess = begin("layer");
      d.apath = null;
      if (!add) {
        var n = d.layers.filter(function (x) { return /^Shape \d+$/.test(x.name); }).length + 1;
        L = PE.newLayer("shape", { name: "Shape " + n, shape: shapeStyle() });
        var i = d.layers.indexOf(ED.layer()); d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, L); d.active = L.id; ED.maskEdit = false;
        c.op = "add"; L.shape.comps = [];
        tg = layerTg(L); tg.put([]);
        L.shape.type = "path";
        ED.emit("layers");
      } else tg = layerTg(L);
    }
    var cs = tg.kind === "layer" && !tg.L.shape.comps.length && tg.L.shape.type === "path" ? [] : tg.get();
    cs.push(c); tg.put(cs);
    return { tg: tg, sess: sess, ci: cs.length - 1 };
  }

  // ---------- pen ----------
  VX.pen = null;      // { key, ci, cpen } while a component is being drawn
  function drawing(tg, cs) {
    var st = VX.pen;
    if (!st || !tg || st.key !== tg.key || !cs[st.ci] || cs[st.ci].closed) { VX.pen = null; return null; }
    return st;
  }
  function finishPen() { if (VX.pen) { VX.pen = null; refresh(); ED.emit("tool"); } }
  VX.finishPen = finishPen;
  function penDown(p, e) {
    if (e.ctrlKey || e.metaKey) { dsDown(p, e, true); return; }
    var tg = curTarget(), cs = tg ? tg.get() : null, t = tol(), st = drawing(tg, cs);
    if (tg && !okLayer(tg)) return;
    if (st) {
      var c = cs[st.ci], first = c.pts[0], last = c.pts[c.pts.length - 1], sess;
      if (c.pts.length >= 2 && dist(first, p.x, p.y) <= t) {      // close
        sess = begin(tg.kind); c.closed = true; tg.put(cs); VX.pen = null;
        ED.drag = { kind: "vec", vec: "close", tg: tg, sess: sess, cs: cs, ci: st.ci, p0: p, label: "Close path", cancel: sess.cancel };
        refresh(); return;
      }
      if (e.altKey && dist(last, p.x, p.y) <= t) { once(tg, "Convert point", function (cs2) { var q = cs2[st.ci].pts[cs2[st.ci].pts.length - 1]; q[4] = q[0]; q[5] = q[1]; q[6] = 0; }); return; }
      var q0 = constrain({ x: last[0], y: last[1] }, p, e);
      sess = begin(tg.kind); c.pts.push(VG.P(q0.x, q0.y)); tg.put(cs);
      ED.drag = { kind: "vec", vec: "handle", tg: tg, sess: sess, cs: cs, ci: st.ci, pi: c.pts.length - 1, p0: q0, label: "Add anchor point", cancel: sess.cancel };
      refresh(); return;
    }
    if (tg && okLayer(tg)) {
      var ha = hitAnchor(cs, p, t);
      if (ha) {
        var hc = cs[ha.ci];
        if (e.altKey) { cvtDown(p, e); return; }
        if (!hc.closed && (ha.pi === 0 || ha.pi === hc.pts.length - 1)) {      // continue an open end
          if (ha.pi === 0 && hc.pts.length > 1) once(tg, "Continue path", function (cs2) { reverse(cs2[ha.ci]); });
          VX.pen = { key: tg.key, ci: ha.ci }; refresh(); ED.emit("tool"); return;
        }
        if (PO.auto) { once(tg, "Delete anchor point", function (cs2) { return removeAnchor(cs2, ha.ci, ha.pi); }); afterDelete(tg); return; }
      }
      var hs = PO.auto ? hitSeg(cs, p, t) : null;
      if (hs) { once(tg, "Add anchor point", function (cs2) { cs2[hs.ci] = VG.splitAt(cs2[hs.ci], hs.si, hs.t); }); selectOnly(tg.key, hs.ci, hs.si + 1); return; }
    }
    var r = newComp(VG.comp([VG.P(p.x, p.y)], false));
    VX.pen = { key: r.tg.key, ci: r.ci };
    ED.drag = { kind: "vec", vec: "handle", tg: r.tg, sess: r.sess, cs: r.tg.get(), ci: r.ci, pi: 0, p0: p, label: PO.mode === "path" ? "New path" : "New shape", cancel: function () { r.sess.cancel(); VX.pen = null; } };
    ED.emit("tool"); refresh();
  }
  function reverse(c) { c.pts.reverse(); c.pts.forEach(function (q) { var a = q[2], b = q[3]; q[2] = q[4]; q[3] = q[5]; q[4] = a; q[5] = b; }); }
  function afterDelete(tg) {      // an empty shape layer goes away; an empty path stays empty
    if (tg.kind === "layer" && !(tg.L.shape.comps || []).length) {
      var d = ED.doc; ED.meta("Delete layer", function () { var i = d.layers.indexOf(tg.L); if (i >= 0) d.layers.splice(i, 1); d.active = d.layers.length ? d.layers[Math.max(0, i - 1)].id : null; });
      ED.emit("layers");
    }
  }
  function selectOnly(key, ci, pi) { selFor(key); SEL.pts = {}; SEL.pts[ci + ":" + pi] = true; }
  function vecMove(p, e) {
    var dr = ED.drag; if (!dr || dr.kind !== "vec") return;
    var cs = dr.cs, c = cs && cs[dr.ci];
    if (dr.vec === "handle" || dr.vec === "close") {
      var q = dr.vec === "close" ? c.pts[0] : c.pts[dr.pi];
      if (Math.hypot(p.x - dr.p0.x, p.y - dr.p0.y) * ED.zoom < 2 && !dr.moved) return;
      dr.moved = true;
      var hp = constrain({ x: q[0], y: q[1] }, p, e);
      if (dr.vec === "close") { q[2] = 2 * q[0] - hp.x; q[3] = 2 * q[1] - hp.y; if (!e.altKey) { q[4] = hp.x; q[5] = hp.y; } q[6] = e.altKey ? 0 : 1; }
      else if (e.altKey) { q[4] = hp.x; q[5] = hp.y; q[6] = 0; }
      else setOut(q, hp.x, hp.y, true);
      dr.tg.put(cs); refresh(); return;
    }
    if (dr.vec === "anchors") {
      var d = constrain({ x: 0, y: 0 }, { x: p.x - dr.p0.x, y: p.y - dr.p0.y }, e), base = dr.c0;
      dr.list.forEach(function (z) { var q2 = cs[z[0]].pts[z[1]], b = base[z[0]].pts[z[1]]; for (var k = 0; k < 6; k++) q2[k] = b[k] + (k % 2 ? d.y : d.x); });
      if (dr.cpen) cs.forEach(autoSmooth);
      dr.moved = dr.moved || Math.abs(d.x) + Math.abs(d.y) > 0;
      dr.tg.put(cs); refresh(); return;
    }
    if (dr.vec === "hdl") {
      var q3 = cs[dr.ci].pts[dr.pi], hp2 = constrain({ x: q3[0], y: q3[1] }, p, e);
      moveHandle(q3, dr.w, hp2.x, hp2.y, e.altKey || dr.brk);
      dr.moved = true; dr.tg.put(cs); refresh(); return;
    }
    if (dr.vec === "seg") {
      var dd = { x: p.x - dr.p0.x, y: p.y - dr.p0.y };
      dragSegment(dr.c0[dr.ci], cs[dr.ci], dr.si, dr.t, dd.x, dd.y);
      dr.moved = true; dr.tg.put(cs); refresh(); return;
    }
    if (dr.vec === "comps") {
      var d2 = constrain({ x: 0, y: 0 }, { x: p.x - dr.p0.x, y: p.y - dr.p0.y }, e);
      dr.list.forEach(function (ci) { cs[ci].pts.forEach(function (q4, pi) { var b2 = dr.c0[ci].pts[pi]; for (var k = 0; k < 6; k++) q4[k] = b2[k] + (k % 2 ? d2.y : d2.x); }); });
      dr.moved = dr.moved || Math.abs(d2.x) + Math.abs(d2.y) > 0;
      dr.tg.put(cs); refresh(); return;
    }
    if (dr.vec === "pull") {      // convert point: drag out symmetric handles
      var q5 = cs[dr.ci].pts[dr.pi], hp3 = constrain({ x: q5[0], y: q5[1] }, p, e);
      if (Math.hypot(hp3.x - q5[0], hp3.y - q5[1]) * ED.zoom < 2 && !dr.moved) return;
      dr.moved = true; setOut(q5, hp3.x, hp3.y, true); dr.tg.put(cs); refresh(); return;
    }
    if (dr.vec === "marquee" || dr.vec === "ff") { if (dr.vec === "ff") { var lp = dr.pts[dr.pts.length - 1]; if (Math.hypot(p.x - lp.x, p.y - lp.y) * ED.zoom >= 1.5) dr.pts.push(p); } else dr.b = p; ED.renderOvl(); }
  }
  function vecUp(p, e) {
    var dr = ED.drag; ED.drag = null; if (!dr || dr.kind !== "vec") return;
    if (dr.vec === "marquee") {
      if (!dr.b) { refresh(); return; }
      var x0 = Math.min(dr.a.x, dr.b.x), x1 = Math.max(dr.a.x, dr.b.x), y0 = Math.min(dr.a.y, dr.b.y), y1 = Math.max(dr.a.y, dr.b.y), tg = curTarget();
      if (tg) { var cs = tg.get(), s = selFor(tg.key); cs.forEach(function (c, ci) { c.pts.forEach(function (q, pi) { if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) { if (dr.psel) SEL.comps[ci] = true; else s[ci + ":" + pi] = true; } }); }); }
      refresh(); return;
    }
    if (dr.vec === "ff") { ffUp(dr, e); return; }
    if (dr.vec === "pull" && !dr.moved) {      // a click with convert point: smooth <-> corner
      var cs2 = dr.cs, q = cs2[dr.ci].pts[dr.pi];
      if (q[2] !== q[0] || q[3] !== q[1] || q[4] !== q[0] || q[5] !== q[1]) { q[2] = q[4] = q[0]; q[3] = q[5] = q[1]; q[6] = 0; }
      else { q[6] = 2; autoSmooth(cs2[dr.ci]); q[6] = 1; }
      dr.tg.put(cs2);
    }
    if ((dr.vec === "anchors" || dr.vec === "comps" || dr.vec === "hdl" || dr.vec === "seg") && !dr.moved && !dr.dup) { refresh(); ED.emit("tool"); return; }      // a click: selection only
    dr.sess.commit(dr.label); refresh(); ED.emit("tool");
  }

  // ---------- curvature pen ----------
  function cpenDown(p, e) {
    if (e.ctrlKey || e.metaKey) { dsDown(p, e, true); return; }
    var tg = curTarget(), cs = tg ? tg.get() : null, t = tol(), st = drawing(tg, cs), sess;
    if (tg && !okLayer(tg)) return;
    if (tg) {
      var ha = hitAnchor(cs, p, t);
      if (ha && !(st && st.ci === ha.ci && ha.pi === 0 && cs[ha.ci].pts.length >= 2)) {
        if (e.detail >= 2 || e.altKey) { once(tg, "Convert point", function (cs2) { var q = cs2[ha.ci].pts[ha.pi]; q[6] = q[6] === 2 ? 0 : 2; if (!q[6]) { q[2] = q[4] = q[0]; q[3] = q[5] = q[1]; } autoSmooth(cs2[ha.ci]); }); return; }
        selectOnly(tg.key, ha.ci, ha.pi);
        sess = begin(tg.kind);
        ED.drag = { kind: "vec", vec: "anchors", tg: tg, sess: sess, cs: cs, c0: VG.clone(cs), list: [[ha.ci, ha.pi]], p0: p, cpen: true, label: "Move anchor point", cancel: sess.cancel };
        return;
      }
      if (!st) { var hs = hitSeg(cs, p, t); if (hs) { once(tg, "Add anchor point", function (cs2) { var c = VG.splitAt(cs2[hs.ci], hs.si, hs.t); c.pts[hs.si + 1][6] = 2; cs2[hs.ci] = autoSmooth(c); }); return; } }
    }
    if (st) {
      var c = cs[st.ci], first = c.pts[0];
      sess = begin(tg.kind);
      if (c.pts.length >= 2 && dist(first, p.x, p.y) <= t) { c.closed = true; autoSmooth(c); tg.put(cs); VX.pen = null; sess.commit("Close path"); refresh(); ED.emit("tool"); return; }
      c.pts.push(VG.Pc(p.x, p.y, p.x, p.y, p.x, p.y, 2)); autoSmooth(c); tg.put(cs);
      ED.drag = { kind: "vec", vec: "anchors", tg: tg, sess: sess, cs: cs, c0: VG.clone(cs), list: [[st.ci, c.pts.length - 1]], p0: p, cpen: true, label: "Add anchor point", cancel: sess.cancel, dup: true };
      refresh(); return;
    }
    var r = newComp(VG.comp([VG.Pc(p.x, p.y, p.x, p.y, p.x, p.y, 2)], false));
    VX.pen = { key: r.tg.key, ci: r.ci, cpen: true };
    r.sess.commit(PO.mode === "path" ? "New path" : "New shape");
    ED.emit("tool"); refresh();
  }

  // ---------- freeform pen ----------
  function ffDown(p, e) {
    if (e.ctrlKey || e.metaKey) { dsDown(p, e, true); return; }
    ED.drag = { kind: "vec", vec: "ff", pts: [p] };
  }
  function ffUp(dr) {
    if (dr.pts.length < 3) { refresh(); return; }
    var pts = dr.pts, closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) * ED.zoom <= 10 && pts.length > 6;
    var anchors = VG.fit(pts, Math.max(0.5, PO.fit) / ED.zoom, closed);
    if (anchors.length < 2) { refresh(); return; }
    var r = newComp(VG.comp(anchors, closed));
    r.sess.commit("Freeform path"); refresh(); ED.emit("layers");
  }

  // ---------- add / delete / convert anchor ----------
  function addDown(p, e) {
    var tg = curTarget(); if (!tg || !okLayer(tg)) { dsDown(p, e); return; }
    var cs = tg.get(), hs = hitSeg(cs, p, tol());
    if (hs) { once(tg, "Add anchor point", function (cs2) { cs2[hs.ci] = VG.splitAt(cs2[hs.ci], hs.si, hs.t); }); selectOnly(tg.key, hs.ci, hs.si + 1); var s2 = begin(tg.kind), cs3 = tg.get(); ED.drag = { kind: "vec", vec: "anchors", tg: tg, sess: s2, cs: cs3, c0: VG.clone(cs3), list: [[hs.ci, hs.si + 1]], p0: p, label: "Move anchor point", cancel: s2.cancel }; return; }
    dsDown(p, e);
  }
  function delDown(p, e) {
    var tg = curTarget(); if (!tg || !okLayer(tg)) return;
    var cs = tg.get(), ha = hitAnchor(cs, p, tol());
    if (ha) { once(tg, "Delete anchor point", function (cs2) { return removeAnchor(cs2, ha.ci, ha.pi); }); clearSel(); afterDelete(tg); return; }
    dsDown(p, e);
  }
  function cvtDown(p, e) {
    var tg = curTarget(); if (!tg || !okLayer(tg)) return;
    var cs = tg.get(), t = tol(), hh = hitHandle(cs, p, t), sess;
    if (hh) { sess = begin(tg.kind); ED.drag = { kind: "vec", vec: "hdl", brk: true, tg: tg, sess: sess, cs: cs, ci: hh.ci, pi: hh.pi, w: hh.w, label: "Convert point", cancel: sess.cancel }; return; }
    var ha = hitAnchor(cs, p, t);
    if (ha) { selectOnly(tg.key, ha.ci, ha.pi); sess = begin(tg.kind); ED.drag = { kind: "vec", vec: "pull", tg: tg, sess: sess, cs: cs, ci: ha.ci, pi: ha.pi, p0: p, label: "Convert point", cancel: sess.cancel }; refresh(); return; }
    dsDown(p, e);
  }

  // ---------- direct selection ----------
  function pickTarget(p) {      // clicking another shape layer's outline makes it the target
    var L = shapeLayerAt(p);
    if (L && (curKey() !== "L:" + L.id)) { ED.doc.apath = null; ED.setActive(L.id); ED.emit("paths"); }
    return curTarget();
  }
  function dsDown(p, e, temp) {
    var tg = curTarget(), t = tol(), cs = tg ? tg.get() : null;
    var onTg = tg && (hitHandle(cs, p, t) || hitAnchor(cs, p, t) || hitSeg(cs, p, t));
    if (!onTg) { tg = pickTarget(p) || tg; cs = tg ? tg.get() : null; }
    if (!tg) { ED.drag = { kind: "vec", vec: "marquee", a: p, b: null }; return; }
    if (!okLayer(tg)) return;
    var s = selFor(tg.key), sess, hh = hitHandle(cs, p, t);
    if (hh) { sess = begin(tg.kind); ED.drag = { kind: "vec", vec: "hdl", tg: tg, sess: sess, cs: cs, ci: hh.ci, pi: hh.pi, w: hh.w, label: "Move handle", cancel: sess.cancel }; return; }
    var ha = hitAnchor(cs, p, t);
    if (ha) {
      var k = ha.ci + ":" + ha.pi;
      if (e.shiftKey) { if (s[k]) delete s[k]; else s[k] = true; }
      else if (!s[k]) { SEL.pts = {}; SEL.pts[k] = true; s = SEL.pts; }
      sess = begin(tg.kind);
      ED.drag = { kind: "vec", vec: "anchors", tg: tg, sess: sess, cs: cs, c0: VG.clone(cs), list: selectedAnchors(cs), p0: p, label: "Move anchor point", cancel: sess.cancel };
      refresh(); return;
    }
    var hs = hitSeg(cs, p, t);
    if (hs) {
      var n = cs[hs.ci].pts.length, k1 = hs.ci + ":" + hs.si, k2 = hs.ci + ":" + ((hs.si + 1) % n);
      if (!e.shiftKey) { SEL.pts = {}; } SEL.pts[k1] = SEL.pts[k2] = true;
      sess = begin(tg.kind);
      if (e.altKey) {      // Alt on a segment: select and drag the whole component
        SEL.comps = {}; SEL.comps[hs.ci] = true;
        ED.drag = { kind: "vec", vec: "comps", tg: tg, sess: sess, cs: cs, c0: VG.clone(cs), list: [hs.ci], p0: p, label: "Move path", cancel: sess.cancel };
      } else ED.drag = { kind: "vec", vec: "seg", tg: tg, sess: sess, cs: cs, c0: VG.clone(cs), ci: hs.ci, si: hs.si, t: hs.t, p0: p, label: "Reshape segment", cancel: sess.cancel };
      refresh(); return;
    }
    if (!e.shiftKey) SEL.pts = {};
    ED.drag = { kind: "vec", vec: "marquee", a: p, b: null };
    void temp; refresh();
  }

  // ---------- path selection ----------
  function psDown(p, e) {
    var tg = curTarget(), t = tol(), cs = tg ? tg.get() : null, ci = tg ? hitComp(cs, p, t) : -1;
    if (ci < 0) { tg = pickTarget(p); cs = tg ? tg.get() : null; ci = tg ? hitComp(cs, p, t) : -1; }
    if (!tg || ci < 0) { if (!e.shiftKey) clearSel(); ED.drag = { kind: "vec", vec: "marquee", a: p, b: null, psel: true }; refresh(); ED.emit("tool"); return; }
    if (!okLayer(tg)) return;
    var sc = compsFor(tg.key);
    if (e.shiftKey) { if (sc[ci]) delete sc[ci]; else sc[ci] = true; }
    else if (!sc[ci]) { SEL.comps = {}; SEL.comps[ci] = true; sc = SEL.comps; }
    var list = Object.keys(SEL.comps).map(Number).filter(function (i) { return cs[i]; }), sess = begin(tg.kind), label = "Move path";
    if (e.altKey) {      // Alt-drag copies the selected components
      var copies = list.map(function (i) { return VG.clone([cs[i]])[0]; });
      SEL.comps = {}; copies.forEach(function (c) { cs.push(c); SEL.comps[cs.length - 1] = true; });
      list = Object.keys(SEL.comps).map(Number); tg.put(cs); label = "Duplicate path";
    }
    ED.drag = { kind: "vec", vec: "comps", tg: tg, sess: sess, cs: cs, c0: VG.clone(cs), list: list, p0: p, label: label, cancel: sess.cancel, dup: e.altKey };
    refresh(); ED.emit("tool");
  }
  // operations on the selected components (options bar)
  VX.setCompOp = function (op) {
    var tg = curTarget(); if (!tg || !okLayer(tg)) return;
    var list = Object.keys(compsFor(tg.key)).map(Number);
    once(tg, "Path operation", function (cs) { (list.length ? list : cs.map(function (c, i) { return i; }).slice(1)).forEach(function (i) { if (cs[i]) cs[i].op = op; }); });
  };
  VX.mergeComps = function () {
    var tg = curTarget(); if (!tg || !okLayer(tg)) return;
    var cs0 = tg.get();
    if (cs0.some(function (c) { return !c.closed; })) { S3.toast("Close the open paths first (merging works on closed shapes)", "error"); return; }
    once(tg, "Merge shape components", function (cs) { var b = VG.bounds(cs) || { w: 100, h: 100 }; return VG.ringsToComps(VG.combine(cs, Math.max(0.02, Math.max(b.w, b.h) / 4000))); });
    clearSel();
  };
  // Properties row for shape layers with several components: combine mode of the selected (or all but the first) + merge
  VX.pathOpsRow = function (L) {
    var w = ED.ui.w, cs = L.shape.comps || [], ops = cs.slice(1).map(function (c) { return c.op || "add"; }), cur = ops.every(function (o) { return o === ops[0]; }) ? ops[0] : "";
    return h("div", { "class": "pe-prow" }, [h("span", { "class": "faint", text: "Components" }),
      w.seg("", OPS.slice(1), cur, function (v) { if (ED.layer() !== L) return; ED.doc.apath = null; VX.setCompOp(v); }),
      w.btn("Merge", function () { if (ED.layer() !== L) return; ED.doc.apath = null; VX.mergeComps(); ED.ui.buildProps(); }, "ghost", null, "Merge the components into one outline")]);
  };
  function deleteSelection() {
    var tg = curTarget(); if (!tg || !okLayer(tg)) return false;
    var cs = tg.get(), comps = Object.keys(compsFor(tg.key)).map(Number).filter(function (i) { return cs[i]; }), pts = selectedAnchors(cs);
    if (ED.tool === "psel" && comps.length) { once(tg, "Delete path", function (c2) { return c2.filter(function (c, i) { return comps.indexOf(i) < 0; }); }); clearSel(); afterDelete(tg); return true; }
    if (pts.length) {
      once(tg, "Delete anchor point", function (c2) { pts.sort(function (a, b) { return b[0] - a[0] || b[1] - a[1]; }).forEach(function (z) { if (c2[z[0]]) removeAnchor(c2, z[0], z[1]); }); return c2; });
      clearSel(); afterDelete(tg); return true;
    }
    return false;
  }
  function nudge(dx, dy) {
    var tg = curTarget(); if (!tg || !okLayer(tg)) return false;
    var cs = tg.get(), comps = Object.keys(compsFor(tg.key)).map(Number).filter(function (i) { return cs[i]; }), pts = selectedAnchors(cs);
    if (ED.tool === "psel") { if (!comps.length) return false; once(tg, "Nudge path", function (c2) { comps.forEach(function (i) { c2[i].pts.forEach(function (q) { moveAnchor(q, dx, dy); }); }); }); return true; }
    if (!pts.length) return false;
    once(tg, "Nudge anchor points", function (c2) { pts.forEach(function (z) { moveAnchor(c2[z[0]].pts[z[1]], dx, dy); }); });
    return true;
  }

  // ---------- overlay ----------
  var BLUE = "#1b8cff";
  ED.on("ovl", function (o) {
    var g = UI.groupOf(ED.tool); if (!g || !ED.doc) return;
    var c = o.c, dpr = o.dpr, tg = curTarget(), dr = ED.drag && ED.drag.kind === "vec" ? ED.drag : null;
    if (tg) {
      var cs = tg.get(), sel = selFor(tg.key), cmp = SEL.comps;
      o.docPath(c, function (c2, px) { c2.beginPath(); VG.trace(c2, cs); c2.lineWidth = 3 * px; c2.strokeStyle = "rgba(255,255,255,.7)"; c2.stroke(); c2.lineWidth = 1.2 * px; c2.strokeStyle = BLUE; c2.stroke(); });
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      var showAll = ED.tool !== "psel" || Object.keys(cmp).length;
      visibleHandles(cs).forEach(function (q) {
        var a = ED.toScr(cs[q.ci].pts[q.pi][0], cs[q.ci].pts[q.pi][1]), b = ED.toScr(q.x, q.y);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = BLUE; c.lineWidth = 1; c.stroke();
        c.beginPath(); c.arc(b.x, b.y, 3.2, 0, Math.PI * 2); c.fillStyle = BLUE; c.fill();
      });
      if (showAll) cs.forEach(function (cc, ci) {
        cc.pts.forEach(function (q, pi) {
          var s = ED.toScr(q[0], q[1]), on = sel[ci + ":" + pi] || cmp[ci] || (VX.pen && VX.pen.key === tg.key && VX.pen.ci === ci && pi === cc.pts.length - 1);
          if (ED.tool === "psel" && !cmp[ci]) return;
          c.fillStyle = on ? BLUE : "#fff"; c.strokeStyle = BLUE; c.lineWidth = 1;
          if (q[6] === 2) { c.beginPath(); c.arc(s.x, s.y, 3.6, 0, Math.PI * 2); c.fill(); c.stroke(); }
          else { c.fillRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7); c.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7); }
        });
      });
      // rubber band from the last anchor to the pointer
      if (VX.pen && VX.pen.key === tg.key && !dr && hoverPt && PO.rubber && cs[VX.pen.ci]) {
        var cc2 = cs[VX.pen.ci], l = cc2.pts[cc2.pts.length - 1];
        if (l) o.docPath(c, function (c3, px) {
          var hp = VX.pen.cpen ? null : hoverPt;
          c3.beginPath(); c3.moveTo(l[0], l[1]);
          if (VX.pen.cpen) { var tmp = VG.clone([cc2])[0]; tmp.pts.push(VG.Pc(hoverPt.x, hoverPt.y, hoverPt.x, hoverPt.y, hoverPt.x, hoverPt.y, 2)); autoSmooth(tmp); var a2 = tmp.pts[tmp.pts.length - 2], b2 = tmp.pts[tmp.pts.length - 1]; c3.moveTo(a2[0], a2[1]); c3.bezierCurveTo(a2[4], a2[5], b2[2], b2[3], b2[0], b2[1]); }
          else c3.bezierCurveTo(l[4], l[5], hp.x, hp.y, hp.x, hp.y);
          c3.lineWidth = 1 * px; c3.strokeStyle = BLUE; c3.setLineDash([4 * px, 3 * px]); c3.stroke(); c3.setLineDash([]);
        });
      }
    }
    if (dr && dr.vec === "marquee" && dr.b) o.docPath(c, function (c2, px) { c2.lineWidth = px; c2.strokeStyle = BLUE; c2.setLineDash([4 * px, 3 * px]); c2.strokeRect(dr.a.x, dr.a.y, dr.b.x - dr.a.x, dr.b.y - dr.a.y); c2.setLineDash([]); });
    if (dr && dr.vec === "ff" && dr.pts.length > 1) o.docPath(c, function (c2, px) { c2.beginPath(); dr.pts.forEach(function (q, i) { if (i) c2.lineTo(q.x, q.y); else c2.moveTo(q.x, q.y); }); c2.lineWidth = 1.5 * px; c2.strokeStyle = BLUE; c2.stroke(); });
  });
  var hoverPt = null;
  function hover(p) { hoverPt = p; }

  // ---------- tool table ----------
  function cursor(p) {
    var tg = curTarget(), t = tol();
    if (!tg) return ED.tool === "psel" || ED.tool === "dsel" ? "default" : "crosshair";
    var cs = tg.get();
    if (ED.tool === "psel" || ED.tool === "dsel") return hitAnchor(cs, p, t) || hitHandle(cs, p, t) ? "pointer" : hitSeg(cs, p, t) ? "move" : "default";
    return "crosshair";
  }
  function leave(next) { if (!UI.groupOf(next)) { VX.pen = null; hoverPt = null; } else if (UI.groupOf(next) === "psel") VX.pen = null; }
  var base = { move: vecMove, up: vecUp, hover: hover, cursor: cursor, leave: leave };
  ED.TOOLS.pen = Object.assign({ down: penDown }, base);
  ED.TOOLS.cpen = Object.assign({ down: cpenDown }, base);
  ED.TOOLS.ffpen = Object.assign({ down: ffDown }, base);
  ED.TOOLS.addpt = Object.assign({ down: addDown }, base);
  ED.TOOLS.delpt = Object.assign({ down: delDown }, base);
  ED.TOOLS.cvtpt = Object.assign({ down: cvtDown }, base);
  ED.TOOLS.psel = Object.assign({ down: psDown }, base);
  ED.TOOLS.dsel = Object.assign({ down: function (p, e) { dsDown(p, e); } }, base);
  UI.addTool("pen", "Pen (P · Shift+P cycles)", "P", "bucket");
  UI.addTool("psel", "Path selection (A · Shift+A cycles)", "A", "text");

  // keys: Enter / Esc finish a path, Delete removes anchors or components, arrows nudge
  UI.keys.push(function (e) {
    if (!UI.groupOf(ED.tool) || e.ctrlKey || e.metaKey) return false;
    var k = e.key;
    if (k === "Escape" && ED.drag && ED.drag.kind === "vec") { var dr = ED.drag; ED.drag = null; if (dr.cancel) dr.cancel(); refresh(); return true; }
    if ((k === "Enter" || k === "Escape") && VX.pen) { finishPen(); return true; }
    if (k === "Escape" && (Object.keys(SEL.pts).length || Object.keys(SEL.comps).length)) { clearSel(); refresh(); return true; }
    if (k === "Delete" || k === "Backspace") return deleteSelection();
    if (k.indexOf("Arrow") === 0) { var n = e.shiftKey ? 10 : 1; return nudge(k === "ArrowLeft" ? -n : k === "ArrowRight" ? n : 0, k === "ArrowUp" ? -n : k === "ArrowDown" ? n : 0); }
    return false;
  });
  // Ctrl+Z while drawing keeps drawing from the new last anchor (state is checked on every click)
  ED.on("changed", function () { if (VX.pen) { var tg = curTarget(); if (!drawing(tg, tg ? tg.get() : [])) VX.pen = null; } });

  // ---------- options bar ----------
  function penOpts(items) {
    var w = ED.ui.w, out = [UI.nameItem(ED.tool), UI.variantSeg("pen")];
    if (["pen", "cpen", "ffpen"].indexOf(ED.tool) >= 0) {
      out.push(w.seg("", [["shape", "Shape"], ["path", "Path"]], PO.mode, function (v) { PO.mode = v; if (v === "path" && PO.op === "new") PO.op = "add"; ED.saveOpts(); ED.ui.buildOpts(); }));
      out.push(w.seg("", OPS.filter(function (o) { return PO.mode === "shape" || o[0] !== "new"; }), PO.op, function (v) { PO.op = v; ED.saveOpts(); }));
      if (PO.mode === "shape") out.push(h("span", { "class": "pe-of" }, [h("span", { text: "Fill" }), UI.color("", ED.o.shape.fill, function (v) { ED.o.shape.fill = v; ED.o.shape.noFill = false; ED.saveOpts(); }, "Fill colour"),
        h("span", { text: "Stroke" }), UI.color("", ED.o.shape.stroke, function (v) { ED.o.shape.stroke = v; ED.saveOpts(); }, "Stroke colour"), w.numInput(ED.o.shape.sw, 0, 500, function (v) { ED.o.shape.sw = v; ED.saveOpts(); })]));
      if (ED.tool === "pen") { out.push(w.check("Auto add/delete", PO.auto, function (v) { PO.auto = v; ED.saveOpts(); })); out.push(w.check("Rubber band", PO.rubber, function (v) { PO.rubber = v; ED.saveOpts(); })); }
      if (ED.tool === "ffpen") out.push(w.field("Curve fit (px)", w.numInput(PO.fit, 0.5, 10, function (v) { PO.fit = v; ED.saveOpts(); }, 0.5), "pe-num"));
    }
    if (VX.pathToSelection && (PO.mode === "path" || (ED.doc && ED.doc.apath))) out = out.concat(pathMakeButtons());
    var hint = { pen: VX.pen ? "Click to add corners, drag for curves (Alt breaks the handle). Click the first anchor to close; Enter or Esc ends an open path." : "Click to place anchors, drag to pull out curve handles. Ctrl = direct selection, Alt on an anchor = convert.",
      cpen: "Click points: the curve flows through them. Double-click a point to toggle corner / smooth; drag a point to move it.", ffpen: "Drag to draw; the stroke becomes a smooth path. End near the start to close it.",
      addpt: "Click a segment to add an anchor.", delpt: "Click an anchor to delete it.", cvtpt: "Click an anchor to toggle smooth / corner; drag from it to pull out handles; drag a handle to break it." }[ED.tool];
    if (hint) out.push(h("span", { "class": "pe-hint", text: hint }));
    return out;
  }
  function pathMakeButtons() {
    var w = ED.ui.w;
    return [h("span", { "class": "pe-of" }, [h("span", { text: "Make" }),
      w.btn("Selection", function () { if (VX.pathToSelection) VX.pathToSelection(); }, "ghost", null, "Turn the current path into a selection"),
      w.btn("Shape", function () { if (VX.pathToShape) VX.pathToShape(); }, "ghost", null, "New shape layer from the current path")])];
  }
  ["pen", "cpen", "ffpen", "addpt", "delpt", "cvtpt"].forEach(function (t) { UI.opts(t, penOpts); });
  function selOpts(items) {
    var w = ED.ui.w, out = [UI.nameItem(ED.tool), UI.variantSeg("psel")], tg = curTarget();
    if (ED.tool === "psel") {
      out.push(w.seg("", OPS.slice(1), "", function (v) { VX.setCompOp(v); ED.ui.buildOpts(); }));
      out.push(w.btn("Merge", function () { VX.mergeComps(); }, "ghost", null, "Merge the components into one outline (applies the unite / subtract / intersect / exclude modes)"));
    }
    if (VX.pathToSelection && tg && tg.kind === "path") out = out.concat(pathMakeButtons());
    out.push(h("span", { "class": "pe-hint", text: ED.tool === "psel" ? "Click a path to select it (Shift adds), drag to move, Alt+drag copies. Delete removes it." : "Click or drag around anchors to select them; drag anchors, handles or curves. Alt+click a segment selects its whole path. Arrows nudge." }));
    return out;
  }
  UI.opts("psel", selOpts); UI.opts("dsel", selOpts);
})();
