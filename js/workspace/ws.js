/* Workspace (files lane): shared state for rulers, guides, grid, snapping, panels and preferences.
   PE.ws (WS): workspace preferences (this browser), units, document-level fields that are saved in projects and
   undone through the normal history, and small helpers for menus and keys. */
(function () {
  "use strict";
  var PE = window.PE, ED = PE.ed, FX = PE.files;
  var WS = PE.ws = PE.ws || {};

  // ---------- preferences (per browser) ----------
  var DEF = WS.DEF = { rulers: false, units: "px", guides: true, lockGuides: false, guideColor: "#14b8e6", smartColor: "#ff2bd6",
    grid: false, gridEvery: 100, gridUnit: "px", gridSub: 4, gridColor: "#8a8f98", snap: true, snapGuides: true, snapGrid: true, snapLayers: true, snapDoc: true, smart: true };
  var P = Object.assign({}, DEF, S3.store("pe-ws") || {});
  WS.p = P;
  WS.set = function (k, v) { P[k] = v; S3.store("pe-ws", P); ED.renderOvl(); ED.emit("ws", k); };
  WS.toggle = function (k) { WS.set(k, !P[k]); return P[k]; };

  // ---------- units ----------
  WS.UNITS = [["px", "Pixels"], ["in", "Inches"], ["cm", "Centimetres"], ["mm", "Millimetres"], ["pt", "Points"], ["pc", "Picas"], ["%", "Percent"]];
  WS.dpi = function (doc) { doc = doc || ED.doc; return doc && doc.dpi > 0 ? doc.dpi : 72; };
  // px <-> unit along an axis ("x" uses the width for %, "y" the height)
  WS.toUnit = function (px, unit, axis, doc) {
    doc = doc || ED.doc; var dpi = WS.dpi(doc);
    switch (unit || P.units) {
      case "in": return px / dpi; case "cm": return px / dpi * 2.54; case "mm": return px / dpi * 25.4; case "pt": return px / dpi * 72; case "pc": return px / dpi * 6;
      case "%": return doc ? px / (axis === "y" ? doc.h : doc.w) * 100 : px;
      default: return px;
    }
  };
  WS.fromUnit = function (v, unit, axis, doc) { var k = WS.toUnit(1000, unit, axis, doc) / 1000; return k ? v / k : v; };
  WS.fmt = function (px, unit, axis) {
    var u = unit || P.units, v = WS.toUnit(px, u, axis);
    return (u === "px" ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100)) + (u === "px" ? " px" : u === "%" ? "%" : " " + u);
  };

  // ---------- document-level fields saved in .s3photo (project.json "ws" object) ----------
  // WS.fields[key] = { save(doc) -> JSON-able or undefined, open(raw, doc) (must validate raw) }
  WS.fields = {};
  PE.docSaveExt = function (doc, meta) {
    var o = {};
    Object.keys(WS.fields).forEach(function (k) { var v = WS.fields[k].save(doc); if (v !== undefined) o[k] = v; });
    if (Object.keys(o).length) meta.ws = o;
  };
  PE.docOpenExt = function (text, doc) {
    var d; try { d = JSON.parse(text); } catch (e) { return; }
    var o = d && d.ws && typeof d.ws === "object" && !Array.isArray(d.ws) ? d.ws : null; if (!o) return;
    Object.keys(WS.fields).forEach(function (k) { if (o[k] !== undefined) { try { WS.fields[k].open(o[k], doc); } catch (e) { /* ignore a bad field */ } } });
  };
  WS.num = function (v, a, b) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : null; };

  // Undoable change of a document-level field (guides, notes…): fn mutates doc[key] (or replaces it).
  WS.edit = function (label, key, fn) {
    var d = ED.doc; if (!d) return;
    var before = PE.clone(d[key]); fn(d);
    var after = PE.clone(d[key]);
    if (JSON.stringify(before) === JSON.stringify(after)) { ED.renderOvl(); return; }
    ED.push({ label: label, bytes: 200 + JSON.stringify(after || null).length * 2, undo: function () { d[key] = PE.clone(before); ED.emit("ws", key); }, redo: function () { d[key] = PE.clone(after); ED.emit("ws", key); } });
    ED.emit("ws", key);
  };

  // ---------- keys ----------
  // WS.key(test(e) -> bool, fn): handled before the app's own shortcuts. Works with no document only if anyDoc.
  WS.key = function (test, fn, anyDoc) {
    (ED.ui.keys = ED.ui.keys || []).push(function (e) {
      if (!anyDoc && !ED.doc) return false;
      if (!test(e)) return false;
      e.preventDefault(); fn(e); return true;
    });
  };
  WS.ctrl = function (e) { return e.ctrlKey || e.metaKey; };

  // ---------- menu item that shows a check mark when on ----------
  WS.checkItem = function (label, key, sc, fn) {
    var it = [label, sc || "", function () { if (fn) fn(); else WS.toggle(key); }, null];
    Object.defineProperty(it, 0, { get: function () { return (P[key] ? "✓ " : "  ") + label; } });
    return it;
  };
})();
