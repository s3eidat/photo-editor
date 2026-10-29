/* Vector lane: type engine. Point text and paragraph (area) text with word wrap, and the character and paragraph
   settings: weights 100–900, tracking, kerning on/off, leading, horizontal / vertical scale, baseline shift, all caps,
   small caps, superscript / subscript, underline, strikethrough, faux bold, faux italic; alignment incl. justify,
   left / right / first-line indents, space before / after. Settings apply to the whole layer. Text stays live:
   it is laid out and drawn here only when one of these settings is used, otherwise the original renderer runs. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, UI = VX.ui, h = S3.h;
  var ALIGNS = ["left", "center", "right", "justify-left", "justify-center", "justify-right", "justify-all"];
  var mc = null;
  function mctx() { if (!mc) mc = PE.cx2(PE.mk(4, 4)); return mc; }
  var HAS_LS = typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;
  var HAS_CAPS = typeof CanvasRenderingContext2D !== "undefined" && "fontVariantCaps" in CanvasRenderingContext2D.prototype;

  function isExt(T) {
    return !!(T.box || T.track || T.base || (T.hs && T.hs !== 100) || (T.vs && T.vs !== 100) || T.caps || T.under || T.strike || T.fbold || T.sup || T.indL || T.indR || T.indF ||
      T.spB || T.spA || T.align && T.align.indexOf("justify") === 0 || T.kern === "none" || (T.weight && T.weight !== 400 && T.weight !== 700) || T.path || T.warp);
  }
  VX.isExtText = isExt;
  function effSize(T) { return Math.max(1, T.size) * (T.sup ? 0.62 : 1); }
  function css(T, size) { return (T.italic ? "italic " : "") + (T.weight || 400) + " " + Math.max(1, size) + 'px "' + PE.cleanFamily(T.font) + '", "Noto Sans Arabic", Tahoma, sans-serif'; }
  VX.fontCss = css;
  function setFont(c, T) {
    c.font = css(T, effSize(T)); c.direction = PE.textDir(T);
    if ("fontKerning" in c) c.fontKerning = T.kern === "none" ? "none" : "normal";
    if (HAS_CAPS) c.fontVariantCaps = T.caps === "small" ? "small-caps" : "normal";
    if (HAS_LS) c.letterSpacing = "0px";
  }
  function shown(T, s) { return T.caps === "all" || (T.caps === "small" && !HAS_CAPS) ? s.toUpperCase() : s; }
  function trackPx(T) { return (T.track || 0) / 1000 * effSize(T); }
  function chars(s) { return Array.from(s).length; }
  function measure(T, s) { var c = mctx(); return (c.measureText(shown(T, s)).width + trackPx(T) * chars(s)) * (T.hs || 100) / 100; }

  // ---------- layout ----------
  var LCACHE = new Map();
  function layout(T) {
    if (!isExt(T)) return null;
    if (T.path && VX.pathLayout) return VX.pathLayout(T);
    var key = JSON.stringify(T), hit = LCACHE.get(key);
    if (hit) return hit;
    var c = mctx(); setFont(c, T);
    var size = Math.max(1, T.size), L = size * (T.lh || 1.2), box = T.box, items = [], y = 0, maxW = 0, overflow = false;
    var paras = String(T.text).split("\n"), al = T.align || "left";
    paras.forEach(function (para, pi) {
      if (pi) y += T.spB || 0;
      var lines = [];
      if (box) {
        var words = para.split(/(\s+)/).filter(function (w) { return w.length; }), cur = "", first = true;
        var avail = function () { return Math.max(size * 0.5, box.w - (T.indL || 0) - (T.indR || 0) - (first ? T.indF || 0 : 0)); };
        words.forEach(function (wd) {
          var trial = cur + wd;
          if (!cur || measure(T, trial.replace(/\s+$/, "")) <= avail() || /^\s+$/.test(wd)) { cur = trial; }
          else { lines.push({ s: cur.replace(/\s+$/, ""), first: first }); first = false; cur = wd.replace(/^\s+/, ""); }
          while (measure(T, cur.replace(/\s+$/, "")) > avail() && chars(cur) > 1) {      // a word longer than the line: break it
            var arr = Array.from(cur), k = arr.length - 1;
            while (k > 1 && measure(T, arr.slice(0, k).join("")) > avail()) k--;
            lines.push({ s: arr.slice(0, k).join(""), first: first }); first = false; cur = arr.slice(k).join("");
          }
        });
        lines.push({ s: cur.replace(/\s+$/, ""), first: first, last: true });
      } else lines.push({ s: para, first: true, last: true });
      lines.forEach(function (ln) {
        var w = measure(T, ln.s), ind = (T.indL || 0) + (ln.first ? T.indF || 0 : 0);
        var it = { s: ln.s, w: w, y: y, first: ln.first, last: !!ln.last, ind: ind };
        if (box && y + L > box.h + 0.5 && items.length) { overflow = true; it.hidden = true; }
        items.push(it); maxW = Math.max(maxW, w + ind + (T.indR || 0)); y += L;
      });
      y += T.spA || 0;
    });
    var W = box ? box.w : Math.max(1, maxW), H = box ? box.h : Math.max(L, y - (T.spA || 0));
    var bx = box ? T.ax : al === "center" || al === "justify-center" ? T.ax - W / 2 : al === "right" || al === "justify-right" ? T.ax - W : T.ax;
    items.forEach(function (it) {      // horizontal placement inside the box
      var avail = W - it.ind - (T.indR || 0), just = box && (al === "justify-all" || (al.indexOf("justify") === 0 && !it.last));
      var gaps = (it.s.match(/\s+/g) || []).length;
      if (just && gaps) { it.gap = (avail - it.w) / gaps; it.x = it.ind; it.jw = avail; }
      else {
        var a = al === "justify-left" ? "left" : al === "justify-center" ? "center" : al === "justify-right" ? "right" : al === "justify-all" ? (PE.textDir(T) === "rtl" ? "right" : "left") : al;
        it.x = it.ind + (a === "center" ? (avail - it.w) / 2 : a === "right" ? avail - it.w : 0);
      }
    });
    var out = { lines: items.map(function (i) { return i.s; }), widths: items.map(function (i) { return i.w; }), w: W, h: H, lh: L, box: { x: bx, y: T.ay, w: W, h: H }, items: items, overflow: overflow };
    if (LCACHE.size > 300) LCACHE.clear();
    LCACHE.set(key, out);
    return out;
  }
  VX.layout = layout;

  // ---------- drawing ----------
  function drawRun(c, T, s, x, y, w, rtl) {      // one run at (x = left edge, y = middle line)
    var hs = (T.hs || 100) / 100, vs = (T.vs || 100) / 100, size = effSize(T), tp = trackPx(T), str = shown(T, s);
    c.save();
    c.translate(rtl ? x + w : x, y); c.scale(hs, vs);
    if (T.fital) c.transform(1, 0, -0.21, 1, 0, 0);
    c.textAlign = rtl ? "right" : "left";
    if (HAS_LS || !tp) {
      if (HAS_LS && tp) c.letterSpacing = tp + "px";
      c.fillText(str, 0, 0);
      if (T.fbold) c.strokeText(str, 0, 0);
    } else {      // no letterSpacing support: place characters one by one (left-to-right scripts)
      var px = 0;
      Array.from(str).forEach(function (ch) { c.fillText(ch, rtl ? -px : px, 0); if (T.fbold) c.strokeText(ch, rtl ? -px : px, 0); px += c.measureText(ch).width + tp; });
    }
    c.restore();
    var th = Math.max(1, size * 0.06);
    if (T.under) c.fillRect(x, y + size * 0.42 * vs, w, th * vs);
    if (T.strike) c.fillRect(x, y + size * 0.02 * vs - th * vs / 2, w, th * vs);
  }
  VX.drawRun = drawRun;
  VX.drawText = function (c, L, b) {
    var T = L.text;
    if (!isExt(T)) return false;
    if (T.path && VX.drawPathText) return VX.drawPathText(c, L, b);
    if (T.warp && VX.drawWarpText && T.warp.style !== "none") return VX.drawWarpText(c, L, b);
    drawLaid(c, T, layout(T));
    return true;
  };
  function drawLaid(c, T, lay) {
    var rtl = PE.textDir(T) === "rtl", size = effSize(T), shift = -(T.base || 0) + (T.sup === "sup" ? -T.size * 0.33 : T.sup === "sub" ? T.size * 0.18 : 0);
    setFont(c, T); c.textBaseline = "middle"; c.fillStyle = PE.hex(T.color, "#111111");
    if (T.fbold) { c.strokeStyle = c.fillStyle; c.lineWidth = size * 0.035; c.lineJoin = "round"; }
    var b = lay.box;
    lay.items.forEach(function (it) {
      if (it.hidden) return;
      var y = b.y + it.y + lay.lh / 2 + shift;
      if (it.gap != null) {      // justified: word by word
        var parts = it.s.split(/(\s+)/).filter(function (p) { return p.length; }), x = 0, space = measure(T, " ");
        if (rtl) parts.reverse();
        parts.forEach(function (p) {
          if (/^\s+$/.test(p)) { x += measure(T, p) + it.gap; return; }
          var pw = measure(T, p); drawRun(c, T, p, b.x + it.x + x, y, pw, rtl); x += pw;
        });
        if (T.under || T.strike) { var th = Math.max(1, size * 0.06), vs = (T.vs || 100) / 100; if (T.under) c.fillRect(b.x + it.x, y + size * 0.42 * vs, it.jw, th * vs); if (T.strike) c.fillRect(b.x + it.x, y + size * 0.02 * vs - th * vs / 2, it.jw, th * vs); }
        void space;
      } else drawRun(c, T, it.s, b.x + it.x, y, it.w, rtl);
    });
  }
  VX.drawLaid = drawLaid;
  VX.padText = function (L, pad) {
    var T = L.text; if (!isExt(T)) return pad;
    return pad + Math.abs(T.base || 0) + (T.fital || T.fbold ? T.size * 0.3 : 0) + (T.sup ? T.size * 0.4 : 0) + (T.under ? T.size * 0.2 : 0) + ((T.vs || 100) > 100 ? T.size * ((T.vs - 100) / 100) : 0);
  };

  // ---------- transforms ----------
  VX.xfText = function (T, c, sx, sy) {
    var k = Math.sqrt(Math.abs(sx * sy)) || 1, ax = Math.abs(sx), ay = Math.abs(sy);
    if (Math.abs(ax / ay - 1) > 1e-3) { T.hs = PE.clamp((T.hs || 100) * ax / k, 1, 1000); T.vs = PE.clamp((T.vs || 100) * ay / k, 1, 1000); }
    if (T.box) { T.box.w = Math.max(1, T.box.w * ax); T.box.h = Math.max(1, T.box.h * ay); }
    ["base", "indL", "indR", "indF", "spB", "spA"].forEach(function (f) { if (T[f]) T[f] *= k; });
    if (T.path && VX.xfPathText) { VX.xfPathText(T, c, sx, sy); return true; }
    var lay = PE.textLayout(T);
    if (T.box) { T.ax = c.x - lay.w / 2; T.ay = c.y - lay.h / 2; return true; }
    var al = T.align || "left", left = al === "left" || al === "justify-left" || al === "justify-all", right = al === "right" || al === "justify-right";
    T.ax = c.x + (left ? -lay.w / 2 : right ? lay.w / 2 : 0); T.ay = c.y - lay.h / 2;
    return true;
  };
  VX.scaleText = function (T, kx, ky) {
    var k = Math.sqrt(kx * ky);
    if (T.box) { T.box.w = Math.max(1, T.box.w * kx); T.box.h = Math.max(1, T.box.h * ky); }
    ["base", "indL", "indR", "indF", "spB", "spA"].forEach(function (f) { if (T[f]) T[f] *= k; });
    if (T.path && VX.scalePathText) VX.scalePathText(T, kx, ky);
  };

  // ---------- on-canvas editor (the text box) ----------
  VX.placeText = function (ta, L) {
    var T = L.text;
    ta.style.fontWeight = String(T.weight || 400);
    ta.style.letterSpacing = T.track ? (T.track / 1000 * T.size * ED.zoom) + "px" : "";
    ta.style.textTransform = T.caps === "all" ? "uppercase" : "";
    ta.style.fontVariantCaps = T.caps === "small" ? "small-caps" : "";
    ta.style.textDecoration = [T.under ? "underline" : "", T.strike ? "line-through" : ""].join(" ").trim();
    ta.style.fontKerning = T.kern === "none" ? "none" : "";
    if (!T.box) { ta.style.whiteSpace = ""; ta.style.textIndent = ""; ta.style.paddingLeft = ta.style.paddingRight = ""; ta.style.boxSizing = ""; return; }
    var z = ED.zoom, s = ED.toScr(T.ax, T.ay), lay = PE.textLayout(T);
    ta.style.boxSizing = "border-box"; ta.style.whiteSpace = "pre-wrap";
    ta.style.left = s.x + "px"; ta.style.top = s.y + "px"; ta.style.width = T.box.w * z + "px"; ta.style.height = Math.max(T.box.h, lay.h) * z + "px";
    ta.style.textAlign = /^justify/.test(T.align) ? "justify" : T.align;
    ta.style.textIndent = (T.indF || 0) * z + "px"; ta.style.paddingLeft = (T.indL || 0) * z + "px"; ta.style.paddingRight = (T.indR || 0) * z + "px";
  };

  // ---------- project files ----------
  VX.onParseLayer(function (raw, out) {
    if (out.kind !== "text" || !raw.text || typeof raw.text !== "object") return;
    var r = raw.text, T = out.text, n = VX.num;
    if (r.weight != null) T.weight = Math.round(n(r.weight, 100, 900, 400) / 100) * 100;
    if (ALIGNS.indexOf(r.align) >= 0) T.align = r.align;
    if (r.box && typeof r.box === "object") T.box = { w: n(r.box.w, 1, 3 * PE.LIM.side, 100), h: n(r.box.h, 1, 3 * PE.LIM.side, 100) };
    if (r.track != null) T.track = n(r.track, -1000, 10000, 0);
    if (r.kern === "none") T.kern = "none";
    if (r.base != null) T.base = n(r.base, -2000, 2000, 0);
    if (r.hs != null) T.hs = n(r.hs, 1, 1000, 100);
    if (r.vs != null) T.vs = n(r.vs, 1, 1000, 100);
    if (r.caps === "all" || r.caps === "small") T.caps = r.caps;
    if (r.sup === "sup" || r.sup === "sub") T.sup = r.sup;
    ["under", "strike", "fbold", "fital"].forEach(function (f) { if (r[f] === true) T[f] = true; });
    ["indL", "indR", "indF"].forEach(function (f) { if (r[f] != null) T[f] = n(r[f], -1e4, 1e4, 0); });
    ["spB", "spA"].forEach(function (f) { if (r[f] != null) T[f] = n(r[f], 0, 1e4, 0); });
  });

  // ---------- paragraph boxes: drag with the type tool; resize the box of the selected paragraph layer ----------
  var TT = ED.TOOLS.text, down0 = TT.down;
  function boxOf(L) { var b = PE.vbox(L); return b; }
  function local(L, p) { var b = boxOf(L), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; return PE.rotPt(p.x, p.y, c.x, c.y, -(b.rot || 0)); }
  var HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  function boxHandle(L, p) {
    var b = boxOf(L), q = local(L, p), t = 8 / ED.zoom;
    for (var i = 0; i < HANDLES.length; i++) { var hx = b.x + (HANDLES[i][0] + 1) / 2 * b.w, hy = b.y + (HANDLES[i][1] + 1) / 2 * b.h; if (Math.abs(q.x - hx) <= t && Math.abs(q.y - hy) <= t) return HANDLES[i]; }
    return null;
  }
  function textAt(p) {
    var d = ED.doc;
    for (var i = d.layers.length - 1; i >= 0; i--) {
      var L = d.layers[i]; if (L.kind !== "text" || !L.visible) continue;
      var b = PE.vbox(L), q = PE.rotPt(p.x, p.y, b.x + b.w / 2, b.y + b.h / 2, -b.rot);
      if (q.x >= b.x - 4 && q.x <= b.x + b.w + 4 && q.y >= b.y - 4 && q.y <= b.y + b.h + 4) return L;
    }
    return null;
  }
  TT.down = function (p, e) {
    var L = ED.layer();
    if (L && L.kind === "text" && L.text.box && !L.locked && L.visible) {
      var hd = boxHandle(L, p);
      if (hd) { var b = boxOf(L); ED.drag = { kind: "tresize", L: L, hd: hd, b0: { x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot }, p0: local(L, p), before: PE.snap(ED.doc), cancel: function () { PE.restore(ED.doc, ED.drag.before); ED.changed(); } }; return; }
    }
    if (VX.textDownExt && VX.textDownExt(p, e)) return;
    if (textAt(p)) { down0(p, e); return; }
    ED.drag = { kind: "tbox", a: p, b: null };
  };
  TT.move = function (p, e) {
    var dr = ED.drag; if (!dr) return;
    if (dr.kind === "tbox") { dr.b = e && e.shiftKey ? { x: dr.a.x + Math.max(p.x - dr.a.x, p.y - dr.a.y), y: dr.a.y + Math.max(p.x - dr.a.x, p.y - dr.a.y) } : p; ED.renderOvl(); return; }
    if (dr.kind === "tresize") {
      var q = local(dr.L, p), b = dr.b0, x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h, dx = q.x - dr.p0.x, dy = q.y - dr.p0.y;
      if (dr.hd[0] < 0) x0 = Math.min(x1 - 4, x0 + dx); if (dr.hd[0] > 0) x1 = Math.max(x0 + 4, x1 + dx);
      if (dr.hd[1] < 0) y0 = Math.min(y1 - 4, y0 + dy); if (dr.hd[1] > 0) y1 = Math.max(y0 + 4, y1 + dy);
      var c0 = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, nc = PE.rotPt((x0 + x1) / 2, (y0 + y1) / 2, c0.x, c0.y, b.rot || 0), T = dr.L.text;
      T.box = { w: x1 - x0, h: y1 - y0 }; T.ax = nc.x - T.box.w / 2; T.ay = nc.y - T.box.h / 2;
      ED.render(); ED.renderOvl(); if (ED.textL === dr.L) ED.placeText();
    }
  };
  TT.up = function (p, e) {
    var dr = ED.drag; ED.drag = null; if (!dr) return;
    if (dr.kind === "tresize") { ED.push(PE.metaEntry("Resize text box", ED.doc, dr.before)); return; }
    if (dr.kind !== "tbox") return;
    var b = dr.b;
    if (!b || Math.abs(b.x - dr.a.x) * ED.zoom < 8 || Math.abs(b.y - dr.a.y) * ED.zoom < 8) { down0(dr.a, e || {}); return; }
    var o = ED.o.text, before = PE.snap(ED.doc), x = Math.min(dr.a.x, b.x), y = Math.min(dr.a.y, b.y);
    var L = PE.newLayer("text", { name: "Paragraph", text: { text: "", font: o.font, size: o.size, weight: o.weight, italic: o.italic, color: ED.doc.fg, align: o.align, dir: o.dir, ax: x, ay: y, box: { w: Math.abs(b.x - dr.a.x), h: Math.abs(b.y - dr.a.y) } } });
    var d = ED.doc, i = d.layers.indexOf(ED.layer()); d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, L); d.active = L.id;
    ED.emit("layers"); ED.startText(L, before, true);
  };
  TT.cursor = function (p) { var L = ED.layer(); if (L && L.kind === "text" && L.text.box && boxHandle(L, p)) return "nwse-resize"; return "text"; };
  ED.on("ovl", function (o) {
    var dr = ED.drag, c = o.c;
    if (dr && dr.kind === "tbox" && dr.b) o.docPath(c, function (c2, px) { c2.lineWidth = px; c2.setLineDash([4 * px, 3 * px]); c2.strokeStyle = "#1b8cff"; c2.strokeRect(dr.a.x, dr.a.y, dr.b.x - dr.a.x, dr.b.y - dr.a.y); c2.setLineDash([]); });
    var L = ED.layer();
    if (ED.tool !== "text" || !L || L.kind !== "text" || !L.text.box || !L.visible) return;
    var b = boxOf(L), lay = PE.textLayout(L.text), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    o.docPath(c, function (c2, px) {
      c2.translate(cx, cy); c2.rotate((b.rot || 0) * Math.PI / 180); c2.translate(-cx, -cy);
      c2.lineWidth = px; c2.strokeStyle = "#1b8cff"; c2.strokeRect(b.x, b.y, b.w, b.h);
      HANDLES.forEach(function (hd) { var hx = b.x + (hd[0] + 1) / 2 * b.w, hy = b.y + (hd[1] + 1) / 2 * b.h; c2.fillStyle = "#fff"; c2.fillRect(hx - 3.5 * px, hy - 3.5 * px, 7 * px, 7 * px); c2.strokeRect(hx - 3.5 * px, hy - 3.5 * px, 7 * px, 7 * px); });
      if (lay.overflow) { var x = b.x + b.w, y = b.y + b.h; c2.fillStyle = "#e5484d"; c2.fillRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px); c2.strokeStyle = "#fff"; c2.lineWidth = 1.5 * px; c2.beginPath(); c2.moveTo(x - 3 * px, y); c2.lineTo(x + 3 * px, y); c2.moveTo(x, y - 3 * px); c2.lineTo(x, y + 3 * px); c2.stroke(); }
    });
  });

  // ---------- Character and Paragraph panels ----------
  var WEIGHTS = [[100, "Thin"], [200, "Extra light"], [300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"], [900, "Black"]];
  function textLayer() { var L = ED.textL || ED.layer(); return L && L.kind === "text" ? L : null; }
  // change the current text: inside an on-canvas edit it joins that edit's history step
  function setT(label, fn) {
    var L = textLayer(); if (!L) return;
    if (ED.textL === L) { fn(L.text); ED.placeText(); ED.render(); return; }
    if (!ED.editable(L)) return;
    UI.live(label, function () { fn(L.text); });
  }
  VX.setText = setT;
  var cpanel = null, ppanel = null, cbody = null, pbody = null;
  function tog(label, on, f, title) {
    var b = h("button", { type: "button", "class": "btn small ghost pe-vtog", "aria-pressed": String(!!on), title: title || label }, [label]);
    b.addEventListener("click", function () { var v = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(v)); f(v); });
    return b;
  }
  function buildChar() {
    cbody.textContent = "";
    var L = textLayer(); if (!L) return;
    var T = L.text, w = ED.ui.w;
    var fonts = PE.deviceFonts().slice(); if (fonts.indexOf(T.font) < 0) fonts.unshift(T.font);
    cbody.appendChild(h("div", { "class": "pe-pgrid" }, [
      h("div", { "class": "pe-span2" }, [UI.psel("Font", fonts.map(function (f) { return [f, f]; }), T.font, function (v) { setT("Font", function (t) { t.font = v; }); })]),
      UI.psel("Weight", WEIGHTS, T.weight || 400, function (v) { setT("Font weight", function (t) { t.weight = +v; }); }),
      UI.pnum("Size (px)", T.size, function (v) { setT("Font size", function (t) { t.size = v; }); }, 1, 1, 2000),
      UI.pnum("Leading (px)", Math.round(T.size * (T.lh || 1.2) * 10) / 10, function (v) { setT("Leading", function (t) { t.lh = PE.clamp(v / t.size, 0.3, 6); }); }, 1, 1, 12000),
      UI.pnum("Tracking (‰ em)", T.track || 0, function (v) { setT("Tracking", function (t) { t.track = v; if (!v) delete t.track; }); }, 10, -1000, 10000),
      UI.psel("Kerning", [["metrics", "Font metrics"], ["none", "None"]], T.kern || "metrics", function (v) { setT("Kerning", function (t) { if (v === "none") t.kern = "none"; else delete t.kern; }); }),
      UI.pnum("Baseline shift (px)", T.base || 0, function (v) { setT("Baseline shift", function (t) { t.base = v; if (!v) delete t.base; }); }, 1, -2000, 2000),
      UI.pnum("Horizontal scale %", T.hs || 100, function (v) { setT("Horizontal scale", function (t) { t.hs = v; if (v === 100) delete t.hs; }); }, 1, 1, 1000),
      UI.pnum("Vertical scale %", T.vs || 100, function (v) { setT("Vertical scale", function (t) { t.vs = v; if (v === 100) delete t.vs; }); }, 1, 1, 1000),
      UI.pcolor("Colour", T.color, function (v) { setT("Text colour", function (t) { t.color = v; }); })
    ]));
    cbody.appendChild(h("div", { "class": "pe-prow pe-vtogs" }, [
      tog("B", T.fbold, function (v) { setT("Faux bold", function (t) { if (v) t.fbold = true; else delete t.fbold; }); }, "Faux bold"),
      tog("I", T.fital, function (v) { setT("Faux italic", function (t) { if (v) t.fital = true; else delete t.fital; }); }, "Faux italic (slant)"),
      tog("TT", T.caps === "all", function (v) { setT("All caps", function (t) { if (v) t.caps = "all"; else delete t.caps; }); buildChar(); }, "All caps"),
      tog("Tt", T.caps === "small", function (v) { setT("Small caps", function (t) { if (v) t.caps = "small"; else delete t.caps; }); buildChar(); }, "Small caps"),
      tog("T¹", T.sup === "sup", function (v) { setT("Superscript", function (t) { if (v) t.sup = "sup"; else delete t.sup; }); buildChar(); }, "Superscript"),
      tog("T₁", T.sup === "sub", function (v) { setT("Subscript", function (t) { if (v) t.sup = "sub"; else delete t.sup; }); buildChar(); }, "Subscript"),
      tog("U", T.under, function (v) { setT("Underline", function (t) { if (v) t.under = true; else delete t.under; }); }, "Underline"),
      tog("S", T.strike, function (v) { setT("Strikethrough", function (t) { if (v) t.strike = true; else delete t.strike; }); }, "Strikethrough"),
      w.check("Italic", T.italic, function (v) { setT("Italic", function (t) { t.italic = v; }); })
    ]));
  }
  function buildPara() {
    pbody.textContent = "";
    var L = textLayer(); if (!L) return;
    var T = L.text, w = ED.ui.w;
    pbody.appendChild(w.seg("", [["left", "Left", "Align left", "t-al"], ["center", "Centre", "Align centre", "t-ac"], ["right", "Right", "Align right", "t-ar"],
      ["justify-left", "J←", "Justify, last line left"], ["justify-center", "J↔", "Justify, last line centred"], ["justify-right", "J→", "Justify, last line right"], ["justify-all", "J≡", "Justify all lines"]], T.align || "left", function (v) {
      setT("Paragraph alignment", function (t) {
        if (!t.box) {      // point text: keep the text where it is
          var b = PE.textLayout(t).box; t.align = v; t.ax = v === "center" || v === "justify-center" ? b.x + b.w / 2 : v === "right" || v === "justify-right" ? b.x + b.w : b.x;
        } else t.align = v;
      });
    }));
    pbody.appendChild(h("div", { "class": "pe-pgrid" }, [
      UI.pnum("Indent left", T.indL || 0, function (v) { setT("Indent", function (t) { t.indL = v; if (!v) delete t.indL; }); }, 1, -1e4, 1e4),
      UI.pnum("Indent right", T.indR || 0, function (v) { setT("Indent", function (t) { t.indR = v; if (!v) delete t.indR; }); }, 1, -1e4, 1e4),
      UI.pnum("First line", T.indF || 0, function (v) { setT("First line indent", function (t) { t.indF = v; if (!v) delete t.indF; }); }, 1, -1e4, 1e4),
      UI.psel("Direction", [["auto", "Auto"], ["ltr", "Left to right"], ["rtl", "Right to left"]], T.dir || "auto", function (v) { setT("Direction", function (t) { t.dir = v; }); }),
      UI.pnum("Space before", T.spB || 0, function (v) { setT("Space before", function (t) { t.spB = v; if (!v) delete t.spB; }); }, 1, 0, 1e4),
      UI.pnum("Space after", T.spA || 0, function (v) { setT("Space after", function (t) { t.spA = v; if (!v) delete t.spA; }); }, 1, 0, 1e4)
    ]));
    var conv = T.box ? w.btn("Convert to point text", function () { setT("Convert to point text", function (t) { var lay = PE.textLayout(t); t.text = lay.lines.join("\n"); delete t.box; if (/^justify/.test(t.align)) t.align = "left"; }); refreshPanels(); }, "ghost")
      : w.btn("Convert to paragraph text", function () { setT("Convert to paragraph text", function (t) { var b = PE.textLayout(t).box; t.box = { w: Math.ceil(b.w + t.size * 0.5), h: Math.ceil(b.h + t.size * 0.3) }; t.ax = b.x; t.ay = b.y; }); refreshPanels(); }, "ghost");
    pbody.appendChild(h("div", { "class": "pe-prow" }, [conv]));
  }
  function refreshPanels() {
    if (!cpanel) return;
    var L = textLayer(), on = !!L;
    cpanel.hidden = ppanel.hidden = !on;
    if (on) { if (!cbody.contains(document.activeElement)) buildChar(); if (!pbody.contains(document.activeElement)) buildPara(); }
  }
  VX.refreshTextPanels = refreshPanels;
  var soon = S3.debounce(refreshPanels, 80);
  function build() {
    var side = document.querySelector(".pe-side"); if (!side) return;
    var props = side.querySelector("#props"), after = props ? props.closest(".pe-panel") : null;
    cbody = h("div", { "class": "pe-pbody" }); pbody = h("div", { "class": "pe-pbody" });
    cpanel = h("details", { "class": "pe-panel", open: S3.store("pe-vchar") !== false }, [h("summary", { text: "Character" }), cbody]);
    ppanel = h("details", { "class": "pe-panel", open: S3.store("pe-vpara") !== false }, [h("summary", { text: "Paragraph" }), pbody]);
    cpanel.addEventListener("toggle", function () { S3.store("pe-vchar", cpanel.open); });
    ppanel.addEventListener("toggle", function () { S3.store("pe-vpara", ppanel.open); });
    side.insertBefore(ppanel, after ? after.nextSibling : side.firstChild);
    side.insertBefore(cpanel, ppanel);
    refreshPanels();
  }
  ED.on("vready", build); ED.on("changed", soon); ED.on("layers", soon); ED.on("tool", soon);

  // Properties: for paragraph text the core alignment row would move the box, so it is replaced
  UI.props(function (P, L) {
    if (!L || L.kind !== "text") return;
    var rows = P.querySelectorAll(".pe-prow");
    Array.prototype.forEach.call(rows, function (r) { if (r.querySelector('[title="Align left"]')) r.remove(); });
    var T = L.text;
    if (T.box) P.insertBefore(h("p", { "class": "faint pe-p", text: "Paragraph text " + Math.round(T.box.w) + " × " + Math.round(T.box.h) + " px: drag its box handles with the type tool. Alignment and indents are in the Paragraph panel." }), P.children[2] || null);
  });

  // type tool options: hint about paragraph boxes
  UI.opts("text", function (items) {
    return items.map(function (x) { if (x.classList && x.classList.contains("pe-hint")) x.textContent = "Click for point text, drag a box for paragraph text; click a text layer to edit it. " + ED.ui.w.K("Ctrl+Enter or Esc finishes."); return x; });
  });
})();
