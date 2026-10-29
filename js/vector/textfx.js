/* Vector lane: text effects that keep the text editable. Warp text (arc, bulge, flag, wave, fish, rise, fisheye,
   inflate, squeeze, twist… with bend and horizontal / vertical distortion, horizontal or vertical orientation),
   type on a path (click a path or a shape outline with the type tool), and the Glyphs panel. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, WF = PE.WF, UI = VX.ui, h = S3.h;

  // ---------- warp text ----------
  function warpFn(w, aspect) {
    if (!w.vert) return WF.style(w.style, w.bend, w.hd, w.vd, aspect);
    var f = WF.style(w.style, w.bend, w.hd, w.vd, 1 / aspect);
    return function (u, v) { var p = f(v, u); return [p[1], p[0]]; };
  }
  VX.drawWarpText = function (c, L, b) {
    var T = L.text, lay = PE.textLayout(T), bx = lay.box;
    var pad = Math.ceil(T.size * 0.7 + Math.abs(T.base || 0) + 4), W = Math.ceil(bx.w + 2 * pad), H = Math.ceil(bx.h + 2 * pad);
    var k = Math.min(1, 4096 / Math.max(W, H)), oc = PE.mk(Math.max(1, Math.ceil(W * k)), Math.max(1, Math.ceil(H * k))), ox = PE.cx2(oc);
    ox.setTransform(k, 0, 0, k, (pad - bx.x) * k, (pad - bx.y) * k);
    drawFlat(ox, T, lay);
    var f = warpFn(T.warp, bx.h / Math.max(1, bx.w)), n = Math.max(8, Math.min(48, Math.round(Math.max(W, H) / 24))), m = Math.max(4, Math.round(n * H / Math.max(1, W))), G = [], i, j;
    if (T.warp.vert) { m = n; n = Math.max(4, Math.round(m * W / Math.max(1, H))); }
    for (j = 0; j <= m; j++) for (i = 0; i <= n; i++) {
      var sx = i / n * W, sy = j / m * H, u = (sx - pad) / bx.w, v = (sy - pad) / bx.h, q = f(u, v);
      G.push({ s: { x: sx * k, y: sy * k }, d: { x: bx.x + q[0] * bx.w, y: bx.y + q[1] * bx.h } });
    }
    for (j = 0; j < m; j++) for (i = 0; i < n; i++) {
      var a = G[j * (n + 1) + i], bq = G[j * (n + 1) + i + 1], cq = G[(j + 1) * (n + 1) + i], d = G[(j + 1) * (n + 1) + i + 1];
      VX.drawTri(c, oc, a, bq, d); VX.drawTri(c, oc, a, d, cq);
    }
    return true;
  };
  function drawFlat(ox, T, lay) {
    if (VX.isExtText(Object.assign({}, T, { warp: null }))) VX.drawLaid(ox, T, lay);
    else {      // plain text, drawn the way the core renderer does
      var dir = PE.textDir(T), b = lay.box;
      ox.font = PE.fontCss(T); ox.direction = dir; ox.fillStyle = PE.hex(T.color, "#111111"); ox.textBaseline = "middle";
      lay.lines.forEach(function (s, i) {
        var y = b.y + lay.lh * (i + 0.5), w = lay.widths[i], x = T.align === "center" ? b.x + (b.w - w) / 2 : T.align === "right" ? b.x + b.w - w : b.x;
        ox.textAlign = dir === "rtl" ? "right" : "left"; ox.fillText(s, dir === "rtl" ? x + w : x, y);
      });
    }
  }
  // one textured triangle: source points p.s (in img px) to destination p.d (in ctx space); grown slightly against seams
  VX.drawTri = function (c, img, A, B, C) {
    var sa = A.s, sb = B.s, sc = C.s, a = A.d, b = B.d, cc = C.d;
    var den = (sb.x - sa.x) * (sc.y - sa.y) - (sc.x - sa.x) * (sb.y - sa.y); if (Math.abs(den) < 1e-9) return;
    var m11 = ((b.x - a.x) * (sc.y - sa.y) - (cc.x - a.x) * (sb.y - sa.y)) / den, m12 = ((cc.x - a.x) * (sb.x - sa.x) - (b.x - a.x) * (sc.x - sa.x)) / den;
    var m21 = ((b.y - a.y) * (sc.y - sa.y) - (cc.y - a.y) * (sb.y - sa.y)) / den, m22 = ((cc.y - a.y) * (sb.x - sa.x) - (b.y - a.y) * (sc.x - sa.x)) / den;
    var dx = a.x - m11 * sa.x - m12 * sa.y, dy = a.y - m21 * sa.x - m22 * sa.y, mx = (a.x + b.x + cc.x) / 3, my = (a.y + b.y + cc.y) / 3;
    function g(p) { var vx = p.x - mx, vy = p.y - my, l = Math.hypot(vx, vy) || 1; return { x: p.x + vx / l * 0.6, y: p.y + vy / l * 0.6 }; }
    var P = g(a), Q = g(b), R = g(cc);
    c.save(); c.beginPath(); c.moveTo(P.x, P.y); c.lineTo(Q.x, Q.y); c.lineTo(R.x, R.y); c.closePath(); c.clip();
    c.transform(m11, m21, m12, m22, dx, dy); c.drawImage(img, 0, 0); c.restore();
  };
  var padText0 = VX.padText;
  VX.padText = function (L, pad) {
    pad = padText0(L, pad);
    var T = L.text;
    if (T.warp && T.warp.style !== "none") { var b = PE.textLayout(Object.assign({}, T, { warp: null })).box, w = T.warp; pad += Math.max(b.w, b.h) * (Math.abs(w.bend) * 0.75 + (Math.abs(w.hd) + Math.abs(w.vd)) * 0.5) + T.size * 0.3; }
    return pad;
  };
  // the dialog: live on the layer, one history step on OK
  VX.warpTextDialog = function () {
    var L = ED.layer(); if (!L || L.kind !== "text") { S3.toast("Select a text layer first", "error"); return; }
    if (!ED.editable(L)) return;
    if (L.text.path) { S3.toast("Text on a path cannot be warped: release it from the path first", "error"); return; }
    if (ED.textL) ED.finishText();
    var w = ED.ui.w, before = PE.snap(ED.doc), st = Object.assign({ style: "arc", bend: 0.5, hd: 0, vd: 0, vert: false }, L.text.warp || {});
    function upd() { if (st.style === "none") delete L.text.warp; else L.text.warp = { style: st.style, bend: st.bend, hd: st.hd, vd: st.vd, vert: st.vert }; ED.render(); }
    var pctf = function (v) { return v + "%"; };
    var body = h("div", { "class": "stack" }, [
      w.select("Style", WF.STYLES, st.style, function (v) { st.style = v; upd(); }),
      w.seg("", [["h", "Horizontal"], ["v", "Vertical"]], st.vert ? "v" : "h", function (v) { st.vert = v === "v"; upd(); }),
      w.range("Bend", Math.round(st.bend * 100), -100, 100, 1, function (v) { st.bend = v / 100; upd(); }, pctf),
      w.range("Horizontal distortion", Math.round(st.hd * 100), -100, 100, 1, function (v) { st.hd = v / 100; upd(); }, pctf),
      w.range("Vertical distortion", Math.round(st.vd * 100), -100, 100, 1, function (v) { st.vd = v / 100; upd(); }, pctf),
      h("p", { "class": "faint pe-p", text: "The text stays editable; choose None to remove the warp." })]);
    var done = false;
    var ok = w.btn("OK", function () { done = true; dlg.close(); ED.push(PE.metaEntry(st.style === "none" ? "Remove warp" : "Warp text", ED.doc, before)); }, "primary");
    var dlg = w.modal("Warp text", body, [h("span", { "class": "grow" }), ok]);
    upd();
    // closing any other way (Esc, the x, outside) cancels
    new MutationObserver(function (_, obs) { if (!document.body.contains(dlg.el)) { obs.disconnect(); if (!done) { PE.restore(ED.doc, before); ED.changed(); } } }).observe(document.body, { childList: true });
  };
  VX.onParseLayer(function (raw, out) {
    if (out.kind !== "text" || !raw.text || typeof raw.text !== "object") return;
    var r = raw.text.warp;
    if (r && typeof r === "object" && WF.STYLES.some(function (s) { return s[0] === r.style && s[0] !== "none"; }))
      out.text.warp = { style: r.style, bend: VX.num(r.bend, -1, 1, 0.5), hd: VX.num(r.hd, -1, 1, 0), vd: VX.num(r.vd, -1, 1, 0), vert: r.vert === true };
  });
  function isText() { var L = ED.doc && ED.layer(); return !!(L && L.kind === "text"); }
  UI.menu("Layer", ["-", ["Warp text…", "", function () { if (ED.ui.w.need()) VX.warpTextDialog(); }, isText]], "Rasterize layer");
  var textOpts0 = ED.ui.optsFor.text;
  UI.opts("text", function (items) {
    items = textOpts0 ? textOpts0(items) : items;
    var at = items.findIndex(function (x) { return x.classList && x.classList.contains("pe-hint"); });
    items.splice(at < 0 ? items.length : at, 0, ED.ui.w.btn("Warp", function () { if (ED.ui.w.need()) VX.warpTextDialog(); }, "ghost", "t-warp", "Warp text (keeps it editable)"));
    return items;
  });
})();
/* type on a path */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, UI = VX.ui, h = S3.h;
  function poly(T) {      // flattened absolute path with cumulative lengths
    var c = T.path.comps[0], pts = VG.flatComp(VG.map([c], function (x, y) { return [x + T.ax, y + T.ay]; })[0], 0.3);
    if (c.closed && pts.length) pts = pts.concat([pts[0]]);
    if (T.path.flip) pts = pts.slice().reverse();
    var L = [0]; for (var i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts: pts, L: L, len: L[L.length - 1] || 0, closed: c.closed };
  }
  function at(P, s) {      // point and direction at arc length s
    var L = P.L, lo = 0, hi = L.length - 1;
    if (P.closed && P.len > 0) s = ((s % P.len) + P.len) % P.len;
    s = Math.max(0, Math.min(P.len, s));
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    var a = P.pts[lo], b = P.pts[hi] || a, t = (s - L[lo]) / ((L[hi] - L[lo]) || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  VX.pathPoly = poly; VX.pathAt = at;
  var LC = new Map();
  VX.pathLayout = function (T) {
    var key = JSON.stringify(T), hit = LC.get(key); if (hit) return hit;
    VX.setFont(VX.mctx(), T);
    var text = String(T.text).replace(/\s*\n\s*/g, " "), rtl = PE.textDir(T) === "rtl", P = poly(T);
    var units = rtl ? text.split(/(\s+)/).filter(function (x) { return x.length; }) : Array.from(text);      // RTL scripts stay joined: words, not letters
    if (rtl) units.reverse();
    var ws = units.map(function (u) { return VX.measureText(T, u); }), total = ws.reduce(function (a, b) { return a + b; }, 0);
    var al = T.align || "left", s0 = (T.path.off || 0) * P.len - (al === "center" || al === "justify-center" ? total / 2 : al === "right" || al === "justify-right" ? total : 0), acc = 0, glyphs = [];
    units.forEach(function (u, i) {
      var mid = s0 + acc + ws[i] / 2; acc += ws[i];
      if (/^\s+$/.test(u)) return;
      if (!P.closed && (mid < -0.5 || mid > P.len + 0.5)) return;      // past the ends: not shown
      if (P.closed && (acc > P.len + 0.5)) return;
      var q = at(P, mid); glyphs.push({ u: u, x: q.x, y: q.y, a: q.a, w: ws[i] });
    });
    var b = VG.bounds(VG.map([T.path.comps[0]], function (x, y) { return [x + T.ax, y + T.ay]; })) || { x: T.ax, y: T.ay, w: 1, h: 1 }, m = T.size * 1.1;
    var out = { lines: [text], widths: [total], w: b.w + 2 * m, h: b.h + 2 * m, lh: T.size * (T.lh || 1.2), box: { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, items: [], glyphs: glyphs, len: P.len, total: total };
    if (LC.size > 200) LC.clear();
    LC.set(key, out);
    return out;
  };
  VX.drawPathText = function (c, L) {
    var T = L.text, lay = VX.pathLayout(T), shift = -(T.base || 0) + (T.sup === "sup" ? -T.size * 0.33 : T.sup === "sub" ? T.size * 0.18 : 0);
    VX.setFont(c, T); c.textBaseline = "alphabetic"; c.fillStyle = PE.hex(T.color, "#111111");
    if (T.fbold) { c.strokeStyle = c.fillStyle; c.lineWidth = VX.effSize(T) * 0.035; c.lineJoin = "round"; }
    lay.glyphs.forEach(function (g) {
      var st = g.st || T, sh = g.st ? -(st.base || 0) + (st.sup === "sup" ? -st.size * 0.33 : st.sup === "sub" ? st.size * 0.18 : 0) : shift;
      if (g.st) { VX.setFont(c, st); c.fillStyle = PE.hex(st.color, "#111111"); c.textBaseline = "alphabetic"; if (st.fbold) { c.strokeStyle = c.fillStyle; c.lineWidth = VX.effSize(st) * 0.035; } }
      c.save(); c.translate(g.x, g.y); c.rotate(g.a);
      VX.drawRun(c, st, g.u, -g.w / 2, sh, g.w, false);
      c.restore();
    });
    return true;
  };
  VX.xfPathText = function (T, cen, sx, sy) {
    var cs = T.path.comps, b = VG.bounds(cs) || { x: 0, y: 0, w: 0, h: 0 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, ax = Math.abs(sx), ay = Math.abs(sy);
    T.path.comps = VG.map(cs, function (x, y) { return [bc.x + (x - bc.x) * ax, bc.y + (y - bc.y) * ay]; });
    T.ax = cen.x - bc.x; T.ay = cen.y - bc.y;
  };
  VX.scalePathText = function (T, kx, ky) { T.path.comps = VG.map(T.path.comps, function (x, y) { return [x * kx, y * ky]; }); };
  VX.onParseLayer(function (raw, out) {
    if (out.kind !== "text" || !raw.text || typeof raw.text !== "object" || !raw.text.path || typeof raw.text.path !== "object") return;
    var cs = VX.cleanComps(raw.text.path.comps, 3 * PE.LIM.side);
    if (cs && cs.length) out.text.path = { comps: cs.slice(0, 1), off: VX.num(raw.text.path.off, 0, 1, 0), flip: raw.text.path.flip === true };
  });

  // type tool: a click on the current path (or the selected shape's outline) starts text on it
  VX.textDownExt = function (p) {
    var tg = VX.target(); if (!tg) return false;
    var cs = tg.get(), n = VG.nearestSeg(cs, p.x, p.y);
    if (!n || n.d > 6 / ED.zoom) return false;
    var c = cs[n.ci], one = { op: "add", closed: c.closed, pts: c.pts };
    var flat = VG.flatComp(one, 0.3), total = 0, upto = 0, i;
    for (i = 1; i < flat.length; i++) total += Math.hypot(flat[i].x - flat[i - 1].x, flat[i].y - flat[i - 1].y);
    if (c.closed && flat.length) total += Math.hypot(flat[0].x - flat[flat.length - 1].x, flat[0].y - flat[flat.length - 1].y);
    var part = VG.flatComp({ op: "add", closed: false, pts: VG.splitAt(one, n.si, n.t).pts.slice(0, n.si + 2) }, 0.3);
    for (i = 1; i < part.length; i++) upto += Math.hypot(part[i].x - part[i - 1].x, part[i].y - part[i - 1].y);
    var o = ED.o.text, before = PE.snap(ED.doc), ax = c.pts[0][0], ay = c.pts[0][1];
    var L = PE.newLayer("text", { name: "Text on path", text: { text: "", font: o.font, size: o.size, weight: o.weight, italic: o.italic, color: ED.doc.fg, align: "left", dir: o.dir, ax: ax, ay: ay,
      path: { comps: VG.map([one], function (x, y) { return [x - ax, y - ay]; }), off: total ? Math.min(1, upto / total) : 0, flip: false } } });
    var d = ED.doc, at = d.layers.indexOf(ED.layer()); d.layers.splice(at < 0 ? d.layers.length : at + 1, 0, L); d.active = L.id; d.apath = null;
    ED.emit("layers"); ED.startText(L, before, true);
    return true;
  };
  var cur0 = ED.TOOLS.text.cursor;
  ED.TOOLS.text.cursor = function (p) {
    var tg = VX.target(); if (tg) { var n = VG.nearestSeg(tg.get(), p.x, p.y); if (n && n.d <= 6 / ED.zoom) return "copy"; }
    return cur0 ? cur0(p) : "text";
  };
  // path text: show the path and the start point while the type tool is active
  ED.on("ovl", function (o) {
    var L = ED.layer();
    if ((ED.tool !== "text" && ED.tool !== "psel" && ED.tool !== "dsel") || !L || L.kind !== "text" || !L.text.path) return;
    var T = L.text, b = PE.vbox(L), cx = b.x + b.w / 2, cy = b.y + b.h / 2, lay = VX.pathLayout(T);
    o.docPath(o.c, function (c, px) {
      c.translate(cx, cy); c.rotate((b.rot || 0) * Math.PI / 180); if (b.fx) c.scale(-1, 1); c.translate(-cx, -cy);
      c.beginPath(); VG.trace(c, VG.map(T.path.comps, function (x, y) { return [x + T.ax, y + T.ay]; })); c.lineWidth = px; c.strokeStyle = "#1b8cff"; c.setLineDash([4 * px, 3 * px]); c.stroke(); c.setLineDash([]);
      if (lay.glyphs.length) { var g = lay.glyphs[0]; c.beginPath(); c.arc(g.x, g.y, 4 * px, 0, Math.PI * 2); c.fillStyle = "#1b8cff"; c.fill(); }
      if (lay.total > lay.len + 1 && !T.path.comps[0].closed) { var e = lay.glyphs[lay.glyphs.length - 1]; if (e) { c.fillStyle = "#e5484d"; c.fillRect(e.x - 5 * px, e.y - 5 * px, 10 * px, 10 * px); } }
    });
  });
  // Properties: start offset, flip side, release
  UI.props(function (P, L) {
    if (!L || L.kind !== "text" || !L.text.path) return;
    var T = L.text, w = ED.ui.w;
    P.appendChild(h("h3", { text: "Text on path" }));
    P.appendChild(w.range("Start", Math.round((T.path.off || 0) * 1000) / 10, 0, 100, 0.1, function (v) { VX.setText("Path text start", function (t) { t.path.off = v / 100; }); }, function (v) { return v + "%"; }));
    P.appendChild(h("div", { "class": "pe-prow" }, [
      w.check("Flip to the other side", !!T.path.flip, function (v) { VX.setText("Flip path text", function (t) { t.path.flip = v; }); }),
      w.btn("Release from path", function () { VX.setText("Release text from path", function (t) { var g = VX.pathLayout(t).glyphs[0]; delete t.path; t.align = "left"; if (g) { t.ax = g.x - g.w / 2; t.ay = g.y - t.size; } }); ED.ui.buildProps(); }, "ghost")]));
  });
})();
/* Glyphs panel: browse characters by group in the current font and insert them into the text */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, h = S3.h;
  function R(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }
  var GROUPS = [
    ["recent", "Recently used", []],
    ["punct", "Punctuation & symbols", R(0x21, 0x2f).concat(R(0x3a, 0x40), R(0x5b, 0x60), R(0x7b, 0x7e), R(0xa1, 0xbf), R(0x2010, 0x2027), R(0x2030, 0x203e), [0x2122, 0x2116, 0x2120])],
    ["latin", "Latin and digits", R(0x41, 0x5a).concat(R(0x61, 0x7a), R(0x30, 0x39))],
    ["accent", "Latin accented", R(0xc0, 0xff).concat(R(0x100, 0x17f))],
    ["greek", "Greek", R(0x391, 0x3a1).concat(R(0x3a3, 0x3a9), R(0x3b1, 0x3c9))],
    ["cyr", "Cyrillic", R(0x410, 0x44f)],
    ["arabic", "Arabic", R(0x621, 0x63a).concat(R(0x641, 0x64a), R(0x64b, 0x652), R(0x660, 0x66d), [0x67e, 0x686, 0x698, 0x6a9, 0x6af, 0x6cc, 0x6f0, 0x6f1, 0x6f2, 0x6f3, 0x6f4, 0x6f5, 0x6f6, 0x6f7, 0x6f8, 0x6f9, 0xfdf2, 0x60c, 0x61b, 0x61f])],
    ["money", "Currency", [0x24, 0xa2, 0xa3, 0xa4, 0xa5].concat(R(0x20a0, 0x20c0))],
    ["arrows", "Arrows", R(0x2190, 0x21ff)],
    ["math", "Maths", [0xb1, 0xd7, 0xf7, 0xb0, 0xb2, 0xb3, 0xb9, 0xbc, 0xbd, 0xbe].concat(R(0x2200, 0x2265), R(0x2153, 0x215e))],
    ["shapes", "Shapes", R(0x25a0, 0x25ff)],
    ["dings", "Symbols & dingbats", R(0x2600, 0x266f).concat(R(0x2700, 0x27bf))],
    ["box", "Box drawing", R(0x2500, 0x257f).concat(R(0x2580, 0x259f))]
  ];
  var st = Object.assign({ group: "punct", recent: [] }, S3.store("pe-glyphs") || {});
  function save() { S3.store("pe-glyphs", st); }
  var panel = null, body = null, grid = null;
  function font() { var L = ED.textL || (ED.doc && ED.layer()); return L && L.kind === "text" ? L.text.font : ED.o.text.font; }
  function insert(ch) {
    var ta = document.querySelector("#textEdit"), L = ED.doc && ED.layer();
    if (!ED.textL) {
      if (!L || L.kind !== "text") { S3.toast("Click with the type tool (T) first, then pick a character", "error"); return; }
      if (!ED.editable(L)) return;
      ED.setTool("text"); ED.startText(L, PE.snap(ED.doc)); ta.selectionStart = ta.selectionEnd = ta.value.length;
    }
    var s = ta.selectionStart || 0, e = ta.selectionEnd || 0;
    ta.value = ta.value.slice(0, s) + ch + ta.value.slice(e); ta.selectionStart = ta.selectionEnd = s + ch.length;
    ta.dispatchEvent(new Event("input")); ta.focus();
    st.recent = [ch].concat(st.recent.filter(function (x) { return x !== ch; })).slice(0, 30); save();
    if (st.group === "recent") fill();
  }
  VX.insertGlyph = insert;
  function fill() {
    grid.textContent = "";
    var g = GROUPS.filter(function (x) { return x[0] === st.group; })[0] || GROUPS[1], list = g[0] === "recent" ? st.recent : g[2].map(function (cp) { return String.fromCodePoint(cp); });
    if (!list.length) { grid.appendChild(h("p", { "class": "faint pe-p", text: "Characters you insert show up here." })); return; }
    var f = '"' + PE.cleanFamily(font()) + '", "Noto Sans Arabic", sans-serif';
    list.forEach(function (ch) {
      var cp = ch.codePointAt(0), b = h("button", { type: "button", "class": "pe-glyph", title: "U+" + cp.toString(16).toUpperCase().padStart(4, "0"), "aria-label": "Insert U+" + cp.toString(16).toUpperCase() }, [/[ً-ْ]/.test(ch) ? "◌" + ch : ch]);
      b.style.fontFamily = f;
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });      // keep the caret in the text being edited
      b.addEventListener("click", function () { insert(ch); });
      grid.appendChild(b);
    });
  }
  function build() {
    var side = document.querySelector(".pe-side"); if (!side) return;
    grid = h("div", { "class": "pe-glyphs", role: "group", "aria-label": "Characters" });
    var sel = ED.ui.w.select("Show", GROUPS.map(function (g) { return [g[0], g[1]]; }), st.group, function (v) { st.group = v; save(); fill(); });
    body = h("div", { "class": "pe-pbody" }, [sel, grid, h("p", { "class": "faint pe-p", text: "Click a character to type it at the cursor (shown in the current text's font)." })]);
    panel = h("details", { "class": "pe-panel", open: S3.store("pe-vglyph") === true }, [h("summary", { text: "Glyphs" }), body]);
    panel.addEventListener("toggle", function () { S3.store("pe-vglyph", panel.open); if (panel.open) fill(); });
    var paths = Array.prototype.filter.call(side.querySelectorAll(".pe-panel"), function (p) { return p.querySelector(".pe-vlist"); })[0];
    side.insertBefore(panel, paths || null);
    if (panel.open) fill();
  }
  ED.on("vready", function () { setTimeout(build, 0); });
  var last = "";
  ED.on("layers", function () { var f = font(); if (panel && panel.open && f !== last) { last = f; fill(); } });
  VX.ui.menu("Layer", [["Glyphs…", "", function () { if (!panel) return; panel.open = true; fill(); panel.scrollIntoView({ block: "nearest" }); }]], "Warp text…");
})();
/* text -> outlines: the browser gives no glyph outlines, so the text is drawn large and its edge traced and fitted */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, UI = VX.ui, h = S3.h;
  VX.textOutlines = function (L) {
    var d = ED.doc, s = PE.surface(L, d), k = PE.clamp(260 / Math.max(8, L.text.size), 1, 8);
    k = Math.min(k, 4000 / Math.max(s.canvas.width, s.canvas.height));
    var W = Math.max(1, Math.ceil(s.canvas.width * k)), H = Math.max(1, Math.ceil(s.canvas.height * k)), c = PE.mk(W, H), x = PE.cx2(c);
    x.setTransform(k, 0, 0, k, -s.x * k, -s.y * k); PE.drawVector(x, L);
    var px = x.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
    for (var i = 0; i < m.length; i++) m[i] = px[i * 4 + 3];
    return VX.work("maskToComps", [m, W, H, 0.8]).then(function (cs) { return VG.map(cs, function (a, b) { return [s.x + a / k, s.y + b / k]; }); });
  };
  function textL() { var L = ED.doc && ED.layer(); if (!L || L.kind !== "text") { S3.toast("Select a text layer first", "error"); return null; } if (ED.textL) ED.finishText(); return L; }
  VX.textToWorkPath = function () {
    var L = textL(); if (!L) return;
    ED.working(VX.textOutlines(L), "Tracing letters…").then(function (cs) {
      if (!cs.length) { S3.toast("Nothing to trace", "error"); return; }
      var d = ED.doc; VX.pathEdit("Work path from text", function () { d.work = { id: "work", name: "Work path", comps: cs }; d.apath = "work"; });
      ED.setTool("dsel"); ED.renderOvl();
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  VX.textToShape = function () {
    var L = textL(); if (!L || !ED.editable(L)) return;
    ED.working(VX.textOutlines(L), "Tracing letters…").then(function (cs) {
      if (!cs.length) { S3.toast("Nothing to trace", "error"); return; }
      ED.meta("Convert text to shape", function () {
        var col = L.text.color; L.kind = "shape"; L.text = null;
        L.shape = { type: "path", x: 0, y: 0, w: 1, h: 1, rot: 0, fill: PE.hex(col, "#111111"), stroke: "#111111", sw: 0, radius: 0, flipX: false, flipY: false, comps: [] };
        VX.setDocComps(L, cs);
      });
      ED.emit("layers");
    }).catch(function (e) { S3.toast(e.message, "error"); });
  };
  function isText() { var L = ED.doc && ED.layer(); return !!(L && L.kind === "text"); }
  UI.menu("Layer", [["Create work path from text", "", function () { if (ED.ui.w.need()) VX.textToWorkPath(); }, isText], ["Convert text to shape", "", function () { if (ED.ui.w.need()) VX.textToShape(); }, isText]], "Warp text…");
  UI.props(function (P, L) {
    if (!L || L.kind !== "text") return;
    P.appendChild(h("div", { "class": "pe-prow" }, [ED.ui.w.btn("To shape", VX.textToShape, "ghost", "t-shape", "Convert the letters to an editable shape layer"), ED.ui.w.btn("To work path", VX.textToWorkPath, "ghost", "v-path", "Outline the letters as a work path")]));
  });
})();
