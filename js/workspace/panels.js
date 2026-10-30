/* Workspace (files lane): panel registry for the side bar. Panels are collapsible sections that can be shown or hidden
   from the Window menu; their state (shown, open, order) is part of the workspace (WS.layout). Lanes add panels with
   WS.panel({ id, title, build(body, api), update(why), open, shown }). The app's own Properties, Layers and History
   panels are registered too, so they can be hidden and reordered the same way. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, h = S3.h;
  var PS = WS.panels = { list: [], byId: {} };
  var state = S3.store("pe-panels") || {};      // id -> { shown, open }
  function persist() { S3.store("pe-panels", state); }
  PS.state = state;

  function side() { return document.querySelector(".pe-side"); }
  function wire(p) {
    var st = state[p.id] || (state[p.id] = {});
    if (st.shown == null) st.shown = p.shown !== false;
    p.el.hidden = !st.shown;
    if (p.el.tagName === "DETAILS") {
      if (st.open != null) p.el.open = !!st.open; else if (p.open != null) p.el.open = !!p.open;
      p.el.addEventListener("toggle", function () { st.open = p.el.open; persist(); if (p.el.open && p.update) p.update("open"); });
    }
  }
  // register a new panel (built here) or an existing element (core panels)
  WS.panel = function (o) {
    var p = Object.assign({}, o);
    if (!p.el) {
      p.body = h("div", { "class": "pe-pbody ws-pbody" });
      p.head = h("summary", {}, [p.title, p.badge ? p.badge : null]);
      p.el = h("details", { "class": "pe-panel ws-panel", "data-panel": p.id }, [p.head, p.body]);
      if (p.build) p.build(p.body, p);
    }
    p.el.setAttribute("data-panel", p.id);
    p.isOpen = function () { return PS.isOpen(p); };
    PS.list.push(p); PS.byId[p.id] = p;
    if (side()) place(p); else document.addEventListener("DOMContentLoaded", function () { place(p); });
    return p;
  };
  function place(p) {
    var s = side(); if (!p.el.parentNode) s.appendChild(p.el);
    wire(p);
    if (p.update && p.isOpen()) p.update("init");
  }
  PS.isOpen = function (p) { return !p.el.hidden && (p.el.tagName !== "DETAILS" || p.el.open); };
  PS.show = function (id, on) {
    var p = PS.byId[id]; if (!p) return;
    var st = state[id] = state[id] || {};
    st.shown = on == null ? !st.shown : !!on; p.el.hidden = !st.shown;
    if (st.shown && p.el.tagName === "DETAILS" && !p.el.open) { p.el.open = true; st.open = true; }
    persist();
    if (st.shown && p.update) p.update("open");
    if (st.shown) p.el.scrollIntoView({ block: "nearest" });
  };
  PS.order = function () { return Array.prototype.map.call(side().children, function (el) { return el.getAttribute("data-panel"); }).filter(Boolean); };
  PS.setOrder = function (ids) {
    var s = side(); (ids || []).forEach(function (id) { var p = PS.byId[id]; if (p) s.appendChild(p.el); });
    state._order = PS.order(); persist();
  };

  // Window menu entries (one per panel, with a tick when shown)
  PS.menuItems = function () {
    return ["-"].concat(PS.list.map(function (p) {
      var it = [p.title, p.key || "", function () { PS.show(p.id); }];
      Object.defineProperty(it, 0, { get: function () { return (state[p.id] && state[p.id].shown !== false ? "✓ " : "  ") + p.title; } });
      return it;
    }));
  };
  Object.defineProperty(WS, "windowItems", { get: function () { return PS.menuItems(); }, configurable: true });

  // ---------- the app's own panels ----------
  document.addEventListener("DOMContentLoaded", function () {
    var s = side(); if (!s) return;
    var core = [["properties", "Properties", s.children[0]], ["layers", "Layers", s.querySelector(".pe-lpanel")], ["history", "History", s.querySelector("#hist") && s.querySelector("#hist").closest("details")]];
    core.reverse().forEach(function (c) { if (c[2]) { var p = { id: c[0], title: c[1], el: c[2] }; c[2].setAttribute("data-panel", c[0]); p.isOpen = function () { return PS.isOpen(p); }; PS.list.unshift(p); PS.byId[c[0]] = p; wire(p); } });
    if (Array.isArray(state._order)) PS.setOrder(state._order);
  });
  // repaint open panels when the document or view changes (each panel decides what to do)
  function each(why) { PS.list.forEach(function (p) { if (p.update && p.isOpen && p.isOpen()) { try { p.update(why); } catch (e) { console.error(e); } } }); }
  ED.on("changed", function () { each("changed"); });
  ED.on("layers", function () { each("layers"); });
  ED.on("view", function (a) { each(a && typeof a === "object" ? "cursor" : "view"); });
  ED.on("tool", function () { each("tool"); });
  PS.each = each;
})();
