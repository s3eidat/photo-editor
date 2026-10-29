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
