/* Files lane: shared plumbing for file formats and workspace features (PSD, TIFF, export, guides, panels…).
   PE.files (FX) holds the menu helper, the extra-format openers, a small worker job runner and this lane's self-tests.
   Nothing here touches the network: files come from the device and go back to it as downloads. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed;
  var FX = PE.files = PE.files || {};

  // ---------- menus: add items to the app's menus by name ----------
  // item = [label, shortcut, fn, enabled?]; after = label of the item to insert after (or null to append).
  FX.menu = function (menu, item, after, sep) {
    var M = ED.ui && ED.ui.MENUS; if (!M) return;
    var m = M.filter(function (x) { return x[0] === menu; })[0];
    if (!m) { m = [menu, []]; M.splice(M.length - 1, 0, m); }
    var list = m[1], i = -1;
    if (after) for (var k = 0; k < list.length; k++) if (list[k] !== "-" && list[k][0] === after) { i = k; break; }
    var add = sep ? ["-", item] : [item];
    if (i < 0) list.push.apply(list, add); else list.splice.apply(list, [i + 1, 0].concat(add));
  };
  FX.has = function () { return !!ED.doc; };
  FX.need = function () { return ED.ui.w.need(); };

  // ---------- extra file formats: openers tried before the image decoder ----------
  FX.openers = [];   // { test(file) -> bool, open(file, asLayers) }
  ED.ui.openExt = function (files, asLayers) {
    for (var i = 0; i < files.length; i++) for (var k = 0; k < FX.openers.length; k++) {
      if (FX.openers[k].test(files[i])) { FX.openers[k].open(files[i], asLayers, files); return true; }
    }
    return false;
  };
  FX.accept = function (ext) { var i = document.getElementById("fileOpen"); if (i && i.accept.indexOf(ext) < 0) i.accept += "," + ext; };

  // ---------- file names ----------
  FX.base = function (doc) { return String((doc || ED.doc).name || "image").replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 120) || "image"; };
  FX.fname = function (ext, doc, suffix) { return FX.base(doc) + (suffix || "") + "." + ext; };

  // ---------- lazy scripts (vendored libraries load only when first needed) ----------
  var loaded = {};
  FX.script = function (src) {
    if (!loaded[src]) loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { delete loaded[src]; rej(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  };

  // ---------- dedicated workers with request ids; fall back to this thread when workers are unavailable ----------
  FX.worker = function (url, local) {
    var W = null, dead = false, id = 0, pend = {};
    function start() {
      if (W || dead) return;
      try {
        W = new Worker(url);
        W.onmessage = function (e) { var m = e.data, p = pend[m.id]; if (!p) return; delete pend[m.id]; if (m.ok) p.res(m.result); else p.rej(new Error(m.error)); };
        W.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); dead = true; W = null; Object.keys(pend).forEach(function (k) { var p = pend[k]; delete pend[k]; p.fallback(); }); };
      } catch (e) { dead = true; W = null; }
    }
    return function (msg, transfer) {
      start();
      if (dead || !W) return Promise.resolve().then(function () { return local(msg); });
      return new Promise(function (res, rej) {
        var n = ++id; msg.id = n;
        pend[n] = { res: res, rej: rej, fallback: function () { Promise.resolve().then(function () { return local(msg); }).then(res, rej); } };
        W.postMessage(msg, transfer || []);
      });
    };
  };

  // ---------- small helpers shared by the lane ----------
  FX.imageData = function (canvas) { return PE.cx2(canvas).getImageData(0, 0, canvas.width, canvas.height); };
  FX.toCanvas = function (img) {     // {data, width, height} -> canvas
    var c = PE.mk(img.width, img.height), x = PE.cx2(c);
    x.putImageData(img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.width * img.height * 4), img.width, img.height), 0, 0);
    return PE.touch(c);
  };
  FX.download = function (blob, name) { S3.download(blob, name, blob.type || "application/octet-stream"); };

  // ---------- self-tests: run after the app's own S3_SELFTEST ----------
  FX.tests = [];     // async function (ok, near, px, solid)
  document.addEventListener("DOMContentLoaded", function () {
    var base = window.S3_SELFTEST;
    if (typeof base !== "function") return;
    window.S3_SELFTEST = async function () {
      var r = await base.apply(this, arguments), fails = r === true ? [] : (Array.isArray(r) ? r.slice() : [String(r)]);
      function ok(c, m) { if (!c) fails.push("files: " + m); }
      function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1 : e); }
      function px(c, x, y) { return Array.prototype.slice.call(PE.cx2(c).getImageData(x, y, 1, 1).data); }
      function solid(w, h, css) { var c = PE.mk(w, h), x = PE.cx2(c); x.fillStyle = css; x.fillRect(0, 0, w, h); return PE.touch(c); }
      var keep = { doc: ED.doc, hist: ED.hist };
      ED.testing = true;
      for (var i = 0; i < FX.tests.length; i++) {
        try { await FX.tests[i](ok, near, px, solid); } catch (e) { fails.push("files: test " + i + " threw " + (e && e.message)); }
      }
      ED.testing = false;
      if (ED.doc !== keep.doc) { ED.doc = keep.doc; ED.hist = keep.hist; ED.live = { over: {}, maskOver: {}, hide: null }; ED.changed(); if (ED.doc) ED.fit(); }
      return fails.length ? fails : true;
    };
  });
})();
