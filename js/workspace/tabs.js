/* Workspace (files lane): several documents open at once, in tabs above the canvas. Each tab keeps its own history,
   zoom and scroll. Every newly opened or created document gets a tab; switching saves the one you leave (it is also
   autosaved in this browser). Open tabs come back after a reload (they load when you click them).
   Window menu: switch, next / previous (Ctrl+Alt+→ / ←), close (Ctrl+Alt+W), close others, close all. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, h = S3.h;
  var T = WS.tabs = { list: [] };       // {doc, hist, zoom, panX, panY, fitted, id, name, lazy}
  var bar = null;

  function cur() { for (var i = 0; i < T.list.length; i++) if (T.list[i].doc && T.list[i].doc === ED.doc) return T.list[i]; return null; }
  T.cur = cur;
  function stash() {     // remember the view of the document we are leaving
    var t = cur(); if (!t) return;
    t.hist = ED.hist; t.zoom = ED.zoom; t.panX = ED.panX; t.panY = ED.panY; t.fitted = ED.fitted; t.name = ED.doc.name; t.id = ED.doc.id;
  }
  function trim(hh, budget) { while (hh && hh.bytes > budget && hh.pos > 1) { var o = hh.list.shift(); hh.bytes -= o.bytes; hh.pos--; hh.dropped++; } }
  var boot = S3.store("pe-tabs"), booted = false;     // the last session's tabs, read before the app reopens the last document
  function save() { if (!booted) return; S3.store("pe-tabs", { ids: T.list.map(function (t) { return t.doc ? t.doc.id : t.id; }), active: ED.doc ? ED.doc.id : null }); }

  // every openDoc (new, open image / project / PSD, recent) becomes a tab
  var open0 = ED.openDoc;
  ED.openDoc = function (doc, label) {
    if (ED.testing) return open0.apply(this, arguments);
    stash();
    if (ED.doc && ED.saveNow) ED.saveNow();
    var same = T.list.filter(function (t) { return (t.doc ? t.doc.id : t.id) === doc.id && t.doc !== doc; })[0];
    if (same && same.doc) { activate(same); return; }
    if (same) T.list.splice(T.list.indexOf(same), 1, { doc: doc }); else T.list.push({ doc: doc });
    open0.apply(this, arguments);
    var t = cur(); if (t) t.hist = ED.hist;
    budget(); render(); save();
  };
  function budget() {     // background tabs share the memory budget: trim their oldest steps first
    var all = T.list.filter(function (t) { return t.doc; }), tot = 0, B = PE.historyBudget() * 1.5;
    all.forEach(function (t) { var hh = t.doc === ED.doc ? ED.hist : t.hist; if (hh) tot += hh.bytes; });
    if (tot <= B) return;
    all.forEach(function (t) { if (t.doc !== ED.doc && t.hist) trim(t.hist, Math.max(20e6, B / (all.length * 2))); });
  }
  function activate(t) {
    if (!t || (t.doc && t.doc === ED.doc)) return;
    if (ED.busy) { S3.toast("Still working on the last step…"); return; }
    if (t.lazy) { load(t); return; }
    ED.cancelModes(); if (ED.flushProps) ED.flushProps();
    stash(); if (ED.doc && ED.saveNow) ED.saveNow();
    var ui = ED.ui;
    if (ui.floatState && ui.floatState()) ui.closeFloat(false);
    ED.doc = t.doc; ED.hist = t.hist || new PE.History(PE.historyBudget(), 60); ED.maskEdit = false; ED.cloneSrc = null; ED.cloneOff = null;
    ED.live.over = {}; ED.live.maskOver = {}; ED.live.hide = null;
    if (t.zoom) { ED.zoom = t.zoom; ED.panX = t.panX; ED.panY = t.panY; ED.fitted = t.fitted; ED.render(); ED.renderOvl(); ED.emit("view"); } else ED.fit();
    ED.emit("layers"); ED.emit("changed", "switch"); if (ui.colors) ui.colors();
    S3.store("pe-last", t.doc.id);
    budget(); render(); save();
  }
  T.activate = activate;
  function load(t) {
    ED.working(PE.store.get(t.id).then(function (r) {
      if (!r || !r.blob) throw new Error("“" + (t.name || "That document") + "” is no longer saved in this browser");
      return r.blob.arrayBuffer().then(function (ab) { return PE.openProject(new Uint8Array(ab)); }).then(function (d) { d.id = r.id; return d; });
    }), "Opening…").then(function (d) {
      var i = T.list.indexOf(t); if (i < 0) return;
      stash(); if (ED.doc && ED.saveNow) ED.saveNow();
      ED.cancelModes();
      var entry = { doc: d }; T.list[i] = entry;
      open0.call(ED, d, "Reopened"); entry.hist = ED.hist; S3.store("pe-last", d.id);
      ED.ui.colors(); render(); save();
    }).catch(function (e) { S3.toast(e.message, "error"); T.list.splice(T.list.indexOf(t), 1); render(); save(); });
  }
  T.close = function (t) {
    t = t || cur(); if (!t) return;
    var i = T.list.indexOf(t), wasCur = t.doc && t.doc === ED.doc;
    if (wasCur && ED.busy) { S3.toast("Still working on the last step…"); return; }
    if (wasCur) { ED.cancelModes(); if (ED.flushProps) ED.flushProps(); if (ED.saveNow) ED.saveNow(); }
    T.list.splice(i, 1);
    if (wasCur) {
      var next = T.list[Math.min(i, T.list.length - 1)];
      if (next) { ED.doc = null; activate(next); }
      else { ED.doc = null; ED.hist = null; ED.live.over = {}; ED.live.maskOver = {}; ED.live.hide = null; S3.store("pe-last", undefined); ED.changed("close"); ED.emit("layers"); }
    }
    render(); save();
  };
  T.closeOthers = function () { var c = cur(); T.list.slice().forEach(function (t) { if (t !== c) T.close(t); }); };
  T.closeAll = function () { T.list.slice().reverse().forEach(function (t) { T.close(t); }); };
  T.step = function (dir) { var i = T.list.indexOf(cur()); if (T.list.length > 1) activate(T.list[(i + dir + T.list.length) % T.list.length]); };

  // ---------- tab strip ----------
  function render() {
    if (!bar) return;
    bar.textContent = "";
    bar.hidden = !T.list.length;
    T.list.forEach(function (t) {
      var on = t.doc && t.doc === ED.doc, name = t.doc ? t.doc.name : t.name || "Untitled";
      var x = h("button", { type: "button", "class": "ws-tx", title: "Close (Ctrl+Alt+W)", "aria-label": "Close " + name }, [ED.ui.w.svg("i-x")]);
      var b = h("div", { "class": "ws-tab" + (on ? " on" : "") + (t.lazy ? " lazy" : ""), role: "tab", tabindex: "0", "aria-selected": String(!!on), title: name + (t.doc ? " — " + t.doc.w + " × " + t.doc.h + " px" : " (click to load)") }, [h("span", { "class": "ws-tn", dir: "auto", text: name }), x]);
      b.addEventListener("click", function (e) { if (e.target.closest(".ws-tx")) return; activate(t); });
      b.addEventListener("auxclick", function (e) { if (e.button === 1) { e.preventDefault(); T.close(t); } });
      b.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(t); } });
      x.addEventListener("click", function (e) { e.stopPropagation(); T.close(t); });
      bar.appendChild(b);
      if (on) setTimeout(function () { if (b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest" }); }, 0);
    });
  }
  T.render = render;

  // ---------- menu + keys ----------
  function has() { return !!ED.doc; }
  var winMenu = ["Window", []];
  ED.ui.MENUS.push(winMenu);
  Object.defineProperty(winMenu, 1, { get: function () {
    var items = [["Next document", "Ctrl+Alt+→", function () { T.step(1); }, function () { return T.list.length > 1; }], ["Previous document", "Ctrl+Alt+←", function () { T.step(-1); }, function () { return T.list.length > 1; }], "-",
      ["Close", "Ctrl+Alt+W", function () { T.close(); }, has], ["Close others", "", T.closeOthers, function () { return T.list.length > 1; }], ["Close all", "", T.closeAll, function () { return T.list.length > 0; }]];
    if (T.list.length) items.push("-");
    T.list.slice(0, 20).forEach(function (t) { items.push([(t.doc && t.doc === ED.doc ? "✓ " : "  ") + (t.doc ? t.doc.name : t.name || "Untitled"), "", function () { activate(t); }]); });
    return items.concat(WS.windowItems || []);
  } });
  WS.key(function (e) { return WS.ctrl(e) && e.altKey && !e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft"); }, function (e) { T.step(e.key === "ArrowRight" ? 1 : -1); });
  WS.key(function (e) { return WS.ctrl(e) && e.altKey && e.key.toLowerCase() === "w" && !e.shiftKey; }, function () { T.close(); });

  ED.on("changed", function () { var t = cur(); if (t && bar) { var el = bar.querySelector(".ws-tab.on .ws-tn"); if (el && el.textContent !== ED.doc.name) { el.textContent = ED.doc.name; save(); } } });

  document.addEventListener("DOMContentLoaded", function () {
    var stage = document.getElementById("stage");
    bar = h("div", { "class": "ws-tabs", role: "tablist", "aria-label": "Open documents", hidden: true });
    stage.parentNode.insertBefore(bar, stage);
    render();
    // bring back the other tabs of the last session (loaded on demand)
    Promise.resolve(ED.ready).then(function () {
      var s = boot; booted = true;
      if (!s || !Array.isArray(s.ids)) { save(); return; }
      return PE.store.list().then(function (all) {
        var byId = {}; all.forEach(function (r) { byId[r.id] = r; });
        var have = {}; T.list.forEach(function (t) { have[t.doc ? t.doc.id : t.id] = 1; });
        var curIdx = s.ids.indexOf(ED.doc ? ED.doc.id : null), out = [];
        s.ids.slice(0, 30).forEach(function (id, k) {
          if (have[id] && ED.doc && id === ED.doc.id) { out.push(cur()); return; }
          if (!byId[id] || have[id]) return;
          out.push({ id: id, name: byId[id].name, lazy: true }); void k;
        });
        if (curIdx < 0 && cur()) out.push(cur());
        T.list = out.filter(Boolean); render(); save();
      });
    }).catch(function () { booted = true; });
  });

  // ---------- self-test ----------
  FX.tests.push(async function (ok) {
    var keep = { list: T.list.slice(), doc: ED.doc, hist: ED.hist, zoom: ED.zoom, panX: ED.panX, panY: ED.panY, testing: ED.testing };
    ED.testing = false; T.list = []; ED.doc = null;
    var store = PE.store.put; PE.store.put = function () { return Promise.resolve(); };     // keep the tests out of Recent
    var save0 = ED.saveNow; ED.saveNow = function () {};
    try {
      ED.newBlank(50, 40, "#ffffff", "Tab A"); var A = ED.doc; ED.fillSel("#ff0000");
      ED.newBlank(30, 20, "#ffffff", "Tab B"); var B = ED.doc;
      ok(T.list.length === 2 && ED.doc === B && ED.hist.list.length === 0, "new document opens a second tab");
      T.activate(T.list[0]); ok(ED.doc === A && ED.hist.list.length === 1 && ED.hist.list[0].label === "Fill", "switching keeps each tab's history");
      ED.undo(); T.activate(T.list[1]); T.activate(T.list[0]); ok(ED.hist.pos === 0 && ED.hist.canRedo(), "undo state survives switching");
      T.close(); ok(T.list.length === 1 && ED.doc === B, "close moves to the next tab");
      T.close(); ok(T.list.length === 0 && ED.doc === null, "closing the last tab leaves no document");
    } finally {
      PE.store.put = store; ED.saveNow = save0;
      T.list = keep.list; ED.doc = keep.doc; ED.hist = keep.hist; ED.zoom = keep.zoom; ED.panX = keep.panX; ED.panY = keep.panY; ED.testing = keep.testing; render();
    }
  });
})();
