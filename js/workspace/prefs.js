/* Workspace (files lane): Edit › Preferences… (Ctrl+K). History states and memory, units and the resolution of new
   documents, guide / smart guide / grid colours and spacing, tool hints, and resets. Stored in this browser only. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, WS = PE.ws, FX = PE.files, h = S3.h, W = ED.ui.w;
  var PR = WS.prefs = {};
  var DEF = { histMax: 60, histMB: 0, newDpi: 72, hints: true };
  var P = Object.assign({}, DEF, S3.store("pe-prefs") || {});
  PR.p = P;
  function save() { S3.store("pe-prefs", P); }
  PR.budget = function () { return P.histMB > 0 ? P.histMB * 1e6 : PE.historyBudget(); };
  function apply(hh) { if (!hh) return; hh.max = P.histMax; hh.budget = PR.budget(); while ((hh.list.length > hh.max || hh.bytes > hh.budget) && hh.pos > 1) { var o = hh.list.shift(); hh.bytes -= o.bytes; hh.pos--; hh.dropped++; } }
  PR.apply = function () {
    apply(ED.hist);
    if (WS.tabs) WS.tabs.list.forEach(function (t) { if (t.hist && t.hist !== ED.hist) apply(t.hist); });
    document.getElementById("app").classList.toggle("ws-nohints", !P.hints);
    ED.emit("changed");
  };
  // new documents: history settings and the default resolution
  var open0 = ED.openDoc;
  ED.openDoc = function (doc) {
    var r = open0.apply(this, arguments);
    if (ED.doc === doc) apply(ED.hist);
    return r;
  };
  var blank0 = ED.newBlank;
  ED.newBlank = function () { var r = blank0.apply(this, arguments); if (ED.doc && !ED.doc.dpi && P.newDpi !== 72) ED.doc.dpi = P.newDpi; return r; };

  PR.dialog = function () {
    var q = Object.assign({}, P), wp = Object.assign({}, WS.p);
    function num(v, min, max, step) { return h("input", { type: "number", "class": "input", min: String(min), max: String(max), step: step || "1", value: String(v) }); }
    var hm = num(q.histMax, 1, 1000), mb = num(q.histMB, 0, 4000, "10"), dpi = num(q.newDpi, 1, 2400, "any");
    var ge = num(wp.gridEvery, 0.01, 100000, "any"), gs = num(wp.gridSub, 1, 64);
    function col(k) { var c = h("input", { type: "color", value: wp[k] }); c.addEventListener("input", function () { wp[k] = c.value; }); return c; }
    var body = h("div", { "class": "stack ws-prefs" }, [
      h("h3", { text: "History" }),
      h("div", { "class": "pe-custom" }, [W.field("History states", hm), W.field("Memory for history (MB, 0 = automatic)", mb)]),
      h("p", { "class": "faint pe-p", text: "Automatic is " + Math.round(PE.historyBudget() / 1e6) + " MB on this device. Steps beyond either limit are dropped, oldest first." }),
      h("h3", { text: "Units" }),
      h("div", { "class": "pe-custom" }, [W.select("Rulers", WS.UNITS, wp.units, function (v) { wp.units = v; }), W.field("New documents (ppi)", dpi)]),
      h("h3", { text: "Guides & grid" }),
      h("div", { "class": "pe-custom" }, [h("label", { "class": "pe-of" }, [h("span", { text: "Guides" }), col("guideColor")]), h("label", { "class": "pe-of" }, [h("span", { text: "Smart guides" }), col("smartColor")]), h("label", { "class": "pe-of" }, [h("span", { text: "Grid" }), col("gridColor")])]),
      h("div", { "class": "pe-custom" }, [W.field("Gridline every", ge), W.select("Grid units", WS.UNITS, wp.gridUnit, function (v) { wp.gridUnit = v; }), W.field("Subdivisions", gs)]),
      h("h3", { text: "Interface" }),
      W.check("Show tool hints in the options bar", q.hints, function (v) { q.hints = v; }),
      h("div", { "class": "pe-prow" }, [W.btn("Keyboard shortcuts…", function () { dlg.close(); if (WS.keys) WS.keys.dialog(); }, "ghost", "t-keys"),
        W.btn("Reset panels", function () { S3.store("pe-panels", undefined); S3.toast("Panels reset: reload the page to see the default layout"); }, "ghost"),
        W.btn("Reset all preferences", function () { ["pe-prefs", "pe-ws", "pe-panels", "pe-keys", "pe-exportas", "pe-histo", "pe-info"].forEach(function (k) { S3.store(k, undefined); }); dlg.close(); S3.toast("Preferences reset: reload the page to apply them everywhere"); }, "ghost")])]);
    var go = W.btn("OK", function () {
      P.histMax = PE.clamp(Math.round(+hm.value || 60), 1, 1000); P.histMB = PE.clamp(Math.round(+mb.value || 0), 0, 4000); P.newDpi = PE.clamp(+dpi.value || 72, 1, 2400); P.hints = q.hints;
      if (+ge.value > 0) wp.gridEvery = +ge.value; wp.gridSub = PE.clamp(Math.round(+gs.value || 4), 1, 64);
      ["units", "guideColor", "smartColor", "gridColor", "gridEvery", "gridUnit", "gridSub"].forEach(function (k) { if (WS.p[k] !== wp[k]) WS.set(k, wp[k]); });
      save(); dlg.close(); PR.apply(); S3.toast("Preferences saved");
    }, "primary");
    var dlg = W.modal("Preferences", body, [h("span", { "class": "faint", text: "Saved in this browser only." }), h("span", { "class": "grow" }), W.btn("Cancel", function () { dlg.close(); }, "ghost"), go], true);
  };
  FX.menu("Edit", ["Preferences…", "Ctrl+K", PR.dialog], null, true);
  WS.key(function (e) { return WS.ctrl(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k"; }, PR.dialog, true);
  document.addEventListener("DOMContentLoaded", function () { document.getElementById("app").classList.toggle("ws-nohints", !P.hints); if (ED.hist) apply(ED.hist); });

  FX.tests.push(async function (ok) {
    var keepP = Object.assign({}, P), keepH = ED.hist, hh = new PE.History(1e9, 60), noop = function () {};
    for (var i = 0; i < 30; i++) hh.push({ label: "s" + i, bytes: 10, undo: noop, redo: noop });
    P.histMax = 10; ED.hist = hh; apply(hh);
    ok(hh.list.length === 10 && hh.pos === 10 && hh.dropped === 20, "history states preference trims old steps");
    hh.push({ label: "x", bytes: 10, undo: noop, redo: noop }); ok(hh.list.length === 10, "history states limit holds");
    Object.assign(P, keepP); ED.hist = keepH;
  });
})();
