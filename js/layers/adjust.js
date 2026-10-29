/* Selection lane: adjustment layers. A layer of kind "adjust" holds {op, p} for one colour adjustment
   (any colour op of PIX.adjust: levels, curves, hue/saturation…) and changes everything below it inside its
   group, weighted by its mask and opacity. Settings stay editable in Properties; nothing is baked until a merge. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, ED = PE.ed, SX = PE.sx, h = S3.h;
  PE.kindsExt.push("adjust");
  // Filters (spatial) are not offered as adjustment layers. Other lanes can mark new specs with `filter: true`.
  var FILTERS = { blur: 1, unsharp: 1, sharpen: 1, noise: 1, pixelate: 1, vignette: 1 };
  var QUICK = { invert: "Invert", desaturate: "Desaturate" };
  // State object for another lane's custom settings UI (spec.ui(el, st)): st.p params, st.schedule() after a change.
  function uiState(p, L, schedule) {
    var d = ED.doc, small = d ? PE.getData(PE.flatten(d, { hide: L ? L.id : null, scale: Math.min(1, 256 / Math.max(d.w, d.h)) })) : null;
    return { p: p, op: null, schedule: schedule, run: schedule, previewOn: true, t: { img: small ? { data: small.data, width: small.width, height: small.height } : { data: new Uint8ClampedArray(4), width: 1, height: 1 }, L: L, r: { x: 0, y: 0, w: d ? d.w : 1, h: d ? d.h : 1 }, sel: null } };
  }
  // Filters registered by the adjust lane's Filter menu (labels "Motion blur…" etc.) never become adjustment layers.
  function filterTitles() {
    var F = PE.adjUI && PE.adjUI.FILTERS, out = {};
    if (F) Object.keys(F).forEach(function (g) { (F[g] || []).forEach(function (it) { if (it && it[0]) out[String(it[0]).replace(/…$/, "")] = 1; }); });
    return out;
  }
  // An adjustment layer must be a colour op: each output pixel depends only on that input pixel (shuffling the
  // pixels and adjusting gives the shuffled result). Blurs, distortions and generators fail this and are left out.
  var POINT = {};
  function pointwise(op) {
    if (POINT[op] != null) return POINT[op];
    var W = 16, n = W * W, img = new Uint8ClampedArray(n * 4), r = PIX.rng(17), i;
    for (i = 0; i < n * 4; i++) img[i] = i % 4 === 3 ? 255 : Math.floor(r() * 256);
    var sh = new Uint8ClampedArray(n * 4);
    for (i = 0; i < n; i++) { var x = i % W, y = (i - x) / W, j = y * W + (x + 5) % W; sh.set(img.subarray(i * 4, i * 4 + 4), j * 4); }
    var ok = false;
    try {
      var p = defaults(op), o1 = { data: new Uint8ClampedArray(img), width: W, height: W }, o2 = { data: new Uint8ClampedArray(sh), width: W, height: W };
      PIX.adjust(o1, op, PE.clone(p)); PIX.adjust(o2, op, PE.clone(p));
      ok = true;
      for (i = 0; i < n && ok; i++) { var x2 = i % W, y2 = (i - x2) / W, j2 = y2 * W + (x2 + 5) % W; for (var c = 0; c < 4; c++) if (Math.abs(o1.data[i * 4 + c] - o2.data[j2 * 4 + c]) > 2) { ok = false; break; } }
    } catch (e) { ok = false; }
    return (POINT[op] = ok);
  }
  SX.isColourOp = pointwise;
  function specs() {
    var out = [], A = ED.ADJ || {}, FT = filterTitles();
    Object.keys(A).forEach(function (k) { if (!FILTERS[k] && !A[k].filter && !A[k].proxy && !FT[A[k].t] && pointwise(k)) out.push([k, A[k].t]); });
    Object.keys(QUICK).forEach(function (k) { out.push([k, QUICK[k]]); });
    return out;
  }
  SX.adjSpecs = specs;
  function title(op) { return (ED.ADJ[op] && ED.ADJ[op].t) || QUICK[op] || op; }
  function defaults(op) {
    var s = ED.ADJ[op], p = {};
    if (!s) return p;
    (s.c || []).forEach(function (c) { p[c.k] = c.def; });
    (s.chk || []).forEach(function (c) { p[c[0]] = c[2] === true; });
    (s.sel || []).forEach(function (c) { p[c[0]] = c[3]; });
    if (typeof s.ui === "function") { try { s.ui(h("div"), uiState(p, null, function () {})); } catch (e) { /* their panel needs more context; keep the slider defaults */ } }
    if (s.custom === "levels") Object.assign(p, { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 });
    if (s.custom === "curves") Object.assign(p, { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] });
    if (s.custom === "balance") Object.assign(p, { sh: [0, 0, 0], mid: [0, 0, 0], hi: [0, 0, 0], keepLum: true });
    return p;
  }

  // ---------- rendering ----------
  // Masks made white over the whole document (and not painted since) change nothing: skip reading them.
  var WHITE = new WeakMap(), white0 = PE.whiteMask;
  PE.whiteMask = function (doc) { var m = white0.apply(this, arguments); WHITE.set(m.canvas, PE.ver(m.canvas)); return m; };
  function opaque(mask, doc) {
    return WHITE.get(mask.canvas) === PE.ver(mask.canvas) && mask.x <= 0 && mask.y <= 0 && mask.x + mask.canvas.width >= doc.w && mask.y + mask.canvas.height >= doc.h;
  }
  function weights(R, L, reg) {      // mask x opacity at device resolution, or null when it is all 255
    var mask = L.mask && L.maskOn ? SX.effMask(L, (R.opts.maskOver && R.opts.maskOver[L.id]) || L.mask) : null, op = PE.clamp(L.opacity, 0, 1), n = reg.w * reg.h;
    if (mask && opaque(mask, R.doc)) mask = null;
    if (!mask && op >= 1) return null;
    var w = new Uint8Array(n);
    if (!mask) { w.fill(Math.round(op * 255)); return w; }
    var md = SX.toDevice(R, { img: mask.canvas, x: mask.x, y: mask.y }, reg, "adjmask");
    for (var i = 0; i < n; i++) w[i] = Math.round(md[i * 4 + 3] * op);
    return w;
  }
  function apply(R, L, data, reg) {
    var a = L.adj; if (!a) return;
    try { PIX.adjust({ data: data, width: reg.w, height: reg.h }, a.op, a.p || {}, weights(R, L, reg)); } catch (e) { /* unknown op from a newer file: leave pixels as they are */ }
  }
  SX.drawExt.adjust = function (R, tgt, L) {
    var rg = R.region, c = tgt.c, d = c.getImageData(rg.x - tgt.ox, rg.y - tgt.oy, rg.w, rg.h);
    apply(R, L, d.data, rg);
    c.putImageData(d, rg.x - tgt.ox, rg.y - tgt.oy);
  };
  SX.adjustData = function (R, L, data, reg) { apply(R, L, data, reg); };    // clipped: only the base below
  SX.pixelKinds = SX.pixelKinds || {}; SX.pixelKinds.adjust = 1;

  PE.surfaceExt.adjust = function (L, doc) {      // its "pixels" are the mask (Ctrl+click loads it as a selection)
    if (!L.mask) { var c = PE.mk(doc.w, doc.h), x = PE.cx2(c); x.fillStyle = "#fff"; x.fillRect(0, 0, doc.w, doc.h); return { canvas: c, x: 0, y: 0 }; }
    return { canvas: L.mask.canvas, x: L.mask.x, y: L.mask.y };
  };
  PE.vboxExt.adjust = function () { var d = ED.doc; return { x: 0, y: 0, w: d.w, h: d.h, rot: 0, fx: false, fy: false }; };
  PE.xfExt.adjust = function () {};          // only its mask moves (done by transformLayer)
  // Painting, fills and gradients on an adjustment layer go to its mask.
  var ed0 = PE.editableExt;
  PE.editableExt = function (L, need) {
    if (ed0 && !ed0(L, need)) return false;
    if (L.kind === "adjust" && need === "pixels") {
      if (!L.mask) { S3.toast("This adjustment layer has no mask: add one to paint where it applies", "error"); return false; }
      if (!ED.maskEdit) { ED.maskEdit = true; ED.emit("layers"); }
    }
    return true;
  };
  var rast = ED.rasterize;
  ED.rasterize = function (L) { if (L && L.kind === "adjust") { S3.toast("Merge an adjustment layer down to apply it to the layer below", "error"); return L; } return rast.apply(this, arguments); };

  // ---------- creating ----------
  SX.newAdjustment = function (op) {
    if (!SX.need()) return;
    var d = ED.doc, L = PE.newLayer("adjust", { name: title(op) });
    L.canvas = null; L.adj = { op: op, p: defaults(op) };
    L.mask = d.sel ? PE.maskFromSel(d) : PE.whiteMask(d); L.maskOn = true;
    SX.insertAbove(L, "New " + title(op).toLowerCase() + " layer", function () { d.sel = null; });    // the selection became its mask
  };
  SX.chooseAdjustment = function () {
    if (!SX.need()) return;
    var w = ED.ui.w, grid = h("div", { "class": "pe-adjgrid" }), dlg;
    specs().forEach(function (s) { grid.appendChild(h("button", { type: "button", "class": "pe-preset", onclick: function () { dlg.close(); SX.newAdjustment(s[0]); } }, [h("b", { text: s[1] })])); });
    dlg = w.modal("New adjustment layer", h("div", { "class": "stack" }, [h("p", { "class": "faint pe-p", text: "Changes the layers below without touching their pixels. Paint its mask to limit where it applies; edit the settings any time in Properties." + (ED.doc.sel ? " The mask starts from your selection." : "") }), grid]), null, true);
  };

  // ---------- Properties ----------
  var pBefore = null, pT = 0;
  function edit(L, fn, label) {     // live change; one history entry once the slider rests (label defaults to the adjustment's)
    if (!pBefore) pBefore = PE.snap(ED.doc);
    fn(); ED.render();
    clearTimeout(pT); pT = setTimeout(function () { var b = pBefore; pBefore = null; ED.push(PE.metaEntry(label || (L.adj.op === "fill" ? "Fill layer" : title(L.adj.op)), ED.doc, b)); }, 450);
  }
  SX.liveEdit = edit;
  function histBelow(L) { var c = PE.flatten(ED.doc, { hide: L.id, scale: Math.min(1, 512 / Math.max(ED.doc.w, ED.doc.h)) }); return PIX.histogram(PE.getData(c)); }
  SX.props.adjust = function (P, L) {
    var w = ED.ui.w, a = L.adj || { op: "invert", p: {} }, s = ED.ADJ[a.op], p = a.p = a.p || {};
    P.appendChild(h("div", { "class": "pe-phead" }, [w.svg("t-adj"), h("b", { text: L.name }), h("span", { "class": "faint", text: title(a.op) + " layer" })]));
    var box = h("div", { "class": "pe-adjbox" });
    P.appendChild(box);
    if (!s) box.appendChild(h("p", { "class": "faint pe-p", text: QUICK[a.op] ? "No settings: it " + a.op + "s everything below it." : "This adjustment is not available in this version." }));
    else {
      (s.c || []).forEach(function (c) { box.appendChild(w.range(c.label, p[c.k] == null ? c.def : p[c.k], c.min, c.max, c.step, function (v) { edit(L, function () { p[c.k] = v; }); }, c.fmt)); });
      (s.chk || []).forEach(function (c) { box.appendChild(w.check(c[1], !!p[c[0]], function (v) { edit(L, function () { p[c[0]] = v; }); })); });
      (s.sel || []).forEach(function (c) { box.appendChild(w.select(c[1], c[2], p[c[0]] == null ? c[3] : p[c[0]], function (v) { edit(L, function () { p[c[0]] = v; }); })); });
      if (typeof s.ui === "function") box.appendChild(w.btn("More settings…", function () { moreSettings(L); }, "ghost", null, "Open the full settings for this adjustment (applies live to this layer)"));
      if (s.custom === "levels") levelsBox(box, L, p);
      if (s.custom === "curves") curvesBox(box, L, p);
      if (s.custom === "balance") balanceBox(box, L, p);
      if (SX.adjCustom && s.custom && SX.adjCustom[s.custom]) SX.adjCustom[s.custom](box, L, p, edit);
    }
    P.appendChild(h("div", { "class": "pe-prow" }, [w.btn("Reset", function () { ED.meta("Reset " + title(a.op), function () { L.adj = { op: a.op, p: defaults(a.op) }; }); }, "ghost"),
      w.btn("Merge down", function () { PE.mergeExt(L); }, "ghost", null, "Apply it to the layer below and remove it"), L.mask ? null : w.btn("Add mask", function () { ED.LOPS.addMask(!!ED.doc.sel); }, "ghost", "t-mask")]));
    SX.maskProps(P, L);
  };
  // Host another lane's settings UI in a dialog; it edits a copy of the params, shown live; Cancel puts them back.
  function moreSettings(L) {
    var s = ED.ADJ[L.adj.op], w = ED.ui.w, before = PE.snap(ED.doc), orig = PE.clone(L.adj.p), draft = PE.clone(L.adj.p), body = h("div", { "class": "stack pe-adjbox" }), done = false;
    function apply() { L.adj = { op: L.adj.op, p: PE.clone(draft) }; ED.render(); }
    var st = uiState(draft, L, apply);
    (s.c || []).forEach(function (c) { body.appendChild(w.range(c.label, draft[c.k] == null ? c.def : draft[c.k], c.min, c.max, c.step, function (v) { draft[c.k] = v; apply(); }, c.fmt)); });
    try { s.ui(body, st); } catch (e) { body.appendChild(h("p", { "class": "faint pe-p", text: "These settings need the image panel: use Image › " + s.t + " on a layer instead." })); }
    apply();
    var dlg = w.modal(s.t + " (adjustment layer)", body, [h("span", { "class": "grow" }), w.btn("Cancel", function () { finish(false); }, "ghost"), w.btn("OK", function () { finish(true); }, "primary")]);
    function finish(ok) {
      if (done) return; done = true; dlg.close();
      if (!ok) { L.adj = { op: L.adj.op, p: orig }; ED.changed(); return; }
      ED.push(PE.metaEntry(s.t, ED.doc, before));
    }
    var obs = new MutationObserver(function () { if (!document.body.contains(dlg.el)) { obs.disconnect(); finish(false); } }); obs.observe(document.body, { childList: true });
  }
  function levelsBox(el, L, p) {
    var w = ED.ui.w, rs = {};
    el.appendChild(histCanvas(histBelow(L).l));
    function mk(k, label, min, max, step) {
      rs[k] = w.range(label, p[k], min, max, step, function (v) {
        edit(L, function () { p[k] = v; if (p.inW <= p.inB + 1) { if (k === "inB") p.inB = p.inW - 2; else p.inW = p.inB + 2; } });
        rs.inB._set(p.inB); rs.inW._set(p.inW);
      });
      el.appendChild(rs[k]);
    }
    mk("inB", "Input black", 0, 253, 1); mk("gamma", "Midtones (gamma)", 0.1, 9.99, 0.01); mk("inW", "Input white", 2, 255, 1); mk("outB", "Output black", 0, 255, 1); mk("outW", "Output white", 0, 255, 1);
    el.appendChild(w.btn("Auto", function () {
      var H = histBelow(L).l, tot = 0, i, lo = 0, hi = 255, acc = 0;
      for (i = 0; i < 256; i++) tot += H[i];
      for (i = 0; i < 256; i++) { acc += H[i]; if (acc > tot * 0.005) { lo = i; break; } }
      acc = 0; for (i = 255; i >= 0; i--) { acc += H[i]; if (acc > tot * 0.005) { hi = i; break; } }
      edit(L, function () { p.inB = Math.min(lo, 253); p.inW = Math.max(hi, p.inB + 2); }); rs.inB._set(p.inB); rs.inW._set(p.inW);
    }, "ghost", null, "Stretch the darkest and brightest 0.5% to black and white"));
  }
  function balanceBox(el, L, p) {
    var w = ED.ui.w, tone = "mid", rs = [];
    el.appendChild(w.seg("Tone", [["sh", "Shadows"], ["mid", "Midtones"], ["hi", "Highlights"]], tone, function (v) { tone = v; rs.forEach(function (r, i) { r._set(p[tone][i]); }); }));
    ["Cyan ↔ Red", "Magenta ↔ Green", "Yellow ↔ Blue"].forEach(function (lab, i) { var r = w.range(lab, p[tone][i], -100, 100, 1, function (v) { edit(L, function () { p[tone][i] = v; }); }); rs.push(r); el.appendChild(r); });
    el.appendChild(w.check("Preserve luminosity", p.keepLum !== false, function (v) { edit(L, function () { p.keepLum = v; }); }));
  }
  function histCanvas(H) {
    var c = h("canvas", { "class": "pe-hist", width: "256", height: "70" }), x = c.getContext("2d"), mx = 1, i;
    for (i = 0; i < 256; i++) if (H[i] > mx) mx = H[i];
    x.fillStyle = "rgba(127,127,127,.55)";
    for (i = 0; i < 256; i++) { var v = Math.log(1 + H[i]) / Math.log(1 + mx) * 70; x.fillRect(i, 70 - v, 1.6, v); }
    return c;
  }
  function curvesBox(el, L, p) {
    var w = ED.ui.w, ch = "rgb", S = 256, c = h("canvas", { "class": "pe-curve", width: String(S), height: String(S), "aria-label": "Curve: drag points, click to add, double-click to remove" }), x = c.getContext("2d");
    var hist = histBelow(L), drag = -1;
    function draw() {
      x.clearRect(0, 0, S, S);
      var H = hist[ch === "rgb" ? "l" : ch], mx = 1, i; for (i = 0; i < 256; i++) mx = Math.max(mx, H[i]);
      x.fillStyle = "rgba(127,127,127,.25)"; for (i = 0; i < 256; i++) { var v = Math.log(1 + H[i]) / Math.log(1 + mx) * S; x.fillRect(i, S - v, 1, v); }
      x.strokeStyle = "rgba(127,127,127,.35)"; x.lineWidth = 1;
      for (i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * S / 4, 0); x.lineTo(i * S / 4, S); x.moveTo(0, i * S / 4); x.lineTo(S, i * S / 4); x.stroke(); }
      x.beginPath(); x.moveTo(0, S); x.lineTo(S, 0); x.stroke();
      var lut = PIX.lutCurve(p[ch]); x.strokeStyle = ch === "r" ? "#e5484d" : ch === "g" ? "#30a46c" : ch === "b" ? "#3e63dd" : (getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#888");
      x.lineWidth = 2; x.beginPath(); for (i = 0; i < 256; i++) { if (i) x.lineTo(i, S - lut[i]); else x.moveTo(i, S - lut[i]); } x.stroke();
      p[ch].forEach(function (q) { x.beginPath(); x.arc(q[0], S - q[1], 4.5, 0, Math.PI * 2); x.fillStyle = "#fff"; x.fill(); x.strokeStyle = "#000"; x.lineWidth = 1.2; x.stroke(); });
    }
    function at(e) { var r = c.getBoundingClientRect(); return [PE.clamp((e.clientX - r.left) / r.width * 255, 0, 255), PE.clamp(255 - (e.clientY - r.top) / r.height * 255, 0, 255)]; }
    c.addEventListener("pointerdown", function (e) {
      var q = at(e), pts = p[ch], best = -1, bd = 1e9;
      pts.forEach(function (pp, i) { var dd = Math.hypot(pp[0] - q[0], pp[1] - q[1]); if (dd < bd) { bd = dd; best = i; } });
      if (bd > 12) { if (pts.length >= 14) return; var nq = [Math.round(q[0]), Math.round(q[1])]; edit(L, function () { pts.push(nq); pts.sort(function (a, b) { return a[0] - b[0]; }); }); best = pts.indexOf(nq); }
      drag = best; c.setPointerCapture(e.pointerId); draw();
    });
    c.addEventListener("pointermove", function (e) {
      if (drag < 0) return; var q = at(e), pts = p[ch], lo = drag > 0 ? pts[drag - 1][0] + 1 : 0, hi = drag < pts.length - 1 ? pts[drag + 1][0] - 1 : 255, i = drag;
      edit(L, function () { pts[i] = [Math.round(PE.clamp(q[0], lo, hi)), Math.round(q[1])]; }); draw();
    });
    c.addEventListener("pointerup", function () { drag = -1; });
    c.addEventListener("dblclick", function (e) { var q = at(e), pts = p[ch]; if (pts.length <= 2) return; var i = pts.findIndex(function (pp) { return Math.hypot(pp[0] - q[0], pp[1] - q[1]) < 12; }); if (i >= 0) { edit(L, function () { pts.splice(i, 1); }); draw(); } });
    el.appendChild(w.seg("Channel", [["rgb", "RGB"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]], ch, function (v) { ch = v; draw(); }));
    el.appendChild(c);
    el.appendChild(h("p", { "class": "faint pe-p", text: "Drag points; click to add; double-click to remove." }));
    draw();
  }

  // ---------- project files ----------
  function cleanVal(v, depth) {          // numbers, booleans, short strings, small arrays/objects of those
    if (typeof v === "number") return isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : 0;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v.slice(0, 40).replace(/[^\w #.,-]/g, "");
    if (depth > 3 || v == null || typeof v !== "object") return undefined;
    if (Array.isArray(v)) return v.slice(0, 64).map(function (x) { return cleanVal(x, depth + 1); }).filter(function (x) { return x !== undefined; });
    var o = {}; Object.keys(v).slice(0, 40).forEach(function (k) { if (!/^[A-Za-z][\w]{0,30}$/.test(k)) return; var c = cleanVal(v[k], depth + 1); if (c !== undefined) o[k] = c; }); return o;
  }
  SX.cleanVal = cleanVal;
  SX.fields.adj = {
    save: function (L) { return L.kind === "adjust" && L.adj ? { op: L.adj.op, p: PE.clone(L.adj.p || {}) } : undefined; },
    parse: function (v, out) { if (out.kind !== "adjust" || !v || typeof v !== "object" || typeof v.op !== "string" || !/^[A-Za-z]{1,30}$/.test(v.op)) return undefined; var p = cleanVal(v.p || {}, 0); return { op: v.op, p: p && !Array.isArray(p) ? p : {} }; }
  };

  // ---------- menus, footer button ----------
  SX.menu("Layer", [["New adjustment layer…", "", SX.chooseAdjustment, SX.has]], "New group");
  document.addEventListener("DOMContentLoaded", function () {
    var foot = S3.$(".pe-lfoot"), m = S3.$("#lMask"); if (!foot || !m) return;
    foot.insertBefore(h("button", { type: "button", "class": "btn ghost icon small", id: "lAdj", title: "New adjustment layer", "aria-label": "New adjustment layer", onclick: SX.chooseAdjustment }, [ED.ui.w.svg("t-adj")]), m.nextSibling);
  });

  SX.tests.push(async function (ok, near) {
    var base = PE.rasterFromCanvas(SX.solid(4, 1, "#406080"), "base"), d = SX.scratch(4, 1, [base]);
    SX.newAdjustment("invert");
    var A = d.layers[1]; ok(A && A.kind === "adjust" && A.mask && d.active === A.id, "new adjustment layer with a mask");
    ok(SX.px(PE.flatten(d), 0, 0).join() === "191,159,127,255", "invert layer inverts what is below");
    ok(SX.px(base.canvas, 0, 0).join() === "64,96,128,255", "pixels below are untouched");
    var mc = PE.cx2(A.mask.canvas); mc.clearRect(0, 0, 2, 1); PE.touch(A.mask.canvas);
    var f = PE.flatten(d); ok(SX.px(f, 0, 0)[0] === 64 && SX.px(f, 3, 0)[0] === 191, "its mask limits where it applies");
    A.opacity = 0.5; ok(near(SX.px(PE.flatten(d), 3, 0)[0], 128, 2), "opacity blends the adjustment");
    A.opacity = 1; ED.meta("Levels", function () { A.adj = { op: "levels", p: { inB: 64, inW: 255, gamma: 1, outB: 0, outW: 255 } }; });
    ok(SX.px(PE.flatten(d), 3, 0)[0] === 0 && SX.px(PE.flatten(d), 0, 0)[0] === 64, "editable settings (levels)");
    ED.undo(); ok(A.adj.op === "invert", "undo settings change");
    var od = await PE.openProject(new Uint8Array(await (await PE.saveProject(d)).arrayBuffer()));
    ok(od.layers[1].kind === "adjust" && od.layers[1].adj.op === "invert" && SX.px(PE.flatten(od), 3, 0)[0] === 191, "adjustment layers round-trip");
    var top = PE.rasterFromCanvas(SX.solid(4, 1, "#406080"), "top"); d.layers.push(top); top.clip = undefined;
    ok(SX.px(PE.flatten(d), 3, 0)[0] === 64, "layers above are not adjusted");
    d.layers.pop(); ED.setActive(A.id); PE.mergeExt(A);
    ok(d.layers.length === 1 && SX.px(d.layers[0].canvas, 3, 0)[0] === 191 && SX.px(d.layers[0].canvas, 0, 0)[0] === 64, "merge down bakes it");
    ok(SX.cleanVal({ a: [1, "x<y>", { b: NaN }], "__proto__": 1, "bad key": 2 }, 0).a[1] === "xy", "settings from files are sanitised");
    ok(SX.isColourOp("levels") && SX.isColourOp("hueSat") && !SX.isColourOp("blur") && !SX.isColourOp("pixelate"), "only colour ops become adjustment layers");
  });
})();
