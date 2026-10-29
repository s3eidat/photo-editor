/* Workspace (files lane): View menu entries and shortcuts for rulers, guides, grid, snapping and smart guides. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, G = WS.guides;
  function has() { return !!ED.doc; }
  var V = "View", after = "Actual pixels (100%)";
  var items = [
    WS.checkItem("Rulers", "rulers", "Ctrl+R"),
    WS.checkItem("Guides", "guides", "Ctrl+;"),
    WS.checkItem("Grid", "grid", "Ctrl+'"),
    WS.checkItem("Snap", "snap", "Ctrl+Shift+;"),
    WS.checkItem("Smart guides", "smart", "Ctrl+U"),
    WS.checkItem("Snap to guides", "snapGuides"), WS.checkItem("Snap to grid", "snapGrid"), WS.checkItem("Snap to layers", "snapLayers"), WS.checkItem("Snap to document edges", "snapDoc"),
    "-",
    WS.checkItem("Lock guides", "lockGuides", "Ctrl+Alt+;"),
    ["New guide…", "", G.newDialog, has], ["New guide layout…", "", G.layoutDialog, has], ["Clear guides", "", G.clear, function () { return !!(ED.doc && ED.doc.guides && ED.doc.guides.length); }],
    ["Guides & grid settings…", "", G.gridDialog]
  ];
  items[4][1] = "";      // Ctrl+U stays Hue/Saturation
  var M = ED.ui.MENUS.filter(function (m) { return m[0] === V; })[0][1], at = M.findIndex(function (it) { return it !== "-" && it[0] === after; });
  M.splice.apply(M, [at + 1, 0, "-"].concat(items));
  WS.key(function (e) { return WS.ctrl(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r"; }, function () { S3.toast(WS.toggle("rulers") ? "Rulers on" : "Rulers off"); });
  WS.key(function (e) { return WS.ctrl(e) && !e.shiftKey && !e.altKey && e.key === ";"; }, function () { WS.toggle("guides"); });
  WS.key(function (e) { return WS.ctrl(e) && e.altKey && e.key === ";"; }, function () { S3.toast(WS.toggle("lockGuides") ? "Guides locked" : "Guides unlocked"); });
  WS.key(function (e) { return WS.ctrl(e) && e.shiftKey && (e.key === ";" || e.key === ":"); }, function () { S3.toast(WS.toggle("snap") ? "Snap on" : "Snap off"); });
  WS.key(function (e) { return WS.ctrl(e) && !e.shiftKey && e.key === "'"; }, function () { WS.toggle("grid"); });
  document.addEventListener("DOMContentLoaded", function () { WS.rulers.init(); });
})();
