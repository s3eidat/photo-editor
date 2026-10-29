/* Selection lane: Quick selection tool. Paint over an area: the selection grows from the strokes into similar,
   connected colours and stops at edges (js/select/selpix.js quickSel, in the lane worker). New / add / subtract
   (Shift adds, Alt subtracts; after the first stroke it switches to Add, as usual). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, PIX = window.PIX;
  var WORK = 1000;
  SX.addIcons({ "t-qsel": '<ellipse cx="9.5" cy="14" rx="6.8" ry="5.4" stroke-dasharray="2.6 2.2"/><path d="m12.5 11.5 6.8-7.6a1.3 1.3 0 0 1 1.9 1.8l-7 7.4z"/><path d="M12.4 11.6c-1.3.2-2 1.1-1.9 2.4"/>' });
  var saved = (S3.store("pe-opts") || {}).qsel;
  ED.o.qsel = Object.assign({ size: 25, mode: "new", all: false, enhance: true, sens: 1 }, saved && typeof saved === "object" ? saved : {});
  var tools = ED.ui.TOOLS, wi = tools.map(function (t) { return t[0]; }).indexOf("wand");
  tools.splice(wi + 1, 0, ["qsel", "Quick selection", "W"]);

  var st = null;
  function down(p, e) {
    var d = ED.doc, o = ED.o.qsel, k = Math.min(1, WORK / Math.max(d.w, d.h)), W = Math.max(1, Math.round(d.w * k)), H = Math.max(1, Math.round(d.h * k));
    var mode = e.altKey ? "sub" : e.shiftKey ? "add" : o.mode;
    if (mode === "sub" && !d.sel) return;
    var L = ED.layer(), src = o.all || !L ? PE.flatten(d, { scale: k }) : PE.flatten(d, { scale: k, only: [L.id] }), img = PE.getData(src);
    if (img.width !== W || img.height !== H) { W = img.width; H = img.height; }
    var seed = PE.mk(W, H);
    st = { k: k, W: W, H: H, img: { data: img.data, width: W, height: H }, seed: seed, sx: PE.cx2(seed), mode: mode, base: d.sel ? d.sel.m : null, before: PE.snap(d), busy: false, again: false, last: null, done: false };
    st.sx.fillStyle = "#fff";
    ED.drag = { kind: "qsel", cancel: function () { if (st) { PE.restore(d, st.before); st = null; ED.changed(); } } };
    dab(p); run();
  }
  function dab(p) {
    var r = Math.max(0.6, ED.o.qsel.size / 2 * st.k), x = p.x * st.k, y = p.y * st.k, c = st.sx;
    if (st.last) {      // a continuous trail between samples
      var dx = x - st.last.x, dy = y - st.last.y, n = Math.ceil(Math.hypot(dx, dy) / Math.max(0.5, r * 0.5));
      for (var i = 1; i <= n; i++) { c.beginPath(); c.arc(st.last.x + dx * i / n, st.last.y + dy * i / n, r, 0, Math.PI * 2); c.fill(); }
    } else { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
    st.last = { x: x, y: y };
  }
  function seeds() { var sd = st.sx.getImageData(0, 0, st.W, st.H).data, m = new Uint8Array(st.W * st.H); for (var i = 0; i < m.length; i++) m[i] = sd[i * 4 + 3]; return m; }
  function run() {
    if (!st) return;
    if (st.busy) { st.again = true; return; }
    st.busy = true; st.again = false;
    var job = st, o = ED.o.qsel;
    SX.work("quickSel", [job.img, seeds(), { sens: o.sens, enhance: o.enhance }]).then(function (m) {
      if (st !== job) return;
      apply(job, m);
    }).catch(function (e) { S3.toast(e.message, "error"); }).then(function () {
      job.busy = false;
      if (st !== job) return;
      if (job.again) run(); else if (job.done) finish(job);
    });
  }
  function apply(job, m) {
    var d = ED.doc, r = SX.scaleMask(m, job.W, job.H, d.w, d.h), out = r, b = job.base, i;
    if (job.mode !== "new" && b) {
      out = new Uint8Array(r.length);
      if (job.mode === "add") for (i = 0; i < r.length; i++) out[i] = b[i] > r[i] ? b[i] : r[i];
      else for (i = 0; i < r.length; i++) out[i] = Math.min(b[i], 255 - r[i]);
    }
    d.sel = PE.makeSel(d, out); job.result = true;
    ED.renderOvl(); ED.emit("view");
  }
  function finish(job) {
    st = null;
    if (!job.result) { ED.changed(); return; }
    ED.push(PE.metaEntry("Quick selection", ED.doc, job.before));
    if (ED.o.qsel.mode === "new") { ED.o.qsel.mode = "add"; ED.saveOpts(); ED.ui.buildOpts(); }
  }
  ED.TOOLS.qsel = {
    brush: true,
    down: function (p, e) { if (ED.busyCheck()) return; down(p, e); },
    move: function (p) { if (!st || st.done) return; dab(p); run(); },
    up: function () { ED.drag = null; if (!st) return; st.done = true; if (!st.busy) { if (st.again) run(); else finish(st); } }
  };

  // options bar
  (ED.ui.optsTail = ED.ui.optsTail || []).unshift(function (t, items) {
    if (t !== "qsel") return;
    var w = ED.ui.w, o = ED.o.qsel;
    items.push(w.seg("", [["new", "New", "New selection", "t-snew"], ["add", "Add", "Add to the selection (Shift)", "t-sadd"], ["sub", "Subtract", "Subtract from the selection (Alt)", "t-ssub"]], o.mode, function (v) { o.mode = v; ED.saveOpts(); }));
    items.push(w.range("Size", o.size, 1, 500, 1, function (v) { o.size = v; ED.saveOpts(); ED.renderOvl(); }, w.px));
    items.push(w.range("Sensitivity", o.sens, 0.5, 2, 0.05, function (v) { o.sens = v; ED.saveOpts(); }, function (v) { return Math.round(v * 100) + "%"; }));
    items.push(w.check("All layers", o.all, function (v) { o.all = v; ED.saveOpts(); }));
    items.push(w.check("Smooth edges", o.enhance, function (v) { o.enhance = v; ED.saveOpts(); }));
    items.push(S3.h("span", { "class": "pe-hint", text: "Paint over what you want; it grows to the edges. Shift adds, Alt subtracts. [ ] size." }));
  });
  // W toggles magic wand / quick selection
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "w" && e.key !== "W") || !ED.doc) return false;
    e.preventDefault(); ED.setTool(ED.tool === "wand" ? "qsel" : "wand"); return true;
  });

  SX.tests.push(async function (ok) {
    // two flat regions with an edge; a stroke in the left one selects all of it and stops at the edge
    var W = 40, H = 20, img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var i = (y * W + x) * 4, left = x < 20, n = ((x * 7 + y * 13) % 5) - 2; img.data[i] = left ? 200 + n : 40 + n; img.data[i + 1] = left ? 60 : 90; img.data[i + 2] = left ? 50 + n : 160; img.data[i + 3] = 255; }
    var seed = new Uint8Array(W * H); for (x = 4; x < 12; x++) seed[10 * W + x] = 255;
    var m = PIXS_quick(img, seed);
    ok(SX.count(m) === 400 && m[10 * W + 25] === 0, "quick selection fills the region, stops at the edge");
    var e2 = PIXS_quick(img, seed, true); ok(e2[10 * W + 2] === 255 && e2[10 * W + 30] === 0, "smooth-edges variant");
    function PIXS_quick(im, s, en) { return window.PIXS.quickSel(im, s, { sens: 1, enhance: !!en }); }
    // end to end on a scratch doc: one stroke -> selection, then undo
    var c = PE.mk(80, 40), cx = PE.cx2(c); cx.fillStyle = "#3366cc"; cx.fillRect(0, 0, 80, 40); cx.fillStyle = "#e0c040"; cx.fillRect(40, 0, 40, 40);
    var d = SX.scratch(80, 40, [PE.rasterFromCanvas(PE.touch(c), "bg")]), o = ED.o.qsel, keep = Object.assign({}, o);
    o.mode = "new"; o.size = 6; o.all = false; o.enhance = false;
    var ev = { altKey: false, shiftKey: false };
    ED.TOOLS.qsel.down({ x: 10, y: 20 }, ev); ED.TOOLS.qsel.move({ x: 20, y: 20 }, ev); ED.TOOLS.qsel.up({ x: 20, y: 20 }, ev);
    for (var t = 0; t < 100 && ED.hist.pos === 0; t++) await new Promise(function (r) { setTimeout(r, 20); });
    ok(d.sel && d.sel.b.x === 0 && d.sel.b.w === 40 && d.sel.b.h === 40, "quick selection tool end to end");
    ED.undo(); ok(!d.sel, "undo quick selection");
    Object.assign(o, keep);
  });
})();
