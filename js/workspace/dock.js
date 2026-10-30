/* Workspace (files lane): dockable panels and saved workspaces.
   - Drag a panel by its title to reorder it in the side bar; drop it over the canvas to float it as a window
     (drag its title to move, resize from the corner, ⇲ docks it back). Panels collapse by clicking their title.
   - Drag the side bar's left edge to resize it; Window › Hide panels (Tab while the canvas has focus) gives the canvas
     the whole width.
   - Window › Workspace: built-in Essentials / Photography / Painting / Review layouts, save your own (panels, order,
     floating windows, side-bar width; optionally rulers / grid / guides settings), switch, reset, delete, export and
     import (.json, validated). */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, PS = WS.panels, h = S3.h, W = ED.ui.w;
  var D = WS.dock = {};
  var st = PS.state;          // shared with panels.js (persisted as pe-panels)
  function persist() { S3.store("pe-panels", st); }
  function side() { return document.querySelector(".pe-side"); }
  function body() { return document.querySelector(".pe-body"); }
  function app() { return document.getElementById("app"); }
  function handleOf(p) { return p.el.tagName === "DETAILS" ? p.el.querySelector(":scope > summary") : p.el.querySelector(".pe-lhead h2") || p.el.firstElementChild; }

  // ---------- floating windows ----------
  var floats = {};
  D.float = function (id, pos) {
    var p = PS.byId[id]; if (!p || floats[id]) return;
    var a = app(), r = a.getBoundingClientRect(), sb = p.el.getBoundingClientRect();
    pos = pos || { x: Math.max(8, r.width - 340 - 330), y: 120, w: Math.max(240, Math.round(sb.width)) };
    var dockBtn = h("button", { type: "button", "class": "ws-fdock", title: "Dock this panel back into the side bar", "aria-label": "Dock panel", text: "⇲" });
    var win = h("div", { "class": "ws-float", role: "dialog", "aria-label": p.title + " panel", "data-for": id }, [dockBtn]);
    win.style.left = PE.clamp(pos.x, 0, Math.max(0, r.width - 120)) + "px"; win.style.top = PE.clamp(pos.y, 0, Math.max(0, r.height - 60)) + "px"; win.style.width = PE.clamp(pos.w || 300, 200, 900) + "px";
    win.appendChild(p.el); a.appendChild(win); floats[id] = win;
    if (p.el.tagName === "DETAILS") p.el.open = true;
    dockBtn.addEventListener("click", function () { D.dock(id); });
    new ResizeObserver(function () { save(id); }).observe(win);
    (st[id] = st[id] || {}).float = pos; persist();
    if (p.update) p.update("open");
  };
  function save(id) { var w = floats[id]; if (!w) return; (st[id] = st[id] || {}).float = { x: parseFloat(w.style.left) || 0, y: parseFloat(w.style.top) || 0, w: Math.round(w.getBoundingClientRect().width) }; persist(); }
  D.dock = function (id, at) {
    var p = PS.byId[id], w = floats[id]; if (!p || !w) return;
    var s = side(), ord = st._order || [], i = ord.indexOf(id), next = null;
    for (var k = i + 1; k >= 0 && k < ord.length && !next; k++) { var q = PS.byId[ord[k]]; if (q && q.el.parentNode === s) next = q.el; }
    s.insertBefore(p.el, at || next); w.remove(); delete floats[id];
    if (st[id]) delete st[id].float; st._order = PS.order(); persist();
  };
  D.floating = function () { return Object.keys(floats); };

  // ---------- dragging titles: reorder, or float when dropped over the canvas ----------
  function wire(p) {
    var hd = handleOf(p); if (!hd || hd._ws) return; hd._ws = true;
    hd.classList.add("ws-handle");
    hd.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || e.target.closest("button,select,input,label") && !e.target.closest("summary")) return;
      var sx = e.clientX, sy = e.clientY, moving = false, ph = null, win = floats[p.id], start = win ? { x: parseFloat(win.style.left), y: parseFloat(win.style.top) } : null;
      function mv(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moving && Math.hypot(dx, dy) < 5) return;
        if (!moving) { moving = true; document.body.classList.add("ws-dragging"); if (!win) { ph = h("div", { "class": "ws-ph" }); p.el.classList.add("ws-lift"); } }
        if (win) { var r = app().getBoundingClientRect(); win.style.left = PE.clamp(start.x + dx, 0, r.width - 80) + "px"; win.style.top = PE.clamp(start.y + dy, 0, r.height - 40) + "px"; return; }
        var s = side(), sr = s.getBoundingClientRect();
        if (ev.clientX >= sr.left - 20) {      // over the side bar: show where it goes
          var kids = Array.prototype.filter.call(s.children, function (c) { return c !== p.el && c !== ph && !c.hidden; }), before = null;
          for (var i = 0; i < kids.length; i++) { var kr = kids[i].getBoundingClientRect(); if (ev.clientY < kr.top + kr.height / 2) { before = kids[i]; break; } }
          s.insertBefore(ph, before);
        } else if (ph.parentNode) ph.remove();
      }
      function up(ev) {
        window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
        document.body.classList.remove("ws-dragging"); p.el.classList.remove("ws-lift");
        if (!moving) return;
        // swallow the click that would toggle the panel
        var stop = function (ce) { ce.preventDefault(); ce.stopPropagation(); window.removeEventListener("click", stop, true); }; window.addEventListener("click", stop, true); setTimeout(function () { window.removeEventListener("click", stop, true); }, 0);
        if (win) { save(p.id); return; }
        if (ph && ph.parentNode) { ph.parentNode.insertBefore(p.el, ph); ph.remove(); st._order = PS.order(); persist(); return; }
        if (ev.type === "pointerup") { var r = app().getBoundingClientRect(); D.float(p.id, { x: ev.clientX - r.left - 40, y: ev.clientY - r.top - 12, w: 300 }); }
      }
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    });
  }

  // ---------- side bar width and visibility ----------
  D.setWidth = function (w) {
    var b = body(); if (!b) return;
    if (!w) { b.style.gridTemplateColumns = ""; delete st._sideW; persist(); return; }
    w = PE.clamp(Math.round(w), 220, 560); b.style.gridTemplateColumns = "78px minmax(0, 1fr) " + w + "px"; st._sideW = w; persist();
  };
  D.hidePanels = function (on) {
    var a = app(); on = on == null ? !a.classList.contains("ws-noside") : on;
    a.classList.toggle("ws-noside", on); st._hidden = on; persist();
    Object.keys(floats).forEach(function (id) { floats[id].hidden = on; });
    ED.ui && setTimeout(function () { if (ED.doc && ED.fitted) ED.fit(ED.fitted.up); }, 30);
  };
  function grip() {
    var s = side(), b = body(), g = h("div", { "class": "ws-grip", title: "Drag to resize the panels (double-click: default width)", role: "separator", "aria-orientation": "vertical" });
    b.appendChild(g);
    new ResizeObserver(function () { b.style.setProperty("--ws-side-w", s.getBoundingClientRect().width + "px"); }).observe(s);
    g.addEventListener("pointerdown", function (e) {
      e.preventDefault(); var sw = s.getBoundingClientRect().width, x0 = e.clientX; g.setPointerCapture(e.pointerId);
      function mv(ev) { D.setWidth(sw + x0 - ev.clientX); }
      function up() { g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); }
      g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up);
    });
    g.addEventListener("dblclick", function () { D.setWidth(0); });
  }

  // ---------- workspaces ----------
  var ALL = ["properties", "layers", "history", "navigator", "histogram", "info", "actions", "notes"];
  function preset(shown, open, order) { var o = { _order: order || ALL }; ALL.forEach(function (id) { o[id] = { shown: shown.indexOf(id) >= 0, open: open.indexOf(id) >= 0 }; }); return { panels: o }; }
  var BUILTIN = D.BUILTIN = {
    "Essentials": preset(["properties", "layers", "history", "navigator", "histogram", "info"], ["properties", "history"]),
    "Photography": preset(["histogram", "navigator", "properties", "layers", "history"], ["histogram", "navigator", "properties", "history"], ["histogram", "navigator", "properties", "layers", "history", "info", "actions", "notes"]),
    "Painting": preset(["properties", "layers", "navigator"], ["properties", "navigator"], ["navigator", "properties", "layers", "history", "histogram", "info", "actions", "notes"]),
    "Review": preset(["notes", "info", "layers", "history"], ["notes", "info"], ["notes", "info", "layers", "history", "properties", "navigator", "histogram", "actions"])
  };
  var WSP = S3.store("pe-workspaces") || { list: {}, current: "Essentials" };
  function saveW() { S3.store("pe-workspaces", WSP); }
  D.capture = function (withView) {
    var o = { panels: {} };
    PS.list.forEach(function (p) { var s2 = st[p.id] || {}; o.panels[p.id] = { shown: !p.el.hidden || !!floats[p.id], open: p.el.tagName === "DETAILS" ? !!p.el.open : true }; if (floats[p.id]) o.panels[p.id].float = s2.float; });
    o.panels._order = PS.order().concat(Object.keys(floats).filter(function (id) { return PS.order().indexOf(id) < 0; }));
    if (st._sideW) o.sideW = st._sideW; if (st._hidden) o.hidden = true;
    if (withView) { o.view = {}; ["rulers", "units", "guides", "grid", "gridEvery", "gridUnit", "gridSub", "gridColor", "guideColor", "snap", "smart"].forEach(function (k) { o.view[k] = WS.p[k]; }); }
    return o;
  };
  D.apply = function (lay) {
    lay = D.clean(lay); if (!lay) return;
    Object.keys(floats).forEach(function (id) { D.dock(id); });
    var P = lay.panels || {};
    PS.list.forEach(function (p) {
      var s2 = P[p.id]; if (!s2) return;
      st[p.id] = st[p.id] || {}; st[p.id].shown = s2.shown !== false; st[p.id].open = s2.open !== false; p.el.hidden = !st[p.id].shown;
      if (p.el.tagName === "DETAILS") p.el.open = st[p.id].open;
    });
    if (P._order) PS.setOrder(P._order);
    PS.list.forEach(function (p) { var s2 = P[p.id]; if (s2 && s2.float && s2.shown !== false) D.float(p.id, s2.float); });
    D.setWidth(lay.sideW || 0); D.hidePanels(!!lay.hidden);
    if (lay.view) Object.keys(lay.view).forEach(function (k) { if (WS.p[k] !== lay.view[k]) WS.set(k, lay.view[k]); });
    persist(); PS.each("open");
  };
  // imported / stored layouts are rebuilt from known keys only
  D.clean = function (raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var out = { panels: {} }, P = raw.panels && typeof raw.panels === "object" ? raw.panels : {}, ids = PS.list.map(function (p) { return p.id; });
    ids.forEach(function (id) {
      var s2 = P[id]; if (!s2 || typeof s2 !== "object") return;
      var o = { shown: s2.shown !== false, open: s2.open !== false };
      if (s2.float && typeof s2.float === "object") { var n = function (v, a, b) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : a; }; o.float = { x: n(s2.float.x, 0, 4000), y: n(s2.float.y, 0, 4000), w: n(s2.float.w, 200, 900) }; }
      out.panels[id] = o;
    });
    if (Array.isArray(P._order)) out.panels._order = P._order.filter(function (id) { return ids.indexOf(id) >= 0; }).slice(0, 60);
    if (+raw.sideW >= 220 && +raw.sideW <= 560) out.sideW = Math.round(+raw.sideW);
    if (raw.hidden === true) out.hidden = true;
    if (raw.view && typeof raw.view === "object") {
      var v = raw.view, ov = {};
      ["rulers", "guides", "grid", "snap", "smart"].forEach(function (k) { if (typeof v[k] === "boolean") ov[k] = v[k]; });
      if (WS.UNITS.some(function (u) { return u[0] === v.units; })) ov.units = v.units;
      if (WS.UNITS.some(function (u) { return u[0] === v.gridUnit; })) ov.gridUnit = v.gridUnit;
      if (+v.gridEvery > 0 && +v.gridEvery < 1e5) ov.gridEvery = +v.gridEvery; if (+v.gridSub >= 1 && +v.gridSub <= 64) ov.gridSub = Math.round(+v.gridSub);
      ["gridColor", "guideColor"].forEach(function (k) { var c = PE.hex(v[k], null); if (c) ov[k] = c; });
      out.view = ov;
    }
    return out;
  };
  D.switchTo = function (name) {
    var lay = WSP.list[name] || BUILTIN[name]; if (!lay) return;
    if (WSP.current && WSP.list[WSP.current] && !WSP.list[WSP.current].locked) { /* user workspaces keep their saved state; changes are explicit */ }
    WSP.current = name; saveW(); D.apply(lay); S3.toast("Workspace: " + name);
  };
  D.saveDialog = function () {
    var name = h("input", { "class": "input", maxlength: "40", dir: "auto", value: WSP.current && !BUILTIN[WSP.current] ? WSP.current : "My workspace" }), view = false;
    var dlg = W.modal("New workspace", h("div", { "class": "stack" }, [W.field("Name", name), W.check("Also keep rulers, guides, grid and snap settings", false, function (v) { view = v; }),
      h("p", { "class": "faint pe-p", text: "Saves which panels are shown, open, their order, floating windows and the side-bar width. Keyboard shortcuts are kept separately (Edit › Keyboard shortcuts)." })]),
      [h("span", { "class": "grow" }), W.btn("Save", function () {
        var n = name.value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40); if (!n) return;
        if (BUILTIN[n]) { S3.toast("That name is taken by a built-in workspace", "error"); return; }
        if (Object.keys(WSP.list).length >= 30 && !WSP.list[n]) { S3.toast("Up to 30 workspaces", "error"); return; }
        WSP.list[n] = D.capture(view); WSP.current = n; saveW(); dlg.close(); S3.toast("Saved workspace “" + n + "”");
      }, "primary")]);
  };
  D.manage = function () {
    var box = h("div", { "class": "stack" }), file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    function draw() {
      box.textContent = "";
      var names = Object.keys(WSP.list);
      if (!names.length) box.appendChild(h("p", { "class": "faint pe-p", text: "No saved workspaces yet." }));
      names.forEach(function (n) { box.appendChild(h("div", { "class": "pe-prow" }, [h("b", { "class": "grow", dir: "auto", text: n }), W.btn("Use", function () { D.switchTo(n); }, "ghost"), W.btn("Delete", function () { delete WSP.list[n]; if (WSP.current === n) WSP.current = "Essentials"; saveW(); draw(); }, "ghost", "i-trash")])); });
    }
    file.addEventListener("change", function () {
      var f = file.files[0]; file.value = ""; if (!f || f.size > 200000) return;
      f.text().then(function (t) {
        var d = JSON.parse(t); if (!d || d.format !== "s3pe-workspaces" || typeof d.list !== "object") throw new Error("That is not a Photo Editor workspace file");
        var n = 0; Object.keys(d.list).slice(0, 30).forEach(function (k) { var c = D.clean(d.list[k]); var nm = String(k).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40); if (c && nm && !BUILTIN[nm]) { WSP.list[nm] = c; n++; } });
        saveW(); draw(); S3.toast("Imported " + n + " workspace" + (n === 1 ? "" : "s"));
      }).catch(function (e) { S3.toast(e.message || "Bad file", "error"); });
    });
    var dlg = W.modal("Workspaces", h("div", { "class": "stack" }, [box, file]), [W.btn("Export…", function () { FX.download(new Blob([JSON.stringify({ format: "s3pe-workspaces", version: 1, list: WSP.list }, null, 1)], { type: "application/json" }), "photo-editor-workspaces.json"); }, "ghost"),
      W.btn("Import…", function () { file.click(); }, "ghost"), h("span", { "class": "grow" }), W.btn("Done", function () { dlg.close(); }, "primary")]);
    draw();
  };
  D.menuItems = function () {
    var cur = WSP.current, items = ["-"];
    Object.keys(BUILTIN).concat(Object.keys(WSP.list)).forEach(function (n) { items.push([(n === cur ? "✓ " : "  ") + "Workspace: " + n, "", function () { D.switchTo(n); }]); });
    items.push(["Reset workspace", "", function () { D.switchTo(cur in BUILTIN || WSP.list[cur] ? cur : "Essentials"); }], ["New workspace…", "", D.saveDialog], ["Manage workspaces…", "", D.manage],
      [(app() && app().classList.contains("ws-noside") ? "Show" : "Hide") + " panels", "Tab", function () { D.hidePanels(); }]);
    return items;
  };
  var base = Object.getOwnPropertyDescriptor(WS, "windowItems");
  Object.defineProperty(WS, "windowItems", { get: function () { return (base && base.get ? base.get() : []).concat(D.menuItems()); }, configurable: true });
  WS.key(function (e) { return e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && document.activeElement === ED.stage; }, function () { D.hidePanels(); });

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      PS.list.forEach(wire);
      grip();
      if (st._sideW) D.setWidth(st._sideW);
      if (st._hidden) D.hidePanels(true);
      PS.list.forEach(function (p) { var s2 = st[p.id]; if (s2 && s2.float && s2.shown !== false) D.float(p.id, s2.float); });
    }, 0);
  });
  var add0 = WS.panel;
  WS.panel = function (o) { var p = add0(o); setTimeout(function () { wire(p); }, 0); return p; };

  FX.tests.push(async function (ok) {
    var c = D.clean({ panels: { info: { shown: true, open: false, float: { x: -50, y: 20, w: 5000 } }, evil: { shown: true }, _order: ["info", "nope", "layers"] }, sideW: 9999, view: { grid: true, gridColor: "red", units: "cm", gridEvery: "1e9" } });
    ok(c && c.panels.info.float.x === 0 && c.panels.info.float.w === 900 && !c.panels.evil && c.panels._order.join() === "info,layers" && !c.sideW && c.view.grid === true && !c.view.gridColor && c.view.units === "cm" && !c.view.gridEvery, "workspace files are validated");
    var keep = D.capture(false);
    D.apply(BUILTIN.Review); ok(!PS.byId.notes.el.hidden && PS.byId.histogram.el.hidden && PS.order()[0] === "notes", "built-in workspace applied");
    D.float("info", { x: 100, y: 100, w: 260 }); ok(D.floating().indexOf("info") >= 0 && PS.byId.info.el.closest(".ws-float"), "panel floats");
    var cap = D.capture(false); ok(cap.panels.info.float && cap.panels.info.float.x === 100, "floating position captured");
    D.dock("info"); ok(PS.byId.info.el.parentNode === side(), "panel docks back");
    D.apply(keep);
  });
})();
