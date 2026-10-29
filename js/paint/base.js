/* Photo Editor paint lane: shared plumbing for js/paint/*. Tool registration (tool bar, grouped tools with a
   flyout, shortcuts), options-bar builders, overlay drawing, menu items, a library store for brushes, patterns,
   swatches and gradients (IndexedDB, this browser only), a worker for the heavy paint maths, and the self-test
   wrapper. Everything here runs on this device; nothing is sent anywhere. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, PPX = window.PPX;
  var PP = PE.paint = PE.paint || {};
  var saved = S3.store("pe-opts") || {};

  // ---------- icons: added to the page's symbol sheet ----------
  PP.icons = function (map) {
    var sheet = document.querySelector("body > svg");
    if (!sheet) return;
    Object.keys(map).forEach(function (id) {
      if (document.getElementById(id)) return;
      var s = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
      s.setAttribute("id", id); s.setAttribute("viewBox", "0 0 24 24");
      map[id].forEach(function (d) {
        var el;
        if (typeof d === "string") { el = document.createElementNS("http://www.w3.org/2000/svg", "path"); el.setAttribute("d", d); }
        else { el = document.createElementNS("http://www.w3.org/2000/svg", d[0]); Object.keys(d[1]).forEach(function (k) { el.setAttribute(k, d[1][k]); }); }
        s.appendChild(el);
      });
      sheet.appendChild(s);
    });
  };

  // ---------- options with saved values ----------
  // Fill o (an existing options object, or a new one) with defaults for keys it does not have.
  PP.opts = function (tool, defs) {
    var o = ED.o[tool] || (ED.o[tool] = {}), s = saved[tool] && typeof saved[tool] === "object" ? saved[tool] : {};
    Object.keys(defs).forEach(function (k) {
      if (o[k] === undefined) o[k] = s[k] !== undefined && typeof s[k] === typeof defs[k] ? s[k] : defs[k];
    });
    return o;
  };

  // ---------- tools ----------
  // spec: {id, name, key, after (tool id it follows in the tool bar), icon: [paths], handlers: {down, move, up, hover}}
  PP.tools = PP.tools || {};
  PP.addTool = function (id, name, key, after, handlers) {
    var T = ED.uiTOOLS, i = -1;
    for (var k = 0; k < T.length; k++) if (T[k][0] === after) i = k;
    var row = [id, name, key];
    for (k = 0; k < T.length; k++) if (T[k][0] === id) { T.splice(k, 1); break; }
    if (i < 0) T.push(row); else T.splice(i + 1, 0, row);
    ED.TOOLS[id] = handlers;
  };
  // Tool groups share one tool-bar button; right-click or long-press shows the others. Plain key = the
  // group's current tool, Shift+key = the next one.
  var GROUPS = PP.groups = [];
  PP.group = function (key, ids) { GROUPS.push({ key: key, ids: ids, cur: S3.store("pe-grp-" + key) || ids[0] }); };
  function groupOf(t) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].ids.indexOf(t) >= 0) return GROUPS[i]; return null; }
  PP.groupOf = groupOf;
  var fly = null;
  function closeFly() { if (fly) { fly.remove(); fly = null; } }
  function openFly(g, btn) {
    closeFly();
    var K = ED.ui.kit, h = S3.h;
    fly = h("div", { "class": "pp-fly", role: "menu" });
    g.ids.forEach(function (id) {
      var row = ED.uiTOOLS.filter(function (r) { return r[0] === id; })[0]; if (!row) return;
      var b = h("button", { type: "button", role: "menuitem", "class": "pe-mi" + (ED.tool === id ? " on" : "") }, [K.svg("t-" + id), h("span", { text: row[1] }), h("kbd", { text: (g.ids.indexOf(id) ? "Shift+" : "") + row[2] })]);
      b.addEventListener("click", function () { closeFly(); ED.setTool(id); });
      fly.appendChild(b);
    });
    document.body.appendChild(fly);
    var r = btn.getBoundingClientRect(), fw = fly.offsetWidth, fh = fly.offsetHeight;
    var x = r.right + 4, y = r.top;
    if (x + fw > innerWidth - 4) { x = Math.max(4, r.left); y = r.bottom + 4; }
    if (y + fh > innerHeight - 4) y = Math.max(4, innerHeight - fh - 4);
    fly.style.left = x + "px"; fly.style.top = y + "px";
    var f = fly.querySelector(".pe-mi"); if (f) f.focus({ preventScroll: true });
  }
  function syncGroups() {
    GROUPS.forEach(function (g) {
      if (g.ids.indexOf(ED.tool) >= 0 && g.cur !== ED.tool) { g.cur = ED.tool; S3.store("pe-grp-" + g.key, g.cur); }
      g.ids.forEach(function (id) {
        var b = document.querySelector('.pe-tool[data-tool="' + id + '"]'); if (!b) return;
        b.hidden = id !== g.cur; b.classList.add("pp-grp");
      });
    });
  }
  function wireGroups() {
    var box = document.getElementById("tools"); if (!box) return;
    GROUPS.forEach(function (g) {
      g.ids.forEach(function (id) {
        var b = box.querySelector('.pe-tool[data-tool="' + id + '"]'); if (!b) return;
        b.title = b.title + " · right-click or hold for more";
        b.addEventListener("contextmenu", function (e) { e.preventDefault(); openFly(g, b); });
        var t = 0;
        b.addEventListener("pointerdown", function (e) { if (e.button) return; t = setTimeout(function () { t = -1; openFly(g, b); }, 480); });
        ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { b.addEventListener(ev, function () { if (t > 0) clearTimeout(t); }); });
        b.addEventListener("click", function (e) { if (t === -1) { e.stopImmediatePropagation(); e.preventDefault(); t = 0; } }, true);
      });
    });
    document.addEventListener("pointerdown", function (e) { if (fly && !fly.contains(e.target)) closeFly(); }, true);
    document.addEventListener("keydown", function (e) { if (fly && e.key === "Escape") { e.stopPropagation(); closeFly(); } }, true);
    syncGroups();
  }
  ED.on("tool", syncGroups);
  window.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || ED.isTyping(e) || document.querySelector(".s3-modal") || (ED.ui && ED.ui.floatState && ED.ui.floatState())) return;
    if (!ED.doc || e.key.length !== 1) return;
    var key = e.key.toUpperCase(), g = null;
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].key === key) g = GROUPS[i];
    if (!g) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var cur = g.ids.indexOf(ED.tool);
    ED.setTool(e.shiftKey ? g.ids[(Math.max(cur, g.ids.indexOf(g.cur)) + 1) % g.ids.length] : g.cur);
  }, true);

  // ---------- options bar, overlay, cursor ----------
  var OPTS = PP.optsFor = {};
  ED.paintOpts = function (t, items) { var f = OPTS[t]; return f ? f(items) : items; };
  ED.ovlHooks = ED.ovlHooks || [];
  PP.overlay = function (f) { ED.ovlHooks.push(f); };
  var CURSORS = PP.cursors = {};
  ED.cursorHook = function (p) { var c = CURSORS[ED.tool]; return c ? (typeof c === "function" ? c(p) : c) : null; };

  // ---------- menus ----------
  // Add items to a menu ("Edit", "Filter"…) after the item labelled `after` (or at the end).
  PP.menu = function (menu, items, after) {
    var M = ED.uiMENUS.filter(function (m) { return m[0] === menu; })[0]; if (!M) return;
    var list = M[1], i = list.length;
    if (after) for (var k = 0; k < list.length; k++) if (list[k] !== "-" && list[k][0] === after) i = k + 1;
    Array.prototype.splice.apply(list, [i, 0].concat(items));
  };
  PP.shortcut = function (what, keys) { ED.uiSHORTCUTS.push([what, keys]); };

  // ---------- library store (brushes, patterns, swatches, gradients) ----------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("No IndexedDB"));
      var rq = indexedDB.open("s3-photo-paint", 1);
      rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains("lib")) rq.result.createObjectStore("lib", { keyPath: "id" }); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction("lib", mode), out = fn(t.objectStore("lib"));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error || new Error("Storage aborted")); };
      });
    });
  }
  PP.lib = {
    put: function (r) { return tx("readwrite", function (s) { s.put(r); }); },
    del: function (id) { return tx("readwrite", function (s) { s.delete(id); }); },
    all: function (kind) { return tx("readonly", function (s) { return s.getAll(); }).then(function (a) { return (a || []).filter(function (r) { return !kind || r.kind === kind; }).sort(function (x, y) { return (x.order || 0) - (y.order || 0); }); }); }
  };

  // ---------- worker for paint maths (falls back to this thread) ----------
  var W = null, alive = false, jid = 0, pend = {};
  function startWorker() {
    if (W !== null) return;
    try {
      W = new Worker("js/paint/pworker.js");
      W.onmessage = function (e) {
        var m = e.data; if (m.id === 0) { alive = true; return; }
        var p = pend[m.id]; if (!p) return; delete pend[m.id];
        if (m.ok) p.res(m.result); else p.rej(new Error(m.error));
      };
      W.onerror = function () { alive = false; W = false; Object.keys(pend).forEach(function (k) { var p = pend[k]; delete pend[k]; p.local(); }); };
      W.postMessage({ id: 0, fn: "ping", args: [] });
    } catch (e) { W = false; }
  }
  PP.startWorker = startWorker;
  PP.workerAlive = function () { return alive; };
  // Run PPX[fn](...args) off the main thread. transfer: buffers to hand over instead of copying.
  PP.work = function (fn, args, transfer) {
    function local() { return PPX.call(fn, args); }
    if (!alive || !W) return Promise.resolve().then(local);
    return new Promise(function (res, rej) {
      var id = ++jid;
      pend[id] = { res: res, rej: rej, local: function () { try { res(local()); } catch (e) { rej(e); } } };
      W.postMessage({ id: id, fn: fn, args: args }, transfer || []);
    });
  };

  // ---------- small shared helpers ----------
  PP.lum = function (rgb) { return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114; };
  PP.rgba = function (rgb, a) { return "rgba(" + Math.round(rgb[0]) + "," + Math.round(rgb[1]) + "," + Math.round(rgb[2]) + "," + a + ")"; };
  // The pixels a paint tool edits: the active layer's canvas, or its mask while the mask is being painted.
  // Grows them to cover the document first. Returns null (after telling the user) if editing is not possible.
  PP.target = function (need) {
    var L = ED.layer();
    if (!ED.editable(L, "pixels")) return null;
    if (ED.maskEdit && !L.mask) ED.maskEdit = false;
    var mask = ED.maskEdit, before = PE.snap(ED.doc), r = ED.docRect();
    if (mask && need === "pixels") { S3.toast("This tool works on layer pixels: click the layer thumbnail (not the mask) first", "error"); return null; }
    var grew = mask ? PE.ensureMaskCovers(L, r) : PE.ensureCovers(L, r), holder = mask ? L.mask : L;
    return { L: L, mask: mask, holder: holder, grow: grew ? PE.metaEntry("Grow", ED.doc, before) : null };
  };
  // Flattened document pixels (or one layer's pixels) for sampling, in doc coordinates.
  PP.sample = function (all, L) {
    var d = ED.doc;
    if (all || !L) return { img: PE.getData(PE.flatten(d)), ox: 0, oy: 0 };
    var s = PE.surface(L, d);
    return { img: PE.getData(s.canvas), ox: s.x, oy: s.y };
  };

  // ---------- self-test: paint checks run after the core's; dynamics reset to defaults while testing ----------
  var TESTS = PP.tests = [];
  PP.test = function (name, fn) { TESTS.push({ name: name, fn: fn }); };
  PP.resetForTest = [];
  function wrapSelftest() {
    var core = window.S3_SELFTEST; if (!core || core._paint) return;
    var wrapped = async function () {
      var keep = PP.resetForTest.map(function (f) { return f(); }), res;
      try { res = await core(); } finally { keep.forEach(function (undo) { if (undo) undo(); }); }
      var fails = res === true ? [] : res.slice();
      var savedDoc = ED.doc, savedHist = ED.hist, savedTool = ED.tool, savedMask = ED.maskEdit;
      keep = PP.resetForTest.map(function (f) { return f(); });
      ED.testing = true;
      for (var i = 0; i < TESTS.length; i++) {
        var out = [];
        try { await TESTS[i].fn(function (c, m) { if (!c) out.push(TESTS[i].name + ": " + m); }); } catch (e) { out.push(TESTS[i].name + " threw " + (e && e.stack || e)); }
        fails = fails.concat(out);
      }
      keep.forEach(function (undo) { if (undo) undo(); });
      ED.testing = false; ED.tool = savedTool; ED.maskEdit = savedMask; ED.stroke = null; ED.drag = null;
      ED.doc = savedDoc; ED.hist = savedHist; ED.live = { over: {}, maskOver: {}, hide: null };
      ED.changed(); if (savedDoc) ED.fit();
      return fails.length ? fails : true;
    };
    wrapped._paint = true;
    window.S3_SELFTEST = wrapped;
  }
  // A scratch document for tests: one white raster layer, fresh history.
  PP.scratch = function (w, h, css) {
    var d = PE.newDoc(w, h, "paint test"), c = PE.mk(w, h), x = PE.cx2(c);
    x.fillStyle = css || "#ffffff"; x.fillRect(0, 0, w, h);
    var L = PE.rasterFromCanvas(PE.touch(c), "Background"); d.layers = [L]; d.active = L.id;
    ED.doc = d; ED.hist = new PE.History(200e6, 60); ED.maskEdit = false; ED.live = { over: {}, maskOver: {}, hide: null };
    return { d: d, L: L };
  };
  PP.px = function (c, x, y) { return Array.prototype.slice.call(PE.cx2(c).getImageData(x, y, 1, 1).data); };
  PP.ev = function (o) { return Object.assign({ altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, pointerType: "mouse" }, o || {}); };
  // Drive a tool through a stroke of points.
  PP.drive = function (tool, pts, ev) {
    var T = ED.TOOLS[tool], e = PP.ev(ev); ED.tool = tool;
    T.down(pts[0], e);
    for (var i = 1; i < pts.length; i++) if (T.move && ED.drag) T.move(pts[i], e);
    if (T.up && ED.drag) T.up(pts[pts.length - 1], e);
  };

  PP.ready = [];
  function boot() {
    wireGroups();
    startWorker();
    wrapSelftest();
    PP.ready.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    ED.emit("tool");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else setTimeout(boot, 0);
})();
