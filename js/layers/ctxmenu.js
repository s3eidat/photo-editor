/* Selection lane: right-click menu on Layers rows (also long-press on touch screens, and the Menu key or
   Shift+F10 on a focused row). Its items are the Layer / Select menu commands, so it follows whatever they do. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, SX = PE.sx, h = S3.h;
  // [shown label, menu, menu item label]; "-" separates groups; items missing from the menus are left out.
  var ITEMS = [["Rename…", null, "rename"], ["Layer style…", "Layer", "Layer style…"], "-",
    ["Duplicate layer", "Layer", "Duplicate layer"], ["Delete layer", "Layer", "Delete layer"], "-",
    ["Group layers", "Layer", "Group layers"], ["Ungroup layers", "Layer", "Ungroup layers"], ["Create / release clipping mask", "Layer", "Create / release clipping mask"],
    ["Convert to smart layer", "Layer", "Convert to smart layer"], ["Rasterize layer", "Layer", "Rasterize layer"], "-",
    ["Add mask (reveal all)", "Layer", "Add mask (reveal all)"], ["Add mask from selection", "Layer", "Add mask from selection"], ["Apply mask", "Layer", "Apply mask"], ["Delete mask", "Layer", "Delete mask"], "-",
    ["Select pixels", "Select", "Layer pixels"], ["Copy layer style", "Layer", "Copy layer style"], ["Paste layer style", "Layer", "Paste layer style"], ["Clear layer style", "Layer", "Clear layer style"],
    ["Link layers", "Layer", "Link layers"], ["Unlink layers", "Layer", "Unlink layers"], "-",
    ["Merge down", "Layer", "Merge down"], ["Merge visible", "Layer", "Merge visible"], ["Flatten image", "Layer", "Flatten image"]];
  function find(menu, label) {
    var M = (ED.ui.MENUS || []).filter(function (m) { return m[0] === menu; })[0];
    return M ? M[1].filter(function (it) { return it !== "-" && it[0] === label; })[0] : null;
  }
  var pop = null, back = null, opened = 0;
  function close() { if (!pop) return; pop.remove(); pop = null; if (back && back.focus) back.focus({ preventScroll: true }); back = null; }
  SX.closeLayerMenu = close;
  SX.openLayerMenu = function (L, x, y, from) {
    close();
    if (!SX.picked[L.id] && ED.doc.active !== L.id) SX.pickLayer(L, null, false);
    var list = [], lastSep = true;
    ITEMS.forEach(function (it) {
      if (it === "-") { if (!lastSep) { list.push("-"); lastSep = true; } return; }
      var fn, en = true;
      if (it[2] === "rename") fn = function () { SX.renameLayer(L); };
      else { var m = find(it[1], it[2]); if (!m) return; fn = m[2]; en = !m[3] || m[3](); }
      list.push([it[0], fn, en]); lastSep = false;
    });
    if (list[list.length - 1] === "-") list.pop();
    pop = h("div", { "class": "pe-menu pe-ctx", role: "menu", "aria-label": "Layer: " + L.name });
    list.forEach(function (it) {
      if (it === "-") { pop.appendChild(h("hr")); return; }
      var b = h("button", { type: "button", role: "menuitem", "class": "pe-mi" }, [h("span", { text: it[0] })]);
      if (!it[2]) b.disabled = true;
      b.addEventListener("click", function () { close(); it[1](); });
      pop.appendChild(b);
    });
    pop.addEventListener("keydown", function (e) {
      var items = S3.$$(".pe-mi:not([disabled])", pop), i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
      else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    document.body.appendChild(pop); back = from || null; opened = Date.now();
    var r = pop.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    pop.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + "px";
    pop.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + "px";
    var f = pop.querySelector(".pe-mi:not([disabled])"); if (f) f.focus({ preventScroll: true });
  };
  document.addEventListener("pointerdown", function (e) { if (pop && !pop.contains(e.target)) close(); }, true);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", function (e) { if (pop && !pop.contains(e.target) && Date.now() - opened > 300) close(); }, true);
  ED.on("changed", function (why) { if (why === "open") close(); });

  function rowLayer(el) { var row = el && el.closest && el.closest(".pe-layer"), id = row && row.getAttribute("data-id"); return id && ED.doc ? { L: PE.findLayer(ED.doc, id), row: row } : null; }
  document.addEventListener("DOMContentLoaded", function () {
    var list = document.getElementById("layerList"); if (!list) return;
    list.addEventListener("contextmenu", function (e) {
      var r = rowLayer(e.target); if (!r || !r.L) return;
      e.preventDefault(); SX.openLayerMenu(r.L, e.clientX, e.clientY, r.row);
    });
    list.addEventListener("keydown", function (e) {
      if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) return;
      var r = rowLayer(e.target); if (!r || !r.L) return;
      e.preventDefault(); e.stopPropagation(); var b = r.row.getBoundingClientRect(); SX.openLayerMenu(r.L, b.left + 24, b.bottom - 4, r.row);
    });
    var hold = null;                // long-press (touch)
    list.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch") return;
      var r = rowLayer(e.target); if (!r || !r.L) return;
      var x = e.clientX, y = e.clientY;
      hold = { x: x, y: y, t: setTimeout(function () { hold = null; SX.openLayerMenu(r.L, x, y, r.row); }, 550) };
    });
    function cancel(e) { if (hold && (!e || e.type !== "pointermove" || Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8)) { clearTimeout(hold.t); hold = null; } }
    list.addEventListener("pointermove", cancel); list.addEventListener("pointerup", cancel); list.addEventListener("pointercancel", cancel);
  });

  SX.tests.push(async function (ok) {
    var a = PE.rasterFromCanvas(SX.solid(2, 2, "#ff0000"), "a"), b = PE.rasterFromCanvas(SX.solid(2, 2, "#00ff00"), "b"), d = SX.scratch(2, 2, [a, b]);
    d.active = a.id; SX.openLayerMenu(b, 10, 10);
    var labels = S3.$$(".pe-ctx .pe-mi").map(function (x) { return x.textContent; }), dup = S3.$$(".pe-ctx .pe-mi").filter(function (x) { return x.textContent === "Duplicate layer"; })[0];
    ok(d.active === b.id && labels.indexOf("Rename…") === 0 && !!dup, "layer right-click menu picks the row and lists layer commands");
    dup.click();
    ok(!document.querySelector(".pe-ctx") && d.layers.length === 3, "a menu command runs and closes the menu");
  });
})();
