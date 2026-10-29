/* Selection lane, shared plumbing: worker bridge (js/select/worker.js), self-test registry, small helpers,
   and the Select › Border / Smooth / Grow / Similar commands. Loaded after ui.js; everything hooks in from here. */
(function () {
  "use strict";
  var PE = window.PE, PIX = window.PIX, PIXS = window.PIXS, ED = PE.ed;
  var SX = PE.sx = PE.sx || {};

  // ---------- worker bridge (falls back to this thread) ----------
  var W = null, alive = false, jid = 0, pend = {};
  function start() {
    if (W !== null) return;
    try {
      W = new Worker("js/select/worker.js");
      W.onmessage = function (e) { var m = e.data, p = pend[m.id]; if (m.id === 0) { alive = true; return; } if (!p) return; delete pend[m.id]; if (m.ok) p.res(m.result); else p.rej(new Error(m.error)); };
      W.onerror = function () { alive = false; W = false; Object.keys(pend).forEach(function (k) { var p = pend[k]; delete pend[k]; p.local(); }); };
      W.postMessage({ id: 0, fn: "smooth", args: [new Uint8Array(1), 1, 1, 1] });
    } catch (e) { W = false; }
  }
  SX.work = function (fn, args) {
    start();
    function local() { return PIXS.call(fn, args); }
    if (!alive || !W) return Promise.resolve().then(local);
    return new Promise(function (res, rej) {
      var id = ++jid; pend[id] = { res: res, rej: rej, local: function () { try { res(local()); } catch (e) { rej(e); } } };
      W.postMessage({ id: id, fn: fn, args: args });
    });
  };
  SX.workerAlive = function () { return alive; };
  start();

  // ---------- helpers ----------
  SX.need = function () { if (!ED.doc) { S3.toast("Open a photo or make a new document first"); return false; } if (ED.busyCheck()) return false; return true; };
  SX.needSel = function () { if (!SX.need()) return false; if (!ED.doc.sel) { S3.toast("Make a selection first", "error"); return false; } return true; };
  // RGBA of the active layer (or of all layers) in document coordinates.
  SX.sampleDoc = function (all) {
    var d = ED.doc, L = ED.layer(), c = all || !L ? PE.flatten(d) : PE.flatten(d, { only: [L.id] }), id = PE.getData(c);
    return { data: id.data, width: id.width, height: id.height };
  };
  SX.setSel = function (label, m) { var d = ED.doc, s = PE.makeSel(d, m); ED.meta(label, function () { d.sel = s; }); if (!s) S3.toast("Nothing was left selected"); };
  SX.menu = function (name, items, after) {      // add items to a top menu (after the item labelled `after`, else at the end)
    var M = (ED.ui.MENUS || []).filter(function (m) { return m[0] === name; })[0]; if (!M) return;
    var i = -1; if (after) M[1].forEach(function (it, k) { if (it[0] === after) i = k; });
    if (i < 0) M[1].push.apply(M[1], items); else M[1].splice.apply(M[1], [i + 1, 0].concat(items));
  };
  SX.hasSel = function () { return !!(ED.doc && ED.doc.sel); };
  SX.has = function () { return !!ED.doc; };

  // ---------- self-test registry: each feature adds known-answer checks; they run after the app's own ----------
  SX.tests = [];
  document.addEventListener("DOMContentLoaded", function () {
    var base = window.S3_SELFTEST;
    if (typeof base !== "function") return;
    window.S3_SELFTEST = async function () {
      var r = await base(), fails = r === true ? [] : (Array.isArray(r) ? r.slice() : [String(r)]);
      var savedDoc = ED.doc, savedHist = ED.hist, savedMask = ED.maskEdit;
      function ok(c, m) { if (!c) fails.push("[selection] " + m); }
      function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1 : e); }
      ED.testing = true;
      for (var i = 0; i < SX.tests.length; i++) {
        try { await SX.tests[i](ok, near); } catch (e) { fails.push("[selection] test " + i + " threw " + (e && e.message)); console.error(e); }
      }
      ED.testing = false; ED.maskEdit = savedMask;
      ED.doc = savedDoc; ED.hist = savedHist; ED.live = { over: {}, maskOver: {}, hide: null }; ED.changed(); if (savedDoc) ED.fit();
      return fails.length ? fails : true;
    };
  });
  // Tiny test helpers.
  SX.count = function (m, thr) { var n = 0; thr = thr == null ? 128 : thr; for (var q = 0; q < m.length; q++) if (m[q] >= thr) n++; return n; };
  SX.solid = function (w, h, css) { var c = PE.mk(w, h), x = PE.cx2(c); x.fillStyle = css; x.fillRect(0, 0, w, h); return PE.touch(c); };
  SX.px = function (c, x, y) { return Array.prototype.slice.call(PE.cx2(c).getImageData(x, y, 1, 1).data); };
  SX.scratch = function (w, h, layers) {      // a test document made current, with fresh history
    var d = PE.newDoc(w, h, "test"); d.layers = layers; d.active = layers.length ? layers[layers.length - 1].id : null;
    ED.doc = d; ED.hist = new PE.History(200e6, 60); ED.maskEdit = false; ED.live = { over: {}, maskOver: {}, hide: null };
    return d;
  };

  // ---------- Select › Border / Smooth / Grow / Similar ----------
  function modify(how, v) {
    if (!SX.needSel()) return;
    var d = ED.doc, m = d.sel.m, job, o = ED.o.wand;
    if (how === "border") job = SX.work("border", [m, d.w, d.h, v]);
    else if (how === "smooth") job = SX.work("smooth", [m, d.w, d.h, v]);
    else job = SX.work("similar", [SX.sampleDoc(o.all), m, o.tol, how === "grow"]);
    ED.working(job, { border: "Border…", smooth: "Smoothing…", grow: "Growing…", similar: "Finding similar…" }[how]).then(function (res) {
      SX.setSel({ border: "Border selection", smooth: "Smooth selection", grow: "Grow", similar: "Similar" }[how], res);
    }).catch(function (e) { S3.toast(e.message, "error"); });
  }
  SX.modify = modify;
  function ask(title, label, def, max, how) { var w = ED.ui.w; w.numberDialog(title, label, def, max, function (v) { modify(how, v); }); }
  SX.menu("Select", [
    ["Border…", "", function () { if (SX.needSel()) ask("Border selection", "Width (px)", 10, 200, "border"); }, SX.hasSel],
    ["Smooth…", "", function () { if (SX.needSel()) ask("Smooth selection", "Radius (px)", 4, 100, "smooth"); }, SX.hasSel],
    ["Grow", "", function () { modify("grow"); }, SX.hasSel],
    ["Similar", "", function () { modify("similar"); }, SX.hasSel]
  ], "Contract…");

  SX.tests.push(async function (ok, near) {
    var C = SX.count, R = PIX.rectMask(20, 20, 5, 5, 10, 10);
    ok(C(PIXS.border(R, 20, 20, 2)) === 80, "border 2 px straddles the edge (80 px)");
    var off = PIXS.offset(R, 20, 20, 2); ok(C(off) > 180 && C(off) < 196 && off[3 * 20 + 3] < 128 && off[4 * 20 + 4] >= 128, "round expand keeps corners round");
    var sp = new Uint8Array(R); sp[1 * 20 + 1] = 255; var sm = PIXS.smooth(sp, 20, 20, 2);
    ok(sm[1 * 20 + 1] < 128 && sm[10 * 20 + 10] === 255 && sm[5 * 20 + 5] < 128, "smooth removes specks and rounds corners");
    var W2 = 20, img = { data: new Uint8ClampedArray(W2 * W2 * 4), width: W2, height: W2 };
    for (var y = 0; y < W2; y++) for (var x = 0; x < W2; x++) {
      var i = (y * W2 + x) * 4, red = (x >= 2 && x < 8 && y >= 2 && y < 8) || (x >= 12 && x < 16 && y >= 12 && y < 16);
      img.data[i] = red ? 220 + (x % 3) : 20; img.data[i + 1] = 30; img.data[i + 2] = red ? 30 : 200; img.data[i + 3] = 255;
    }
    var seed = PIX.rectMask(W2, W2, 3, 3, 2, 2);
    ok(C(PIXS.similar(img, seed, 10, true)) === 36, "grow fills the touching square");
    ok(C(PIXS.similar(img, seed, 10, false)) === 52, "similar finds both squares");
    var wk = await SX.work("similar", [img, seed, 10, true]); ok(C(wk) === 36, "grow via worker" + (SX.workerAlive() ? "" : " (fallback)"));
  });
})();
