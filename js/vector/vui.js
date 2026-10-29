/* Vector lane UI plumbing: its icons (drawn for this app), stylesheet, tool groups in the tool bar (pen family,
   path selection family), keyboard shortcuts, menu helpers and a live "edit with one history step per pause" helper. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, VX = PE.VX, h = S3.h;
  var UI = VX.ui = {};

  // ---------- icons ----------
  var ICONS = {
    "t-pen": '<path d="M12 2.5 18 11.5l-3.6 8.5H9.6L6 11.5z"/><path d="M12 2.5v8.2"/><circle cx="12" cy="12.4" r="1.6"/><path d="M9 22h6"/>',
    "t-cpen": '<path d="M12 2.5 18 11.5l-3.6 8.5H9.6L6 11.5z"/><circle cx="12" cy="12.4" r="1.6"/><path d="M2.5 21c3-5 6-6 9-4" stroke-dasharray="2 1.6"/>',
    "t-ffpen": '<path d="M14 2.5l5 7.5-3 7h-4l-3-7z"/><circle cx="14" cy="11" r="1.3"/><path d="M2.5 20c2-3 3.5 1 5.5-1.5S10 15 11.5 17"/>',
    "t-addpt": '<path d="M12 6.5 17 14l-3 6.5h-4L7 14z"/><circle cx="12" cy="14.6" r="1.3"/><path d="M4 2.5v6M1 5.5h6"/>',
    "t-delpt": '<path d="M12 6.5 17 14l-3 6.5h-4L7 14z"/><circle cx="12" cy="14.6" r="1.3"/><path d="M1 5.5h6"/>',
    "t-cvtpt": '<path d="M3.5 19 12 5l8.5 14"/><rect x="10.3" y="3.3" width="3.4" height="3.4" fill="currentColor"/>',
    "t-psel": '<path d="M6 2.8v16.4l4.4-4.3 3.1 6.6 2.7-1.2-3.1-6.5H19z" fill="currentColor"/>',
    "t-dsel": '<path d="M6 2.8v16.4l4.4-4.3 3.1 6.6 2.7-1.2-3.1-6.5H19z"/>',
    "t-ptext": '<rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="2.5 2"/><path d="M8 8h8M12 8v9"/>',
    "t-tpath": '<path d="M3 18c4-9 14-9 18 0" stroke-dasharray="2.5 2"/><path d="M8 6.5h8M12 6.5v8"/>',
    "t-warp": '<path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 16c3-3 6 3 9 0s6 3 9 0M3 8v8M21 8v8"/>',
    "t-glyph": '<path d="M5 19 10 5l5 14M7 14h6"/><path d="M15.5 8.5c1-1.3 4.5-1.3 4.5 1.4V19M20 13.5c-4-.6-5.3 1-5.3 2.8 0 3 4 3 5.3.4"/>',
    "s-polygon": '<path d="M12 3.5 20 9.3l-3 9.2H7L4 9.3z"/>',
    "s-custom": '<path d="M12 20.5C7 17 3 13.6 3 9.2 3 6.4 5.2 4.3 7.8 4.3c1.8 0 3.3 1 4.2 2.6.9-1.6 2.4-2.6 4.2-2.6 2.6 0 4.8 2.1 4.8 4.9 0 4.4-4 7.8-9 11.3z"/>',
    "v-unite": '<rect x="3.5" y="3.5" width="11" height="11" fill="currentColor"/><rect x="9.5" y="9.5" width="11" height="11" fill="currentColor"/>',
    "v-sub": '<path d="M3.5 3.5h11v6h-5v5h-6z" fill="currentColor"/><rect x="9.5" y="9.5" width="11" height="11"/>',
    "v-int": '<rect x="3.5" y="3.5" width="11" height="11"/><rect x="9.5" y="9.5" width="11" height="11"/><rect x="9.5" y="9.5" width="5" height="5" fill="currentColor"/>',
    "v-xor": '<path d="M3.5 3.5h11v6h-5v5h-6zM20.5 20.5h-11v-6h5v-5h6z" fill="currentColor"/><rect x="9.5" y="9.5" width="5" height="5"/>',
    "v-new": '<rect x="5" y="5" width="14" height="14" rx="1.5"/><path d="M12 8.5v7M8.5 12h7"/>',
    "v-path": '<path d="M4 18C6 8 12 6 20 6"/><rect x="2.5" y="16.5" width="3" height="3" fill="currentColor"/><rect x="18.5" y="4.5" width="3" height="3" fill="currentColor"/>',
    "v-liquify": '<path d="M4 12c2-6 6-6 8 0s6 6 8 0"/><path d="M4 6c2-2 4-2 6 0M14 18c2 2 4 2 6 0"/>',
    "t-vxf": '<path d="M4 6c5-3 11 3 16 0M4 18c5-3 11 3 16 0M4 6v12M20 6v12M9.3 5.2v13.6M14.7 6.8v11.6"/>',
    "v-pin": '<circle cx="12" cy="7" r="3.5"/><path d="M12 10.5V21"/>'
  };
  (function sprite() {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
    s.setAttribute("style", "display:none"); s.setAttribute("aria-hidden", "true");
    var tmp = document.createElementNS(NS, "svg");
    Object.keys(ICONS).forEach(function (id) {
      var sym = document.createElementNS(NS, "symbol"); sym.setAttribute("id", id); sym.setAttribute("viewBox", "0 0 24 24");
      tmp.innerHTML = ICONS[id];      // constant markup written in this file, never user input
      while (tmp.firstChild) sym.appendChild(tmp.firstChild);
      s.appendChild(sym);
    });
    (document.body || document.documentElement).appendChild(s);
    var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "js/vector/vector.css"; document.head.appendChild(l);
  })();

  // ---------- tool groups ----------
  var NAMES = UI.NAMES = { pen: "Pen", cpen: "Curvature pen", ffpen: "Freeform pen", addpt: "Add anchor point", delpt: "Delete anchor point", cvtpt: "Convert point", psel: "Path selection", dsel: "Direct selection" };
  var GROUPS = UI.GROUPS = { pen: ["pen", "cpen", "ffpen", "addpt", "delpt", "cvtpt"], psel: ["psel", "dsel"] };
  UI.groupOf = function (t) { for (var g in GROUPS) if (GROUPS[g].indexOf(t) >= 0) return g; return null; };
  var last = Object.assign({ pen: "pen", psel: "psel" }, S3.store("pe-vgroups") || {});
  // add a tool-bar button (before the main UI builds the bar) after the tool with id `after`
  UI.addTool = function (id, label, key, after) {
    var T = ED.ui.TOOLS, at = T.length;
    T.forEach(function (t, i) { if (t[0] === after) at = i + 1; });
    T.splice(at, 0, [id, label, key]);
  };
  function syncGroups() {
    var g = UI.groupOf(ED.tool);
    if (g) { last[g] = ED.tool; S3.store("pe-vgroups", last); }
    Object.keys(GROUPS).forEach(function (k) {
      var b = document.querySelector('.pe-tool[data-tool="' + k + '"]'); if (!b) return;
      var on = GROUPS[k].indexOf(ED.tool) >= 0, cur = on ? ED.tool : last[k];
      b.setAttribute("aria-pressed", String(on));
      var u = b.querySelector("use"); if (u) u.setAttribute("href", "#t-" + cur);
      b.title = NAMES[cur] + " (" + (k === "pen" ? "P" : "A") + ", Shift+" + (k === "pen" ? "P" : "A") + " cycles)";
    });
  }
  UI.lastOf = function (g) { return last[g]; };
  // the variant picker shown in the options bar of every tool in a group
  UI.variantSeg = function (g) {
    return ED.ui.w.seg("", GROUPS[g].map(function (t) { return [t, NAMES[t], NAMES[t], "t-" + t]; }), ED.tool, function (v) { ED.setTool(v); });
  };
  UI.nameItem = function (t) { return h("span", { "class": "pe-oname" }, [ED.ui.w.svg("t-" + t), NAMES[t] || t]); };

  // ---------- keys ----------
  var KEYS = UI.keys = [];
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!ED.doc || document.querySelector(".s3-modal")) return false;
    for (var i = 0; i < KEYS.length; i++) if (KEYS[i](e)) { e.preventDefault(); return true; }
    return false;
  });
  KEYS.push(function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    var k = e.key.toLowerCase(), g = k === "p" ? "pen" : k === "a" ? "psel" : null;
    if (!g || !ED.TOOLS[GROUPS[g][0]]) return false;
    var list = GROUPS[g], cur = list.indexOf(ED.tool);
    if (e.shiftKey) { var cyc = g === "pen" ? ["pen", "cpen", "ffpen"] : list, ci = cyc.indexOf(ED.tool); ED.setTool(cyc[(ci + 1) % cyc.length]); }
    else ED.setTool(cur >= 0 ? ED.tool : last[g]);
    return true;
  });

  // ---------- options-bar and properties hooks ----------
  var OPTS = ED.ui.optsFor = ED.ui.optsFor || {};
  UI.opts = function (tool, f) { OPTS[tool] = f; };
  var PROPS = ED.ui.propsExt = ED.ui.propsExt || [];
  UI.props = function (f) { PROPS.push(f); };

  // ---------- live edits: one history step per pause (like the Properties panel) ----------
  var pb = null, pt = 0, plabel = "";
  UI.live = function (label, fn) {
    if (!pb) pb = PE.snap(ED.doc);
    plabel = label; fn(); ED.render(); ED.renderOvl();
    clearTimeout(pt); pt = setTimeout(UI.flush, 450);
  };
  var flushing = false;
  UI.flush = function () { if (!pb) return; clearTimeout(pt); var b = pb; pb = null; flushing = true; try { ED.push(PE.metaEntry(plabel, ED.doc, b)); } finally { flushing = false; } };
  var flushProps0 = ED.flushProps;
  ED.flushProps = function () { UI.flush(); if (flushProps0) flushProps0(); };
  // any other history step first records a pending live edit, so steps stay in order
  var push0 = ED.push;
  ED.push = function (e) { if (pb && !flushing && e) UI.flush(); return push0(e); };
  var undo0 = ED.undo;
  ED.undo = function () { UI.flush(); return undo0.apply(ED, arguments); };

  // ---------- menus ----------
  // add(menuName, item, afterLabel?) where item = [label, shortcut, fn, enabled?] or "-"
  UI.menu = function (menu, items, after) {
    var M = ED.ui.MENUS.filter(function (m) { return m[0] === menu; })[0];
    if (!M) { M = [menu, []]; var vi = -1; ED.ui.MENUS.forEach(function (m, i) { if (m[0] === "View") vi = i; }); ED.ui.MENUS.splice(vi < 0 ? ED.ui.MENUS.length : vi, 0, M); }
    var at = M[1].length;
    if (after) M[1].forEach(function (it, i) { if (it !== "-" && it[0] === after) at = i + 1; });
    M[1].splice.apply(M[1], [at, 0].concat(items));
  };

  // ---------- small widgets ----------
  UI.color = function (label, val, onSet, title) {
    var c = h("input", { type: "color", "class": "pe-vcol", value: PE.hex(val, "#000000"), "aria-label": label, title: title || label });
    c.addEventListener("input", function () { onSet(c.value); });
    return label ? h("label", { "class": "pe-of" }, [h("span", { text: label }), c]) : c;
  };
  UI.pnum = function (label, val, onSet, step, min, max) {
    var i = h("input", { type: "number", "class": "input", step: step || 1, value: Math.round(val * 100) / 100 });
    if (min != null) i.min = min; if (max != null) i.max = max;
    i.addEventListener("input", function () { var v = +i.value; if (isFinite(v) && i.value !== "") onSet(min != null ? PE.clamp(v, min, max == null ? Infinity : max) : v); });
    return h("label", { "class": "pe-pf" }, [h("span", { text: label }), i]);
  };
  UI.psel = function (label, opts, val, onSet) {
    var s = h("select", { "class": "select", "aria-label": label });
    opts.forEach(function (o) { var op = h("option", { value: o[0], text: o[1] }); if (String(o[0]) === String(val)) op.selected = true; s.appendChild(op); });
    s.addEventListener("change", function () { onSet(s.value); });
    return h("label", { "class": "pe-pf" }, [h("span", { text: label }), s]);
  };
  UI.pcolor = function (label, val, onSet) {
    var c = h("input", { type: "color", value: PE.hex(val, "#000000") });
    c.addEventListener("input", function () { onSet(c.value); });
    return h("label", { "class": "pe-pf pe-pcol" }, [h("span", { text: label }), c]);
  };

  // run after the main UI has built its tool bar and menus
  function ready() {
    ED.on("tool", syncGroups);
    syncGroups();
    ED.emit("vready");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else setTimeout(ready, 0);
})();
