/* Vector lane: character runs. Part of a text layer can have its own font, weight, size, colour, tracking, baseline
   shift, scale, caps, super/subscript, underline, strike and faux styles: select characters while editing (or in the
   Properties text box) and change a Character setting. Runs are T.runs = [{a, b, s}] (UTF-16 offsets, style
   overrides), kept in step with edits, laid out word by word with mixed sizes on a shared baseline. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, VG = PE.VG, h = S3.h;
  var KEYS = VX.RUN_KEYS = ["font", "weight", "italic", "size", "color", "track", "base", "hs", "vs", "caps", "sup", "under", "strike", "fbold", "fital"];

  // ---------- run bookkeeping ----------
  function segments(T) {      // the whole text as [{a, b, st}] with resolved styles
    var segs = [], pos = 0, n = String(T.text).length;
    (T.runs || []).forEach(function (r) {
      var a = Math.max(pos, Math.min(n, r.a)), b = Math.min(n, r.b);
      if (a > pos) segs.push({ a: pos, b: a, st: T });
      if (b > a) segs.push({ a: a, b: b, st: Object.assign({}, T, r.s, { runs: null }) });
      pos = Math.max(pos, b);
    });
    if (pos < n || !segs.length) segs.push({ a: pos, b: n, st: T });
    return segs;
  }
  VX.runSegments = segments;
  function styleAt(T, i) { var r = (T.runs || []).filter(function (x) { return x.a <= i && i < x.b; })[0]; return r ? Object.assign({}, T, r.s, { runs: null }) : T; }
  VX.styleAt = styleAt;
  function normalize(T) {
    var n = String(T.text).length, rs = (T.runs || []).filter(function (r) { return r.b > r.a && r.a < n && Object.keys(r.s || {}).length; }).sort(function (x, y) { return x.a - y.a; }), out = [];
    rs.forEach(function (r) {
      r = { a: Math.max(0, r.a), b: Math.min(n, r.b), s: r.s };
      Object.keys(r.s).forEach(function (k) { if (r.s[k] === T[k] || (r.s[k] == null)) delete r.s[k]; });      // same as the layer: not an override
      if (!Object.keys(r.s).length || r.b <= r.a) return;
      var l = out[out.length - 1];
      if (l && l.b >= r.a && JSON.stringify(l.s) === JSON.stringify(r.s)) l.b = Math.max(l.b, r.b);
      else out.push(r);
    });
    if (out.length) T.runs = out.slice(0, 500); else delete T.runs;
  }
  VX.normalizeRuns = normalize;
  // set key = value on characters [a, b)
  VX.setRange = function (T, a, b, key, value) {
    if (a >= b) return;
    var rs = [], pos = a;
    (T.runs || []).forEach(function (r) {
      if (r.b <= a || r.a >= b) { rs.push(r); return; }
      if (r.a < a) rs.push({ a: r.a, b: a, s: Object.assign({}, r.s) });
      if (r.b > b) rs.push({ a: b, b: r.b, s: Object.assign({}, r.s) });
      var mid = { a: Math.max(r.a, a), b: Math.min(r.b, b), s: Object.assign({}, r.s) }; mid.s[key] = value; rs.push(mid);
    });
    rs.sort(function (x, y) { return x.a - y.a; });
    var filled = [];      // gaps inside [a, b) without a run get a new one
    rs.forEach(function (r) { if (r.a >= a && r.b <= b) { if (r.a > pos) filled.push({ a: pos, b: r.a, s: (function () { var o = {}; o[key] = value; return o; })() }); pos = Math.max(pos, r.b); } });
    if (pos < b) { var o = {}; o[key] = value; filled.push({ a: pos, b: b, s: o }); }
    T.runs = rs.concat(filled);
    normalize(T);
  };
  // keep runs on the same characters after the text changes from old to now (new typing takes the style before it)
  VX.shiftRuns = function (T, old, now) {
    if (!T.runs || old === now) return;
    var p = 0, n0 = old.length, n1 = now.length;
    while (p < n0 && p < n1 && old.charCodeAt(p) === now.charCodeAt(p)) p++;
    var q = 0; while (q < n0 - p && q < n1 - p && old.charCodeAt(n0 - 1 - q) === now.charCodeAt(n1 - 1 - q)) q++;
    var oldEnd = n0 - q, ins = n1 - p - q, delta = n1 - n0;
    T.runs = T.runs.map(function (r) {
      var a = r.a < p ? r.a : r.a >= oldEnd ? r.a + delta : p + ins;
      var b = r.b <= p ? (r.b === p && r.a < p ? p + ins : r.b) : r.b >= oldEnd ? r.b + delta : p + ins;
      if (r.a < p && r.b > p && r.b < oldEnd) b = p + ins;
      return { a: a, b: b, s: r.s };
    });
    normalize(T);
  };

  // ---------- layout with runs ----------
  var LC = new Map();
  VX.layoutRuns = function (T) {
    var key = JSON.stringify(T), hit = LC.get(key); if (hit) return hit;
    var c = VX.mctx(), text = String(T.text), segs = segments(T), box = T.box, al = T.align || "left", rtl = PE.textDir(T) === "rtl";
    function meas(st, s) { VX.setFont(c, st); return VX.measureText(st, s); }
    // tokens: paragraph breaks, words, spaces, split at run boundaries
    var paras = [[]], si = 0;
    for (var i = 0; i < text.length;) {
      while (segs[si] && segs[si].b <= i) si++;
      var seg = segs[si] || segs[segs.length - 1], ch = text[i];
      if (ch === "\n") { paras.push([]); i++; continue; }
      var sp = /\s/.test(ch), j = i + 1;
      while (j < text.length && j < seg.b && text[j] !== "\n" && /\s/.test(text[j]) === sp) j++;
      var t = text.slice(i, j), P = paras[paras.length - 1], last = P[P.length - 1];
      P.push({ t: t, st: seg.st, sp: sp, w: meas(seg.st, t), join: last && !last.sp && !sp });      // join: continues the previous word
      i = j;
    }
    var items = [], y = 0, maxW = 0, overflow = false;
    paras.forEach(function (toks, pi) {
      if (pi) y += T.spB || 0;
      // group into words (tokens joined without spaces) and spaces
      var groups = [];
      toks.forEach(function (tk) { if (tk.join) groups[groups.length - 1].push(tk); else groups.push([tk]); });
      var lines = [], cur = [], cw = 0, first = true;
      function avail() { return box ? Math.max(T.size * 0.5, box.w - (T.indL || 0) - (T.indR || 0) - (first ? T.indF || 0 : 0)) : Infinity; }
      groups.forEach(function (g) {
        var gw = g.reduce(function (s, tk) { return s + tk.w; }, 0), isSp = g[0].sp;
        if (box && !isSp && cur.length && cw + gw > avail()) {
          while (cur.length && cur[cur.length - 1].sp) cw -= cur.pop().w;      // drop trailing spaces
          lines.push({ toks: cur, first: first }); first = false; cur = []; cw = 0;
        }
        if (isSp && !cur.length && lines.length) return;      // no leading spaces on wrapped lines
        g.forEach(function (tk) { cur.push(tk); }); cw += gw;
      });
      while (cur.length > 1 && cur[cur.length - 1].sp) cur.pop();
      lines.push({ toks: cur, first: first, last: true });
      lines.forEach(function (ln) {
        var w = ln.toks.reduce(function (s, tk) { return s + tk.w; }, 0), big = ln.toks.reduce(function (m, tk) { return Math.max(m, tk.st.size); }, ln.toks.length ? 0 : T.size);
        var L = big * (T.lh || 1.2), ind = (T.indL || 0) + (ln.first ? T.indF || 0 : 0), it = { toks: ln.toks, w: w, y: y, h: L, big: big, ind: ind, first: ln.first, last: !!ln.last, s: ln.toks.map(function (tk) { return tk.t; }).join("") };
        if (box && y + L > box.h + 0.5 && items.length) { overflow = true; it.hidden = true; }
        items.push(it); maxW = Math.max(maxW, w + ind + (T.indR || 0)); y += L;
      });
      y += T.spA || 0;
    });
    var W = box ? box.w : Math.max(1, maxW), H = box ? box.h : Math.max(T.size * (T.lh || 1.2), y - (T.spA || 0));
    var bx = box ? T.ax : al === "center" || al === "justify-center" ? T.ax - W / 2 : al === "right" || al === "justify-right" ? T.ax - W : T.ax;
    items.forEach(function (it) {
      var av = W - it.ind - (T.indR || 0), just = box && (al === "justify-all" || (al.indexOf("justify") === 0 && !it.last)), gaps = it.toks.filter(function (tk) { return tk.sp; }).length;
      it.gap = just && gaps ? (av - it.w) / gaps : 0;
      var a = al === "justify-left" || al === "justify-all" ? (rtl ? "right" : "left") : al === "justify-center" ? "center" : al === "justify-right" ? "right" : al;
      it.x = it.ind + (it.gap ? 0 : a === "center" ? (av - it.w) / 2 : a === "right" ? av - it.w : 0);
      it.span = it.gap ? av : it.w;
    });
    var out = { runs: true, lines: items.map(function (i) { return i.s; }), widths: items.map(function (i) { return i.w; }), w: W, h: H, lh: T.size * (T.lh || 1.2), box: { x: bx, y: T.ay, w: W, h: H }, items: items, overflow: overflow };
    if (LC.size > 200) LC.clear();
    LC.set(key, out);
    return out;
  };
  VX.drawRuns = function (c, T, lay) {
    var rtl = PE.textDir(T) === "rtl", b = lay.box;
    c.textBaseline = "middle";
    lay.items.forEach(function (it) {
      if (it.hidden) return;
      var base = b.y + it.y + it.h / 2 + it.big * 0.35, x = rtl ? b.x + it.x + it.span : b.x + it.x;
      it.toks.forEach(function (tk) {
        var w = tk.w + (tk.sp ? it.gap : 0), st = tk.st;
        if (tk.sp) { x += rtl ? -w : w; return; }
        var es = VX.effSize(st), y = base - es * 0.35 - (st.base || 0) + (st.sup === "sup" ? -st.size * 0.33 : st.sup === "sub" ? st.size * 0.18 : 0);
        VX.setFont(c, st); c.fillStyle = PE.hex(st.color, "#111111");
        if (st.fbold) { c.strokeStyle = c.fillStyle; c.lineWidth = es * 0.035; c.lineJoin = "round"; }
        VX.drawRun(c, st, tk.t, rtl ? x - w : x, y, w, rtl);
        x += rtl ? -w : w;
      });
    });
  };

  // ---------- path text with runs: style per letter ----------
  var pathLayout0 = VX.pathLayout;
  VX.pathLayout = function (T) {
    var lay = pathLayout0(T);
    if (!T.runs || !T.runs.length || lay._runs) return lay;
    var text = String(T.text).replace(/\s*\n\s*/g, " ");
    // re-measure letter by letter with each letter's style, keeping the start point and alignment of the plain layout
    var units = [], idx = 0;
    Array.from(text).forEach(function (ch) { units.push({ ch: ch, st: styleAt(T, idx) }); idx += ch.length; });
    var c = VX.mctx(), ws = units.map(function (u) { VX.setFont(c, u.st); return VX.measureText(u.st, u.ch); }), total = ws.reduce(function (a, x) { return a + x; }, 0);
    var shift = (total - lay.total), al = T.align || "left", s0 = (T.path.off || 0) * lay.len - (al === "center" || al === "justify-center" ? total / 2 : al === "right" || al === "justify-right" ? total : 0);
    var P = VX.pathPoly(T), acc = 0, glyphs = [];
    units.forEach(function (u, i) {
      var mid = s0 + acc + ws[i] / 2; acc += ws[i];
      if (/^\s$/.test(u.ch)) return;
      if (!P.closed && (mid < -0.5 || mid > P.len + 0.5)) return;
      var q = VX.pathAt(P, mid); glyphs.push({ u: u.ch, x: q.x, y: q.y, a: q.a, w: ws[i], st: u.st });
    });
    var out = Object.assign({}, lay, { glyphs: glyphs, total: total, _runs: true });
    void shift;
    return out;
  };

  // ---------- capture the selected characters for the Character panel ----------
  VX.charSel = null;      // { id, a, b, text }
  function track(ta, L) { if (!L) return; var a = ta.selectionStart, b = ta.selectionEnd; VX.charSel = a < b ? { id: L.id, a: a, b: b, text: L.text.text } : null; if (VX.refreshTextPanels) VX.refreshTextPanels(); }
  VX.selRange = function (L) {
    var s = VX.charSel;
    if (!s || !L || s.id !== L.id || s.text !== L.text.text) return null;
    return s;
  };
  function wire(ta, getL) {
    var prev = null;
    ta.addEventListener("beforeinput", function () { var L = getL(); prev = L ? L.text.text : null; });
    ta.addEventListener("input", function () {
      var L = getL(); if (!L || prev == null) return;
      if (L.text.runs) { var old = prev; VX.shiftRuns(L.text, old, ta.value.slice(0, PE.LIM.text)); }
      prev = null;
    });
    ["select", "keyup", "mouseup", "pointerup"].forEach(function (ev) { ta.addEventListener(ev, function () { track(ta, getL()); }); });
  }
  ED.on("vready", function () {
    var ta = document.querySelector("#textEdit");
    if (ta) wire(ta, function () { return ED.textL; });
  });
  // the Properties text box edits the same text
  VX.ui.props(function (P, L) {
    if (!L || L.kind !== "text") return;
    var t = P.querySelector("textarea"); if (!t) return;
    wire(t, function () { return L; });
    if (L.text.runs && L.text.runs.length) P.appendChild(h("div", { "class": "pe-prow" }, [h("span", { "class": "faint", text: L.text.runs.length + " styled range" + (L.text.runs.length > 1 ? "s" : "") }),
      ED.ui.w.btn("Clear character styles", function () { VX.setText("Clear character styles", function (T) { delete T.runs; }); ED.ui.buildProps(); }, "ghost")]));
  });
  ED.on("layers", function () { var L = ED.layer(); if (VX.charSel && (!L || L.id !== VX.charSel.id)) VX.charSel = null; });

  // ---------- project files ----------
  VX.onParseLayer(function (raw, out) {
    if (out.kind !== "text" || !raw.text || !Array.isArray(raw.text.runs)) return;
    var n = out.text.text.length, num = VX.num, T = out.text;
    var rs = raw.text.runs.slice(0, 500).map(function (r) {
      if (!r || typeof r !== "object" || !r.s || typeof r.s !== "object") return null;
      var a = Math.round(num(r.a, 0, n, 0)), b = Math.round(num(r.b, 0, n, 0)), s = {}, x = r.s;
      if (b <= a) return null;
      if (typeof x.font === "string") s.font = PE.cleanFamily(x.font);
      if (x.weight != null) s.weight = Math.round(num(x.weight, 100, 900, 400) / 100) * 100;
      if (x.italic === true || x.italic === false) s.italic = x.italic;
      if (x.size != null) s.size = num(x.size, 1, 2000, T.size);
      if (x.color != null) s.color = PE.hex(x.color, T.color);
      if (x.track != null) s.track = num(x.track, -1000, 10000, 0);
      if (x.base != null) s.base = num(x.base, -2000, 2000, 0);
      if (x.hs != null) s.hs = num(x.hs, 1, 1000, 100);
      if (x.vs != null) s.vs = num(x.vs, 1, 1000, 100);
      if (x.caps === "all" || x.caps === "small" || x.caps === null) s.caps = x.caps || undefined;
      if (x.sup === "sup" || x.sup === "sub") s.sup = x.sup;
      ["under", "strike", "fbold", "fital"].forEach(function (k) { if (x[k] === true || x[k] === false) s[k] = x[k]; });
      Object.keys(s).forEach(function (k) { if (s[k] === undefined) delete s[k]; });
      return Object.keys(s).length ? { a: a, b: b, s: s } : null;
    }).filter(Boolean);
    if (rs.length) { T.runs = rs; normalize(T); }
  });
  void VG;
})();
