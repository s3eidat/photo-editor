/* Selection lane: lock options (transparent pixels, image pixels, position, all), bring to front / send to back,
   and Select › Reselect. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  SX.KEYS.push("lockA", "lockP", "lockM");
  SX.addIcons({
    "t-lockA": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16" opacity=".5"/><rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none" opacity=".6"/><rect x="12" y="12" width="8" height="8" fill="currentColor" stroke="none" opacity=".6"/>',
    "t-lockP": '<path d="M20.5 3.5c-3 .8-8.7 6-10.9 9.2l1.9 1.9c3.2-2.2 8.3-7.9 9-11.1z"/><path d="M9.2 13.5c-2.1 0-3.7 1.6-3.7 3.6 0 1.4-.9 2.3-2 2.9 3.1.6 7.4-.4 7.7-4.6"/>',
    "t-lockM": '<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>'
  });
  var ed0 = PE.editableExt;
  PE.editableExt = function (L, need) {
    if (ed0 && !ed0(L, need)) return false;
    if (need === "pixels" && !ED.maskEdit) {
      if (L.lockP) { S3.toast("“" + L.name + "” has its pixels locked (Layers › lock options)", "error"); return false; }
      if (L.lockA && ED.tool === "eraser") { S3.toast("Transparent pixels are locked on “" + L.name + "”: the eraser can't remove pixels", "error"); return false; }
    }
    if (need !== "pixels" && L.lockM && ["move"].indexOf(ED.tool) >= 0) { S3.toast("“" + L.name + "” has its position locked", "error"); return false; }
    return true;
  };
  ["applyTransform", "flipLayer", "startTransform", "nudge"].forEach(function (fn) {
    var orig = ED[fn];
    ED[fn] = function () { var L = ED.layer(); if (L && L.lockM && (fn !== "applyTransform" || (ED.xf && ED.xf.L === L))) { S3.toast("“" + L.name + "” has its position locked", "error"); if (fn === "applyTransform") ED.cancelTransform(); return; } return orig.apply(this, arguments); };
  });
  ["lockA", "lockP", "lockM"].forEach(function (k) { SX.fields[k] = { save: function (L) { return L[k] ? true : undefined; }, parse: function (v) { return v === true ? true : undefined; } }; });
  function toggle(k, label) { var L = ED.layer(); if (!L || !SX.need()) return; ED.meta((L[k] ? "Unlock " : "Lock ") + label, function () { if (L[k]) delete L[k]; else L[k] = true; }); }
  SX.toggleLock = toggle;
  var row = null;
  function sync() {
    if (!row) return;
    var L = ED.layer();
    S3.$$("button", row).forEach(function (b) { var k = b.getAttribute("data-k"), on = !!(L && (k === "all" ? L.locked : L[k])); b.setAttribute("aria-pressed", String(on)); b.disabled = !L; });
  }
  document.addEventListener("DOMContentLoaded", function () {
    var op = S3.$(".pe-lfill") || S3.$(".pe-lop"); if (!op) return;
    var w = ED.ui.w;
    row = h("div", { "class": "pe-locks", role: "group", "aria-label": "Lock" }, [h("span", { "class": "faint", text: "Lock" }),
      h("button", { type: "button", "class": "pe-lkb", "data-k": "lockA", title: "Lock transparent pixels: paint only where the layer already has pixels", "aria-label": "Lock transparent pixels", onclick: function () { toggle("lockA", "transparency"); } }, [w.svg("t-lockA")]),
      h("button", { type: "button", "class": "pe-lkb", "data-k": "lockP", title: "Lock image pixels: no painting, still movable", "aria-label": "Lock image pixels", onclick: function () { toggle("lockP", "pixels"); } }, [w.svg("t-lockP")]),
      h("button", { type: "button", "class": "pe-lkb", "data-k": "lockM", title: "Lock position: no moving or transforming", "aria-label": "Lock position", onclick: function () { toggle("lockM", "position"); } }, [w.svg("t-lockM")]),
      h("button", { type: "button", "class": "pe-lkb", "data-k": "all", title: "Lock all", "aria-label": "Lock all", onclick: function () { var L = ED.layer(); if (L) ED.meta(L.locked ? "Unlock layer" : "Lock layer", function () { L.locked = !L.locked; }); } }, [w.svg("t-lock")])]);
    op.parentNode.insertBefore(row, op.nextSibling);
    sync();
  });
  ED.on("changed", sync); ED.on("layers", sync);
  var meta0 = SX.metaMore;
  SX.metaMore = function (L, parts) { if (meta0) meta0(L, parts); var l = [L.lockA ? "transparency" : "", L.lockP ? "pixels" : "", L.lockM ? "position" : ""].filter(Boolean); if (l.length) parts.push("locked " + l.join(", ")); };

  // ---------- bring to front / send to back (within the layer's group) ----------
  SX.toEnd = function (front) {
    if (!SX.need()) return; var d = ED.doc, a = ED.layer(); if (!a) return;
    var t = SX.tree(d), sib = SX.groupsApi.siblings(a, t), end = front ? sib[sib.length - 1] : sib[0];
    if (end === a) return;
    ED.meta(front ? "Bring to front" : "Send to back", function () { SX.groupsApi.place(d, a, end, front ? "above" : "below"); });
    ED.emit("layers");
  };
  (ED.ui.keys = ED.ui.keys || []).push(function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || !ED.doc) return false;
    if (e.code === "BracketRight") { e.preventDefault(); SX.toEnd(true); return true; }
    if (e.code === "BracketLeft") { e.preventDefault(); SX.toEnd(false); return true; }
    if (e.code === "KeyD") { e.preventDefault(); SX.reselect(); return true; }
    return false;
  });
  SX.menu("Layer", [["Bring to front", "Ctrl+Shift+]", function () { SX.toEnd(true); }, SX.has], ["Send to back", "Ctrl+Shift+[", function () { SX.toEnd(false); }, SX.has]], "Send backward");

  // ---------- reselect ----------
  var last = new WeakMap(), des = ED.deselect;
  ED.deselect = function () { var d = ED.doc; if (d && d.sel) last.set(d, d.sel); return des.apply(this, arguments); };
  SX.reselect = function () { var d = ED.doc, s = d && last.get(d); if (!s || s.w !== d.w || s.h !== d.h) { S3.toast("Nothing to reselect", "error"); return; } ED.meta("Reselect", function () { d.sel = s; }); };
  SX.menu("Select", [["Reselect", "Ctrl+Shift+D", function () { SX.reselect(); }, function () { var d = ED.doc; return !!(d && last.get(d)); }]], "Deselect");

  SX.tests.push(async function (ok) {
    var c = PE.mk(10, 10); PE.cx2(c).fillStyle = "#ff0000"; PE.cx2(c).fillRect(0, 0, 5, 10);
    var L = PE.rasterFromCanvas(PE.touch(c), "half"), d = SX.scratch(10, 10, [L]); L.lockA = true;
    var o = ED.o.brush, keep = Object.assign({}, o), tool = ED.tool; ED.tool = "brush"; o.size = 30; o.hard = 1; o.op = 1; d.fg = "#0000ff";
    var ev = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
    ED.TOOLS.brush.down({ x: 5, y: 5 }, ev); ED.TOOLS.brush.up({ x: 5, y: 5 }, ev);
    ok(SX.px(L.canvas, 2, 2).join() === "0,0,255,255" && SX.px(L.canvas, 8, 2)[3] === 0, "locked transparency: paint only on existing pixels");
    L.lockA = false; L.lockP = true; var n = ED.hist.pos; ED.TOOLS.brush.down({ x: 8, y: 8 }, ev); ED.TOOLS.brush.up({ x: 8, y: 8 }, ev); ok(ED.hist.pos === n && SX.px(L.canvas, 8, 8)[3] === 0, "locked pixels block painting");
    L.lockP = false; L.lockM = true; ED.nudge(2, 0); ok(L.x === 0, "locked position blocks moving"); L.lockM = false;
    Object.assign(o, keep); ED.tool = tool;
    var b2 = PE.rasterFromCanvas(SX.solid(2, 2, "#000"), "b2"), c2 = PE.rasterFromCanvas(SX.solid(2, 2, "#fff"), "c2"); d.layers.push(b2, c2); d.active = L.id;
    SX.toEnd(true); ok(d.layers[d.layers.length - 1] === L, "bring to front"); SX.toEnd(false); ok(d.layers[0] === L, "send to back");
    d.sel = PE.makeSel(d, window.PIX.rectMask(10, 10, 1, 1, 3, 3)); ED.deselect(); SX.reselect(); ok(d.sel && d.sel.b.w === 3, "reselect");
  });
})();
