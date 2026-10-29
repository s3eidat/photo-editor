/* Vector lane: vertical type and type masks. Vertical text stacks letters top to bottom in columns that run right to
   left (point text, or a paragraph box whose height wraps the columns). "Mask" mode on the type tool turns the text
   you type into a selection instead of a layer. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, UI = VX.ui, h = S3.h;
  var LC = new Map();
  VX.layoutVert = function (T) {
    var key = JSON.stringify(T), hit = LC.get(key); if (hit) return hit;
    var size = Math.max(1, T.size), col = size * (T.lh || 1.2), adv = size * 1.02 + (T.track || 0) / 1000 * size, box = T.box, cols = [], idx = 0;
    String(T.text).split("\n").forEach(function (para) {
      var cur = [];
      Array.from(para).forEach(function (ch) {
        if (box && cur.length && (cur.length + 1) * adv > box.h) { cols.push(cur); cur = []; }
        cur.push({ ch: ch, st: VX.styleAt ? VX.styleAt(T, idx) : T }); idx += ch.length;
      });
      cols.push(cur); idx += 1;
    });
    var W = box ? box.w : Math.max(col, cols.length * col), H = box ? box.h : Math.max(adv, Math.max.apply(null, cols.map(function (c) { return c.length * adv; })));
    var al = T.align || "left", glyphs = [], overflow = false;
    cols.forEach(function (c, ci) {
      var x = T.ax + W - (ci + 0.5) * col, len = c.length * adv, y0 = T.ay + (al === "center" ? (H - len) / 2 : al === "right" ? H - len : 0);
      if (box && (ci + 1) * col > box.w + 0.5) { overflow = true; return; }
      c.forEach(function (g, k) { glyphs.push({ ch: g.ch, st: g.st, x: x, y: y0 + (k + 0.5) * adv }); });
    });
    var out = { vert: true, lines: cols.map(function (c) { return c.map(function (g) { return g.ch; }).join(""); }), widths: cols.map(function () { return col; }), w: W, h: H, lh: col, box: { x: T.ax, y: T.ay, w: W, h: H }, items: [], glyphs: glyphs, overflow: overflow };
    if (LC.size > 200) LC.clear();
    LC.set(key, out);
    return out;
  };
  VX.drawVert = function (c, T, lay) {
    c.textBaseline = "middle";
    lay.glyphs.forEach(function (g) {
      var st = g.st || T, w = VX.measureText(st, g.ch);
      VX.setFont(c, st); c.fillStyle = PE.hex(st.color, "#111111");
      if (st.fbold) { c.strokeStyle = c.fillStyle; c.lineWidth = VX.effSize(st) * 0.035; c.lineJoin = "round"; }
      w = VX.measureText(st, g.ch);
      VX.drawRun(c, st, g.ch, g.x - w / 2, g.y - (st.base || 0), w, false);
    });
  };
  var place0 = VX.placeText;
  VX.placeText = function (ta, L) {
    place0(ta, L);
    var T = L.text;
    ta.classList.toggle("pe-vmask", !!VX.maskPending && VX.maskPending === L.id);
    if (!T.vert) { ta.style.writingMode = ""; return; }
    var z = ED.zoom, s = ED.toScr(T.ax, T.ay), lay = PE.textLayout(T);
    ta.style.writingMode = "vertical-rl"; ta.style.whiteSpace = T.box ? "pre-wrap" : "pre"; ta.style.boxSizing = "border-box";
    ta.style.left = s.x + "px"; ta.style.top = s.y + "px"; ta.style.width = Math.max(lay.w, T.size) * z + 8 + "px"; ta.style.height = Math.max(lay.h, T.size) * z + 8 + "px";
  };
  VX.onParseLayer(function (raw, out) { if (out.kind === "text" && raw.text && raw.text.vert === true) out.text.vert = true; });

  // ---------- type tool: orientation and mask mode ----------
  var o = ED.o.text; if (o.vert === undefined) o.vert = false; if (o.mask === undefined) o.mask = false;
  var T = ED.TOOLS.text, down0 = T.down, up0 = T.up;
  function stamp() {      // a text layer the type tool just created gets the tool's orientation / mask mode
    var L = ED.textL; if (!L || !ED.textNew || L.text.text) return;
    if (o.vert && !L.text.path) { L.text.vert = true; ED.placeText(); }
    if (o.mask) { VX.maskPending = L.id; ED.placeText(); }
  }
  T.down = function (p, e) { down0(p, e); stamp(); };
  T.up = function (p, e) { up0(p, e); stamp(); };
  ED.on("changed", function () {
    var id = VX.maskPending; if (!id || (ED.textL && ED.textL.id === id)) return;
    VX.maskPending = null;
    var d = ED.doc, L = d && PE.findLayer(d, id); if (!L || L.kind !== "text") return;
    var r = PE.inter(PE.rectI(PE.vbox(L)), { x: 0, y: 0, w: d.w, h: d.h }), m = new Uint8Array(d.w * d.h);
    var s = PE.surface(L, d), rr = PE.inter({ x: s.x, y: s.y, w: s.canvas.width, h: s.canvas.height }, { x: 0, y: 0, w: d.w, h: d.h });
    if (rr) { var px = PE.getData(PE.flatten(d, { only: [L.id], rect: rr })).data; for (var y = 0; y < rr.h; y++) for (var x = 0; x < rr.w; x++) m[(y + rr.y) * d.w + x + rr.x] = px[(y * rr.w + x) * 4 + 3]; }
    void r;
    var sel = PE.makeSel(d, window.PIX.combine(d.sel ? d.sel.m : null, m, d.sel ? ED.o.sel.mode : "new"));
    ED.meta("Type mask", function () { var i = d.layers.indexOf(L); d.layers.splice(i, 1); d.active = d.layers.length ? d.layers[Math.max(0, i - 1)].id : null; d.sel = sel; });
    ED.emit("layers");
  });
  var opts0 = ED.ui.optsFor.text;
  UI.opts("text", function (items) {
    items = opts0 ? opts0(items) : items;
    var w = ED.ui.w, at = items.findIndex(function (x) { return x.classList && x.classList.contains("pe-hint"); });
    items.splice(at < 0 ? items.length : at, 0,
      w.seg("", [["h", "Horizontal", "Horizontal type"], ["v", "Vertical", "Vertical type"]], o.vert ? "v" : "h", function (v) { o.vert = v === "v"; ED.saveOpts(); }),
      w.check("Mask", o.mask, function (v) { o.mask = v; ED.saveOpts(); }));
    return items;
  });
  UI.props(function (P, L) {
    if (!L || L.kind !== "text" || L.text.path) return;
    P.appendChild(h("div", { "class": "pe-prow" }, [ED.ui.w.seg("Orientation", [["h", "Horizontal"], ["v", "Vertical"]], L.text.vert ? "v" : "h", function (v) { VX.setText("Text orientation", function (t) { if (v === "v") t.vert = true; else delete t.vert; }); })]));
  });
})();
